import { Router } from 'express';
import { authenticate, requireRole } from '../auth';
import { recordAudit } from '../audit';
import { pool, withTransaction } from '../db/pool';
import { badRequest, conflict, handle, HttpError, notFound } from '../errors';
import { log } from '../logger';
import { formatInr, maskAccount } from '../mask';

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

const SELECT_PAYMENTS = `
  SELECT p.*, s.name AS supplier_name, a.account_number AS destination_number, a.ifsc AS destination_ifsc
  FROM payments p
  JOIN suppliers s ON s.id = p.supplier_id
  JOIN supplier_bank_accounts a ON a.id = p.destination_account_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const view = (p: any) => ({
  id: p.id,
  supplierId: p.supplier_id,
  supplierName: p.supplier_name,
  amountMinor: Number(p.amount_minor),
  amount: formatInr(Number(p.amount_minor)),
  currency: p.currency,
  // The destination is fixed when the instruction is created and shown masked.
  destination: { accountId: p.destination_account_id, account: maskAccount(p.destination_number), ifsc: p.destination_ifsc },
  status: p.status,
  scheduledFor: p.scheduled_for instanceof Date ? p.scheduled_for.toISOString().slice(0, 10) : p.scheduled_for,
  createdBy: p.created_by,
  createdAt: p.created_at,
  releasedBy: p.released_by,
  releasedAt: p.released_at,
  hold: p.held_at ? { reason: p.hold_reason, bankChangeRequestId: p.hold_ref, heldAt: p.held_at,
    resolution: p.resolution, resolvedBy: p.resolved_by, resolvedAt: p.resolved_at } : null,
});

paymentsRouter.get('/', handle(async (req, res) => {
  const filter = typeof req.query.supplierId === 'string' ? req.query.supplierId : null;
  const r = filter
    ? await pool.query(`${SELECT_PAYMENTS} WHERE p.supplier_id = $1 ORDER BY p.scheduled_for DESC, p.id DESC`, [filter])
    : await pool.query(`${SELECT_PAYMENTS} ORDER BY p.scheduled_for DESC, p.id DESC`);
  res.json({ payments: r.rows.map(view) });
}));

paymentsRouter.get('/:id', handle(async (req, res) => {
  const r = await pool.query(`${SELECT_PAYMENTS} WHERE p.id = $1`, [req.params.id]);
  if (!r.rowCount) throw notFound(`Payment ${req.params.id}`);
  res.json({ payment: view(r.rows[0]) });
}));

/** VP-183: Finance Ops schedules a payment to the supplier's currently active bank account. */
paymentsRouter.post('/', requireRole('FINANCE_OPS'), handle(async (req, res) => {
  const { supplierId, amount, scheduledFor } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (typeof supplierId !== 'string' || !supplierId) errors.supplierId = 'Choose a supplier';
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
    errors.amount = 'Enter an amount greater than zero with at most two decimals';
  const today = new Date().toISOString().slice(0, 10);
  if (typeof scheduledFor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor) || scheduledFor < today)
    errors.scheduledFor = 'Choose today or a future date (YYYY-MM-DD)';
  if (Object.keys(errors).length) throw badRequest('VALIDATION_FAILED', 'Check the highlighted fields', errors);

  const actor = req.user!.username;
  const id = await withTransaction(async (c) => {
    const s = await c.query('SELECT id, status FROM suppliers WHERE id = $1', [supplierId]);
    if (!s.rowCount) throw notFound(`Supplier ${supplierId}`);
    const acct = await c.query("SELECT id, account_number FROM supplier_bank_accounts WHERE supplier_id = $1 AND status = 'active'", [supplierId]);
    if (s.rows[0].status !== 'active' || !acct.rowCount) throw conflict('SUPPLIER_NOT_ACTIVE', 'Payments can only be scheduled for suppliers with a verified bank account');
    const newId = 'PAY-' + (await c.query("SELECT nextval('payment_seq') AS n")).rows[0].n;
    const amountMinor = Math.round(amount * 100);
    await c.query(
      "INSERT INTO payments (id, supplier_id, amount_minor, currency, destination_account_id, status, scheduled_for, created_by) VALUES ($1,$2,$3,'INR',$4,'scheduled',$5,$6)",
      [newId, supplierId, amountMinor, acct.rows[0].id, scheduledFor, actor]);
    await recordAudit(c, { type: 'PAYMENT_SCHEDULED', actor, entityType: 'payment', entityId: newId,
      details: { supplierId, destination: maskAccount(acct.rows[0].account_number), amountMinor } });
    return newId;
  });
  log('info', 'payment scheduled', { paymentId: id, supplierId, actor });
  const r = await pool.query(`${SELECT_PAYMENTS} WHERE p.id = $1`, [id]);
  res.status(201).json({ payment: view(r.rows[0]) });
}));

/** VP-183: Finance Approver releases a scheduled payment; the scheduler can never release their own. */
paymentsRouter.post('/:id/release', requireRole('FINANCE_APPROVER'), handle(async (req, res) => {
  const actor = req.user!.username;
  await withTransaction(async (c) => {
    const p = await c.query('SELECT id, status, created_by FROM payments WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!p.rowCount) throw notFound(`Payment ${req.params.id}`);
    if (p.rows[0].status === 'on_hold') throw conflict('PAYMENT_ON_HOLD', 'This payment is on hold because the supplier changed bank account. Resolve the hold first.');
    if (p.rows[0].status === 'cancelled') throw conflict('PAYMENT_CANCELLED', 'This payment was cancelled');
    if (p.rows[0].status !== 'scheduled') throw conflict('ALREADY_RELEASED', 'This payment has already been released');
    if (p.rows[0].created_by === actor) throw new HttpError(403, 'SELF_RELEASE_NOT_ALLOWED', 'The person who scheduled a payment cannot release it');
    await c.query("UPDATE payments SET status = 'released', released_by = $1, released_at = now() WHERE id = $2", [actor, req.params.id]);
    await recordAudit(c, { type: 'PAYMENT_RELEASED', actor, entityType: 'payment', entityId: req.params.id });
  });
  log('info', 'payment released', { paymentId: req.params.id, actor });
  const r = await pool.query(`${SELECT_PAYMENTS} WHERE p.id = $1`, [req.params.id]);
  res.json({ payment: view(r.rows[0]) });
}));

/**
 * VP-184 AC5: a Finance Approver decides each held payment: redirect it to the supplier's
 * current active account, or cancel it. The person who requested the bank change cannot decide.
 */
paymentsRouter.post('/:id/resolve-hold', requireRole('FINANCE_APPROVER'), handle(async (req, res) => {
  const action = req.body?.action;
  if (action !== 'redirect' && action !== 'cancel') throw badRequest('VALIDATION_FAILED', 'Check the highlighted fields', { action: 'Choose redirect or cancel' });
  const actor = req.user!.username;
  await withTransaction(async (c) => {
    const p = await c.query(
      `SELECT p.*, r.requested_by AS change_requested_by, a.account_number AS old_number
       FROM payments p LEFT JOIN bank_change_requests r ON r.id = p.hold_ref
       JOIN supplier_bank_accounts a ON a.id = p.destination_account_id
       WHERE p.id = $1 FOR UPDATE OF p`, [req.params.id]);
    if (!p.rowCount) throw notFound(`Payment ${req.params.id}`);
    const pay = p.rows[0];
    if (pay.status !== 'on_hold') throw conflict('NOT_ON_HOLD', 'This payment is not on hold');
    if (pay.change_requested_by === actor) throw new HttpError(403, 'SELF_RESOLUTION_NOT_ALLOWED', 'The person who requested the bank change cannot decide its held payments');

    if (action === 'cancel') {
      await c.query("UPDATE payments SET status = 'cancelled', resolution = 'cancelled', resolved_by = $1, resolved_at = now() WHERE id = $2", [actor, pay.id]);
      await recordAudit(c, { type: 'PAYMENT_HOLD_RESOLVED', actor, entityType: 'payment', entityId: pay.id,
        details: { resolution: 'cancelled', requestId: pay.hold_ref } });
      return;
    }
    const acct = await c.query("SELECT id, account_number FROM supplier_bank_accounts WHERE supplier_id = $1 AND status = 'active'", [pay.supplier_id]);
    if (!acct.rowCount) throw conflict('SUPPLIER_NOT_ACTIVE', 'The supplier has no active bank account to redirect to');
    await c.query(
      "UPDATE payments SET status = 'scheduled', destination_account_id = $1, resolution = 'redirected', resolved_by = $2, resolved_at = now() WHERE id = $3",
      [acct.rows[0].id, actor, pay.id]);
    await recordAudit(c, { type: 'PAYMENT_HOLD_RESOLVED', actor, entityType: 'payment', entityId: pay.id,
      details: { resolution: 'redirected', requestId: pay.hold_ref, from: maskAccount(pay.old_number), to: maskAccount(acct.rows[0].account_number) } });
  });
  log('info', 'payment hold resolved', { paymentId: req.params.id, action, actor });
  const r = await pool.query(`${SELECT_PAYMENTS} WHERE p.id = $1`, [req.params.id]);
  res.json({ payment: view(r.rows[0]) });
}));
