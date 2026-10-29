import { expect, test } from '@playwright/test';
import { activeSupplier, auth, daysFromNow, tokenFor } from '../support/api';

test.describe('VP-183 Scheduled supplier payments', () => {
  test('VP-183 Finance Ops schedules a payment to the supplier’s active account', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Payee One');
    const token = await tokenFor(request, 'neha.joshi');
    const res = await request.post('/api/payments', { headers: auth(token), data: { supplierId: supplier.id, amount: 125000.5, scheduledFor: daysFromNow(7) } });
    expect(res.status()).toBe(201);
    const { payment } = await res.json();
    expect(payment).toMatchObject({ status: 'scheduled', amountMinor: 12500050, currency: 'INR' });
    expect(payment.destination.account).toBe(supplier.bankAccount.account);
  });

  test('VP-183 payments cannot be scheduled for a supplier awaiting verification', async ({ request }) => {
    const token = await tokenFor(request, 'neha.joshi');
    const res = await request.post('/api/payments', { headers: auth(token), data: { supplierId: 'SUP-0194', amount: 1000, scheduledFor: daysFromNow(3) } });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'SUPPLIER_NOT_ACTIVE' });
  });

  test('VP-183 Procurement cannot schedule payments', async ({ request }) => {
    const token = await tokenFor(request, 'ravi.kumar');
    const res = await request.post('/api/payments', { headers: auth(token), data: { supplierId: 'SUP-0192', amount: 1000, scheduledFor: daysFromNow(3) } });
    expect(res.status()).toBe(403);
  });

  test('VP-183 a past date is rejected', async ({ request }) => {
    const token = await tokenFor(request, 'neha.joshi');
    const res = await request.post('/api/payments', { headers: auth(token), data: { supplierId: 'SUP-0192', amount: 1000, scheduledFor: '2020-01-01' } });
    expect(res.status()).toBe(422);
    expect((await res.json()).details).toHaveProperty('scheduledFor');
  });

  test('VP-183 a Finance Approver releases a scheduled payment once', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Payee Two');
    const ops = await tokenFor(request, 'neha.joshi');
    const approver = await tokenFor(request, 'j.thomas');
    const { payment } = await (await request.post('/api/payments', { headers: auth(ops), data: { supplierId: supplier.id, amount: 5000, scheduledFor: daysFromNow(2) } })).json();
    const first = await request.post(`/api/payments/${payment.id}/release`, { headers: auth(approver) });
    expect(first.status()).toBe(200);
    expect((await first.json()).payment).toMatchObject({ status: 'released', releasedBy: 'j.thomas' });
    const second = await request.post(`/api/payments/${payment.id}/release`, { headers: auth(approver) });
    expect(second.status()).toBe(409);
  });

  test('VP-183 Finance Ops cannot release payments', async ({ request }) => {
    const token = await tokenFor(request, 'priya.menon');
    const res = await request.post('/api/payments/PAY-7815/release', { headers: auth(token) });
    expect(res.status()).toBe(403);
  });
});
