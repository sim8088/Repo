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

---

# Phase 2: Bank & cash

## Bank feed & reconciliation (`/bank`)
1. **Import tab:** upload the CSV, OFX or QFX from the bank. The preview counts new lines and lines already imported, totals money in and out, and checks that the file's running balance ties line by line. Importing the same file again adds nothing. PDF statements can't be read yet; download CSV or OFX instead.
2. **To match tab:** click **Auto-match**. It matches by check number, or by the same amount within a few days when there's one clear candidate. For each line that's left:
   - take a suggested match, or
   - open **Something else…** to **Book it** (rule-suggested category, store, party and deposit source), to **Find in books** (tick several entries that add up to one bank line, e.g. a pooled deposit), or to **Exclude** it with a reason.
3. **Reconcile tab:** pick the statement date and type the ending balance from the statement. The screen lists the book balance, the outstanding items (checks and deposits in the books, not yet at the bank), the bank-only items, and what the statement *should* say. **Mark reconciled** only unlocks at a $0.00 difference. Lines inside a reconciled period are locked; only the CFO can undo a reconciliation, with a reason.
4. **All bank lines tab:** every line with its status, deposit source and the entries it matched. Unmatch or re-include lines here.

## Checks register (`/bank/checks`)
Shows outstanding, cleared, stale (uncleared after 60 days; the threshold is in Settings), void, and "cleared, not in books". Void an uncleared check with a reason. A cleared check can't be voided.

## Deposits (`/bank/deposits`)
Every bank deposit gets a source: store cash, card settlement, Fiserv, Mudflap, tenant rent, rebate, ATM, lottery, loan repayment from a related party, owner contribution, transfer, refund, or other. Most are guessed from the description. Tick **Only unclassified** to clear the rest. The side panel totals deposits by source and ties to the total.

## Cash chain (`/cash`)
- **Business day board:** for each store it shows POS cash → store count → operator pickup → HQ receipt → deposited, each with amount, who and when. The amount box is prefilled with the step before; type only what was actually counted.
- **Postings:** a count that differs from the POS posts the difference to *Cash over / short* at the store. A pickup moves cash from the store's registers to the HQ pool. A short or over HQ recount also posts to over/short. Differences of **$5.00 or more** are flagged.
- **At HQ, waiting to deposit:** tick the received bags and record the pooled deposit with the slip total. You can keep cash back at HQ for payouts. A bag picked up more than 2 days ago and not deposited is flagged overdue.
- **Cash paid out:** payroll (e.g. the HM11 crew), vendors, change for a store (a transfer, not an expense), and owner withdrawals (follows the policy in Settings).
- **Variances to review:** sign each flagged variance off with what you found.

## 13-week cash forecast (`/cash/forecast`)
Starts from today's book balance for Trustmark. That balance already includes checks written but not yet cleared. Recurring items are detected from the last 13 weeks of the books: weekly (payroll, supplier settlements), monthly (rent, utilities, insurance), or several times a week (store-cash deposits, projected as a weekly total). Switch off anything that won't repeat. Add one-off or recurring items the history can't know about. Weeks that end below the $30,000 floor are red, and the tie-out proves opening + inflows − outflows = ending.

## Transfers (`/books/new?kind=transfer`)
Moves money between balance-sheet accounts (bank, cash, clearing, loans). The ledger refuses a transfer that touches the P&L.

---

# Phase 6: People & payroll

Payroll screens need a role that reads reports (CFO, bookkeeper, owner, outside accountant). Importing, posting and recording pay need **payroll.edit** (CFO, bookkeeper). Approving a rate change needs **approve** (CFO, owner).

## Payroll runs (`/people/runs`)
1. **Import a Gusto report:** in Gusto, export the payroll journal for one pay date as CSV and upload it. Columns it reads: Pay date, Employee, Employee ID, Location (the store code, e.g. HM13), Department, Regular hours, Overtime hours, Gross pay, Employee taxes, Employer taxes, State taxes (optional), Net pay, Payment method (Direct deposit / Check), Check #, plus Gusto's **Total** row.
2. The preview checks every line (gross = net + employee taxes) and ties the lines to the Total row for gross, both kinds of tax, net and company debit. It won't import until everything ties and every location is a known store.
3. Importing the same report again adds nothing (each line has a key built from pay date, employee and amounts), and every line keeps its import batch id. People Gusto pays who aren't on file yet are added and wait in **New hires to confirm**.
4. Open a run to see each employee, subtotals by store and department, and the tie-outs. **Post** (or post the whole week from the weekly review): per store, net pay goes to *6100 Payroll – net pay* and employee + employer taxes to *6110 Payroll taxes* on the pay date, crediting Trustmark (CORP) with the Gusto company debit. Each paper check posts separately with its check number, so it shows in the checks register.

## Weekly review (`/people/review`)
The Friday workflow on one screen, newest pay date first:
1. **Gusto runs for the week** and whether each ties to its report.
2. **This week vs last by store:** labor cost (gross + employer taxes + cash/check pay), hours, overtime, headcount, hires, leavers and rate changes. A change over **15%** either way is red. "Not in yet" means the store has no payroll for the week so far.
3. **By employee:** only people with something to check (tick off the box to see everyone): new hire, terminated, rate change, *paid rate ≠ approved*, overtime, over 15%, paid after termination, paid by Gusto and cash/check.
4. **Rate changes to approve**, with a warning when Gusto already pays a rate nobody has approved.
5. **Post** every imported run for the week. The tie-out then proves the posted entries match the runs.

## Employees (`/people/employees`)
Filter by store, department and status, or search. Open a name for the details, rate history (starting rate, every request and decision) and the last six weeks of pay. **Change rate** sends a request with a reason and effective date; it applies only when the CFO or an owner approves it (the bookkeeper can request but not approve). **Confirm hire** after checking the W-4, I-9 and rate. **Terminate** records the last day worked and why. Editing an employee can't change their rate.

## Cash & check pay (`/people/cash-pay`)
- **Record pay outside Gusto** per employee and pay week. For cash already paid out in the cash chain (HM11's weekly crew payout), pick that payout: nothing new posts, and you can't assign more than the payout. New cash is posted as a cash payroll payout from the HQ pool or a store's registers; a check posts to 6100 and credits Trustmark with its check number.
- **Gusto vs cash/check by employee and week** shows both side by side. Someone paid both ways in a week is marked **Both: confirm it is extra pay** until you say what it was for. It is never treated as a duplicate on its own.
- **Payroll payouts in the cash chain** shows how much of each payout is split by employee; the tie-out is green when all of it is.

## Labor % (`/people/labor`)
Labor cost as a % of POS sales (fuel, inside, kitchen; not sales tax) for each store and Saturday–Friday pay week, against each store's target, with sales per labor hour. Red cells are over target; `*` marks a week with fewer than seven days of sales so far. The tie-out proves labor cost equals 6100 + 6110 in the books for every posted week. CFO and bookkeeper set the targets.

## Payroll tax tracker (`/people/taxes`)
Taxes owed (employee + employer taxes on every Gusto run, split federal and state) against deposits, by quarter. Federal taxes are deposited by Gusto on each pay date; state taxes monthly, so a state difference mid-quarter is normal. Record any other deposit with the form. Tick each quarterly return (941, state withholding, state unemployment; 940 with Q4) with its confirmation number, and work the W-2 / 1099 season list before 31 January. The tie-outs prove the liabilities add to the runs and that the year's posted Gusto payroll ties to the ledger.
