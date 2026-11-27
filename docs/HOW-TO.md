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
With no month in the URL, it opens on the latest month with sales and says so. Lines are grouped by line of business: Fuel, Inside, Kitchen, Other. Each margin shows as a % of sales. Click any amount to open the transactions behind it. The tie-outs check the total against the ledger (summed independently) and the store columns against the total. Phase 4 adds the cash and accrual bases, the views and the bridge; see the Phase 4 section below.

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

---

# Phase 3: Fuel

## Gallons & margin (`/fuel`)
Pick the month and the stores. **By store & grade** shows gallons, retail per gallon, delivered cost per gallon, cpg margin, margin dollars, discounts per gallon (host, Mudflap and fuel discounts), card fees per gallon (card and network fees), the break-even cpg (discounts + card fees per gallon) and the net cpg, with a pill against the target band (18–45¢). **By day** and **By month** show the same totals over time. Cost per gallon is that month's delivered cost from the invoices (product + freight + taxes over net gallons); Plus is blended 50/50 Regular/Premium. HM15's truck-lane diesel comes from the Comdata summary, not the POS. The tie-out proves the structured fuel sales equal fuel revenue (4000–4030) in the ledger and that the table's COGS equals `fuelCostOfSales`, the accrual fuel cost Phase 4 uses.

## Invoices & BOLs (`/fuel/invoices`)
Every delivery: supplier, store, invoice #, BOL #, delivered and due dates, gross and net gallons by grade, product cost, freight, taxes and total, its attachments, and the notice or Dash payment that settled it (linked to the ledger entry). **Log a delivery** by hand; leave the invoice # blank when only the BOL has arrived, and come back with **Add the invoice**. The filter shows open, missing (BOL with no invoice), flagged (same invoice # or BOL entered twice, and cost per gallon more than 5% from the month's average) and settled deliveries. Remove a duplicate with a reason. **Import** takes one row per grade (Supplier, Store, Invoice, BOL, Delivered, Due, Grade, Gross, Net, Cost, Freight, Taxes); invoices already on file are skipped and each new one carries the batch id.

## Supplier settlement (`/fuel/settlement`)
- **Post a notice:** upload or paste the Craddock EFT notice (Notice, Store, Notice date, Type, Processing date, Description, Invoice, Amount). Types are CC_PROCEEDS, CC_FEE, HOST_DISCOUNT, FUEL_INVOICE, OTHER (Cybera / POS network fees), BANK_DRAFT and DEPOSIT. Signs follow the type: proceeds and drafts +, fees, discounts, invoices and deposits −. The preview shows every line with the date it will carry in the books and three checks: it **nets to zero**, each invoice line matches the invoice on file, and card proceeds equal the POS card sales for that day. **Import and post** or **Save unposted**. Importing the same notice twice adds nothing. **Enter by hand** opens a line editor with a running net.
- **Posting** creates one entry per sales day for card fees (6000) and host discounts (4920), dated processing date − 1; one entry on the notice date for fuel invoices (5000) and network fees (6010); and the draft or deposit on Trustmark on the next business day. All post against the Craddock receivable (1100). A notice posts completely or not at all. **Unpost…** reverses it with a reason (not once its bank line is reconciled).
- **Craddock receivable:** pick any date. Opening + POS card sales − what posted notices settled = the receivable, tied to the ledger, with the card batches not yet on a posted notice.
- **Dash clearing:** who owes whom per store (Dash holds our card money, or we owe Dash), invoices due in the next 14 days, and the clearing ledger by date (card proceeds in, invoices out on their due dates, fees, remittances or drafts). **Pay invoices due through today** pays each open Dash invoice from clearing on its own due date. **Post a Dash statement** books the weekly fees and remittance.

## Truck lane (`/fuel/truck`)
HM15's Comdata summary by day (gallons, sales, transactions), kept apart from the store POS. Import it weekly (Date, Store, Gallons, Sales, Transactions); the preview is idempotent. Mudflap fuel-code discounts and card true-ups post to 4910 against the Fiserv / AccessOne clearing (1120). The Fiserv table shows truck-lane cards, Mudflap, "MER BNKCD DEPOSIT" deposits and the fees debited the following month, with the effective rate. Tie-outs: Comdata sales = truck-lane diesel revenue; truck cards into 1120 = Comdata sales; 1120 rolls forward month by month.

## Tanks (`/fuel/tanks`)
Each tank's gallons, fill, days of supply (7-day average draw), 30-day book-to-physical variance against its allowance (1% of gallons sold + 130 gallons), water (alert over 1 inch) and the last reading. Click a tank for the daily table: yesterday's reading + deliveries (BOL net gallons) − sales = book; today's reading − book = variance. Plus draws half from Regular and half from Premium. **Record a reading** (stick or ATG); store managers can record their own store's tanks.

## Pricing & ordering (`/fuel/pricing`)
Pick a store. The price board shows our posted price per grade, competitors seen in the last 7 days (generic names), the spread, delivered cost and margin per gallon, and what matching the lowest competitor would do to a week's margin dollars. Log competitor prices and change posted prices below. The **ordering plan** suggests each store's next delivery: when a full transport (8,800 gal) fits under the 90% safe fill, or sooner if a tank would fall to 2.5 days of supply, split by tank in 100-gallon compartments.
# Phase 5: Intercompany, payables & receivables

## Approvals (`/approvals`, under Today)
Everything waiting for a yes or no, oldest first. Bills are the first kind; raises and rate changes, write-offs and adjusting entries plug into the same list in later phases. Approve with an optional note, or reject with a reason. Only roles with the approve permission (owner, CFO) see the buttons.

## Related parties (`/intercompany/parties`)
- **Figures:** owed to us, what we owe, the net, and anyone over their limit.
- **Parties:** every related company, owner, tenant and lender with money out, money in, the balance and its limit. The tie-out proves the party ledgers add up to 1910, 1920 and 2400 in the ledger and that every line on those accounts names a party.
- **Store entities with Corporate:** each store entity's position, built from the automatic due-to / due-from lines.
- **Record a movement:** we paid a bill for them (posts to 1920, never store expenses), we lent them money (1910), they paid us back, we paid them back, or they paid a bill for us (our expense against 2400).

## Party statement (`/intercompany/parties/:id`)
A printable statement for one party: opening balance, each movement with a running balance, the closing balance, and the aging of what is open (oldest settled first). Print it for a PDF or export CSV. Set or remove the party's limit here. Tenant statements show the rent schedule's charges against rent received; owner statements list withdrawals in the period.

## Rent pass-throughs (`/intercompany/rent`)
Templates for the monthly mortgage pass-through: the store books rent, Corporate owes the related party. Pick a month and generate it; a month already generated is skipped, so it never duplicates. Pause a template or add one for a new store. The demo's 1 Sep, 1 Oct and 1 Nov entries were generated from these templates.

## Owner draws (`/intercompany/draws`)
Owner withdrawals year to date, by owner. Under the current policy they are booked as Corporate · Miscellaneous expense; the view finds them there (when an owner is named) and on the draws account, so switching the policy loses nothing.

## Elimination view (`/intercompany/eliminations`)
The consolidated balance sheet with the store-entity to Corporate due-to / due-from netted out. It proves each entity pair agrees, due-from equals due-to, the eliminations net to zero and consolidated assets equal liabilities plus equity. Balances with related parties outside the group are real and stay.

## Bills (`/payables/bills`) and one bill (`/payables/bills/:id`)
- Status runs **awaiting approval → approved → scheduled → paid** (or void). Nothing posts until approval; approval posts the expense lines (by store) against **2000 Accounts payable** on the bill date. Autopay bills are scheduled for their due date on approval.
- On a bill: approve or reject, schedule (date and method), record the payment (check # or confirmation, plus the confirmation file), void an approved bill (its accrual is reversed with your reason), and attach the invoice.
- Recording payment posts 2000 → Trustmark, so the bank feed matches it like any other payment and checks appear in the checks register.

## Bills inbox (`/payables/inbox`)
Upload a photo or PDF, or paste the email text, then **Read it**. Amounts, dates, the invoice #, vendor, store, utility account and disconnect wording are pulled out with simple pattern matching. **There is no OCR service**: a photo or PDF is kept with the bill, but only its file name is read. Check every field, split the amount across stores if needed, and **Save for approval**.

## AP aging (`/payables/aging`)
Open bills by vendor: current, 1–30, 31–60, 61–90 and over 90 days past due. The tie-out proves the aging (plus anything entered on 2000 by hand) equals the Accounts payable balance in the ledger.

## Payment calendar (`/payables/calendar`)
Bills by the day the money goes out over the next 35 days, against the projected Trustmark balance. The projection is the 13-week forecast with approved and scheduled bills added as known events; a bill stands in for the matching recurring payment so nothing counts twice. Bills awaiting approval are listed separately.

## Utilities (`/payables/utilities`)
Each utility account: company, service, store, account number, service address, autopay, last bill, change on the bill before, next due date and the full amount history (bills, plus autopay drafts straight from the bank). Flags: past due, disconnect notice, and a jump of more than 25%.

## Vendor statements (`/payables/statements`)
Record a vendor's statement (date, balance, open invoices). Each line is explained: agrees, amount differs, paid by us but not yet credited, on the statement but not in our AP, or in our AP but not on the statement. The explanations add up to the difference exactly; anything left is shown as not explained.

## 1099 vendors (`/payables/1099`)
Payments this year to vendors marked 1099 (Setup › Vendors & parties), flagged at $600. Paid means money that left the bank or cash on transactions naming the vendor.

## Tenant rent (`/receivables/rent`)
Each tenant's monthly rent, due vs received. Deposits apply to the oldest open month. Rent is late once the grace days after the due date pass. Record rent received from the form; the tie-out proves rent received equals rent income from those tenants in the ledger.

## Rebates & other income (`/receivables/other`)
Tabs for rebates and programs, ATM income, insurance claims and refunds owed to us. Each item shows expected, received and outstanding. Record money as it arrives (posts money in to its income account), apply a deposit already in the books, or close an item with a reason.

# Phase 4: Reports

## Command center (`/reports/command`)
The board. One tile and one table row per store with activity in the month: net sales, gross margin and GM %, labor % (pill: red when over the store's target), net profit and net margin, and the change on the month before, plus the company total. It opens on the latest month with sales and says so; pick another month or basis (accrual by default). Click a store's net profit for its P&L. Tie-outs: the stores add to the total, and the total equals the P&L on the same basis.

## Profit & loss (`/reports/pnl`)
- **Basis:** Booked (the ledger, the default), Cash, Accrual, or Compare (cash and accrual side by side with the bridge).
  - *Cash:* each line on the date its cash moved. Bank items on the date their statement line cleared; an uncleared **check** is left out until it clears; other uncleared bank items (ACH, card, online) count on their book date; bills when paid (unpaid bills are left out). Cash on hand, cash in transit and supplier / card clearing are cash equivalents, so their items count on their book date.
  - *Accrual:* each line on its transaction date; bills on their bill (invoice) date; paid fuel invoices (5000) taken out and replaced with accrual fuel cost of sales (`fuelCostOfSales`: gallons sold × the month's delivered cost per gallon, Plus blended 50/50), dated the month end.
- **View:** by store, by month (the trend), or against the prior period of the same length. Tick **% of sales** to see every line as a share of sales.
- **Drill-down:** on cash and accrual every amount opens `/reports/drill`, the entries behind it with their book and cash dates; on booked it opens the transactions list as before.
- **Bridge:** cash-basis net profit → bank clear date vs book date → uncleared checks → bills on invoice date → paid fuel out → accrual fuel cost in → accrual net profit. It ties to the cent, and each line opens its entries. "Fuel, explained" splits the fuel lines into the change in fuel inventory at cost (delivered − sold) and fuel delivered but not paid (delivered − paid); neither is posted to the ledger yet.
- **Budget:** "Budgets arrive in phase 8." The hook (`budgetCompare`) takes budget figures once they exist.

## Drill-down (`/reports/drill`)
Every entry behind a P&L figure or a bridge line, with the date the basis uses, the cash date ("not in cash" for an uncleared check or unpaid bill) and a link to each transaction. Accrual fuel cost rows show gallons × cost per gallon by grade. Tie-out: the entries add to the P&L figure.

## Balance sheet (`/reports/balance-sheet`)
As of any date, for one entity or consolidated: bank, cash on hand and in transit, supplier clearing, receivables, inventory, prepaid, intercompany broken out by party and group entity, fixed assets net of depreciation, accounts payable, accrued payroll / payroll taxes / sales tax, loans, intercompany payables, owner capital, owner draws, retained earnings and current-year earnings. Tie-outs: assets = liabilities + equity; every balance agrees with the trial balance account by account; consolidated, due-from and due-to group entities eliminate.

## Cash flow (`/reports/cash-flow`)
Indirect method for any months and entity: booked net income, depreciation added back, working-capital changes, investing (fixed assets, loans and bills paid for related parties), financing (mortgages, related-party payables, group entities, owner capital and draws). Cash and cash equivalents = bank + cash + supplier clearing. Tie-outs: opening + net change = closing, and the change equals the cash accounts' own movement in the ledger. The 13-week forecast is linked for the months ahead.

## Store scorecards (`/reports/scorecards`)
For each operating store and month (accrual basis): fuel gallons, fuel margin ¢/gal, inside GM %, food cost % (purchases ÷ food sales until counts arrive in phase 7), labor % against the store's target, card fee %, cash over / short, net profit and break-even sales (fixed costs ÷ contribution margin, rated on the margin of safety). Each is green, amber or red against thresholds the CFO or bookkeeper can change. Add notes per store and month. Tie-out: net profit equals the accrual P&L.

## Board pack (`/reports/board`)
One printable page per month: a summary letter written from the numbers (edit it before printing; edits aren't saved to the books), P&L by store, balance sheet, cash, KPIs, intercompany positions and the open inbox items. **Print / PDF** uses the browser's print.

## Report builder (`/reports/builder`)
Pick row groups (net sales, sales by line of business, cost of goods, gross profit, labor, operating expenses, net profit) and account rows, columns by store or month, a basis, months and stores. Save it, and open saved reports from the list. A schedule (weekly, monthly, quarterly) is kept with the report, but **nothing is emailed yet**: sending needs the hosted back end. Tie-outs: every row adds across; net profit agrees with the P&L.

## Exports
Every report has **Export CSV**, **Export Excel** (a real .xlsx workbook) and **Print / PDF**. Exports are logged in the audit log.

# Phase 10: GL toolkit & QuickBooks

## Journal entries (`/books/journals`)
Every manual journal entry, with tabs. **Entries:** filter by status; each shows its posting (or "nothing posted" while it waits). **Templates:** accruals (payroll, utilities, fuel received not invoiced, interest), prepaids (insurance, property tax, licenses), depreciation, intercompany management fee, reclass, owner draw / contribution, inventory adjustments (fuel book-to-physical, inside count) and bad-debt write-off; each fills the accounts and sides and needs only amounts, stores and a date. **Recurring:** monthly or quarterly schedules on a day of the month between a first and last month; "Generate N due" creates each period's entry once. **Reversing:** entries with an auto-reverse date; "Post N reversals due" posts each reversal once, on its own date. Figures: awaiting approval, posted this month, recurring runs due, reversals due. Tie-outs: each posted entry agrees with its transaction; pending entries posted nothing; reversals mirror their entries.

## New journal entry (`/books/journals/new`)
Pick a template (or none), give the date, stores and amounts, check the lines (each line's entity comes from its store; due-to / due-from are added when lines span entities), write the required memo, tick **Adjusting** where it applies, set an auto-reverse date, attach support. At or under the approval limit (Setup › Settings, $10,000 in the demo) it posts at once; over it, it waits for approval by someone other than the preparer with approval rights (CFO or owner) and posts nothing until then. The Journal entry mode of **New entry** uses the same rules.

## Journal entry (`/books/journals/:id`)
Lines with store and entity, status, preparer, approver, reversal, attachments and history. An approver who isn't the preparer can approve (it posts on its own date) or reject with a reason.

## GL detail (`/books/gl`, `/books/accounts/:id`)
Any account and date range with the opening balance, every line with a running balance, and the closing balance. Filter by entity and store. The **Source** column drills to the journal entry, bill, payroll run or QBO pull behind a line; the ref opens the transaction. Export CSV or Excel. Tie-outs: opening + activity = closing; closing equals the trial balance (for the same entity).

## Trial balance (`/reports/trial-balance`)
By entity or all entities, as of any date: **unadjusted**, **adjusting** (entries tagged adjusting dated in the month of the as-of date), **adjusted**, the **prior month end** and the change. Debits positive, credits in parentheses. Tie-outs: unadjusted + adjusting = adjusted on every row; each column balances. Link to the consolidated view.

## Account reconciliations (`/books/recons`, `/books/recons/:account`)
Every balance-sheet account (retained earnings rolls forward from the P&L) for a month: GL, support, difference, status, preparer and reviewer. Support comes from the subledger where there is one: the saved bank reconciliation (statement ± book-only and bank-only items), Craddock notices, Dash clearing, related-party ledgers, entity due-to / due-from, open bills (AP), and the payroll accrual from pay runs. Everything else (cash on hand, Fiserv clearing, inventory, prepaid, fixed assets, loans until Phase 9, sales tax, equity) is entered by hand with its document attached. The preparer signs (a difference needs an explanation); a reviewer with approval rights who isn't the preparer signs off. A sign-off lapses ("GL changed after sign-off") if anything posts to the account in that month afterwards. The inbox lists the last month's accounts not signed off.

## Consolidation (`/books/consolidation`)
As of any date: each entity's trial balance side by side, combined, the eliminations and the consolidated column. Elimination entries: each pair of entities' due-to / due-from (from the automatic lines, so the Phase 5 pair check applies) and intercompany management fee income against the expense. Tie-outs: each entity balances; eliminations net to zero; nothing intercompany is left; consolidated net income equals the sum of the entities; every pair agrees. **Record** keeps the elimination entries in the elimination entry log. Nothing posts to the ledger.

# QuickBooks

## Sync status (`/qbo`)
Each entity's QBO company, status ("Not connected — needs hosted back end"), connector, QBO's closing date, last push and last QBO trial balance, with the steps to sync by file until the live connection ships. Edit the company name and closing date.

## Mapping (`/qbo/mapping`)
Tabs for accounts, stores ↔ classes / locations, and vendors / parties ↔ QBO vendors / customers. Pick a QBO name per row, use a suggestion (same account number, then the closest name), or accept them all. Unmapped accounts hold back any entry that touches them and go to the inbox. Load QBO's account list from its Account List CSV.

## Pull & push (`/qbo/sync`)
**Push:** for an entity and month, the approved journal entries (and reversals) and the monthly summaries (sales, fuel COGS, card fees, payroll; each source entry lands in one summary), each balanced on the entity's own lines. "Push and download CSV" records each entry with its (simulated) QBO id and downloads a CSV for QBO's journal import. Unchanged entries aren't sent twice; a changed one is re-sent under its id. Locked months and QBO's closing date refuse. **Pull:** paste or choose QBO's Transaction List export; the preview marks each row already pulled, duplicate (same date, amount and payee as a portal entry), new or held (unmapped); new rows post with the batch id. **QBO trial balance:** import QBO's Trial Balance CSV for an entity and month; the same file twice changes nothing, a new version replaces the old.

## Differences report (`/qbo/differences`)
The portal's trial balance against QBO's for an entity and month, by QBO account, with each difference's likely cause: unmapped account (either side), entry not pushed (or changed since the push), timing (a portal entry within 3 days of month end for the same amount), or not explained. Differences over $5 alert in the inbox. Tie-outs: both sides balance, the differences net to zero, every difference has a cause.

## Sync log (`/qbo/log`)
Every pull, push, QBO trial balance import, mapping change, error and fix: when, who, what moved (each pushed entry with its QBO id), who approved, the batch id. Tie-out: every pushed entry is in the log.
