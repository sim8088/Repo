# CFO Portal

The CFO's working hub for a group of fuel and convenience stores (HM11 Gluckstadt, HM13 Meadville, HM15 Crystal Springs, HM17 Centreville, HM14 Gulfport leased out, plus Corporate). It's meant to be a workbench rather than a dashboard: it shows what needs doing today, lets you do it on the spot, and traces every number back to the transactions behind it.

The portal is built in 14 phases, and each one is usable on its own. **Phase 1 (Foundation) is built.** The app's `/roadmap` screen shows what each later phase adds.

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
src/data/      seed.ts (demo dataset), storage.ts (IndexedDB persistence)
src/app/       React UI (screens in pages/, shell, ⌘K and shared components in components/)
e2e/           Playwright tests: accessibility, layout and workflows
docs/          HOW-TO.md (one note per screen), DECISIONS.md
```

## Known limits of Phase 1

- **Single device.** The books live in the browser's IndexedDB. Before real data goes in, a hosted multi-user back end has to replace it: server database, sign-in with 2FA, encryption at rest, daily backups. `Books` is storage-agnostic, so that change sits behind `src/data/storage.ts`.
- **Booked basis only.** Fuel cost is the fuel invoices dated in the month. The cash and accrual P&L, and the bridge between them, come in Phase 4.
- **CSV, not .xlsx.** Excel opens the CSV exports. Native .xlsx and the board-pack PDF come in Phase 4.
- Inbox items for bank matching, fuel notices, cash handoffs, bills, payroll and compliance deadlines arrive with their phases.
