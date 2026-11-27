# Decisions log

This file records the context and decisions behind the portal so they don't get lost between sessions. Add new entries at the top.

## 2026-11-27 — Phase 5 build (Intercompany, payables & receivables)
- **Party ledgers are read from the ledger**, not kept separately: lines on intercompany accounts (1910 loans, new **1920 bills paid for related parties**, 2400 due to related parties), loan and receivable accounts, tagged with the party (on the line or the transaction). Sign: + they owe us, − we owe them. Store entities get the same ledger from Corporate's automatic 1900/2900 lines. Aging settles the oldest items first.
- **Paying another business's bill** posts to 1920 under that party, never to store expenses or the P&L.
- **Tenants** appear in the party list with the rent schedule's monthly charges (memo only, not posted: rent stays cash basis) against rent received.
- **Rent pass-throughs are templates** (`state.intercompany.rentTemplates`); the demo's main loop now calls `generateRent` on the 1st, producing the same entries (same refs) as before. Generation is idempotent per template and month.
- **Owner draws** are found on draws-type accounts and on the owner-withdrawal expense account where an owner is named, so the view works under either policy.
- **Limits** are per party (or entity), on the absolute balance; the inbox alerts above them. Demo: Southern Eagle is over.
- **Elimination view** nets only the automatic entity due-to / due-from (1900/2900). Related parties outside the group are real balances and stay.
- **Bills** are a subledger (`state.payables.bills`). A draft posts nothing; **approval** posts expense lines → 2000 on the bill date and needs the `approve` permission (owner, CFO). When the approver's role can't post journals (owner), the entry is posted under the person who entered the bill and the approval is audited under the approver. **Payment** posts 2000 → Trustmark (or cash at HQ) and needs the new `bills.pay` permission (CFO, bookkeeper); `bills.enter` covers CFO, bookkeeper and store managers (own store only). New `ar.edit` covers receivables. Amount limits by role come in phase 14.
- **One payment per bill** for now (no partial payments). Voiding an approved bill soft-deletes its accrual with the reason.
- **Forecast hook:** `addForecastSource` in `forecast.ts` lets a module add known events; approved and scheduled bills are added on their pay date and replace the nearest occurrence (within 10 days) of the same vendor's detected pattern, so nothing counts twice.
- **The bills inbox has no OCR.** Pasted text and file names are read with regular expressions; files are kept as attachments. A real OCR or email-forwarding service needs the hosted back end.
- **Utilities history** combines bills on the utility account and autopay drafts paid straight from the bank (no bill). A jump is a bill more than 25% above the one before.
- **Vendor statements** are reconciled by invoice number; every difference is classified and the classifications add to the difference exactly.
- **1099** = money out of bank or cash accounts on transactions naming a 1099 vendor, calendar year, flagged at $600.
- **Receivables** (rebates, insurance claims, refunds) are tracked as expected amounts, not accrued; receipts post money in to the item's income account or apply an existing deposit. ATM income is read from 4310 by month.
- **Approvals** are a provider registry (`src/core/approvals.ts`); bills are the first provider. Later phases add rate changes, write-offs and adjusting entries without touching the screen.
- **Saved books from before Phase 5** (same schema number) load without the new slices; the core reads them as empty. Reset to the demo data to see the Phase 5 demo.
- **Demo data** (illustrative, generic names): about 30 bills across 10 new demo vendors (one past due, one due in 3 days and unscheduled, one awaiting approval), 11 utility accounts (HM15 water jumps 40%, HM13 water past due with a disconnect notice), an ice-supplier statement with every difference explained, related-party activity for Cheers, Rowdy's, Bullseye and Five Rivers, a new laundromat tenant late for November, and rebates, an insurance claim and a refund outstanding.

## 2026-11-27 — Phase 2 build (Bank & cash)
- **Keep building in this repo** (CFO decision, 2026-11-27); StationBooks stays as it is.
- **HM17 opened November 2026** (CFO decision, 2026-11-27).
- **Bank lines are a separate subledger** (`state.bank.lines`). Each one matches one or more ledger lines on its bank account. Reconciliation is computed: book balance − book-only items + bank-only items = statement. It can only be saved at a $0.00 difference, and it locks the bank lines it covers.
- **Import is idempotent.** The key is the FITID when the file has one; otherwise it's account + date + amount + description, numbered within the file so two identical real lines both import. Every line keeps its import batch id.
- **Auto-match only takes clear winners:** a check-number hit, or one candidate at least 10 points ahead. Ties are left for a person.
- **Cash chain postings:** a count vs POS difference, a pickup vs count difference and an HQ vs pickup difference all go to `6340 Cash over / short` at the store. The pickup moves cash from `1010` (store) to `1020 Cash at HQ / in transit` (Corporate). The pooled deposit moves `1020` → Trustmark. Flags fire at materiality ($5.00); smaller differences are still posted.
- **HM11 cash payroll** is a payout from the HQ pool. Payouts for change are transfers (no expense). Owner withdrawals follow the Settings policy.
- **Stale checks:** 60 days (configurable). **Deposit due:** within 2 days of pickup (configurable).
- **Forecast** starts from the book balance (outstanding checks are already in it). Recurring items are detected from 13 weeks of history; the CFO can switch any off or add manual items.
- **Not yet:** PDF statement parsing, a direct bank feed (needs a provider such as Plaid and the hosted back end), and check images from the bank (attach them to the transaction for now).

## 2026-11-27 — Phase 1 build
- **Stack:** Vite + React 19 + TypeScript, plain CSS tokens ("Ledger" design), react-router (hash routes, so it works as a static page). The accounting core in `src/core` is framework-free and unit-tested.
- **Storage:** IndexedDB on one device for Phase 1. Swapping in a hosted back end (multi-user, 2FA, encryption, backups) is a prerequisite before real data goes in.
- **Intercompany is automatic.** Each store has its own entity, and Corporate is the hub. When a transaction's lines span entities, the ledger adds `2900 Due to related entities` / `1900 Due from related entities` lines so each entity balances. Example: the shared Trustmark account (CORP) pays an HM11 bill.
- **Owner withdrawals:** the default policy is *Corporate · Miscellaneous expense* (CFO decision, 2026-11-02). It can be switched to equity draws in Settings, and the policy fills in when an owner is picked on an entry.
- **Rent pass-throughs:** each one debits the store's rent and credits Corporate's *Due to related parties* (Dhunna / SKD). The demo uses round illustrative amounts. Real amounts stay out of the repo and are entered as data.
- **HM17** opened Nov 2026 per the build spec (the house notes say Oct 2026; this is configurable on the store record). **HM14** is leased out and appears only through rent income.
- **Materiality:** $5.00.
- **"Payments with no document"** is a review queue, not a to-do. It covers the last 30 days, $1,000 and over, and leaves out payroll until the Gusto import ships.
- **Demo data** is illustrative. None of it is real company figures, owner names or account numbers; those are never committed.
