import { Router } from 'express';
import { authenticate, requireRole } from '../auth';
import { recordAudit } from '../audit';
import { pool, withTransaction } from '../db/pool';
import { badRequest, conflict, handle, HttpError, notFound } from '../errors';
import { log } from '../logger';
import { maskAccount } from '../mask';

export const suppliersRouter = Router();
suppliersRouter.use(authenticate);

interface AccountRow { id: number; account_number: string; ifsc: string; status: string; created_by: string; verified_by: string | null; verified_at: Date | null; created_at: Date }

// Bank-account numbers never leave the service unmasked (VP-182).
const accountView = (a: AccountRow) => ({
  id: a.id,
  account: maskAccount(a.account_number),
  ifsc: a.ifsc,
  status: a.status,
  createdBy: a.created_by,
  verifiedBy: a.verified_by,
  verifiedAt: a.verified_at,
  createdAt: a.created_at,
});

suppliersRouter.get('/', handle(async (_req, res) => {
  const r = await pool.query(`
    SELECT s.id, s.name, s.status, s.created_by, s.created_at,
           a.id AS account_id, a.account_number, a.ifsc, a.status AS account_status
    FROM suppliers s
    LEFT JOIN LATERAL (
      SELECT * FROM supplier_bank_accounts b WHERE b.supplier_id = s.id
      ORDER BY (b.status = 'active') DESC, b.created_at DESC LIMIT 1
    ) a ON true
    ORDER BY s.id`);
  res.json({
    suppliers: r.rows.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      createdBy: s.created_by,
      createdAt: s.created_at,
      bankAccount: s.account_id ? { id: s.account_id, account: maskAccount(s.account_number), ifsc: s.ifsc, status: s.account_status } : null,
    })),
  });
}));

suppliersRouter.get('/:id', handle(async (req, res) => {
  const s = await pool.query('SELECT id, name, status, created_by, created_at FROM suppliers WHERE id = $1', [req.params.id]);
  if (!s.rowCount) throw notFound(`Supplier ${req.params.id}`);
  const accounts = await pool.query<AccountRow>('SELECT * FROM supplier_bank_accounts WHERE supplier_id = $1 ORDER BY created_at', [req.params.id]);
  const payments = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled, count(*) FILTER (WHERE status = 'released')::int AS released, count(*) FILTER (WHERE status = 'on_hold')::int AS on_hold
     FROM payments WHERE supplier_id = $1`, [req.params.id]);
  const row = s.rows[0];
  res.json({
    supplier: {
      id: row.id, name: row.name, status: row.status, createdBy: row.created_by, createdAt: row.created_at,
      bankAccounts: accounts.rows.map(accountView),
      payments: payments.rows[0],
    },
  });
}));

const ACCOUNT_RE = /^\d{9,18}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** VP-181: Procurement onboards a supplier; its first bank account waits for Finance verification. */
suppliersRouter.post('/', requireRole('PROCUREMENT'), handle(async (req, res) => {
  const { name, accountNumber, ifsc } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) errors.name = 'Enter a supplier name of 2 to 120 characters';
  if (typeof accountNumber !== 'string' || !ACCOUNT_RE.test(accountNumber)) errors.accountNumber = 'Enter 9 to 18 digits';
  if (typeof ifsc !== 'string' || !IFSC_RE.test(ifsc)) errors.ifsc = 'Enter a valid IFSC code, e.g. HDFC0001234';
  if (Object.keys(errors).length) throw badRequest('VALIDATION_FAILED', 'Check the highlighted fields', errors);

  const actor = req.user!.username;
  const created = await withTransaction(async (c) => {
    const id = 'SUP-' + String((await c.query("SELECT nextval('supplier_seq') AS n")).rows[0].n).padStart(4, '0');
    await c.query("INSERT INTO suppliers (id, name, status, created_by) VALUES ($1,$2,'pending_verification',$3)", [id, name.trim(), actor]);
    const acct = await c.query<AccountRow>(
      "INSERT INTO supplier_bank_accounts (supplier_id, account_number, ifsc, status, created_by) VALUES ($1,$2,$3,'pending',$4) RETURNING *",
      [id, accountNumber, ifsc, actor]);
    await recordAudit(c, { type: 'SUPPLIER_CREATED', actor, entityType: 'supplier', entityId: id, details: { name: name.trim() } });
    await recordAudit(c, { type: 'BANK_ACCOUNT_ADDED', actor, entityType: 'supplier', entityId: id, details: { account: maskAccount(accountNumber), ifsc } });
    return { id, account: acct.rows[0] };
  });
  log('info', 'supplier onboarded', { supplierId: created.id, actor });
  res.status(201).json({ supplier: { id: created.id, name: name.trim(), status: 'pending_verification', bankAccount: accountView(created.account) } });
}));

/** VP-181: Finance Approver verifies a pending bank account, which activates the supplier. */
suppliersRouter.post('/:id/bank-accounts/:accountId/verify', requireRole('FINANCE_APPROVER'), handle(async (req, res) => {
  const actor = req.user!.username;
  const result = await withTransaction(async (c) => {
    const a = await c.query<AccountRow>('SELECT * FROM supplier_bank_accounts WHERE id = $1 AND supplier_id = $2 FOR UPDATE', [
      Number(req.params.accountId), req.params.id]);
    if (!a.rowCount) throw notFound(`Bank account ${req.params.accountId} for supplier ${req.params.id}`);
    const acct = a.rows[0];
    if (acct.status !== 'pending') throw conflict('ALREADY_VERIFIED', 'This bank account is already verified');
    // Maker-checker: whoever added the account can never verify it.
    if (acct.created_by === actor) throw new HttpError(403, 'SELF_VERIFICATION_NOT_ALLOWED', 'The person who added a bank account cannot verify it');
    const v = await c.query<AccountRow>("UPDATE supplier_bank_accounts SET status = 'active', verified_by = $1, verified_at = now() WHERE id = $2 RETURNING *", [actor, acct.id]);
    await c.query("UPDATE suppliers SET status = 'active' WHERE id = $1", [req.params.id]);
    await recordAudit(c, { type: 'BANK_ACCOUNT_VERIFIED', actor, entityType: 'supplier', entityId: req.params.id, details: { account: maskAccount(acct.account_number) } });
    return v.rows[0];
  });
  log('info', 'bank account verified', { supplierId: req.params.id, actor });
  res.json({ bankAccount: accountView(result) });
}));
