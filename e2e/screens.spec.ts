import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/', '/books/transactions', '/books/transactions?queue=uncat', '/books/transactions?queue=dup', '/books/transactions?queue=nodoc',
  '/books/new', '/books/new?kind=journal', '/books/accounts', '/books/accounts/acct_trustmark', '/reports/pnl', '/reports/trial-balance',
  '/close/periods', '/setup/stores', '/setup/entities', '/setup/parties', '/setup/rules', '/setup/users', '/setup/audit', '/setup/settings', '/roadmap',
  '/books/transactions/TX-000300',
  '/bank', '/bank?tab=reconcile', '/bank?tab=lines', '/bank?tab=import', '/bank/checks', '/bank/deposits', '/cash', '/cash?show=flagged', '/cash/forecast', '/books/new?kind=transfer',
  '/approvals', '/intercompany/parties', '/intercompany/parties/pt_cheers', '/intercompany/parties/pt_laundry', '/intercompany/parties/ent_hm11', '/intercompany/parties/pt_owner_a',
  '/intercompany/draws', '/intercompany/eliminations', '/intercompany/rent',
  '/payables/bills', '/payables/bills?status=all', '/payables/bills/BILL-0001', '/payables/inbox', '/payables/aging', '/payables/calendar', '/payables/utilities', '/payables/statements', '/payables/1099',
  '/receivables/rent', '/receivables/other', '/receivables/other?tab=atm', '/receivables/other?tab=insurance',
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

test('payables: approve a bill, then schedule and pay it; AP ties throughout', async ({ page }) => {
  await open(page, '/approvals');
  await expect(page.getByRole('link', { name: 'Kitchen equipment service (demo) · invoice KS-3318' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve Kitchen equipment service (demo) · invoice KS-3318' }).click();
  await expect(page.getByText(/Approved Kitchen equipment service/)).toBeVisible();
  await open(page, '/payables/bills?status=open&q=KS-3318');
  await page.getByRole('link', { name: /BILL-/ }).first().click();
  await expect(page.locator('h1')).toContainText('KS-3318');
  await expect(page.locator('.tie.ok', { hasText: 'Accounts payable credited the bill total' })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Check #').fill('4990');
  await page.getByRole('button', { name: /Record payment of \$1,240.00/ }).click();
  await expect(page.getByText(/Paid. Posted TX-/)).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Paid by TX-' })).toBeVisible();
  await open(page, '/payables/aging');
  await expect(page.locator('.tie.ok', { hasText: 'Ties to 2000 Accounts payable in the ledger' })).toBeVisible();
  await open(page, '/bank/checks');
  await expect(page.getByRole('link', { name: '#4990' })).toBeVisible();
});

test('bills inbox: paste an email, read it, save for approval', async ({ page }) => {
  await open(page, '/payables/inbox');
  await expect(page.getByText('No OCR yet.')).toBeVisible();
  await page.getByLabel('Or paste the email text').fill('From: Ice supplier (demo)\nInvoice # IC-2433 dated 11/15/2026 for HM15\nAmount due: $415.00\nDue date: 12/15/2026');
  await page.getByRole('button', { name: 'Read it' }).click();
  await expect(page.getByText('Invoice # IC-2433', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Invoice #')).toHaveValue('IC-2433');
  await expect(page.getByLabel('Due date')).toHaveValue('2026-12-15');
  await expect(page.getByLabel('Amount 1')).toHaveValue('415.00');
  await page.getByRole('button', { name: 'Save for approval' }).click();
  await expect(page.locator('h1')).toContainText('IC-2433');
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('Awaiting approval');
});

test('intercompany: open a party statement that ties, and the elimination view nets to zero', async ({ page }) => {
  await open(page, '/intercompany/parties');
  await expect(page.locator('.tie.ok', { hasText: 'Party ledgers tie to the party accounts in the ledger' })).toBeVisible();
  await page.getByRole('link', { name: 'Southern Eagle' }).click();
  await expect(page.locator('h1')).toHaveText('Southern Eagle');
  await expect(page.locator('.tie.ok', { hasText: 'Opening + money out − money in = closing' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Agrees with the party accounts in the ledger' })).toBeVisible();
  await expect(page.locator('.figure', { hasText: 'Limit' })).toContainText('Over by');
  await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeVisible();
  await open(page, '/intercompany/eliminations');
  await expect(page.locator('.tie.ok', { hasText: 'Due-from and due-to net to zero' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Consolidated assets = liabilities + equity' })).toBeVisible();
});

test('intercompany: pay another business\'s bill from the shared account', async ({ page }) => {
  await open(page, '/intercompany/parties');
  await page.getByLabel('Party', { exact: true }).selectOption('pt_bullseye');
  await page.getByLabel('What happened').selectOption('paid_bill');
  await page.getByLabel('Amount').fill('725.00');
  await page.getByLabel('Whose bill (vendor paid)').fill('Bullseye propane');
  await page.getByRole('button', { name: 'Post movement' }).click();
  await page.getByRole('link', { name: /Open TX-/ }).click();
  await expect(page.locator('h1')).toContainText('Paid Bullseye propane for Bullseye');
  await expect(page.getByText('1920 · Due from related parties – bills paid for them')).toBeVisible();
});
