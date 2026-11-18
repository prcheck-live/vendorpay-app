import { expect, test } from '@playwright/test';
import { APIRequestContext } from '@playwright/test';
import { accountNumber, activeSupplier, auth, daysFromNow, tokenFor } from '../support/api';

// Team tests for VP-184, one or more per written acceptance criterion.
test.describe('VP-184 Supplier bank account change', () => {
  test('VP-184 Procurement submits a new bank account for an active supplier', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Bank Change AC1');
    const procurement = await tokenFor(request, 'ravi.kumar');
    const res = await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(procurement), data: { accountNumber: accountNumber(), ifsc: 'ICIC0000110', reason: 'Supplier moved to ICICI' },
    });
    expect(res.status()).toBe(201);
    const { request: change } = await res.json();
    expect(change).toMatchObject({ supplierId: supplier.id, status: 'requested', requestedBy: 'ravi.kumar' });
  });

  test('VP-184 the new account stays inactive until a Finance Approver approves it', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Bank Change AC2');
    const procurement = await tokenFor(request, 'ravi.kumar');
    const approver = await tokenFor(request, 'j.thomas');
    const { request: change } = await (await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(procurement), data: { accountNumber: accountNumber(), ifsc: 'ICIC0000110', reason: 'Supplier moved to ICICI' },
    })).json();

    const before = (await (await request.get(`/api/suppliers/${supplier.id}`, { headers: auth(approver) })).json()).supplier;
    expect(before.bankAccounts.find((a: { id: number }) => a.id === change.newAccount.id).status).toBe('proposed');

    const approved = await request.post(`/api/bank-change-requests/${change.id}/approve`, { headers: auth(approver) });
    expect(approved.status()).toBe(200);
    const after = (await (await request.get(`/api/suppliers/${supplier.id}`, { headers: auth(approver) })).json()).supplier;
    const status = (id: number) => after.bankAccounts.find((a: { id: number }) => a.id === id).status;
    expect(status(change.newAccount.id)).toBe('active');
    expect(status(change.previousAccount.id)).toBe('inactive');
  });

  test('VP-184 Procurement cannot approve a bank change', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Bank Change Role');
    const procurement = await tokenFor(request, 'ravi.kumar');
    const { request: change } = await (await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(procurement), data: { accountNumber: accountNumber(), ifsc: 'ICIC0000110', reason: 'Supplier moved to ICICI' },
    })).json();
    const res = await request.post(`/api/bank-change-requests/${change.id}/approve`, { headers: auth(procurement) });
    expect(res.status()).toBe(403);
  });

  test('VP-184 the requester cannot approve their own bank change', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Bank Change Self');
    const approver = await tokenFor(request, 'm.fernandes');
    const { request: change } = await (await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(approver), data: { accountNumber: accountNumber(), ifsc: 'ICIC0000110', reason: 'Supplier called Finance directly' },
    })).json();
    const res = await request.post(`/api/bank-change-requests/${change.id}/approve`, { headers: auth(approver) });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'SELF_APPROVAL_NOT_ALLOWED' });
  });

  test('VP-184 the new account number is masked in API responses', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Bank Change AC3');
    const procurement = await tokenFor(request, 'ravi.kumar');
    const number = accountNumber();
    const res = await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(procurement), data: { accountNumber: number, ifsc: 'ICIC0000110', reason: 'Supplier moved to ICICI' },
    });
    const body = await res.text();
    expect(body).toContain(`**** ${number.slice(-4)}`);
    expect(body).not.toContain(number);
    const list = await (await request.get(`/api/bank-change-requests?supplierId=${supplier.id}`, { headers: auth(procurement) })).text();
    expect(list).not.toMatch(/\d{9,18}/);
  });

  test('VP-184 the request and the approval are recorded in the audit trail', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Bank Change AC4');
    const procurement = await tokenFor(request, 'ravi.kumar');
    const approver = await tokenFor(request, 'm.fernandes');
    const { request: change } = await (await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(procurement), data: { accountNumber: accountNumber(), ifsc: 'ICIC0000110', reason: 'Supplier moved to ICICI' },
    })).json();
    await request.post(`/api/bank-change-requests/${change.id}/approve`, { headers: auth(approver) });

    const { events } = await (await request.get(`/api/audit-events?entityId=${supplier.id}`, { headers: auth(approver) })).json();
    const types = events.map((e: { type: string; actor: string }) => `${e.type}:${e.actor}`);
    expect(types).toContain('BANK_CHANGE_REQUESTED:ravi.kumar');
    expect(types).toContain('BANK_CHANGE_APPROVED:m.fernandes');
  });

  // AC5: payments already scheduled to the old account are held for Finance review.
  async function changeWithScheduledPayment(request: APIRequestContext, name: string) {
    const supplier = await activeSupplier(request, name);
    const ops = await tokenFor(request, 'neha.joshi');
    const procurement = await tokenFor(request, 'ravi.kumar');
    const approver = await tokenFor(request, 'm.fernandes');
    const { payment } = await (await request.post('/api/payments', {
      headers: auth(ops), data: { supplierId: supplier.id, amount: 125000, scheduledFor: daysFromNow(7) },
    })).json();
    const { request: change } = await (await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(procurement), data: { accountNumber: accountNumber(), ifsc: 'ICIC0000110', reason: 'Supplier moved to ICICI' },
    })).json();
    const approved = await request.post(`/api/bank-change-requests/${change.id}/approve`, { headers: auth(approver) });
    expect(approved.status()).toBe(200);
    return { supplier, payment, change, approvedBody: await approved.json() };
  }

  test('VP-184 approving a bank change puts payments scheduled to the old account on hold', async ({ request }) => {
    const { payment, change, approvedBody } = await changeWithScheduledPayment(request, 'Test Bank Change Hold');
    expect(approvedBody.heldPayments).toEqual([payment.id]);
    const approver = await tokenFor(request, 'j.thomas');
    const held = (await (await request.get(`/api/payments/${payment.id}`, { headers: auth(approver) })).json()).payment;
    expect(held).toMatchObject({ status: 'on_hold', destination: { accountId: change.previousAccount.id }, hold: { bankChangeRequestId: change.id } });
    const release = await request.post(`/api/payments/${payment.id}/release`, { headers: auth(approver) });
    expect(release.status()).toBe(409);
    expect(await release.json()).toMatchObject({ error: 'PAYMENT_ON_HOLD' });
  });

  test('VP-184 Finance redirects a held payment to the new account and it is audited', async ({ request }) => {
    const { payment, change } = await changeWithScheduledPayment(request, 'Test Bank Change Redirect');
    const approver = await tokenFor(request, 'j.thomas');
    const res = await request.post(`/api/payments/${payment.id}/resolve-hold`, { headers: auth(approver), data: { action: 'redirect' } });
    expect(res.status()).toBe(200);
    expect((await res.json()).payment).toMatchObject({
      status: 'scheduled', destination: { accountId: change.newAccount.id }, hold: { resolution: 'redirected', resolvedBy: 'j.thomas' },
    });
    const { events } = await (await request.get(`/api/audit-events?entityId=${payment.id}`, { headers: auth(approver) })).json();
    expect(events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['PAYMENT_HELD', 'PAYMENT_HOLD_RESOLVED']));
  });

  test('VP-184 the bank change requester cannot decide its held payments', async ({ request }) => {
    const supplier = await activeSupplier(request, 'Test Bank Change Self Resolve');
    const ops = await tokenFor(request, 'neha.joshi');
    const requester = await tokenFor(request, 'm.fernandes');
    const approver = await tokenFor(request, 'j.thomas');
    const { payment } = await (await request.post('/api/payments', {
      headers: auth(ops), data: { supplierId: supplier.id, amount: 5000, scheduledFor: daysFromNow(3) },
    })).json();
    const { request: change } = await (await request.post(`/api/suppliers/${supplier.id}/bank-change-requests`, {
      headers: auth(requester), data: { accountNumber: accountNumber(), ifsc: 'ICIC0000110', reason: 'Supplier called Finance directly' },
    })).json();
    await request.post(`/api/bank-change-requests/${change.id}/approve`, { headers: auth(approver) });
    const res = await request.post(`/api/payments/${payment.id}/resolve-hold`, { headers: auth(requester), data: { action: 'redirect' } });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'SELF_RESOLUTION_NOT_ALLOWED' });
  });
});
