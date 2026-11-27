# CFO Portal

The CFO's working hub for a group of fuel and convenience stores (HM11 Gluckstadt, HM13 Meadville, HM15 Crystal Springs, HM17 Centreville, HM14 Gulfport leased out, plus Corporate). It's meant to be a workbench rather than a dashboard: it shows what needs doing today, lets you do it on the spot, and traces every number back to the transactions behind it.

The portal is built in 14 phases, and each one is usable on its own. **Phases 1 (Foundation), 2 (Bank & cash) and 3 (Fuel) are built.** The app's `/roadmap` screen shows what each later phase adds.

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
  fuel.ts        fuel subledger: invoices, notices, Dash clearing, truck lane, margin, accrual COGS, tanks, pricing
  fuelio.ts      notice / invoice / Comdata file parsers
src/data/      seed.ts (demo dataset), seed-fuel.ts (demo fuel), storage.ts (IndexedDB persistence)
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

## Known limits

- **Single device.** The books live in the browser's IndexedDB. Before real data goes in, a hosted multi-user back end has to replace it: server database, sign-in with 2FA, encryption at rest, daily backups. `Books` is storage-agnostic, so that change sits behind `src/data/storage.ts`.
- **Booked basis only.** Fuel cost in the ledger is fuel invoices on the date they're paid (netted on a Craddock notice, or out of Dash clearing on the due date). `fuelCostOfSales` computes accrual fuel COGS; the accrual P&L and the bridge come in Phase 4.
- **CSV, not .xlsx.** Excel opens the CSV exports. Native .xlsx and the board-pack PDF come in Phase 4.
- No PDF statement parsing or direct bank feed yet. Download CSV/OFX from Trustmark. A live feed needs a provider (e.g. Plaid) and the hosted back end.
- Inbox items for bills, payroll and compliance deadlines arrive with their phases. Craddock and Comdata files are pasted or uploaded as CSV; PDF notices and live supplier feeds aren't read yet.
