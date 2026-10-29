import { expect, test } from '@playwright/test';
import { PASSWORD } from '../support/api';

test.describe('VP-182 Masked bank details in the UI', () => {
  test('VP-182 a Finance Ops user signs in and sees suppliers with masked accounts', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Username').fill('neha.joshi');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('signin-submit').click();
    const table = page.getByTestId('suppliers-table');
    await expect(table).toContainText('Northstar Components');
    await expect(table).toContainText('**** 4421');
    await expect(table).not.toContainText('50100234564421');
    await expect(page.locator('#me-role')).toHaveText('Finance Ops');
    await expect(page.getByRole('link', { name: 'Audit trail' })).toBeHidden();
  });
});
