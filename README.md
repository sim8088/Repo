# CFO Portal

The CFO's working hub for a group of fuel and convenience stores (HM11 Gluckstadt, HM13 Meadville, HM15 Crystal Springs, HM17 Centreville, HM14 Gulfport leased out, plus Corporate). It's meant to be a workbench rather than a dashboard: it shows what needs doing today, lets you do it on the spot, and traces every number back to the transactions behind it.

The portal was built in 14 phases, each usable on its own. **All 14 are built:** Foundation, Bank & cash, Fuel, Reports, Intercompany & payables, People & payroll, Inside store & kitchen, Budgets & close, Compliance, assets & ask, GL toolkit & QuickBooks, Tax, Debt & treasury, Growth & owners, and Controls & risk. The app's `/roadmap` screen lists what each one covers.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # accounting-core unit tests (vitest)
npm run build        # typecheck + production build in dist/
npm run e2e          # browser tests: axe-core, 390/1440 px, light/dark, key workflows
```

`npm run e2e` uses Playwright. If a Chromium binary is preinstalled somewhere (as in cloud containers), point at it with `PW_CHROMIUM=/path/to/chromium npm run e2e`.

The first time it opens, the app loads a **demo dataset**: four stores, 1 Sep – 26 Nov 2026, about 750 transactions. Every one is posted through the real ledger, so it is validated and balanced like a manual entry. The amounts are made up. To start over, use Setup › Settings › Reset to demo data.

## What Phase 1 includes

| Area | What works |
|---|---|
| Ledger | Double-entry under every screen. Money is stored as integer cents. Debits must equal credits. If a transaction spans entities (for example, the shared Trustmark account pays an HM11 bill), the ledger adds **due-to / due-from lines automatically**, so each entity's books balance on their own. |
| Transactions | Money out, money in and journal entries. A category can be split across stores by amount or by %, and the cents always add back to the total. Attach a photo or PDF. Each transaction has a memo, tags, a check # and a doc #. You can bulk-edit category and store. Deleting is a soft delete that needs a reason, and deleted items can be restored. |
| Rules engine | "If the description contains X, suggest category Y and store Z." Each time you categorize something, the matching rule is created or updated. Confidence rises when a suggestion is accepted and falls when it is changed. |
| Duplicate detection | Flags the same amount and payee within ±3 days. You can mark a pair as not a duplicate. |
| Today | Inbox of uncategorized items, duplicates, accounts below their floor, past months still open, and payments missing a document. Also: bank vs the $30k floor, cash on hand, supplier clearing, month-to-date profit, and yesterday at a glance. |
| Reports | Profit & loss by store with lines of business and drill-down to transactions. Trial balance by entity. General-ledger detail for any account with a running balance. Every report has a **tie-out footer** and exports to CSV. Printing gives a clean PDF. |
| Close | Lock and unlock periods. Unlocking needs a reason. Locked months refuse every change. |
| Setup | Stores (add a fifth with no code change), entities (one hub), chart of accounts, vendors and parties, rules, users and roles, settings, audit log (who, what, when, before and after, why). |
| Roles | CFO, bookkeeper, store manager (sees only their own store), owner, and outside accountant. The "Acting as" menu shows the portal the way each role sees it. |
| UX | ⌘K / Ctrl+K or `/` searches pages, stores, accounts, parties, TX refs, check numbers and amounts such as `$4,077.40`. `N` starts a new entry. Light and dark themes. On phones there's a bottom tab bar and a card list. Zero axe-core violations. |

## Where to find things

```
src/core/      Accounting core: pure TypeScript, no UI. Most of the logic and the unit tests live here.
  money.ts       cents, parsing, accounting format, largest-remainder allocation
  ledger.ts      draft validation, automatic intercompany balancing
  books.ts       the Books repository: every write is permission-checked, validated and audited
  reports.ts     trial balance, P&L by store, account detail, balances
  rules.ts       rule matching, learning, confidence
  duplicates.ts  duplicate detection
  permissions.ts roles and the permission matrix
  coa.ts         chart of accounts for fuel retail
  payroll.ts     employees, rate approvals, Gusto import and posting, cash/check pay, weekly review, labor %, payroll taxes
src/data/      seed.ts (demo dataset), seed-payroll.ts (phase 6 demo), storage.ts (IndexedDB persistence)
  fuel.ts        fuel subledger: invoices, notices, Dash clearing, truck lane, margin, accrual COGS, tanks, pricing
  fuelio.ts      notice / invoice / Comdata file parsers
  inside.ts      inside store: POS department import, vendor purchases → departments, counts and shrink, budgets, scan-data, lottery, age checks
  kitchen.ts     kitchen: food sales, menu mix, food cost, waste, kitchen labor, supplier price alerts
src/data/      seed.ts (demo dataset), seed-fuel.ts (demo fuel), storage.ts (IndexedDB persistence)
  intercompany.ts, payables.ts, receivables.ts, approvals.ts   phase 5
  statements.ts  phase 4: booked / cash / accrual P&L and the bridge, balance sheet, cash flow, command center, scorecards, report builder
  budgets.ts     phase 8: budget versions and grid, budget vs actual and variance comments, rolling forecast, scenarios, break-even
  close.ts       phase 8: month-end checklist, auto-evidence, intercompany agreements, lock gate
  binder.ts      phase 8: the close binder (printable HTML, ZIP of CSVs)
  xlsx.ts        minimal .xlsx (OOXML) writer for Excel exports
  journals.ts    phase 10: journal entries, approval limit, reversing / recurring, templates, trial balance columns
  recons.ts      phase 10: monthly account reconciliations with subledger support and sign-offs
  consolidation.ts  phase 10: consolidated trial balance with elimination entries
  qbo.ts         phase 10: QuickBooks connector interface, file connector, mapping, pull, push, differences
  limits.ts, controls.ts   phase 14: approval limits (one central check), segregation of duties, cash controls, fraud signals, risk & insurance, UST, backup / restore (seed-controls.ts)
src/data/      seed.ts (demo dataset), storage.ts (IndexedDB persistence)
  compliance.ts, prepaids.ts, assets.ts, loans.ts, ask.ts   phase 9 (seed-compliance.ts, seed-assets.ts)
  debt.ts, debtTypes.ts   phase 12: debt dashboard, covenants, refinance, paydown vs invest, reserve, related-party loans (seed-debt.ts)
  tax.ts, taxPackage.ts, taxTypes.ts   phase 11: entity map, MACRS, book-to-tax, sales tax, estimates, K-1, CPA package (seed-tax.ts)
  growth.ts, growthTypes.ts   phase 13: expansion scorecard, sites, pro forma, IRR/NPV, acquisitions, capital allocation, valuation, safe distribution, deal evaluation (seed-growth.ts)
  compass.ts, compassTypes.ts   growth compass: ROIC vs WACC, stage gates, store roles, moves, triggers, sensitivity (seed-compass.ts)
src/app/       React UI (screens in pages/, shell, ⌘K and shared components in components/)
e2e/           Playwright tests: accessibility, layout and workflows
docs/          HOW-TO.md (one note per screen), DECISIONS.md
```

## What Phase 2 adds

| Area | What works |
|---|---|
| Bank import | CSV, OFX and QFX import with a preview: new vs already-imported lines, totals, and a line-by-line check of the running balance. Re-importing a file is a no-op, and every line keeps its import batch id. |
| Matching | Auto-match by check number, or by amount + date when one candidate clearly wins. Manual match of one bank line to several entries (pooled deposits). Book a bank-only line in one step; that teaches the rules. Exclude a line with a reason. |
| Reconciliation | Statement balance vs book balance, explained line by line (outstanding items, bank-only items). It saves only at a $0.00 difference, records "reconciled through", and locks the lines it covers. The CFO can undo one, with a reason. |
| Checks register | Outstanding / cleared / stale / void / cleared-not-in-books. Void an uncleared check with a reason. |
| Deposits | A source on every deposit, guessed from the description. Unclassified deposits go to the inbox. Totals by source tie to total deposits. |
| Cash chain | Store count → operator pickup → HQ receipt → pooled deposit, with who and when at every step. Each difference posts to Cash over / short, and anything ≥ $5 is flagged. Overdue deposits are flagged. Payouts (payroll, vendors, change, owner draws) come from the pool. Cash on hand is shown by location. |
| Forecast | A 13-week rolling forecast against the $30k floor, built from recurring items found in the books plus items you add. 7/14/30-day projections and the lowest point also show on Today. |
| Transfers | A Transfer mode for moving money between balance-sheet accounts. The ledger refuses a transfer that touches the P&L. |

## What Phase 6 adds

| Area | What works |
|---|---|
| Employees | Store, department (front, kitchen, office, truck lane), pay type, current rate, status, hire and termination dates, Gusto id, and how they're paid (Gusto, cash, check, mixed). New hires wait to be confirmed. |
| Rate changes | Requested with a reason and effective date; they apply only when the CFO or an owner approves. Full history per employee. The weekly review warns when Gusto pays a rate nobody approved. |
| Gusto runs | Import the payroll journal CSV. The preview ties every line and the Total row (gross, employee and employer taxes, net, company debit); re-importing adds nothing, and each line keeps its batch id. Per run: lines by employee and by store/department, check-paid amounts. |
| Posting | SPEC §6.7: net pay to 6100, employee + employer taxes to 6110, by store, on the pay date, crediting Trustmark. The Gusto debit ties to the run's company debit; paper checks post on their own and show in the checks register. |
| Cash & check pay | Per employee and week. Links to HM11's cash-chain payouts instead of posting twice. Gusto and cash/check pay for the same person and week are shown side by side and confirmed, never assumed to be duplicates. |
| Weekly review | One screen: the run → this week vs last by store and employee (hours, headcount, hires, leavers, rate changes, overtime; >15% flagged) → approve rate changes → post. |
| Labor % | Labor cost vs POS sales by store and week, against a per-store target, plus sales per labor hour. Ties to 6100 + 6110 for posted weeks. |
| Payroll taxes | Liabilities vs deposits by quarter (federal and state), the 941 / state return checklist and the W-2 / 1099 season list. |
| Inbox | Payroll to review, rate changes awaiting approval, new hires to confirm, payroll moved more than 15% week to week. |
## What Phase 4 adds

| Area | What works |
|---|---|
| Command center | One tile and row per store with activity: sales, gross margin, labor % against target, net profit and the change on the prior month, plus the company total. Defaults to the latest month with sales and says so. |
| P&L on two bases | Booked (ledger), **cash** (clear / settlement date; uncleared checks left out; bills when paid) and **accrual** (transaction date; accrual fuel COGS replaces paid fuel invoices). By store, by month (trend), vs prior period, % of sales, lines of business. Drill from any figure to its entries and transactions. |
| Bridge | Cash → accrual, line by line (clear timing, uncleared checks, bills, paid fuel out, accrual fuel in), tying to the cent, with the fuel inventory change and fuel delivered-not-paid explained. |
| Balance sheet | Any date, by entity or consolidated; intercompany by party; ties A = L + E and to the trial balance account by account. |
| Cash flow | Indirect: net income → working capital → investing → financing = change in cash and equivalents. |
| Scorecards | Fuel gallons and ¢/gal, inside GM %, food cost %, labor %, card fee %, cash over / short, net profit, break-even sales: green / amber / red against configurable thresholds, with notes. |
| Board pack | One printable monthly page: an editable letter written from the numbers, P&L, balance sheet, cash, KPIs, intercompany positions, open issues. |
| Report builder | Rows (accounts or groups) × columns (stores or months) on any basis; saved reports with a cadence (no email yet). |
| Exports | CSV and real Excel (.xlsx) on every report, plus print to PDF; a tie-out footer on each. |
## What Phase 7 adds

| Area | What works |
|---|---|
| POS import | Daily department sales (PDI C-Store Essentials / CStorePro CSV). The preview ties to the file total and to the POS close in the books; idempotent, batch id on every row. Units, transactions per day and average ticket. |
| Department margin | Configurable departments mapped to revenue and cost-of-goods accounts; vendor purchases (checks, EFT, cash, bills) mapped to departments; true margin with the inventory change. Ties to 5100–5200. |
| Inventory & shrink | Counts by department at cost, book vs counted, shrink % by department. Posting a count moves 1310 through the ledger. |
| Purchasing budgets | Monthly per store and department, spend to date, bills awaiting approval and a remaining bar. |
| Scan-data | Programs per manufacturer: units × share × rate vs received, on the Phase 5 rebate items. Short-paid flagged. |
| Lottery & age checks | Weekly lottery settlement per store with the shortage flag; commissions tie to 4140. Age-check audit log with follow-ups. |
| Kitchen | Food sales by day, menu mix import, food cost % with counts and a target per store, waste log and its effect, kitchen labor and prime cost, supplier price alerts from item-level invoice detail. |
| Inbox | Food cost outside target, shrink over threshold, purchasing budget exceeded, lottery shortage, scan-data short-paid, supplier price jump. |

## What Phase 13 adds

| Area | What works |
|---|---|
| Expansion readiness | Eight checks, green / amber / red, recalculated monthly with a recorded history: TTM EBITDA and trend (annualized, and it says so), three quarters of same-store profit ("not enough history" until four quarters exist), every store at break-even with fix plans, reserve plus equity for the next deal, DSCR and leverage after the deal's debt, management bandwidth (manager ready + books closed on time), the newest store against its ramp targets. Alert when it turns green or drops to red. |
| Sites | Prospects and our own stores scored on AADT, visibility, access, competition within 3 miles (brand, price, amenities), population and growth, trucks, zoning, environmental, utilities and income, with editable weights. |
| Pro forma | Buy / build / lease: 10 years of monthly P&L with a ramp, capital lines, brand and supplier incentives and financing → EBITDA, cash after debt service, cash-on-cash, levered and unlevered IRR (bracketed bisection + Newton), NPV, payback, DSCR by year, break-even gallons and inside sales, sensitivity (±2¢ × ±10% gallons, ±1% rate). Prefill from a store's statements. |
| Buy vs build vs lease | Side by side: IRR, NPV, upfront cash, time to open, residual real estate, IRR with a construction overrun, risk factors. |
| Acquisitions | Seller P&L normalized (add-backs, owner perks, normalizations), gallons vs supplier statements with a 2% flag, valuation by EBITDA multiple / per gallon / real estate + business, cash at closing with inventory and fuel in the tanks, QoE checklist, due-diligence tracker with documents in the vault. |
| Capital allocation | Projects, debt paydown, the reserve and owner distributions ranked by risk-adjusted return, with deployable cash allocated down the list. |
| Valuation | EBITDA × multiple range, per-gallon cross-check, real estate at appraised value less debt = equity, recorded quarterly with the trend. |
| Owner returns | Distributions by owner YTD and lifetime (tied to the ledger), recorded distributions posted Dr 3100 / Cr bank, the safe distribution amount (replaces the Phase 11 placeholder on the tax screen), tax distributions, ROE and ROIC by store. |
| Workflows | Quarterly CFO review (printable owner / bank pack and a multi-sheet Excel workbook) and Evaluate a deal (go / no-go with reasons). |
| Inbox | Expansion scorecard changed, month not yet recorded, due diligence overdue or with an issue; Phase 12's "cash above the reserve 2+ months" now suggests where to put it. |

## Growth compass

| Area | What works |
|---|---|
| Growth compass | `/growth/compass`, first in Growth: the stage on a five-step ladder (Fix → Stabilize → Optimize → Replicate → Scale) with why, the ROIC − WACC spread, the gates (value vs threshold), store roles (Grow / Fix with its lever / Harvest / Watch), the next three moves, "Open store #N when …" with estimated dates, the sensitivity, and every formula and assumption editable. Monthly snapshots; the inbox flags a stage change; a one-line summary on Today. |

### How big-company CFOs decide to grow, and how this maps
- **Return on capital beats the cost of capital.** A store is only worth copying if it earns more on the money tied up in it than that money costs. Here: ROIC (after-tax operating profit ÷ fixed assets, inventory and working capital) against WACC (the blend of after-tax debt cost and a cost of equity the CFO sets). The spread is the headline number.
- **Unit economics before expansion.** Profit a gallon, a store-month and a transaction, labor against target and break-even headroom, per store. Weak stores get a named lever and a dollar value before a new one is opened.
- **Cash, not just profit.** Free cash flow and how much of EBITDA becomes cash; the reserve first; months until the next store's equity is on hand.
- **Capacity.** The bank's view: DSCR and leverage after a typical new-store loan.
- **Stage gates.** Explicit, written-down thresholds, each pass or fail with the actual number, so the decision to grow is a checklist rather than a feeling. The thresholds are editable and logged.
- **Prove it twice.** Scale (a pipeline of stores) needs the gates to hold for months in a row and cash to fund the next store quickly.

## What Phase 12 adds

| Area | What works |
|---|---|
| Debt dashboard | Every loan, mortgage, line of credit, equipment note and related-party loan (both ways), related-party-carried mortgages flagged; balance, rate and index, after-tax cost, payment, maturity and balloon, collateral, guarantor, prepayment penalty, covenants; interest to date (6500) and projected; WACD; maturity ladder. Ties to 2300–2320 and the schedules. |
| Covenant monitor | DSCR, leverage, minimum liquidity and fixed-charge coverage monthly from the statements (TTM, or annualized with fewer months, and it says so), headroom, a forecast breach date from the 13-week forecast and the trend, and a printable lender package with an Excel workbook. |
| Refinance analyzer | Current vs proposed loan: payment change, interest saved, break-even months, NPV at the cost of capital, DSCR before and after, cash freed. Saved scenarios, market rate history, property values and LTV. |
| Triggers | Rate gap with break-even, maturity within 12 months, LTV below target, variable above fixed, covenant forecast to breach. |
| Paydown vs invest | After-tax cost of each debt vs after-tax return on alternatives, ranked (avalanche once the reserve is met), with the effect on DSCR, liquidity and months to fund the next store. |
| Cash reserve | N weeks of fixed costs + one fuel load per store + one payroll; deployable cash and suggested uses. |
| Related-party loans | Documented terms, imputed-interest flags below the AFR, monthly balance confirmations. |
| Inbox | Covenant breach forecast, DSCR below target, maturity within 12 months, refinance opportunity, variable above fixed, deployable cash above the reserve 2+ months. |

## What Phase 3 adds

| Area | What works |
|---|---|
| Gallons & margin | Gallons, retail and cost per gallon, cpg margin, discounts and card fees per gallon, and break-even cpg by store, grade, day and month. Structured daily fuel sales tie to fuel revenue in the ledger. |
| Accrual fuel COGS | `fuelCostOfSales(state, storeId, period)` in `src/core/fuel.ts`: gallons sold by grade × that month's delivered cost per gallon (Plus blended 50/50). Phase 4 builds the accrual P&L on it. |
| Invoices & BOLs | Deliveries with BOL, invoice, gallons by grade, cost, freight, taxes, due date and attachments. Flags missing invoices, duplicates and price outliers. Idempotent import. |
| Craddock notices | Upload or paste an EFT notice, see every line and its books date, prove it nets to zero, then post: card fees → 6000, network fees → 6010, host discounts → 4920, invoices → 5000, draft or deposit → Trustmark. The receivable at any date ties to the ledger. |
| Dash clearing | Card proceeds in, invoices out on their due dates, weekly statements, the balance owed each way and the clearing ledger by date. |
| Truck lane | Comdata summary import (kept apart from the POS), Mudflap discounts and true-ups (4910), Fiserv deposits and next-month fees. |
| Tanks | Tanks per store, daily readings, book-to-physical variance, water alerts, days of supply and a reorder signal. |
| Pricing & ordering | Posted prices vs competitors with the margin impact of matching, and a suggested next load per store. |
| Inbox | Missing fuel invoices, unposted notices (and any not netting to zero), tank variance and water, stores outside the cpg target, duplicate invoices. |
## What Phase 5 adds

| Area | What works |
|---|---|
| Related parties | A running due-to / due-from ledger for every related company, owner, tenant and lender, plus each store entity's position with Corporate. Aging, limits with inbox alerts, and a printable statement per party (PDF via print, CSV). Paying another business's bill from the shared account posts to that party's receivable (1920). |
| Rent pass-throughs | Monthly templates generate the store rent / Corporate payable entries, idempotently. |
| Owner draws | Year-to-date withdrawals by owner, found under either withdrawal policy. |
| Elimination view | Consolidated balance sheet with the entity due-to / due-from netted out; proves each pair agrees and both sides net to zero. |
| Bills | Vendor, store, invoice #, dates, category lines split by store, attachments, autopay. Draft → approved (posts expense → 2000) → scheduled → paid (2000 → Trustmark with check # and confirmation). |
| Bills inbox | Upload a photo/PDF or paste the email; amounts, dates, invoice #, vendor and store are read from the text or file name (no OCR) into a form you confirm. |
| AP aging, payment calendar | Aging buckets that tie to the 2000 balance; bills by pay date against the projected bank balance (bills feed the 13-week forecast). |
| Utilities | Each account with its history; flags past due, disconnect notices and jumps over 25%. |
| Vendor statements, 1099s | Statement vs AP with every difference explained; 1099 vendors flagged at $600. |
| Receivables | Tenant rent roll (due vs received, late), rebates and programs, ATM income, insurance claims and refunds owed to us. |
| Approvals | One queue under Today for everything waiting on a yes; bills now, other kinds plug in later. |

## What Phase 9 adds

| Area | What works |
|---|---|
| Compliance calendar | Sales tax, fuel/UST, payroll, income and property tax, annual reports: recurring due dates, status (not started → in prep → filed → paid → accepted), filed date, paid amount, confirmation # and documents. Overdue and due-in-30-days items reach the inbox. |
| Licenses, insurance, leases | Licenses and permits per store with expiry and renewal history; insurance policies (tied to their prepaid schedules); leases we rent (tied to the rent pass-throughs) and let (tied to tenant rent). Expiring items reach the inbox. |
| Notices | IRS and state letters: deadline, response, outcome, documents. Open ones stay in the inbox. |
| Document vault | One searchable index of every attachment (transactions, bills, fuel invoices, compliance and asset records) plus standalone uploads, with type, tags and links to transactions, vendors, stores and months. |
| Prepaids | Property tax, insurance and annual fees amortized monthly (1400 → expense), idempotently; ties to 1400. |
| Fixed assets | Register by store, straight-line book depreciation posted from the register (idempotent per asset and month; it replaced the demo's hand-posted entries with the same amounts), disposals with gain/loss, maintenance log and warranties. Ties to 1500/1510/1590. |
| Loans | Terms, covenants, amortization tables and payoff dates; payments split principal and interest through the ledger; a line of credit with draws and daily interest. Store mortgages carried by Dhunna / SKD are information only (no double-booking of the rent). Ties to 2310/2320. |
| Ask | Plain-English questions answered from the books with the transactions as proof (⌘K offers "Ask: …"). Never invents a number: it says what's missing instead. Copy as text or export CSV. |
## What Phase 8 adds

| Area | What works |
|---|---|
| Annual budget | Store × P&L line × month for a fiscal year, on the accrual basis. Build from last year's actuals + growth % (the demo has only Sep–Nov 2026, so the complete months are annualized and the version says so) or zero-based; edit in a grid, copy the first month across or spread a total; versions with one active. |
| Budget vs actual | Every P&L line with variance $ and %, by month or range, store and basis; a comment on each store × line × month variance over a configurable threshold. Also a **Vs budget** view on the P&L. Actuals tie to the P&L; the budget ties to the grid. |
| Rolling forecast | Actuals for months that are over, actual-to-date + plan for this month, budget or run rate (or your override) for months to come. |
| Scenarios | Fuel margin ±N¢ a gallon, a new store opening in a month (copied profile with a ramp), closing a kitchen one weekday, % change to any line group; saved and compared side by side with the base forecast. |
| Break-even | Per store: fixed costs ÷ contribution margin %, as sales, sales a day and gallons, with the margin of safety; actual or budget. |
| Month-end checklist | The 12 close steps per month and store with owners, due dates (business days after month end), status, notes and evidence attachments. Steps the data can prove (POS closes, fuel invoices settled, notices posted, bank reconciled, cash chain, payroll posted, intercompany agreed, rent pass-throughs, variances explained) compute their status and evidence and link to the screen that does them. |
| Lock gate | Lock is enabled only when every other step is done; the CFO can override with a reason, kept with the month. Periods › Lock goes through the same gate. |
| Close binder | One printable HTML document (statements on both bases, bank reconciliation, checklist with evidence, budget vs actual, schedules, document index) and a ZIP of CSVs. |
| Inbox | Close steps overdue, months past their close date and not locked, budget variances over the threshold with no comment. |
## What Phase 10 adds

| Area | What works |
|---|---|
| Journal entries | Multi-line, balanced, entity and store per line, required memo, attachments. Over the approval limit an entry waits (posts nothing) until someone other than the preparer approves it; it shows on Approvals. Adjusting flag. |
| Templates | Accruals (payroll, utilities, fuel received not invoiced, interest), prepaids (insurance, property tax, licenses), depreciation, intercompany fee, reclass, owner draw / contribution, inventory (fuel book-to-physical, inside count), bad-debt write-off: amounts, stores and a date. |
| Reversing & recurring | Auto-reverse date, posted once on that date. Monthly or quarterly schedules generating each period once. |
| GL detail & trial balance | Any account and range with running balance, entity filter, drill to source, Excel. Trial balance unadjusted / adjusting / adjusted by entity with the prior month end. |
| Account reconciliations | Every balance-sheet account monthly: GL vs support from the subledger (bank rec, Craddock, Dash, party ledgers, bills, payroll) or entered with its document; preparer and reviewer sign-off, invalidated if the GL moves. |
| Consolidation | Entities side by side, elimination entries (due-to / due-from by pair, intercompany fees), proof they net to zero, an elimination entry log. |
| QuickBooks | Pluggable connector with a working file connector (the live API needs the hosted back end): connections per entity, mapping with suggestions, pull with de-dupe and batch ids, push of approved entries and monthly summaries as a QBO journal CSV with QBO ids (never into a locked month), differences report with causes and a $5 alert, sync log. |
| Inbox | Journal entries awaiting approval, recurring entries and reversals due, account recs not signed off after month end, QBO differences over $5, unmapped accounts. |

## What Phase 11 adds

Working papers for the CPA, not tax advice: rates, lives and thresholds are configurable tables to verify with the CPA, and nothing is filed.

| Area | What works |
|---|---|
| Entity map | Classification, masked EIN, owners and %, the return each entity files on, state registrations, fiscal year, method, preparer, prior returns in the vault. |
| Calendar & returns | Tax kinds on the compliance calendar (income, state, payroll, sales tax, excise, property, 1099s, W-2s, annual reports) plus estimate installments, linked to their trackers; tax notices. |
| Sales tax | Taxable POS sales (fuel excluded) vs collected (2200) vs remitted by store and month, variance flags and a printable / CSV filing worksheet; ties to 2200. |
| Book-to-tax | Trial balance → adjustments (depreciation, meals, penalties, owner items, accrual-to-cash, manual) with workpapers and review → taxable income; Schedule M-1 and M-2. |
| Tax depreciation | MACRS (tested against Pub 946), §179, bonus, QIP, the mid-quarter test, cost-seg flags; book vs tax side by side feeding the M-1. |
| Methods | Gross-receipts test, cash/accrual, inventory and UNICAP, Form 3115 tracking. |
| Estimates | Per owner and entity, annualized, with 100%/110% safe harbors; payments by an entity post through the ledger. |
| Owners & K-1 | Shares by %, distributions, basis and capital roll-forward, tax distributions vs capacity. |
| Planning | Projected taxable income and levers (equipment timing, bonus/§179, retirement, S-corp salary, restructuring note) with tax saved. |
| CPA package | One ZIP of every year-end schedule with a printable index. |
| Inbox | Estimate due in 14 days, return due in 30 days, sales tax collected ≠ remitted. |
## What Phase 14 adds

| Area | What works |
|---|---|
| Approval limits | Limits by role and amount for bills, journal entries, write-offs and rate changes, enforced on every approval through one central check; a refusal names who can approve. The journal-entry threshold still decides what needs approval. |
| Segregation of duties | Enter / approve / pay matrix from roles and limits; conflicts in configuration and in activity (same person entered and approved, approved and paid, counted and received); acknowledgments with a compensating control, which can cover a role's activity. |
| Cash controls | Second counts above an amount (recorded on the step, optionally enforced), blind HQ counts on the cash chain, deposit timeliness, variance by person and by store with repeated small shortages flagged as a pattern. |
| Fraud signals | Duplicate vendors, round-dollar payments, just under a limit, voids / refunds by cashier (POS exception CSV import), drive-offs and tank shortfalls, lottery shortages, pay after termination, ghost employees, rate spikes, check gaps, vendor bank changes; each with evidence rows that tie, dismissal with a reason (audited) or escalation with a note. |
| Risk & insurance | Risk register (likelihood × impact, owner, mitigation, review date), coverage checklist by policy type against the Phase 9 policies with gaps flagged, claims history tied to receivables. |
| UST compliance | Tightness, line leak detector, cathodic protection and spill tests per tank, inspections and financial responsibility per site, overdue flags, monthly release detection from the tank readings, documents. |
| Security & backups | Honest status of 2FA / encryption / daily backups (hosted back end), a working local backup and restore (CFO, previewed, audited), the export log and an access review by user. |
| Inbox | New fraud signals, duty conflicts not acknowledged, UST items overdue, risk reviews due, coverage gaps. |

## Known limits

- **Single device.** The books live in the browser's IndexedDB. Before real data goes in, a hosted multi-user back end has to replace it: server database, sign-in with 2FA, encryption at rest, daily backups. `Books` is storage-agnostic, so that change sits behind `src/data/storage.ts`.
- **Accrual adjustments aren't posted.** The accrual P&L and the bridge compute accrual fuel COGS, the fuel inventory change and fuel delivered-not-paid, but the ledger (and so the balance sheet) stays on the booked basis until accrual templates arrive with the GL toolkit (phase 10); the phase 8 close checklist tracks "accruals booked" as a manual step.
- **PDF is the browser's print.** Scheduled reports keep a cadence, but nothing is emailed yet.
- No PDF statement parsing or direct bank feed yet. Download CSV/OFX from Trustmark. A live feed needs a provider (e.g. Plaid) and the hosted back end.
- Craddock and Comdata files are pasted or uploaded as CSV; PDF notices and live supplier feeds aren't read yet.
- Bills: one payment per bill (no partial payments) and no OCR. Approval limits (phase 14) apply to approving; rejecting still needs the approve permission.
- Ask understands a fixed set of question patterns (no language model, no back end). Vault documents are indexed by their metadata, not their contents (no OCR). Tax depreciation and the covenant monitor come in phases 11 and 12.
- QuickBooks syncs by file: the live QBO API (OAuth, webhooks, real ids) needs the hosted back end. Recurring entries and reversals are generated when someone presses the button (the inbox says when), not on a timer.
- Ask understands a fixed set of question patterns (no language model, no back end). Vault documents are indexed by their metadata, not their contents (no OCR). The covenant monitor and the risk register come in phases 12 and 14.
- Growth compass: store ROIC is before corporate overhead; with fewer than 3 complete months there is no EBITDA trend, so most trigger dates say no estimate; the cost of equity is a judgement call.
- Growth: pro formas are pre-tax and assume a balloon is refinanced on the same amortization; same-store and TTM checks need more history than the demo has; valuation multiples are entered, not market data.
- Tax: only ordinary income is allocated to owners (no separately stated items, QBI or state apportionment); partner basis leaves out liabilities; the books start in September, so earlier book income is entered.
