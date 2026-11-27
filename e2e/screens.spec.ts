import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/', '/books/transactions', '/books/transactions?queue=uncat', '/books/transactions?queue=dup', '/books/transactions?queue=nodoc',
  '/books/new', '/books/new?kind=journal', '/books/accounts', '/books/accounts/acct_trustmark', '/reports/pnl', '/reports/trial-balance',
  '/close/periods', '/setup/stores', '/setup/entities', '/setup/parties', '/setup/rules', '/setup/users', '/setup/audit', '/setup/settings', '/roadmap',
  '/books/transactions/TX-000300',
  '/bank', '/bank?tab=reconcile', '/bank?tab=lines', '/bank?tab=import', '/bank/checks', '/bank/deposits', '/cash', '/cash?show=flagged', '/cash/forecast', '/books/new?kind=transfer',
  '/people/runs', '/people/runs?tab=import', '/people/review', '/people/review?week=2026-11-20&all=1', '/people/employees', '/people/employees?show=pending', '/people/employees?status=all',
  '/people/cash-pay', '/people/cash-pay?all=1', '/people/labor', '/people/taxes',
  '/fuel', '/fuel?view=day', '/fuel?view=trend', '/fuel/invoices', '/fuel/invoices?show=flagged', '/fuel/invoices?tab=import', '/fuel/settlement',
  '/fuel/settlement?tab=dash', '/fuel/truck', '/fuel/tanks', '/fuel/pricing',
  '/approvals', '/intercompany/parties', '/intercompany/parties/pt_cheers', '/intercompany/parties/pt_laundry', '/intercompany/parties/ent_hm11', '/intercompany/parties/pt_owner_a',
  '/intercompany/draws', '/intercompany/eliminations', '/intercompany/rent',
  '/payables/bills', '/payables/bills?status=all', '/payables/bills/BILL-0001', '/payables/inbox', '/payables/aging', '/payables/calendar', '/payables/utilities', '/payables/statements', '/payables/1099',
  '/receivables/rent', '/receivables/other', '/receivables/other?tab=atm', '/receivables/other?tab=insurance',
  '/compliance/calendar', '/compliance/calendar?show=open', '/compliance/licenses', '/compliance/licenses?show=expiring', '/compliance/insurance', '/compliance/insurance?tab=leases',
  '/compliance/notices', '/compliance/vault', '/compliance/vault?tag=permit', '/assets', '/assets?id=fa_hm15_truck', '/assets/depreciation', '/assets/loans', '/assets/loans/loan_hm15_equip',
  '/assets/loans/loan_loc', '/assets/loans/loan_mtg_hm11', '/assets/maintenance', '/assets/prepaids', '/ask', '/ask?q=Outstanding%20Craddock%20invoices%20as%20of%20yesterday', '/ask?q=what%20is%20the%20weather',
  '/reports/command', '/reports/command?basis=cash&month=2026-10', '/reports/pnl?basis=cash', '/reports/pnl?basis=accrual&view=month&from=2026-09&to=2026-11&pct=1',
  '/reports/pnl?basis=compare', '/reports/pnl?basis=accrual&view=prior&store=st_hm15',
  '/reports/drill?basis=accrual&account=acct_cogs_fuel&from=2026-11&to=2026-11', '/reports/drill?basis=bridge&reason=uncleared_check&from=2026-11&to=2026-11',
  '/reports/balance-sheet', '/reports/balance-sheet?entity=ent_hm11&asOf=2026-10-31', '/reports/cash-flow', '/reports/cash-flow?from=2026-09&to=2026-11&entity=ent_corp',
  '/reports/scorecards', '/reports/board', '/reports/builder',
  '/inside', '/inside?tab=import', '/inside/purchases', '/inside/inventory', '/inside/budgets', '/inside/rebates', '/inside/lottery', '/inside/lottery?show=short', '/inside/age-checks',
  '/kitchen', '/kitchen?tab=import', '/kitchen/food-cost', '/kitchen/waste', '/kitchen/labor', '/kitchen/prices', '/kitchen/prices?tab=invoices', '/kitchen/prices?tab=import',
  '/budgets', '/budgets?store=st_hm11', '/budgets/bva', '/budgets/bva?month=2026-09&store=st_hm13', '/budgets/forecast', '/budgets/forecast?fy=2027&store=st_hm15',
  '/budgets/scenarios', '/budgets/scenarios?fy=2027', '/budgets/break-even', '/budgets/break-even?source=budget', '/reports/pnl?basis=accrual&view=budget&from=2026-10',
  '/close', '/close?month=2026-10&step=intercompany', '/close?month=2026-09&step=bank', '/close?month=2026-10&step=inventory&store=st_hm15', '/close/binder', '/close/binder?month=2026-09',
  // Phase 10: GL toolkit & QuickBooks
  '/books/journals', '/books/journals?tab=templates', '/books/journals?tab=recurring', '/books/journals?tab=reversing', '/books/journals?status=pending',
  '/books/journals/new', '/books/journals/new?template=accr_payroll', '/books/journals/JE-0007', '/books/journals/JE-0010',
  '/books/gl', '/books/gl?account=acct_due_to&entity=ent_hm11&from=2026-10-01&to=2026-10-31', '/reports/trial-balance?asOf=2026-10-31&entity=ent_hm11',
  '/books/recons', '/books/recons?period=2026-10&all=1', '/books/recons/acct_prepaid?period=2026-10', '/books/recons/acct_trustmark?period=2026-10',
  '/books/consolidation', '/books/consolidation?asOf=2026-10-31',
  '/qbo', '/qbo/mapping', '/qbo/mapping?tab=classes', '/qbo/mapping?tab=parties&show=unmapped', '/qbo/sync', '/qbo/sync?tab=pull', '/qbo/sync?tab=tb&entity=ent_hm11&period=2026-10',
  '/qbo/differences', '/qbo/differences?entity=ent_hm11&period=2026-10&all=1', '/qbo/log',
  '/debt', '/debt/covenants', '/debt/lender-package', '/debt/lender-package?loan=loan_hm15_equip', '/debt/refinance', '/debt/refinance?loan=loan_hm15_equip',
  '/debt/paydown', '/debt/reserve', '/debt/related-party',
  '/tax', '/tax/calendar', '/tax/calendar?show=open', '/tax/sales-tax', '/tax/sales-tax?period=2026-10', '/tax/book-to-tax', '/tax/book-to-tax?entity=ent_hm14', '/tax/depreciation',
  '/tax/methods', '/tax/estimates', '/tax/owners', '/tax/planning', '/tax/planning?entity=ent_hm14', '/tax/cpa',
  // Phase 13: growth & owners
  '/growth/readiness', '/growth/sites', '/growth/pro-forma', '/growth/compare', '/growth/acquisitions', '/growth/capital', '/growth/valuation',
  '/growth/owners', '/growth/review', '/growth/evaluate', '/growth/compare?site=none', '/growth',
  // Growth compass
  '/growth/compass',
  // Phase 14: Controls & risk
  '/controls', '/controls/limits', '/controls/sod', '/controls/sod?tab=all', '/controls/cash', '/controls/fraud', '/controls/fraud?show=all&kind=check_sequence',
  '/controls/fraud?tab=pos', '/controls/fraud?tab=driveoffs', '/controls/risk', '/controls/risk?tab=coverage', '/controls/risk?tab=claims',
  '/controls/ust', '/controls/ust?tab=release', '/controls/ust?tab=documents', '/controls/security',
];

async function open(page: Page, route: string) {
  await page.goto('/#' + route);
  await expect(page.locator('h1')).toBeVisible();
  await page.waitForTimeout(150);
}

for (const width of [390, 1440]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every screen passes axe and fits at ${width}px, ${scheme}`, async ({ page }) => {
      test.setTimeout(15 * 60_000); // one test sweeps every route
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

async function axe(page: Page, what: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `axe on ${what}`).toEqual([]);
}

test('weekly payroll review: run pulled, this week vs last, approve the raise, post', async ({ page }) => {
  await open(page, '/people/review');
  await expect(page.locator('#wr-week')).toHaveValue('2026-11-27');
  await expect(page.getByText('Every run ties to its Gusto report totals')).toBeVisible();
  const hm15 = page.locator('section', { has: page.getByRole('heading', { name: /2 · This week vs last/ }) }).locator('tr', { hasText: 'HM15' });
  await expect(hm15.locator('.pill.bad').first()).toHaveText(/^\+(1[6-9]|[2-9]\d)(\.\d)?%$/); // over the 15% flag
  await expect(page.getByText(/Gusto already pays the raise waiting for approval/).first()).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Quinn P.' }).getByText('New hire')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Gusto already pays the raise/)).toHaveCount(0);
  await expect(page.getByText('No rate changes waiting for approval.')).toBeVisible();
  await page.getByRole('button', { name: 'Post 4 runs to the books' }).click();
  await expect(page.getByText(/Every run for this week is posted/)).toBeVisible();
  await expect(page.getByText('HM15 posted entries tie to the run')).toBeVisible();
  await open(page, '/people/runs');
  await expect(page.getByText('To review & post')).toHaveCount(0);
  await open(page, '/bank/checks?status=outstanding');
  await expect(page.locator('tr', { hasText: '#4127' })).toBeVisible();
});

test('payroll: import a Gusto report whose preview ties, then re-import adds nothing', async ({ page }) => {
  const csv = [
    'Pay date,Employee,Employee ID,Location,Department,Regular hours,Overtime hours,Gross pay,Employee taxes,Employer taxes,Net pay,Payment method',
    '12/04/2026,Logan N.,,HM13,Front,40,0,480.00,73.44,52.80,406.56,Direct deposit',
    '12/04/2026,Test Hire Z.,G-9001,HM13,Kitchen,20,0,240.00,36.72,26.40,203.28,Check',
    'Total,,,,,,,720.00,110.16,79.20,609.84,',
  ].join('\n');
  await open(page, '/people/runs?tab=import');
  await page.locator('input[type=file]').setInputFiles({ name: 'gusto-2026-12-04.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Gross ties to the report total')).toBeVisible();
  await expect(page.getByText('Net pay ties to the report total')).toBeVisible();
  await expect(page.getByText(/New in Gusto: Test Hire Z\./)).toBeVisible();
  await axe(page, 'Gusto import preview');
  await page.getByRole('button', { name: 'Import 2 new lines' }).click();
  await expect(page.getByRole('heading', { name: /Run paid Dec 4, 2026/ })).toBeVisible();
  await expect(page.getByText('Company debit ties to the Gusto report')).toBeVisible();
  await axe(page, 'run detail');
  await page.getByRole('button', { name: 'Import a Gusto report' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'gusto-2026-12-04.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('0 new, 2 already imported')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 new lines' })).toBeDisabled();
  await open(page, '/people/employees?show=new');
  await expect(page.locator('li', { hasText: 'Test Hire Z.' })).toBeVisible();
});

test('employees: a raise goes for approval and only an approver can approve it', async ({ page }) => {
  await open(page, '/people/employees?q=Logan');
  await page.getByRole('link', { name: 'Logan N.' }).click();
  await page.getByRole('button', { name: 'Change rate' }).click();
  await page.getByLabel('New rate').fill('12.75');
  await page.getByLabel('Reason', { exact: true }).fill('Six-month review');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Awaiting approval').first()).toBeVisible();
  await axe(page, 'employee detail');
  await page.locator('#acting-as').selectOption('usr_bk');
  await open(page, '/people/employees?show=pending');
  await expect(page.getByText('Waiting for the CFO or an owner to approve.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await page.locator('#acting-as').selectOption('usr_owner');
  await open(page, '/people/employees?show=pending');
  await page.locator('li', { hasText: 'Logan N.' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('li', { hasText: 'Logan N.' })).toHaveCount(0);
});

test('cash & check pay: someone paid by Gusto and in cash is shown both ways and confirmed, not dropped', async ({ page }) => {
  await open(page, '/people/cash-pay');
  await expect(page.getByText('Every payroll payout is split by employee')).toBeVisible();
  const row = page.locator('tr', { hasText: 'Morgan T.' }).first();
  await expect(row.getByText('Both: confirm it is extra pay')).toBeVisible();
  await row.getByLabel('What the extra pay was for').fill('Covered two extra shifts');
  await row.getByRole('button', { name: 'Confirm extra pay' }).click();
  await expect(page.locator('tr', { hasText: 'Morgan T.' }).first().getByText('Both: confirmed extra pay')).toBeVisible();
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

test('ask: a question answered with proof transactions, from ⌘K; an unknown says what is missing', async ({ page }) => {
  await open(page, '/');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /Search pages/ }).fill('What did we pay Entergy for HM11 in October?');
  await expect(page.locator('#cmd-list [role=option]').first()).toContainText('Ask: What did we pay Entergy');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('Ask');
  await expect(page.getByRole('heading', { name: /We paid Entergy Mississippi \$[\d,.]+ for HM11 in October 2026/ })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'The proof rows add to the answer' })).toBeVisible();
  const proof = page.locator('section', { has: page.getByRole('heading', { name: /We paid Entergy/ }) }).locator('tbody tr');
  await expect(proof).toHaveCount(1);
  await expect(proof.first()).toContainText('ENTERGY MS HM11');
  await proof.first().getByRole('link').click();
  await expect(page.locator('h1')).toContainText('ENTERGY MS HM11');
  await open(page, '/ask');
  await page.locator('#ask-q').fill('How many customers smiled at HM13?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Not answered' })).toBeVisible();
  await expect(page.getByText("What's missing:")).toBeVisible();
  await page.getByRole('button', { name: 'Bills due this week' }).first().click();
  await expect(page.getByRole('heading', { name: /due this week/ })).toBeVisible();
});

test('compliance: mark the overdue UST report filed and paid; the overdue count clears', async ({ page }) => {
  await open(page, '/compliance/calendar');
  await expect(page.locator('.figure', { hasText: 'Overdue' }).locator('.value')).toHaveText('1');
  await page.getByRole('button', { name: /Update UST environmental fee report due 2026-10-31/ }).click();
  await page.getByLabel('Status').selectOption('paid');
  await page.getByLabel('Amount paid').fill('120.00');
  await page.getByLabel('Confirmation #').fill('UST-Q3-0001');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('UST environmental fee report (Q3 2026): Paid');
  await expect(page.locator('.figure', { hasText: 'Overdue' }).locator('.value')).toHaveText('0');
  await expect(page.locator('.tie.ok', { hasText: 'Every filed or paid item has a confirmation or document' })).toBeVisible();
});

test('assets: register ties to the ledger, and a loan payment splits principal and interest', async ({ page }) => {
  await open(page, '/assets');
  await expect(page.locator('.tie.ok', { hasText: 'Register cost ties to 1500 Equipment + 1510 Buildings by store' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Accumulated depreciation ties to 1590 by store' })).toBeVisible();
  await open(page, '/assets/prepaids');
  await expect(page.locator('.tie.ok', { hasText: 'Remaining on the schedules ties to 1400 Prepaid expenses' })).toBeVisible();
  await open(page, '/assets/loans');
  await expect(page.locator('.tie.ok', { hasText: '2310 Notes payable – equipment ties to its loans' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'not double-booked' })).toBeVisible();
  await page.getByRole('link', { name: 'HM15 truck-lane equipment note' }).click();
  await expect(page.locator('.tie.ok', { hasText: 'Principal across the table repays the original amount' })).toBeVisible();
  await page.locator('tr', { hasText: 'Nov 1, 2026' }).getByRole('link').click();
  await expect(page.getByText('2310 · Notes payable – equipment')).toBeVisible();
  await expect(page.getByText('6500 · Interest expense')).toBeVisible();
});

test('reports: command center → store P&L → its transactions; the accrual bridge ties', async ({ page }) => {
  await open(page, '/reports/command');
  await expect(page.locator('.page-head .lede')).toContainText('the latest month with sales');
  await expect(page.locator('.tie.ok', { hasText: 'Store rows add to the company total' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Ties to the accrual P&L' })).toBeVisible();
  await page.getByRole('link', { name: /^HM11 net profit/ }).click();
  await expect(page.locator('h1')).toHaveText('Profit & loss by store');
  await expect(page.locator('#p-store')).toHaveValue('st_hm11');
  await expect(page.locator('.tie.ok', { hasText: 'Cash + bridge = accrual, to the cent' })).toBeVisible();
  await page.getByRole('link', { name: /^Utilities, HM11: .* see transactions/ }).click();
  await expect(page.locator('h1')).toHaveText('Utilities · HM11');
  await expect(page.locator('.tie.ok', { hasText: 'Entries add to the P&L figure' })).toBeVisible();
  await page.locator('tbody a', { hasText: /^TX-/ }).first().click();
  await expect(page.getByText('Debits equal credits')).toBeVisible();
  await open(page, '/reports/pnl');
  await page.getByRole('button', { name: 'Accrual', exact: true }).click();
  await expect(page.locator('.tie.ok', { hasText: 'Accrual = booked + paid fuel − accrual fuel cost' })).toBeVisible();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bridge: cash basis to accrual basis' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Cash + bridge = accrual, to the cent' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Line differences add to the bridge' })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^pnl-compare-.*\.xlsx$/);
});

test('reports: balance sheet and cash flow tie; build and save a report', async ({ page }) => {
  await open(page, '/reports/balance-sheet');
  await expect(page.locator('.tie.ok', { hasText: 'Assets = liabilities + equity' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Agrees to the trial balance, account by account' })).toBeVisible();
  await open(page, '/reports/cash-flow');
  await expect(page.locator('.tie.ok', { hasText: 'Opening + net change = closing cash' })).toBeVisible();
  await open(page, '/reports/builder');
  await page.getByLabel('Name').fill('Kitchen by month');
  await page.getByLabel('Columns').selectOption('month');
  await page.getByLabel('Kitchen sales').check();
  await page.getByLabel('Schedule').selectOption('monthly');
  await expect(page.locator('.tie.ok', { hasText: 'Every row adds across to its total' })).toBeVisible();
  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByRole('status')).toContainText('Saved "Kitchen by month"');
  await expect(page.locator('.inbox li', { hasText: 'Kitchen by month' })).toContainText('monthly');
  await open(page, '/reports/scorecards');
  await expect(page.locator('.tie.ok', { hasText: 'Net profit ties to the accrual P&L' })).toBeVisible();
  await open(page, '/reports/board');
  await expect(page.getByLabel('Letter (edit before printing)')).toHaveValue(/summary for the owners/);
});

test('inside store: import a POS department report that ties to the POS close, then re-import adds nothing', async ({ page }) => {
  // HM13's 26 Nov close is in the books but its department detail is not imported yet.
  const csv = [
    'Department,Net Sales,Qty Sold',
    'Cigarettes,792.82,94', 'Grocery,566.30,150', 'Packaged beverage,509.67,212', 'General merchandise,113.26,25', 'Beer & wine,849.45,87', 'Hot food,723.42,92',
    'Customer count,,378',
    'Total,3554.92,',
  ].join('\n');
  await open(page, '/inside?tab=import');
  await page.locator('#pi-store').selectOption('st_hm13');
  await page.locator('#pi-date').fill('2026-11-26');
  await page.getByLabel('Paste the department report').fill(csv);
  await page.getByRole('button', { name: 'Read report' }).click();
  await expect(page.locator('.tie.ok', { hasText: 'Ties to the file total' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Ties to the POS daily close in the books' })).toBeVisible();
  await axe(page, 'POS import preview');
  await page.getByRole('button', { name: 'Import 6 new rows' }).click();
  await expect(page.getByRole('status')).toContainText('Imported 6 rows');
  await page.getByRole('button', { name: 'Read report' }).click();
  await expect(page.getByText('0 new, 6 already imported or with a problem')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 new rows' })).toBeDisabled();
  await open(page, '/inside?month=2026-11&store=st_hm13');
  await expect(page.locator('.tie.ok', { hasText: 'POS department import ties to the POS daily close' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Cost of goods ties to 5100–5200 in the ledger' })).toBeVisible();
});

test('inside store: enter a count that shows shrink, post it, and 1310 still ties', async ({ page }) => {
  await open(page, '/inside/inventory?store=st_hm11');
  await page.locator('#ce-date').fill('2026-11-26');
  const entry = page.locator('section', { has: page.getByRole('heading', { name: 'Enter a count' }) });
  const row = entry.locator('tr', { hasText: 'Tobacco' });
  const book = (await row.locator('td').nth(4).textContent())!.replace(/[,$]/g, '');
  await page.getByLabel('Tobacco counted at cost').fill((Number(book) - 1000).toFixed(2));
  await expect(row.locator('.pill.bad')).toBeVisible();
  await expect(row.locator('td').nth(6)).toContainText('1,000.00');
  await axe(page, 'count entry');
  await page.getByRole('button', { name: 'Post count' }).click();
  await expect(page.getByRole('status')).toContainText('Posted the HM11 count');
  const hist = page.locator('section', { has: page.getByRole('heading', { name: 'Shrink by department' }) });
  await expect(hist.locator('tr', { hasText: 'Nov 26, 2026' }).first().locator('.pill.bad')).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'HM11 1310 ties to the latest counts' })).toBeVisible();
  await open(page, '/');
  await expect(page.getByText('Shrink over threshold')).toBeVisible();
});

test('budgets: edit a grid cell; totals tie across the grid, budget vs actual and the forecast', async ({ page }) => {
  await open(page, '/budgets?store=st_hm13');
  await expect(page.locator('.tie.ok', { hasText: "Grid ties to the budget's cells" })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Same total on Rolling forecast' })).toBeVisible();
  const cell = page.getByLabel('Repairs & maintenance, December 2026');
  await cell.fill('2,500');
  await cell.press('Enter');
  await expect(page.getByRole('status')).toContainText('Repairs & maintenance, December 2026: $2,500.00');
  await expect(page.locator('.tie.ok', { hasText: 'Months add to the year' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Same total on Rolling forecast' })).toBeVisible();
  await open(page, '/budgets/bva?month=2026-10');
  await expect(page.locator('.tie.ok', { hasText: 'Actuals tie to the P&L' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Budget ties to the annual budget grid' })).toBeVisible();
  await open(page, '/reports/pnl?basis=accrual&view=budget&from=2026-10');
  await expect(page.locator('.tie.ok', { hasText: 'Actual and budget columns tie to their statements' })).toBeVisible();
});

test('budgets: comment a variance and it leaves the to-explain list', async ({ page }) => {
  await open(page, '/budgets/bva?month=2026-10&show=open');
  const items = page.locator('.var-list li');
  const before = await items.count();
  expect(before).toBeGreaterThan(0);
  await items.first().getByRole('textbox').fill('Late delivery pulled into the month; timing only.');
  await items.first().getByRole('button', { name: 'Save comment' }).click();
  await expect(page.getByRole('status')).toContainText('Comment saved');
  await expect(items).toHaveCount(before - 1);
  await page.getByLabel('Only without a comment').click();
  await expect(page.getByLabel('Only without a comment')).not.toBeChecked();
  await expect(page.getByText('“Late delivery pulled into the month; timing only.”', { exact: false })).toBeVisible();
});

test('scenarios: the saved scenario ties, and a draft previews before saving', async ({ page }) => {
  await open(page, '/budgets/scenarios?fy=2027');
  await expect(page.locator('.tie.ok', { hasText: 'Tighter fuel, HM19 opens March: changes add up to the difference' })).toBeVisible();
  await page.getByLabel('Scenario name').fill('Fuel plus 3 cents');
  await page.getByLabel('Cents a gallon (+ or −)').fill('3');
  await page.getByRole('button', { name: 'Add change' }).click();
  await expect(page.getByRole('columnheader', { name: 'Fuel plus 3 cents (not saved)' })).toBeVisible();
  await page.getByRole('button', { name: 'Save scenario' }).click();
  await expect(page.getByRole('status')).toContainText('Saved "Fuel plus 3 cents"');
  await expect(page.locator('.tie.ok', { hasText: 'Fuel plus 3 cents: changes add up to the difference' })).toBeVisible();
});

test('close: work October to the lock gate, then lock it', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, '/close?month=2026-10');
  await expect(page.getByRole('button', { name: 'Lock October 2026' })).toBeDisabled();
  // HM15's October month-end count is posted, so the inventory step is proved by the data (closeHooks).
  await expect(page.getByRole('button', { name: /^9\. Inventory counted · HM15: Done/ })).toBeVisible();
  await page.getByRole('button', { name: /^8\. Accruals booked: In progress/ }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('done');
  await page.getByRole('button', { name: 'Save step' }).click();
  await expect(page.getByRole('button', { name: /^8\. Accruals booked: Done/ })).toBeVisible();
  await page.getByRole('button', { name: /^7\. Intercompany agreed: In progress/ }).click();
  await expect(page.getByRole('heading', { name: '7. Intercompany agreed' })).toBeVisible();
  for (let i = 0; i < 12; i++) {
    const b = page.getByRole('button', { name: /^Mark .* agreed$/ });
    if (!(await b.count())) break;
    await b.first().click();
    await page.waitForTimeout(100);
  }
  await expect(page.getByRole('button', { name: /^7\. Intercompany agreed: Done/ })).toBeVisible();
  await open(page, '/budgets/bva?month=2026-10&show=open');
  for (let i = 0; i < 30; i++) {
    const item = page.locator('.var-list li');
    if (!(await item.count())) break;
    await item.first().getByRole('textbox').fill('Reviewed with the store manager.');
    await item.first().getByRole('button', { name: 'Save comment' }).click();
    await page.waitForTimeout(150);
  }
  await expect(page.getByText('Every variance over the threshold has a comment.')).toBeVisible();
  await open(page, '/close?month=2026-10');
  await expect(page.locator('.tie.ok', { hasText: 'Lock gate open: every other step is done' })).toBeVisible();
  await page.getByRole('button', { name: 'Lock October 2026' }).click();
  await expect(page.getByRole('status')).toContainText('October 2026 locked');
  await expect(page.getByRole('button', { name: /^12\. Lock: Done/ })).toBeVisible();
});

test('close: the CFO can override the lock gate with a reason; the binder downloads', async ({ page }) => {
  await open(page, '/close?month=2026-10');
  await page.getByRole('button', { name: 'Lock anyway…' }).click();
  await expect(page.getByRole('button', { name: 'Override and lock' })).toBeDisabled();
  await page.getByLabel(/Why lock with \d+ steps? open\?/).fill('Board pack due; HM15 count follows.');
  await page.getByRole('button', { name: 'Override and lock' }).click();
  await expect(page.getByText('Locked with an override: “Board pack due; HM15 count follows.”', { exact: false })).toBeVisible();
  await open(page, '/close/binder?month=2026-10');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download ZIP of CSVs' }).click()]);
  expect(dl.suggestedFilename()).toBe('close-binder-2026-10-schedules.zip');
});

test('journal entries: a template entry over the limit waits, another role approves it, and it posts', async ({ page }) => {
  await open(page, '/books/journals/new?template=accr_utilities');
  await page.getByLabel('Date', { exact: true }).fill('2026-11-20');
  await page.getByLabel('Store', { exact: true }).selectOption('st_hm13');
  await page.getByLabel('Estimate').fill('12,500.00');
  await expect(page.getByText(/^Over the \$10,000\.00 limit/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.locator('h1')).toContainText('Accrued utilities HM13');
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('Awaiting approval');
  await expect(page.getByText(/You prepared this entry/)).toBeVisible();
  await open(page, '/approvals');
  await expect(page.getByRole('link', { name: /Accrued utilities HM13/ })).toBeVisible();
  await page.locator('#acting-as').selectOption('usr_owner');
  await page.getByRole('link', { name: /Accrued utilities HM13/ }).click();
  await page.getByRole('button', { name: 'Approve and post' }).click();
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('Posted');
  await expect(page.locator('.tie.ok', { hasText: 'The posted transaction carries these lines' })).toBeVisible();
  await page.getByRole('link', { name: /^Posted as TX-/ }).click();
  await expect(page.getByText('Debits equal credits')).toBeVisible();
});

test('account reconciliations: review one, prepare one with its document, and a later posting invalidates a sign-off', async ({ page }) => {
  await open(page, '/books/recons?period=2026-10');
  await expect(page.locator('.tie.ok', { hasText: 'GL column ties to the trial balance' })).toBeVisible();
  await page.getByRole('link', { name: '2200 · Sales tax payable' }).click();
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('Awaiting review');
  await page.getByRole('button', { name: 'Sign as reviewer' }).click();
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('Signed off');
  await open(page, '/books/recons/acct_owner_capital?period=2026-10');
  // Support equals the GL balance shown on the page, whatever the demo data makes it.
  const gl = (await page.locator('.figure', { hasText: 'GL at' }).locator('.value').textContent())!.replace(/[$,]/g, '').trim();
  await page.getByLabel('Balance per support').fill(gl);
  await page.getByLabel('What it is').fill('Capital account statement');
  await page.locator('input[type=file]').setInputFiles({ name: 'capital.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') });
  await expect(page.getByText('capital.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Save support' }).click();
  await expect(page.locator('.tie.ok', { hasText: 'No difference' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign as preparer' }).click();
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('Awaiting review');
  await expect(page.getByText('You prepared it, so someone else reviews it.')).toBeVisible();
  // A journal entry into October changes 2200 after its sign-off.
  await open(page, '/books/new?kind=journal');
  await page.getByLabel('Date').fill('2026-10-31');
  await page.getByLabel('Description').fill('Sales tax true-up');
  await page.getByLabel('Account 1').selectOption('acct_sales_tax');
  await page.getByLabel('Debit').first().fill('10');
  await page.getByLabel('Account 2').selectOption('acct_misc');
  await page.getByLabel('Credit').nth(1).fill('10');
  await page.getByLabel('Memo', { exact: true }).fill('Rounding on the October return');
  await page.getByRole('button', { name: 'Post journal entry' }).click();
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('Posted');
  await open(page, '/books/recons/acct_sales_tax?period=2026-10');
  await expect(page.locator('.figure', { hasText: 'Status' })).toContainText('GL changed after sign-off');
});

test('QuickBooks: differences are explained; push the held entry; import a QBO trial balance once', async ({ page }) => {
  await open(page, '/qbo/differences?entity=ent_hm11&period=2026-10');
  await expect(page.locator('.figure', { hasText: 'Over $5' })).toContainText('4');
  await expect(page.locator('.tie.ok', { hasText: 'Every difference has a cause' })).toBeVisible();
  await expect(page.locator('td', { hasText: 'Entry not pushed' }).first()).toBeVisible();
  await expect(page.locator('td', { hasText: 'Unmapped account' }).first()).toBeVisible();
  await open(page, '/qbo/sync?entity=ent_hm11&period=2026-10');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Push 1 and download CSV' }).click()]);
  expect(dl.suggestedFilename()).toBe('qbo-journal-HM11-2026-10.csv');
  await expect(page.getByRole('status')).toContainText('Pushed 1');
  await open(page, '/qbo/sync?tab=tb&entity=ent_hm13&period=2026-10');
  const tb = ['Trial Balance', 'HM13 books', 'As of October 31, 2026', '', ',Debit,Credit', 'Trustmark Operating,"1,000.00",', 'Owner Capital,,"1,000.00"', 'TOTAL,"$1,000.00","$1,000.00"'].join('\n');
  await page.getByLabel('QBO trial balance').fill(tb);
  await expect(page.locator('.tie.ok', { hasText: 'Debits equal credits' })).toBeVisible();
  await page.getByRole('button', { name: 'Import trial balance' }).click();
  await expect(page.getByRole('status')).toContainText('Imported the QBO trial balance for HM13');
  await page.getByLabel('QBO trial balance').fill(tb);
  await page.getByRole('button', { name: 'Import trial balance' }).click();
  await expect(page.getByRole('status')).toContainText('Already imported');
  await page.locator('#main').getByRole('link', { name: 'Differences report' }).click();
  await expect(page.locator('h1')).toHaveText('Differences report');
  await expect(page.locator('td', { hasText: 'Not explained' }).first()).toBeVisible();
  await open(page, '/qbo/log');
  await expect(page.locator('td', { hasText: 'Imported the QBO trial balance for HM13 2026-10' })).toBeVisible();
});

test('debt: run a refinance scenario and see break-even; save it', async ({ page }) => {
  await open(page, '/debt/refinance');
  await page.getByLabel('Saved scenario').selectOption({ label: 'HM13 mortgage: 10-year fixed at 5.50%' });
  const be = page.locator('.figure', { hasText: 'Break-even' });
  await expect(be.locator('.value')).toHaveText(/^\d+ months$/);
  await expect(page.locator('.tie.ok', { hasText: 'The new schedule repays its principal' })).toBeVisible();
  // A lower rate pays back sooner.
  const before = Number((await be.locator('.value').textContent())!.split(' ')[0]);
  await page.getByLabel('Rate (%)', { exact: true }).fill('4.50');
  await expect(be.locator('.value')).not.toHaveText(`${before} months`);
  const after = Number((await be.locator('.value').textContent())!.split(' ')[0]);
  expect(after).toBeLessThan(before);
  await page.getByLabel('Scenario name').fill('HM13 at 4.50%');
  await page.getByRole('button', { name: 'Save scenario' }).click();
  await expect(page.getByRole('status')).toContainText('Saved HM13 at 4.50%');
  await expect(page.getByLabel('Saved scenario')).toHaveValue(/refi/);
});

test('debt: the covenant monitor shows the liquidity near-breach from the forecast, and the dashboard ties', async ({ page }) => {
  await open(page, '/debt/covenants');
  const row = page.locator('tr', { hasText: 'Minimum liquidity' });
  await expect(row.locator('.pill')).toHaveText('Near');
  await expect(row).toContainText('13-week forecast reaches');
  await expect(page.locator('.tie.ok', { hasText: 'EBITDA ties to the P&L' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Scheduled interest equals 6500 on the ledger' })).toBeVisible();
  await expect(page.getByText('annualized (× 6.00)')).toBeVisible();
  await open(page, '/');
  await expect(page.locator('.inbox li', { hasText: 'Covenant breach forecast within 2 quarters' })).toBeVisible();
  await open(page, '/debt');
  await expect(page.locator('.tie.ok', { hasText: '2310 Notes payable – equipment ties to its loan schedules' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Interest to date adds to 6500 Interest expense' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'The ladder adds to company debt' })).toBeVisible();
  await expect(page.locator('.pill', { hasText: 'Carried by SKD Properties' })).toBeVisible();
  await open(page, '/debt/related-party');
  await expect(page.locator('tr', { hasText: 'Southern Eagle' }).locator('.pill', { hasText: 'Below AFR' })).toBeVisible();
});

test('tax: the October sales tax worksheet ties to 2200 and flags the $105 collected outside the POS and not remitted', async ({ page }) => {
  await open(page, '/tax/sales-tax?period=2026-10');
  await expect(page.locator('.tie.ok', { hasText: 'Tax collected less remitted ties to 2200 Sales tax payable' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Taxable sales tie to the taxable departments on the POS close' })).toBeVisible();
  await expect(page.locator('.tie.bad', { hasText: 'Collected ≠ remitted for this month' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Look into these before filing' })).toContainText('HM15: collected');
  await expect(page.getByRole('status').filter({ hasText: 'Look into these before filing' })).toContainText('$105.00 not remitted');
  await page.getByLabel('Month', { exact: true }).selectOption('2026-09');
  await expect(page.locator('.tie.ok', { hasText: 'Collected = remitted for this month' })).toBeVisible();
  await open(page, '/tax/book-to-tax');
  await expect(page.locator('.tie.ok', { hasText: 'M-1 reconciles book income to taxable income' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Book depreciation in these books ties to the asset register (6400)' })).toBeVisible();
  await open(page, '/');
  await expect(page.getByText('Sales tax collected ≠ remitted')).toBeVisible();
});

test('tax: record the Corporate estimate due within 14 days; it posts through the ledger and clears', async ({ page }) => {
  await open(page, '/tax/estimates');
  await expect(page.locator('.figure', { hasText: 'Due within 14 days' }).locator('.value')).toHaveText('1');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'CORP · State 2026' }) });
  await card.getByRole('button', { name: 'Record a payment' }).click();
  await card.getByLabel('Quarter').selectOption('4');
  await card.getByLabel('Amount').fill('1,000.00');
  await card.getByLabel('Confirmation #').fill('PTE-E2E-4');
  await card.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('status')).toContainText('Payment posted as TX-');
  await expect(page.locator('.figure', { hasText: 'Due within 14 days' }).locator('.value')).toHaveText('0');
  await expect(page.locator('.tie.ok', { hasText: 'Payments made by an entity agree with their entries in the books (2)' })).toBeVisible();
  await card.getByRole('link', { name: /^TX-/ }).last().click();
  await expect(page.getByText('6250 · Income & franchise taxes (entity level)')).toBeVisible();
});

test('growth: evaluate a deal end to end: pro forma → financing → company impact → go / no-go', async ({ page }) => {
  await open(page, '/growth/readiness');
  await expect(page.locator('.tie.ok', { hasText: 'Overall follows the rule' })).toBeVisible();
  await expect(page.locator('tr', { hasText: '3 quarters of stable or growing same-store profit' })).toContainText('Not enough history');
  await open(page, '/growth/pro-forma');
  await expect(page.locator('.tie.ok', { hasText: 'Every annual total = the sum of its 12 months' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'NPV of the levered flows at the levered IRR is zero' })).toBeVisible();
  await open(page, '/growth/evaluate');
  await page.getByLabel('Deal', { exact: true }).selectOption({ label: 'HM19 build – Prospect A (build)' });
  const decision = page.locator('.figure', { hasText: 'Decision' }).locator('.value');
  await expect(decision).toHaveText('Go, with conditions');
  await expect(page.locator('tr', { hasText: 'Equity available above the reserve' }).locator('.pill')).toHaveText('Fail');
  await expect(page.locator('.tie.ok', { hasText: 'DSCR after = (EBITDA + deal year 1)' })).toBeVisible();
  // Expensive money breaks the hurdle: no go.
  await page.getByLabel('Rate %').fill('16');
  await expect(decision).toHaveText('No go');
  await expect(page.locator('tr', { hasText: 'Levered IRR at or above' }).locator('.pill')).toHaveText('Fail');
  await page.getByLabel('Rate %').fill('7');
  await expect(decision).toHaveText('Go, with conditions');
  // The acquisition, from its own screen.
  await open(page, '/growth/acquisitions');
  await expect(page.locator('.tie.ok', { hasText: 'Normalized = reported + add-backs + perks − normalizations' })).toBeVisible();
  await page.getByRole('link', { name: 'Evaluate this deal' }).click();
  await expect(page.locator('h1')).toHaveText('Evaluate a deal');
  await expect(page.locator('tr', { hasText: 'Fuel volume verified against supplier statements' }).locator('.pill')).toHaveText('Fail');
  await expect(page.locator('tr', { hasText: 'No open due-diligence issue' }).locator('.pill')).toHaveText('Pass');
});

test('growth: record an owner distribution and see it tie to the ledger', async ({ page }) => {
  await open(page, '/growth/owners');
  await expect(page.locator('.tie.ok', { hasText: 'Cash − reserve − capex − tax − cushion = safe distribution' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Every recorded distribution is posted to 3100 for its amount' })).toBeVisible();
  const ytd = page.locator('tr', { hasText: 'Owner B' }).first().locator('td').nth(2);
  await expect(ytd).toHaveText('8,000.00');
  await page.getByLabel('Owner', { exact: true }).selectOption({ label: 'Owner B' });
  await page.getByLabel('Amount', { exact: true }).fill('1,500.00');
  await page.getByRole('button', { name: 'Post distribution' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Posted TX-' })).toBeVisible();
  await expect(ytd).toHaveText('9,500.00');
  await expect(page.locator('.tieout > span', { hasText: 'Every recorded distribution is posted to 3100 for its amount' })).toContainText('$21,500.00 recorded, $21,500.00 in 3100');
  await expect(page.locator('.tie.ok', { hasText: 'Books YTD ties to the owner draws in the ledger' })).toBeVisible();
  // Above the safe amount needs a reason.
  await page.getByLabel('Amount', { exact: true }).fill('900,000.00');
  await expect(page.getByLabel('Reason to go above the safe amount')).toBeVisible();
  await page.getByRole('button', { name: 'Post distribution' }).click();
  await expect(page.getByRole('alert')).toContainText('above the safe distribution');
  await page.getByLabel('Amount', { exact: true }).fill('');
  await page.locator('tr', { hasText: 'Owner B' }).getByRole('link', { name: /^TX-/ }).first().click();
  await expect(page.getByText('3100 · Owner draws')).toBeVisible();
});

test('growth compass: a stage, three moves, and the spread moves with the cost of equity', async ({ page }) => {
  await open(page, '/');
  await expect(page.locator('.compass-today')).toContainText('Growth compass: Fix');
  await page.getByRole('link', { name: 'Growth compass: Fix' }).click();
  await expect(page.locator('h1')).toHaveText('Growth compass');
  await expect(page.getByTestId('compass-stage')).toHaveText('Fix');
  await expect(page.locator('.compass-ladder [aria-current="step"]')).toContainText('Fix');
  await expect(page.locator('.compass-moves > li')).toHaveCount(3);
  const gates = page.getByRole('region', { name: 'The gates' });
  await expect(gates.locator('tr', { hasText: 'No covenant broken or forecast to break' }).locator('.pill')).toHaveText('Fail');
  await expect(gates.locator('tr', { hasText: 'Bank at or above its floor' }).locator('.pill')).toHaveText('Pass');
  await expect(page.locator('.compass-why')).toContainText('forecast to break');
  await expect(page.locator('.tie.ok', { hasText: 'Invested capital ties to the balance sheet' })).toBeVisible();
  await expect(page.locator('.tie.ok', { hasText: 'Free cash flow ties to the cash flow statement' })).toBeVisible();
  const spread = page.locator('.figure', { hasText: 'ROIC − WACC' }).locator('.value');
  await expect(spread).toHaveText('+1.0 pts');
  await page.getByLabel('Cost of equity %').fill('20');
  await page.getByRole('button', { name: 'Save assumptions' }).click();
  await expect(page.getByText('Assumptions saved.')).toBeVisible();
  await expect(spread).not.toHaveText('+1.0 pts');
  await expect(spread).toContainText('−');
  await expect(gates.locator('tr', { hasText: 'Company ROIC at or above the cost of capital' }).locator('.pill')).toHaveText('Fail');
  await axe(page, 'compass after an edit');
  await page.getByRole('button', { name: 'Record October 2026' }).click();
  await expect(page.locator('.tie.ok', { hasText: 'October 2026 is in the history' })).toBeVisible();
});

test('controls: a bookkeeper approving a bill above their limit is refused, and the message names who can', async ({ page }) => {
  await open(page, '/controls/limits');
  await page.getByLabel('Bookkeeper limit for bills').fill('1,000');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Approval limits saved.')).toBeVisible();
  await page.locator('#acting-as').selectOption('usr_bk');
  await open(page, '/approvals');
  await page.getByRole('button', { name: 'Approve Kitchen equipment service (demo) · invoice KS-3318' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('over your $1,000.00 limit for bills');
  await expect(alert).toContainText('CFO (CFO / admin)');
  await expect(alert).toContainText('Owner (demo) (Owner)');
  await expect(page.getByRole('link', { name: 'Kitchen equipment service (demo) · invoice KS-3318' })).toBeVisible();
  await axe(page, 'approval refused');
  await page.locator('#acting-as').selectOption('usr_owner');
  await open(page, '/approvals');
  await page.getByRole('button', { name: 'Approve Kitchen equipment service (demo) · invoice KS-3318' }).click();
  await expect(page.getByText(/Approved Kitchen equipment service/)).toBeVisible();
});

test('controls: dismiss a fraud signal with a reason; it leaves the open list and the reason is kept', async ({ page }) => {
  await open(page, '/controls/fraud?kind=round_dollar');
  const title = 'Outside CPA firm: 3 round-dollar payments';
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('section', { has: page.getByRole('heading', { name: title }) }).locator('.tie.ok', { hasText: 'Evidence rows add to the stated amount' })).toBeVisible();
  await page.getByRole('button', { name: `Dismiss ${title}` }).click();
  await page.getByLabel('What did you find?').fill('Monthly bookkeeping retainer per the engagement letter');
  await page.getByRole('button', { name: 'Confirm dismiss' }).click();
  await expect(page.getByText('Dismissed. The reason is in the audit log.')).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
  await open(page, '/controls/fraud?kind=round_dollar&show=dismissed');
  await expect(page.getByText(/Monthly bookkeeping retainer per the engagement letter/)).toBeVisible();
  await axe(page, 'dismissed signal');
  await open(page, '/setup/audit');
  await expect(page.getByText(/Dismissed fraud signal round_dollar:pt_cpa/).first()).toBeVisible();
});

test('controls: download a backup, see it in the export log, and restore it after a preview', async ({ page }) => {
  await open(page, '/controls/security');
  await expect(page.getByText('Requires hosted back end').first()).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^cfo-portal-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await dl.path();
  const fs = await import('node:fs');
  const text = fs.readFileSync(path!, 'utf8');
  expect(JSON.parse(text).format).toBe('cfo-portal-backup');
  await expect(page.locator('td', { hasText: /full books backup \(JSON\)/ }).first()).toBeVisible();
  await page.locator('#bk-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByRole('heading', { name: 'Preview: backup.json' })).toBeVisible();
  await axe(page, 'restore preview');
  await page.getByRole('button', { name: 'Replace the books with this backup' }).click();
  await expect(page.getByRole('alert')).toContainText('Type RESTORE to confirm');
  await page.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await page.getByRole('button', { name: 'Replace the books with this backup' }).click();
  await expect(page.getByText(/Books restored from the backup/)).toBeVisible();
});

test('controls: blind HQ count hides the pickup amount until HQ records what it counted', async ({ page }) => {
  await open(page, '/controls/cash');
  await page.getByLabel(/Blind HQ counts/).check();
  await page.getByRole('button', { name: 'Save cash controls' }).click();
  await expect(page.getByText('Cash controls saved.')).toBeVisible();
  await open(page, '/cash?date=2026-11-26');
  const row = page.locator('tr', { hasText: 'HM13' }).first();
  await row.getByLabel('Operator pickup amount').fill('100.00');
  await row.getByRole('button', { name: 'Record' }).click();
  await expect(row.getByText('Sealed bag · amount hidden for the blind HQ count')).toBeVisible();
  await row.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText(/Blind count: enter what you counted/)).toBeVisible();
  await row.getByLabel('HQ receipt amount').fill('100.00');
  await row.getByRole('button', { name: 'Record' }).click();
  await expect(row.getByText('Sealed bag · amount hidden for the blind HQ count')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Deposit HM13 2026-11-26/ })).toBeVisible();
});
