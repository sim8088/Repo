# How to use each screen (Phase 1)

Each screen also carries these notes in-app under "How to use this screen".

## My day (`/`)
Your morning check.
1. Work the inbox from the top. Each line opens the screen that fixes it.
2. Check the Trustmark figure against the $30,000 floor. It turns red below the floor.
3. Click any figure to see the transactions behind it.

"Payments of $1,000+ with no document" is a review queue: it's listed, but it isn't counted in the "items need you" total.

## Transactions (`/books/transactions`)
1. The queue buttons show everything, or only uncategorized items, possible duplicates, or payments missing a document.
2. Search by description, TX ref, check #, doc #, party, or an amount such as `4,077.40`.
3. Tick rows and choose a new category and/or store to bulk-edit. Splits, journals and locked months are skipped, and the skips are counted.
4. Export downloads exactly what the filters show.
5. To see deleted items, tick "Show deleted". You can restore them from the transaction page.

**Uncategorized queue:** accept the suggestion, or pick a category and store and click Save. Either way a rule is learned or updated.
**Duplicates:** delete the extra one (it can be restored), or click "Not a duplicate".

## New entry (`/books/new`)
- **Money out / money in:** pick the bank or cash account (Trustmark belongs to CORP), the category lines and the stores. "Split across stores by %" generates exact-cent lines.
- **Journal entry:** enter debits and credits. Post stays disabled until they balance.
- When the lines span more than one entity, the ledger adds the intercompany lines itself.
- Choosing an owner as the party fills in the account set by the owner-withdrawal policy in Settings.
- Dates in a locked month are refused, and the message says how to unlock.

## Transaction page (`/books/transactions/:id`)
This page shows the lines (grey "auto" lines are intercompany), the tie-outs (debits = credits, each entity balances), documents and history. Attach a photo or PDF up to 15 MB. Edit, delete (a reason is required) or restore.

## Chart of accounts (`/books/accounts`)
Add accounts, or edit a name, number, line of business or floor. Inactive accounts keep their history. System accounts (intercompany, retained earnings, uncategorized) can't be removed. Click an account to open its ledger.

## Account detail (`/books/accounts/:id`)
General-ledger lines with a running balance for any date range, optionally for one store. The tie-out proves that opening + activity = closing, and that closing matches the trial balance.

## Profit & loss by store (`/reports/pnl`)
With no month in the URL, it opens on the latest month with sales and says so. Lines are grouped by line of business: Fuel, Inside, Kitchen, Other. Each margin shows as a % of sales. Click any amount to open the transactions behind it. The tie-outs check the total against the ledger (summed independently) and the store columns against the total.

## Trial balance (`/reports/trial-balance`)
Shows one entity or all entities, as of any date. Each entity balances on its own. Prior-year profit rolls into retained earnings. Export it as CSV for the CPA.

## Periods (`/close/periods`)
Lock a month when it's reconciled. Unlocking needs a reason, which goes in the audit log. Only the CFO can lock or unlock.

## Setup
- **Stores:** add or edit code, name, owning entity, kind (operating / leased out / corporate), fuel supplier, payroll and features.
- **Entities:** tax classification and EIN. Exactly one entity is the hub (Corporate).
- **Vendors & parties:** type, a default account and store to speed up entry, and the 1099 flag.
- **Rules:** text → category + store, with accepted and changed counts and a confidence score.
- **Users & roles:** the role and the permission matrix. Store managers are limited to their stores.
- **Audit log:** every change, with before/after and the reason.
- **Settings:** fiscal year start, materiality ($5), owner-withdrawal policy, and resetting to demo data.

## Keyboard
`⌘K` / `Ctrl+K` or `/` opens search · `N` starts a new entry · `↑ ↓ Enter Esc` work inside search.
