import { APIRequestContext, expect } from '@playwright/test';

export const PASSWORD = process.env.DEMO_PASSWORD ?? 'VendorPay@2026';

export async function tokenFor(request: APIRequestContext, username: string): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.status(), `sign-in for ${username}`).toBe(200);
  return (await res.json()).token;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** A future date, so scheduling validations pass whatever day the suite runs. */
export function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 9 to 18 digit account number unique to this run. */
export function accountNumber(): string {
  return String(Date.now()).slice(-12) + String(Math.floor(Math.random() * 90 + 10));
}

/** Onboards and verifies a fresh supplier so tests never depend on each other. */
export async function activeSupplier(request: APIRequestContext, name: string) {
  const procurement = await tokenFor(request, 'ravi.kumar');
  const approver = await tokenFor(request, 'm.fernandes');
  const created = await request.post('/api/suppliers', { headers: auth(procurement), data: { name, accountNumber: accountNumber(), ifsc: 'HDFC0001234' } });
  expect(created.status()).toBe(201);
  const { supplier } = await created.json();
  const verified = await request.post(`/api/suppliers/${supplier.id}/bank-accounts/${supplier.bankAccount.id}/verify`, { headers: auth(approver) });
  expect(verified.status()).toBe(200);
  return supplier as { id: string; bankAccount: { id: number; account: string } };
}
