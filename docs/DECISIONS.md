# Decisions log

This file records the context and decisions behind the portal so they don't get lost between sessions. Add new entries at the top.

## 2026-11-27 — Phase 6 build (People & payroll)
- **Posting follows SPEC §6.7:** per store, net pay → `6100`, employee + employer taxes → `6110`, on the pay date, crediting Trustmark (CORP). The Gusto debit line equals the run's *total company debit* (direct-deposit net + all taxes). Paper checks on a Gusto run aren't in Gusto's debit, so each posts on its own with its check number and shows in the checks register. A run can only post when its lines tie to the report's totals, and never into a locked month.
- **Demo runs are attached, not re-posted.** Each weekly `GUSTO PAYROLL <store>` entry the core demo already posted got a run whose employee lines add to it to the cent (`txnIds` points at it), so the Phase 2 bank feed and reconciliations are unchanged. The 27 Nov runs are imported but not posted: that's the week waiting for review.
- **Import is idempotent by line:** key = pay date + Gusto id (or name) + gross + net, numbered within the file. One pay date per import. Unknown employees are added and wait in "New hires to confirm". Deductions aren't supported yet (gross must equal net + employee taxes).
- **Pay weeks run Saturday–Friday**, named by the Friday pay date. Weekly review, the cash/Gusto comparison and labor % all use this week. Labor % compares the pay week's labor with the same week's POS sales (a simplification: Gusto may pay a period in arrears).
- **Labor cost = gross + employer taxes + cash/check pay**, which is the same as net + all taxes + cash/check, i.e. 6100 + 6110 in the books once posted. Labor % targets are per store (demo: HM11 6.5%, HM13 9.5%, HM15 7.5%, HM17 12%, of total POS sales including fuel).
- **Cash and check pay outside Gusto** is one entry per employee and pay week. Linking to an existing cash-chain payroll payout posts nothing new and can't exceed the payout. **Never assumed to duplicate Gusto:** paid both ways in a week shows "Both" until someone confirms what the extra pay was for.
- **The 15% flag** fires when labor cost moves more than 15% either way against the prior pay week (strictly over 15%). A store with nothing yet this week shows "Not in yet" rather than −100%.
- **Rate changes** need `payroll.edit` to request (CFO, bookkeeper) and `approve` to approve (CFO, owner). A rejection needs a reason. The current rate is the starting rate plus approved changes effective by that date. The review warns when Gusto pays a rate that isn't approved.
- **New permission `payroll.edit`** (CFO, bookkeeper). Payroll screens need `view.reports`; store managers don't see payroll.
- **Payroll taxes:** liability = employee + employer taxes on every run, split federal / state using the run's state-tax column. Demo: Gusto deposits federal on each pay date and state monthly; Q3 941 and state returns are marked filed.
- **Older saved books** without the `people` slice still open (read through `peopleOf`; written on first payroll change), so `SCHEMA` stays at 2.
- **"Payments with no document"** still leaves out payroll: the Gusto run is the document.
- **Not yet:** a live Gusto API connection (needs the hosted back end and OAuth), deductions/benefits and garnishments, payroll accruals at month end (phase 8/10), per-entity 941s (the tracker totals all employers), and PDF pay stubs.

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
