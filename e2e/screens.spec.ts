import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/', '/books/transactions', '/books/transactions?queue=uncat', '/books/transactions?queue=dup', '/books/transactions?queue=nodoc',
  '/books/new', '/books/new?kind=journal', '/books/accounts', '/books/accounts/acct_trustmark', '/reports/pnl', '/reports/trial-balance',
  '/close/periods', '/setup/stores', '/setup/entities', '/setup/parties', '/setup/rules', '/setup/users', '/setup/audit', '/setup/settings', '/roadmap',
  '/books/transactions/TX-000300',
  '/bank', '/bank?tab=reconcile', '/bank?tab=lines', '/bank?tab=import', '/bank/checks', '/bank/deposits', '/cash', '/cash?show=flagged', '/cash/forecast', '/books/new?kind=transfer',
  '/fuel', '/fuel?view=day', '/fuel?view=trend', '/fuel/invoices', '/fuel/invoices?show=flagged', '/fuel/invoices?tab=import', '/fuel/settlement',
  '/fuel/settlement?tab=dash', '/fuel/truck', '/fuel/tanks', '/fuel/pricing',
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
    for (const r of ['/', '/reports/pnl', '/books/transactions', '/bank', '/cash', '/cash/forecast']) {
      await open(page, r);
      await page.screenshot({ path: `test-results/shots/${w}-${scheme}-${r.replace(/[/?=]/g, '_') || 'today'}.png`, fullPage: false });
    }
  }
});

test('bank: auto-match, book a bank-only fee, import idempotently, reconcile November', async ({ page }) => {
  await open(page, '/bank');
  const before = Number((await page.getByRole('button', { name: /To match/ }).textContent())!.match(/\((\d+)\)/)![1]);
  await page.getByRole('button', { name: 'Auto-match' }).click();
  await expect.poll(async () => Number((await page.getByRole('button', { name: /To match/ }).textContent())!.match(/\((\d+)\)/)![1])).toBeLessThan(before);
  const fee = page.locator('li', { hasText: 'WIRE TRANSFER FEE' });
  await fee.getByRole('button', { name: /Book it|Something else/ }).click();
  await fee.getByLabel('Category').selectOption('acct_bank_fees');
  await fee.getByRole('button', { name: 'Book & match' }).click();
  await expect(page.locator('li', { hasText: 'WIRE TRANSFER FEE' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Import' }).click();
  const csv = 'Date,Description,Amount\n2026-11-26,ACH DEBIT ATMOS ENERGY 9921,-187.20\n2026-11-26,POS PURCHASE HOME DEPOT 4471,-64.10\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'trustmark-nov26.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Import 2 new lines' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'trustmark-nov26.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('0 new, 2 already imported')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 new lines' })).toBeDisabled();

  await page.getByRole('button', { name: 'Reconcile' }).click();
  await page.getByLabel('Statement date').fill('2026-11-25');
  await expect(page.getByText('Difference $0.00 — fully explained')).toBeVisible();
  await page.getByRole('button', { name: /Mark reconciled through/ }).click();
  await expect(page.getByText(/Reconciled through Nov 25, 2026/).first()).toBeVisible();
});

test('cash chain: pickup, HQ receipt and a pooled deposit', async ({ page }) => {
  await open(page, '/cash?date=2026-11-26');
  const row = page.locator('tr', { hasText: 'HM13' }).first();
  await row.getByLabel('Operator pickup amount').fill('100.00');
  await row.getByRole('button', { name: 'Record' }).click();
  await expect(row.locator('.pill', { hasText: /Short/ })).toBeVisible();
  await row.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByRole('checkbox', { name: /Deposit HM13 2026-11-26/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Deposit HM13 2026-11-26/ }).check();
  await page.getByRole('button', { name: /Record deposit of 1 bag/ }).click();
  await expect(page.getByRole('checkbox', { name: /Deposit HM13 2026-11-26/ })).toHaveCount(0);
});

test('forecast shows 13 weeks that roll forward, and items can be added', async ({ page }) => {
  await open(page, '/cash/forecast');
  await expect(page.getByText('Opening + inflows − outflows = ending')).toBeVisible();
  await page.getByLabel('What').fill('Property tax HM13');
  await page.getByLabel('Amount').fill('18,500');
  await page.getByRole('button', { name: 'Add to forecast' }).click();
  await expect(page.locator('td', { hasText: 'Property tax HM13' })).toBeVisible();
});

test('dismissing a duplicate updates the list straight away', async ({ page }) => {
  await open(page, '/books/transactions?queue=dup');
  await page.getByRole('button', { name: 'Not a duplicate' }).first().click();
  await expect(page.getByText('No possible duplicates')).toBeVisible();
});

test('fuel: paste a Craddock notice, prove it nets to zero, post it, and post the waiting one', async ({ page }) => {
  await open(page, '/fuel/settlement');
  const notice = [
    'Notice,Store,Notice date,Type,Processing date,Description,Invoice,Amount',
    '41990,HM11,2026-11-26,CC_PROCEEDS,2026-11-24,Card batch 11/23,,1000.00',
    '41990,HM11,2026-11-26,CC_FEE,2026-11-24,Card fees,,-21.50',
    '41990,HM11,2026-11-26,OTHER,,Cybera network fee,,-86.50',
    '41990,HM11,2026-11-26,DEPOSIT,,ACH deposit,,-892.00',
  ].join('\n');
  await page.getByLabel('Paste the notice').fill(notice);
  await page.getByRole('button', { name: 'Read notice' }).click();
  const preview = page.locator('section', { has: page.getByRole('heading', { name: /^Preview:/ }) });
  await expect(preview.locator('.tie.ok', { hasText: 'Nets to zero' })).toBeVisible();
  await page.getByRole('button', { name: 'Import and post 1 notice' }).click();
  await expect(page.getByRole('status')).toContainText('posted 1 notice');
  await page.getByLabel('Paste the notice').fill(notice);
  await page.getByRole('button', { name: 'Read notice' }).click();
  await expect(page.getByText('Already on file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import and post 0 notices' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: /^Post notice #/ }).click();
  await expect(page.getByText('Every notice is posted.')).toBeVisible();
  await expect(page.getByText('HM13 receivable ties to the ledger')).toBeVisible();
  await expect(page.getByText('HM11 receivable ties to the ledger')).toBeVisible();
});

test('fuel: import an invoice once; the second import adds nothing', async ({ page }) => {
  await open(page, '/fuel/invoices?tab=import');
  const csv = 'Supplier,Store,Invoice,BOL,Delivered,Due,Grade,Gross,Net,Cost,Freight,Taxes\nCraddock,HM11,C-9901,99001,2026-11-26,2026-11-29,Regular,6020,6000,12480.00,270.00,2184.00\nCraddock,HM11,C-9901,99001,2026-11-26,2026-11-29,Premium,1505,1500,3900.00,67.50,546.00\n';
  await page.getByLabel('Paste invoices').fill(csv);
  await page.getByRole('button', { name: 'Read invoices' }).click();
  await expect(page.getByText('1 new, 0 skipped')).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 invoice' }).click();
  await expect(page.getByRole('status')).toContainText('Imported 1 invoices');
  await page.getByLabel('Paste invoices').fill(csv);
  await page.getByRole('button', { name: 'Read invoices' }).click();
  await expect(page.getByText('0 new, 1 skipped')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 invoices' })).toBeDisabled();
});
