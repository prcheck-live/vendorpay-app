import { pool } from './pool';
import { hashPassword } from '../auth';
import { log } from '../logger';

// Demo users. Every account uses the same demo password; change it outside demos.
export const DEMO_PASSWORD = 'VendorPay@2026';
export const SEED_USERS = [
  { username: 'neha.joshi', displayName: 'Neha Joshi', role: 'FINANCE_OPS' },
  { username: 'priya.menon', displayName: 'Priya Menon', role: 'FINANCE_OPS' },
  { username: 'm.fernandes', displayName: 'Marco Fernandes', role: 'FINANCE_APPROVER' },
  { username: 'j.thomas', displayName: 'Jaya Thomas', role: 'FINANCE_APPROVER' },
  { username: 'ravi.kumar', displayName: 'Ravi Kumar', role: 'PROCUREMENT' },
  { username: 'audit.viewer', displayName: 'Audit Viewer', role: 'AUDITOR' },
] as const;

/** Loads demo data once. Returns false when data already exists. */
export async function seed(): Promise<boolean> {
  const existing = await pool.query('SELECT count(*)::int AS n FROM users');
  if (existing.rows[0].n > 0) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of SEED_USERS) {
      await client.query('INSERT INTO users (username, display_name, role, password_hash) VALUES ($1,$2,$3,$4)', [
        u.username, u.displayName, u.role, hashPassword(DEMO_PASSWORD),
      ]);
    }
    // Suppliers: two active, one awaiting bank-account verification.
    await client.query(`INSERT INTO suppliers (id, name, status, created_by, created_at) VALUES
      ('SUP-0192', 'Northstar Components', 'active', 'ravi.kumar', '2026-09-02T09:15:00+05:30'),
      ('SUP-0193', 'Kaveri Logistics', 'active', 'ravi.kumar', '2026-09-10T11:40:00+05:30'),
      ('SUP-0194', 'Bluepeak Packaging', 'pending_verification', 'ravi.kumar', '2026-10-20T15:05:00+05:30')`);
    await client.query("SELECT setval('supplier_seq', 194)");
    const acct = async (supplier: string, number: string, ifsc: string, status: string, verifiedBy: string | null) =>
      (await client.query(
        `INSERT INTO supplier_bank_accounts (supplier_id, account_number, ifsc, status, created_by, verified_by, verified_at)
         VALUES ($1,$2,$3,$4,'ravi.kumar',$5, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
        [supplier, number, ifsc, status, verifiedBy],
      )).rows[0].id as number;
    const northstar = await acct('SUP-0192', '50100234564421', 'HDFC0001234', 'active', 'm.fernandes');
    const kaveri = await acct('SUP-0193', '00011020007765', 'ICIC0000110', 'active', 'j.thomas');
    await acct('SUP-0194', '91802003113310', 'UTIB0000918', 'pending', null);
    // Payments: PAY-7821 is the scheduled payment the VP-184 change must not redirect.
    await client.query(
      `INSERT INTO payments (id, supplier_id, amount_minor, currency, destination_account_id, status, scheduled_for, created_by, created_at, released_by, released_at) VALUES
      ('PAY-7790', 'SUP-0193', 12540000, 'INR', $2, 'released', '2026-10-15', 'neha.joshi', '2026-10-10T10:00:00+05:30', 'j.thomas', '2026-10-15T09:30:00+05:30'),
      ('PAY-7815', 'SUP-0193', 4210000, 'INR', $2, 'scheduled', '2026-11-12', 'priya.menon', '2026-10-24T14:20:00+05:30', NULL, NULL),
      ('PAY-7821', 'SUP-0192', 85000000, 'INR', $1, 'scheduled', '2026-11-05', 'neha.joshi', '2026-10-21T16:45:00+05:30', NULL, NULL)`,
      [northstar, kaveri],
    );
    await client.query("SELECT setval('payment_seq', 7821)");
    await client.query(`INSERT INTO audit_events (type, actor, entity_type, entity_id, details, created_at) VALUES
      ('SUPPLIER_CREATED', 'ravi.kumar', 'supplier', 'SUP-0192', '{"name":"Northstar Components"}', '2026-09-02T09:15:00+05:30'),
      ('BANK_ACCOUNT_VERIFIED', 'm.fernandes', 'supplier', 'SUP-0192', '{"account":"**** 4421"}', '2026-09-03T10:05:00+05:30'),
      ('PAYMENT_SCHEDULED', 'neha.joshi', 'payment', 'PAY-7821', '{"supplierId":"SUP-0192","destination":"**** 4421","amountMinor":85000000}', '2026-10-21T16:45:00+05:30')`);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed()
    .then((done) => log('info', done ? 'seed data loaded' : 'seed skipped: data already present'))
    .catch((err) => { log('error', 'seed failed', { error: String(err) }); process.exitCode = 1; })
    .finally(() => pool.end());
}
