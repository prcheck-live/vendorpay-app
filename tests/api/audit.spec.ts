import { expect, test } from '@playwright/test';
import { activeSupplier, auth, daysFromNow, tokenFor } from '../support/api';

test.describe('VP-185 Audit trail', () => {
  test('VP-185 onboarding, verification and scheduling are recorded with the actor', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Audited Supplier');
    const ops = await tokenFor(request, 'neha.joshi');
    const { payment } = await (await request.post('/api/payments', { headers: auth(ops), data: { supplierId: supplier.id, amount: 999, scheduledFor: daysFromNow(4) } })).json();
    const auditor = await tokenFor(request, 'audit.viewer');

    const supplierEvents = (await (await request.get(`/api/audit-events?entityId=${supplier.id}`, { headers: auth(auditor) })).json()).events;
    expect(supplierEvents.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['SUPPLIER_CREATED', 'BANK_ACCOUNT_ADDED', 'BANK_ACCOUNT_VERIFIED']));
    expect(supplierEvents.find((e: { type: string }) => e.type === 'BANK_ACCOUNT_VERIFIED').actor).toBe('m.fernandes');

    const paymentEvents = (await (await request.get(`/api/audit-events?entityId=${payment.id}`, { headers: auth(auditor) })).json()).events;
    expect(paymentEvents).toEqual([expect.objectContaining({ type: 'PAYMENT_SCHEDULED', actor: 'neha.joshi' })]);
  });

  test('VP-185 audit details never contain a full account number', async ({ request }) => {
    const auditor = await tokenFor(request, 'audit.viewer');
    const body = await (await request.get('/api/audit-events?limit=500', { headers: auth(auditor) })).text();
    expect(body).not.toMatch(/\d{9,18}/);
  });

  test('VP-185 Finance Ops cannot read the audit trail', async ({ request }) => {
    const token = await tokenFor(request, 'neha.joshi');
    expect((await request.get('/api/audit-events', { headers: auth(token) })).status()).toBe(403);
  });
});
