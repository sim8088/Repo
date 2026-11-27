# CFO Portal

The CFO's working hub for a group of fuel and convenience stores (HM11 Gluckstadt, HM13 Meadville, HM15 Crystal Springs, HM17 Centreville, HM14 Gulfport leased out, plus Corporate). It's meant to be a workbench rather than a dashboard: it shows what needs doing today, lets you do it on the spot, and traces every number back to the transactions behind it.

The portal is built in 14 phases, and each one is usable on its own. **Built so far:** Phases 1 (Foundation), 2 (Bank & cash), 3 (Fuel), 4 (Reports), 5 (Intercompany, payables & receivables) and 6 (People & payroll). The app's `/roadmap` screen shows what each later phase adds.

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
src/data/      seed.ts (demo dataset), seed-fuel.ts (demo fuel), storage.ts (IndexedDB persistence)
  intercompany.ts, payables.ts, receivables.ts, approvals.ts   phase 5
  statements.ts  phase 4: booked / cash / accrual P&L and the bridge, balance sheet, cash flow, command center, scorecards, report builder
  xlsx.ts        minimal .xlsx (OOXML) writer for Excel exports
src/data/      seed.ts (demo dataset), storage.ts (IndexedDB persistence)
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

## Known limits

- **Single device.** The books live in the browser's IndexedDB. Before real data goes in, a hosted multi-user back end has to replace it: server database, sign-in with 2FA, encryption at rest, daily backups. `Books` is storage-agnostic, so that change sits behind `src/data/storage.ts`.
- **Accrual adjustments aren't posted.** The accrual P&L and the bridge compute accrual fuel COGS, the fuel inventory change and fuel delivered-not-paid, but the ledger (and so the balance sheet) stays on the booked basis until month-end accrual entries arrive with the close (phases 8 and 10).
- **PDF is the browser's print.** Scheduled reports keep a cadence, but nothing is emailed yet.
- No PDF statement parsing or direct bank feed yet. Download CSV/OFX from Trustmark. A live feed needs a provider (e.g. Plaid) and the hosted back end.
- Inbox items for fuel notices, bills and compliance deadlines arrive with their phases.
- Inbox items for bills, payroll and compliance deadlines arrive with their phases. Craddock and Comdata files are pasted or uploaded as CSV; PDF notices and live supplier feeds aren't read yet.
- Inbox items for fuel notices, payroll and compliance deadlines arrive with their phases.
- Bills: one payment per bill (no partial payments), no OCR, and approval limits by amount arrive with Controls (phase 14).
