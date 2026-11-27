import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/', '/books/transactions', '/books/transactions?queue=uncat', '/books/transactions?queue=dup', '/books/transactions?queue=nodoc',
  '/books/new', '/books/new?kind=journal', '/books/accounts', '/books/accounts/acct_trustmark', '/reports/pnl', '/reports/trial-balance',
  '/close/periods', '/setup/stores', '/setup/entities', '/setup/parties', '/setup/rules', '/setup/users', '/setup/audit', '/setup/settings', '/roadmap',
  '/books/transactions/TX-000300',
];

async function open(page: Page, route: string) {
  await page.goto('/#' + route);
  await expect(page.locator('h1')).toBeVisible();
  await page.waitForTimeout(150);
}

for (const width of [390, 1440]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every screen passes axe and fits at ${width}px, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      for (const r of ROUTES) {
        await open(page, r);
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const summary = res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        expect(summary, `axe on ${r}`).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `horizontal page scroll on ${r}`).toBeLessThanOrEqual(0);
      }
    });
  }
}

test('categorize from the inbox, and the rule learns', async ({ page }) => {
  await open(page, '/books/transactions?queue=uncat');
  const row = page.locator('tr', { hasText: 'ATMOS ENERGY' });
  await row.locator('select').first().selectOption('acct_utilities');
  await row.locator('select').nth(1).selectOption('st_hm13');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('tr', { hasText: 'ATMOS ENERGY' })).toHaveCount(0);
  await open(page, '/setup/rules');
  await expect(page.locator('td', { hasText: 'ATMOS ENERGY' })).toBeVisible();
});

test('post a split money-out entry; intercompany lines balance each entity', async ({ page }) => {
  await open(page, '/books/new');
  await page.getByLabel('Description').fill('Pest control, all stores');
  await page.getByRole('button', { name: 'Split across stores by %' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('acct_repairs');
  await page.getByLabel('Total to split').fill('1,000.00');
  await page.getByRole('button', { name: 'Even across operating stores' }).click();
  await page.getByRole('button', { name: 'Add split lines' }).click();
  await page.getByRole('button', { name: 'Post money out' }).click();
  await expect(page.locator('h1')).toHaveText('Pest control, all stores');
  await expect(page.getByText('Debits equal credits')).toBeVisible();
  await expect(page.getByText('Each entity balances')).toBeVisible();
  await expect(page.locator('.pill', { hasText: 'auto' }).first()).toBeVisible();
});

test('unbalanced journal cannot post; locked month refuses entries', async ({ page }) => {
  await open(page, '/books/new?kind=journal');
  await page.getByLabel('Date').fill('2026-09-15');
  await page.getByLabel('Description').fill('Test');
  await page.getByLabel('Account 1').selectOption('acct_repairs');
  await page.getByLabel('Debit').first().fill('10');
  await page.getByLabel('Account 2').selectOption('acct_trustmark');
  await page.getByLabel('Credit').nth(1).fill('9');
  await expect(page.getByRole('button', { name: 'Post journal entry' })).toBeDisabled();
  await page.getByLabel('Credit').nth(1).fill('10');
  await page.getByRole('button', { name: 'Post journal entry' }).click();
  await expect(page.getByRole('alert')).toContainText('locked');
});

test('⌘K finds a transaction by amount', async ({ page }) => {
  await open(page, '/');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /Search pages/ }).fill('$1,284.36');
  await expect(page.getByRole('option').filter({ hasText: 'SYSCO' }).first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toContainText('SYSCO');
});

test('store manager only sees their store', async ({ page }) => {
  await open(page, '/');
  await page.locator('#acting-as').selectOption('usr_mgr11');
  await open(page, '/books/transactions');
  await expect(page.locator('#f-store option')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Trial balance' })).toBeVisible();
  await open(page, '/reports/trial-balance');
  await expect(page.locator('h1 + p')).toContainText("doesn't include");
});

test('screenshots for review', async ({ page }) => {
  for (const [w, scheme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    for (const r of ['/', '/reports/pnl', '/books/transactions', '/books/transactions?queue=uncat']) {
      await open(page, r);
      await page.screenshot({ path: `test-results/shots/${w}-${scheme}-${r.replace(/[/?=]/g, '_') || 'today'}.png`, fullPage: false });
    }
  }
});
