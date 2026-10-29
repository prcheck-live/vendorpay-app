import { expect, test } from '@playwright/test';
import { accountNumber, activeSupplier, auth, tokenFor } from '../support/api';

test.describe('VP-181 Supplier onboarding', () => {
  test('VP-181 Procurement onboards a supplier whose bank account waits for verification', async ({ request }) => {
    const token = await tokenFor(request, 'ravi.kumar');
    const res = await request.post('/api/suppliers', {
      headers: auth(token), data: { name: 'Test Onboarding Pvt Ltd', accountNumber: accountNumber(), ifsc: 'SBIN0004321' },
    });
    expect(res.status()).toBe(201);
    const { supplier } = await res.json();
    expect(supplier.status).toBe('pending_verification');
    expect(supplier.bankAccount.status).toBe('pending');
  });

  test('VP-181 Finance Ops cannot onboard suppliers', async ({ request }) => {
    const token = await tokenFor(request, 'neha.joshi');
    const res = await request.post('/api/suppliers', { headers: auth(token), data: { name: 'Nope Ltd', accountNumber: accountNumber(), ifsc: 'SBIN0004321' } });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'FORBIDDEN_ROLE' });
  });

  test('VP-181 an invalid IFSC code is rejected with a field message', async ({ request }) => {
    const token = await tokenFor(request, 'ravi.kumar');
    const res = await request.post('/api/suppliers', { headers: auth(token), data: { name: 'Bad IFSC Ltd', accountNumber: accountNumber(), ifsc: 'BAD' } });
    expect(res.status()).toBe(422);
    expect((await res.json()).details).toHaveProperty('ifsc');
  });

  test('VP-181 a Finance Approver verifies the account and the supplier becomes active', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Verified Supplier');
    const token = await tokenFor(request, 'neha.joshi');
    const res = await request.get(`/api/suppliers/${supplier.id}`, { headers: auth(token) });
    expect((await res.json()).supplier).toMatchObject({ status: 'active', bankAccounts: [{ status: 'active', verifiedBy: 'm.fernandes' }] });
  });
});

test.describe('VP-182 Masked bank details', () => {
  test('VP-182 supplier responses show only the last four digits of the account', async ({ request }) => {
    const token = await tokenFor(request, 'neha.joshi');
    const res = await request.get('/api/suppliers/SUP-0192', { headers: auth(token) });
    const body = await res.text();
    expect(body).toContain('**** 4421');
    expect(body).not.toMatch(/\d{9,18}/);
  });

  test('VP-182 the supplier list never contains a full account number', async ({ request }) => {
    const token = await tokenFor(request, 'm.fernandes');
    const body = await (await request.get('/api/suppliers', { headers: auth(token) })).text();
    expect(body).not.toMatch(/\d{9,18}/);
  });
});
