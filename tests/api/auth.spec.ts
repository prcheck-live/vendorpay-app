import { expect, test } from '@playwright/test';
import { auth, tokenFor } from '../support/api';

test.describe('VP-170 Sign-in and roles', () => {
  test('VP-170 a demo user can sign in and read their own profile', async ({ request }) => {
    const token = await tokenFor(request, 'anika.rao');
    const me = await request.get('/api/auth/me', { headers: auth(token) });
    expect(me.status()).toBe(200);
    expect((await me.json()).user).toMatchObject({ username: 'anika.rao', role: 'FINANCE_OPS' });
  });

  test('VP-170 a wrong password is rejected without saying which field was wrong', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { username: 'anika.rao', password: 'wrong' } });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' });
  });

  test('VP-170 API calls without a token are refused', async ({ request }) => {
    const res = await request.get('/api/suppliers');
    expect(res.status()).toBe(401);
  });

  test('VP-170 the build reports its commit for environment checks', async ({ request }) => {
    const res = await request.get('/version');
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ app: 'vendorpay', gitSha: expect.any(String) });
  });
});
