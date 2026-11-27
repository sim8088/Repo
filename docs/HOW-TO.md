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
Lock a month when it's reconciled. Since phase 8 the Lock button goes through the month-end checklist's gate: it locks only when every other step is done (the CFO can override from the checklist with a reason). Unlocking needs a reason, which goes in the audit log. Only the CFO can lock or unlock.

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
- **Budget:** view **Vs budget** puts actual, the active budget and the variance (with %) on every line; the panel below the bridge sums it up and links to Budgets › Budget vs actual for the variance comments.

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
# Phase 7 — Inside store and kitchen

## Department sales & margin (`/inside`)
Sales by department for a month and store, from the POS daily close (4100–4150, 4200), with units and customer counts from the POS department import, purchases mapped to departments and the inventory change from counts. Cost of goods = purchases − the increase in counted inventory, so margin is true department margin once a month is counted. Figures: inside sales, inside gross margin, average ticket, transactions a day, the thinnest margin. Tie-outs: cost of goods = 5100–5200 in the ledger; the POS import = the POS close day by day; every purchase has a department.

**Import POS department sales** (tab): pick the store and business day, upload or paste the PDI C-Store Essentials or CStorePro department report (Department and Sales; Units/Qty and a Customer count or Total row are read when present). The preview must tie to the file total and, department by department, to the POS close already in the books. POS department names map to ours through each department's POS names; map a new one from the preview. Re-importing adds nothing; a corrected report needs the earlier batch undone first. Nothing posts: the close already did.

## Vendor purchases (`/inside/purchases`)
Every merchandise and food purchase in the books (checks, EFT, cash and approved bills), by vendor, with how it was paid and its departments. Vendor mappings say which department(s) a vendor's purchases belong to; a vendor shipping several departments (the grocery wholesaler) is split by that store's sales of them that month. Unmapped purchases follow their account (5100 beer, 5110 tobacco, 5120 grocery / beverages / other by sales, 5200 kitchen).

## Inventory & shrink (`/inside/inventory`)
Enter a count at cost by department for a store and date. Book = last count + purchases − sales × the department's expected cost %; shrink = book − counted, as a % of the department's sales, red over the department's threshold (1.5% inside, 5% kitchen). **Post count** moves 1310 Merchandise inventory to the counted value against each department's cost-of-goods account (an "inventory count" journal). Store managers save counts for their store; the CFO or bookkeeper posts. Counts post in date order and never into a locked month; only the latest posted count can be voided. The tie-out proves 1310 at each store equals the latest counts.

## Purchasing budgets (`/inside/budgets`)
A monthly buying budget per store and department against purchases to date and bills awaiting approval, with a remaining bar. Over budget goes to the inbox. This is purchasing control, separate from the profit-and-loss budget of Phase 8.

## Scan-data & rebates (`/inside/rebates`)
Manufacturer programs: department, share of its units that qualify, cents per unit, monthly or quarterly. Expected = units sold (from the POS import) × share × rate. **Claim** an ended period to put that amount on the rebate in Receivables (or update the linked one); the payment is applied there, and a payment below the scan-data figure shows short-paid and goes to the inbox.

## Lottery (`/inside/lottery`)
Each store's lottery week: instant and online sales, cashes and payouts, commission, the settlement swept and the register's lottery net. Settlement must equal sales − payouts − commission; a register short of the lottery report (by $5 or more) is a lottery shortage until someone signs it off. Commissions tie to 4140 in the ledger month by month. Nothing posts.

## Age-check audits (`/inside/age-checks`)
Date, store, product, pass/fail, who ran it and the clerk. A failure needs a follow-up and due date; close it when done. License expiry lives with Compliance (Phase 9).

## Food sales & menu mix (`/kitchen`)
Food sales by store and day from 4200 on the POS close, and the menu mix from the POS item report (Item, Qty, Sales, for a store and period). The item import ties to food sales in the books and is idempotent.

## Food cost (`/kitchen/food-cost`)
Food cost % = (kitchen purchases ± the change in counted kitchen inventory) ÷ food sales, by store and month, with a target per store (±2 points) and the trend. A month is measured once a kitchen count is posted on or after the 25th; before that it shows purchases only (*). Food cost always equals 5200 in the ledger. Waste % and the cost % without waste show alongside.

## Waste log (`/kitchen/waste`)
Item, qty, cost and reason. Waste is not posted (it was bought, so it is inside food cost); the screen shows how many points of food cost it is.

## Labor & prime cost (`/kitchen/labor`)
Kitchen labor from payroll's Kitchen department (gross + employer taxes + cash/check pay, for pay weeks paid in the month) and prime cost (food cost + kitchen labor) as a % of food sales.

## Supplier prices (`/kitchen/prices`)
Import item-level invoice detail (Sysco etc.). Each invoice is matched to its purchase in the books (vendor, store, total, within 7 days). The top items by spend alert when the latest price moved more than 5% from the price before; mark an alert reviewed once dealt with. Lines without an item code (freight, surcharges) are kept but not price-tracked.

# Phase 9: Compliance, assets & ask

## Compliance calendar (`/compliance/calendar`)
Every return, payment and annual filing (sales tax, the UST fee report, payroll returns, income tax, property tax, annual reports) with its due date and the period it covers. Monthly, quarterly and annual items repeat on the first due date's day of the month. **Update** a row to set the status (not started, in prep, filed, paid, accepted), the filed date, the confirmation number, the payment date and amount (and the TX-ref of the payment), and attach the confirmation. Done means filed, plus paid when the item needs a payment, or accepted. Overdue items and anything due within 30 days are in the inbox. The tie-out checks every filed item has a confirmation or document and every linked payment agrees with the books.

## Licenses & permits (`/compliance/licenses`)
Beer, tobacco, food service, UST, business and lottery licenses per store, with issuer, number, expiry and documents. **Renew** enters the new expiry and keeps the old one in the history. Anything expiring within 30 days is in the inbox. The tie-out checks each operating store holds what its activity needs (beer where 4100 has sales this year, food service where there is a kitchen, tobacco, UST and business everywhere).

## Insurance & leases (`/compliance/insurance`)
Policies (carrier, number, stores, term, premium, deductible, limit, documents) and leases (we rent / we let, counterparty, term, rent, escalation, renewal options, notice). Tie-outs: prepaid premiums equal their prepaid schedule; leases we rent from related parties equal the rent pass-through; tenant leases equal the tenant rent schedule.

## Notices (`/compliance/notices`)
IRS and state letters: type, entity, period, received, deadline, amount, what it says, status (open, working on it, responded, closed), what we sent and the outcome. Closing needs the outcome; responded needs the response and its date. Open notices stay in the inbox.

## Document vault (`/compliance/vault`)
One index of every attachment: transactions, bills (and their payment confirmations), fuel invoices and notices, compliance records, assets, maintenance and loans, plus files uploaded straight to the vault. The same file on two records is one entry. Search by words or filter by type, store, month and tag. **Tag / link** sets the type and tags and links a document to a transaction (by TX-ref, which also attaches it there), a vendor or party, a store or a month. Upload a file on its own and link it later. The tie-out proves every attachment on transactions, bills and fuel invoices is in the index.

## Fixed assets (`/assets`)
The register by store: tag, class, cost, salvage, in-service date, life, accumulated depreciation, book value and monthly depreciation. Open an asset for its month-by-month schedule, documents, warranty and the disposal form. Add an asset (optionally posting the purchase from Trustmark). "Register vs the ledger" ties cost to 1500 + 1510 and accumulated depreciation to 1590, store by store.

## Depreciation (`/assets/depreciation`)
Book depreciation by month and store, straight line from the month placed in service. After a month ends, **Post** it: one entry on the month's last day with a line per asset (6400 → 1590). Posting is idempotent per asset and month. The tie-out compares 6400 with the register each month.

## Loans (`/assets/loans`) and one loan (`/assets/loans/:id`)
Company loans (on our books, paid from Trustmark) and store mortgages carried by Dhunna Development / SKD Properties (information only: we book the rent pass-through, not the mortgage). Each loan shows lender, amount, rate (fixed or variable with its index), term, amortization, payment, start, maturity and balloon, collateral, guarantor, prepayment penalty and covenants, and its amortization table (principal vs interest each month, payoff date). **Post** a due payment: principal to the loan account, interest to 6500, from Trustmark. A line of credit records draws and paydowns and charges interest on the daily balance. Tie-outs: each loan account (2310, 2320) equals its loans; 2300 holds nothing for the related-party mortgages; the rent pass-through covers each mortgage payment.

## Maintenance (`/assets/maintenance`)
The maintenance log (repairs, service, inspections, calibrations) with cost, the payment TX-ref and the next due date, plus warranty end dates. Items due within 30 days are in the inbox. The tie-out checks every logged cost linked to a payment agrees with it.

## Prepaids (`/assets/prepaids`)
Property tax, insurance and annual fees spread evenly over their months. Add a prepaid (optionally posting the payment to 1400 from Trustmark); after each month ends, post its amortization (1400 → the expense). The tie-out proves what is left on the schedules equals 1400.

## Ask (`/ask`, or ⌘K "Ask: …")
Type a question in plain English. Patterns understood: what did we pay *vendor* (for *store*) in *month*; outstanding *supplier* invoices as of *date*; gallons sold this/last month at *store* (including or excluding Comdata); *account* balance as of *date*; sales at *store* last week/month; who owes us; intercompany balances; bills due this week / past due. The answer shows how the question was read, then the proof rows (transactions, bills, invoices or statements) that add to it. Copy it as text or export the rows to CSV. There is no AI service: when a question isn't understood, or the data isn't in the books, it says exactly what's missing and suggests a phrasing.

# Phase 8: Budgets & close

## Annual budget (`/budgets`)
The budget for a fiscal year: store × P&L line × month, on the accrual basis, sales and costs both entered as positive numbers. Pick the year, the version and a store; with one store picked every month is an input (type, then leave the cell or press Enter). **Copy Jan →** repeats the first month across the year; **Even out** spreads the year's total evenly (the cents add back). **Add a line** adds an account the store has no budget for. Below, **Versions** lists every version with its net sales and net profit; one is active and everything else (budget vs actual, the forecast, the close) reads it. **Build a new version** from last year's actuals + growth %, from zero, or as a copy of the active one. The demo books start in September 2026, so "last year + growth" annualizes the complete months on file (September and October, flat by month) and the version's note says so; HM17, opened in November, is scaled up from its days so far. Tie-outs: months add to the year; the grid ties to the version's cells; the same total shows on the rolling forecast.

## Budget vs actual (`/budgets/bva`)
Every P&L line for a month (or range), a store or all, and a basis (accrual by default): actual, budget, variance (actual − budget, green when it helps profit) and variance %. Click a line for its entries. **Variances over the threshold** lists each store × line × month at least the threshold dollars and percent off budget (default $1,000 and 10%, set at the bottom); type why and **Save comment**. The close's step 11 needs every one explained. Tie-outs: actuals tie to the P&L on the same basis; the budget ties to the annual budget grid; variance = actual − budget on every line. The P&L (`/reports/pnl`) has the same comparison as its **Vs budget** view.

## Rolling forecast (`/budgets/forecast`)
The fiscal year as it is turning out: actuals for months that are over, actual-to-date plus the rest of the plan (prorated by days) for the current month, and for months to come either the budget or the run rate of the last three complete months (**Months to come**). With one store picked, type over a forecast month to override it. Year, budget and vs-budget columns at the right. A year with no budget of its own (FY2027 in the demo) uses last year's actuals + the last budget's growth as a stand-in and says so. Tie-outs: actual months tie to the accrual P&L; months add to the year; the budget column ties to the annual budget.

## Scenarios (`/budgets/scenarios`)
What-ifs on top of the rolling forecast, side by side with the base: **fuel margin ± N¢ a gallon** (forecast gallons = forecast fuel sales ÷ the store's average price per gallon), **new store opens in a month** (copies another store's forecast; sales, cost of goods and card fees ramp from an opening level over N months, fixed costs start in full), **close the kitchen on a weekday** (removes that weekday's share of kitchen sales and food cost, and the same share of the kitchen department's part of labor), and **% change to an account group** or one account. Changes apply only to months still to come. Build a draft (it previews as a column), then save it; each scenario lists what every change does to net profit. Tie-out: each scenario's changes add up to its difference from the base.

## Break-even (`/budgets/break-even`)
For each operating store and month (or range), on actuals or the budget: net sales, variable costs (cost of goods + card and network fees), contribution and contribution margin %, fixed costs (every other operating expense), break-even sales (fixed ÷ CM %), per day, gallons and break-even gallons at the current mix, margin of safety and net profit. Tie-outs: contribution − fixed = net profit for every store; on actuals for one month it agrees with the store scorecards.

## Month-end checklist (`/close`)
The one-screen month-end close. Pick the month; the figures show steps done, open, overdue and the lock status. The grid has the twelve steps down the side and Company + every store across; a step that doesn't apply to a store says n/a. Click a status to open the step: its evidence (✓ what the data proves, ✗ what is missing), owner, due date, **Open …** to go to the screen that does it, status, note and **Attach evidence**. Steps the data can prove (sales posted, fuel invoices settled, notices posted, bank reconciled, cash chain balanced, payroll posted, intercompany agreed, rent pass-throughs, variances explained) turn done by themselves; they can't be marked done by hand, only in progress or blocked with a note. Accruals and inventory counts are manual for now (accruals link to Books › New entry; phase 7 plugs inventory counts in). Step 7 lists each related party's month-end balance with an **Agreed** button once they confirm it. **Lock** (step 12) is enabled only when every other step is done; the CFO can **Lock anyway…** with a reason, kept with the month and in the audit log. **Owners and due dates** sets each step's default owner and how many business days after month end it is due. Inbox: close steps overdue, months past their lock date, and variances over the threshold with no comment.

## Close binder (`/close/binder`)
One printable HTML document for the month: the checklist with its evidence, P&L on the accrual and cash bases with the bridge, balance sheet, cash flow, the bank reconciliation with its outstanding items, budget vs actual with the variance comments, schedules (AP aging, intercompany balances and whether each was agreed, fuel gallons and margin, fixed assets) and an index of supporting documents (where each attachment is filed). **Open printable binder** opens it to print to PDF; **Download HTML** saves it; **Download ZIP of CSVs** has one CSV per table. The contents list shows every section's tie-outs.

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
# Phase 12: Debt, treasury & capital structure

## Debt dashboard (`/debt`)
Every loan in one table: the loans on our books (equipment note, line of credit) and the store mortgages carried by related parties (flagged "Carried by …", information only). For each: balance, rate (fixed, or variable with its index and margin) and its after-tax cost, payment, maturity and balloon, collateral and guarantor, prepayment penalty, covenants, interest to date (the 6500 posted by its payments) and interest projected for the next 12 months from the schedule. Figures: company debt, weighted-average cost of debt (before and after tax, and including the related-party mortgages), interest this year and projected, the next maturity. The maturity ladder shows principal coming due by year, balloons and maturities apart. Tie-outs: each loan account (2310, 2320) equals its schedules; interest to date adds to 6500; 2300 holds nothing; the ladder adds to company debt. Export CSV or Excel.

## Covenant monitor (`/debt/covenants`)
DSCR, leverage (debt ÷ EBITDA), minimum liquidity and fixed-charge coverage, tested monthly from the statements. Each covenant shows its limit, the actual, headroom (amount and %), status (holds, near, breach) and the forecast breach date. The monthly table builds EBITDA (net income + interest + depreciation), debt service (scheduled principal and interest on our loans), debt, rent and the ratios, with the group DSCR that adds the related-party mortgages and their rent. With fewer than 12 months on the books the ratios are **annualized** and the note above the table says so; the settings panel changes the basis, the trailing months, annualizing, whether the month in progress is reported, the "near" band, the horizon and the DSCR target. Liquidity breaches come from the 13-week cash forecast, ratio breaches from the trend once three complete months exist. Add covenants to any loan. Tie-outs: EBITDA ties to the P&L, scheduled interest equals 6500, debt ties to the schedules.

## Lender package (`/debt/lender-package`)
Pick a loan for its compliance certificate (each covenant: required, actual, headroom, in compliance), loan terms, the EBITDA build-up, the debt schedule and the balance sheet. **Print / PDF** for the lender; **Export Excel (all sheets)** writes one workbook with the covenants, monthly ratios, debt schedule and P&L summary; CSV exports the certificate.

## Refinance analyzer (`/debt/refinance`)
Pick a loan (it starts from the latest market quote for that kind of loan, the original term, the remaining amortization, 1% fees and the prepayment penalty read from the loan's wording) or a saved scenario. Change the rate, term, amortization, fees, penalty, cash out, or roll the costs into the loan; the figures update as you type: monthly payment change, break-even months (costs ÷ monthly saving), NPV at the cost of capital, interest saved (over the months both loans run, and over the life), DSCR before and after (the group DSCR for a related-party mortgage), cash freed. **Save scenario** keeps it. Below: the refinance triggers, the market rate history (add a quote) and property values with LTV (add a value).

## Paydown vs invest (`/debt/paydown`)
Each debt's after-tax cost (rate × (1 − tax rate)) and each alternative's after-tax return, ranked highest first. Once cash is above the reserve, the deployable cash (or the amount you enter) goes down the list: that is the recommendation, avalanche order for the debts. The effect table shows DSCR, liquidity, free cash a month, interest saved, return gained and months to fund the next store, before and after. Add alternatives (new store, equipment upgrade, inventory, cash reserve, other) with an expected return; set the tax rate and the next store's equity.

## Cash reserve (`/debt/reserve`)
The target = N weeks of fixed costs (expenses on the P&L over the last complete months, less card fees, payroll and depreciation) + one typical fuel load per fuel-selling store (median delivered invoice in 90 days) + one payroll (average of the last four pay weeks) + a cushion. Cash = bank, cash on hand and supplier / card clearing. Deployable = cash − target. Month ends show the history; two or more in a row above the target puts a line in the inbox. The suggested uses come from Paydown vs invest. Change the policy at the bottom. Tie-outs: the parts add to the target; cash ties to the ledger accounts.

## Related-party loans (`/debt/related-party`)
Loans to related parties (1910) and from them (2400), by party, straight from the ledger. Record each loan's terms (rate, repayment schedule, start, maturity, whether a signed note is on file). A rate below the AFR is flagged with the interest that may be imputed (balance × (AFR − rate) a year). Each month end shows the book balance; **Record confirmation** saves what the other side agreed (a difference needs a note). Balances with no terms say so. Tie-outs: the parties add to 1910 and 2400.


# Phase 11 — Tax

Working papers for the CPA, not tax advice. Every rate, life and threshold is a configurable table (Tax › Planning › Tax tables) with a current-law default labeled "verify with your CPA". Nothing here files a return.

## Entity map (`/tax`)
Each entity's classification and form, masked EIN (last four digits; edit the EIN in Setup › Entities), the return it files on (disregarded entities roll into their parent, the hub by default), owners and %, state registrations, fiscal year end, overall and inventory method, preparer and where prior returns are kept (a vault document or a note). **Edit** a row to change them. Tie-outs: every return's ownership adds to 100%; every disregarded entity rolls into a return that files; every owner draw this year went to an owner of the return it came from.

## Calendar & returns (`/tax/calendar`)
The compliance calendar's tax kinds (federal income, state income/franchise, estimated tax, payroll, sales tax, fuel and tobacco excise, property tax, 1099s, W-2s, annual reports) plus every estimate installment. Each row links to its tracker (payroll → the Phase 6 tracker, 1099s → Payables › 1099, sales tax → the worksheet, estimates → Estimates). **Update** records status, filed date, confirmation and payment, exactly as on the compliance calendar. Tax notices from the Phase 9 tracker are listed below. Tie-outs: filed items carry a confirmation or document; entity-paid estimates agree with their entries in the books.

## Sales tax (`/tax/sales-tax`)
Pick a month. Per store: POS sales, fuel (excluded unless the tables say otherwise), other non-taxable, taxable sales, tax at the rate, tax collected (2200 credits, with anything collected outside the POS shown apart), variance, remitted (2200 debits for that month) and not remitted. Flags appear when collected differs from rate × taxable sales, or, once the return is due or filed, when collected ≠ remitted (also an inbox item). Export or print the worksheet. Tie-outs: collected less remitted ties to 2200; taxable sales tie to the taxable departments on the POS close.

## Book-to-tax (`/tax/book-to-tax`)
Pick the return and year. Net income per books (the members' trial balances, plus book income from before these books, entered) → adjustments → taxable income. Standard adjustments recompute from the books: depreciation (register book − tax), meals (50% of 6350), penalties (6360), owner withdrawals booked to expense, and accrual-to-cash for a cash-method return. Each has a **Workpaper** (notes, source link, the meals %) and a **Review** sign-off; editing clears the sign-off. Add manual adjustments with their M-1 line; someone other than the preparer reviews them. Schedule M-1 and M-2 (AAA for the S corporation, partners' capital for the partnership) are laid out below. Tie-outs: trial balances balance; book income ties to them; book depreciation ties to the register and 6400; M-1 line 8 equals book income plus every adjustment.

## Tax depreciation (`/tax/depreciation`)
Every Phase 9 asset with its tax schedule beside the book one: recovery period, convention (the 40% mid-quarter test is applied automatically), §179, bonus, QIP, book and tax for the year, accumulated on both sides and the difference. **Elections** sets them per asset. Flags: no elections recorded, cost-segregation candidates (canopies, USTs, site work; HM14's land and building pending a study), lives that look wrong, bonus or §179 where they aren't allowed. The MACRS tables (5, 7, 15-year half-year and mid-quarter; 39-year mid-month) are shown below. Tie-outs: book ties to the register and 6400; book − tax ties to the M-1 depreciation adjustments.

## Methods (`/tax/methods`)
The §448(c) gross-receipts test: three prior years (entered for years before these books, plus anything in the books), aggregated across every entity, averaged and compared with the threshold. Per return: cash vs accrual eligibility, inventory method and UNICAP (exempt for a small business). Form 3115 changes with DCN, status, filed date and §481(a) adjustment. Tie-out: this year's receipts in the books tie to net sales on the P&L.

## Estimates (`/tax/estimates`)
One card per payer (an owner, or an entity paying its own tax). Projected income (year to date annualized, depreciation at the full year), × the rate, against the safe harbor (last year's tax at 100%, or 110% above the AGI threshold): the smaller is required, in four installments; overpayments carry forward. **Record a payment**: paid personally (recorded only) or by an entity, which posts from Trustmark (an owner's estimate as a distribution under the owner-withdrawal policy; an entity's own to 6250). Installments due within 14 days reach the inbox.

## Owners & K-1 (`/tax/owners`)
Per return: each owner's %, share of taxable income, distributions (from owner draws), non-deductible share, basis start and end (suspended losses and distributions over basis flagged), capital start and end. **Start** enters last year's ending basis and capital. S-corporation distributions out of proportion to ownership are flagged. Tax distributions = projected taxable share × owner rate, against what has been distributed and the distribution capacity (bank above the floor less entity estimates due in 90 days).

## Planning (`/tax/planning`)
Projected year-end taxable income for a return and the levers: equipment bought before year end (bonus / MACRS), electing bonus on this year's assets, retirement contributions, owner salary (FICA effect for the S corporation) and a C-corporation comparison (information only), each with the tax saved at the table rates. The tax tables themselves are edited here.

## CPA package (`/tax/cpa`)
The year-end ZIP: entity map, trial balance per entity, fixed assets book and tax, loan schedules, payroll summary, 1099 list, owner draws, intercompany balances, inventory, tax workpapers with M-1/M-2, sales tax, estimates and K-1 support, plus a printable index (HTML and CSV). Each line opens its screen. Downloads are logged.

# Phase 14: Controls & risk

## Control health (`/controls`)
One line per control (approval limits, segregation of duties, cash, fraud signals, risk & insurance, UST, backups), green / amber / red, with the screen that fixes it. Figures: open fraud signals and the dollars in their evidence, open duty conflicts, UST items overdue, coverage gaps. Tie-outs: the open signals add to their evidence rows; the fraud count agrees with the Fraud signals screen.

## Approval limits (`/controls/limits`)
Limits by role for bills, journal entries, write-offs (entries from a write-off template) and rate changes (counted at their yearly cost: per hour × 2,080, per week × 52). Blank = no limit, 0 = can't approve; store managers and outside accountants never approve. Every approve function calls one central check, so an approval over the approver's limit is refused with a message that names who can approve it (never the preparer of a journal entry). The journal-entry threshold under Setup › Settings still decides which entries need approval at all. "Approvals given" lists every approval on file, flags any over today's limits and any entered and approved by the same person. CFO only to change; audited.

## Segregation of duties (`/controls/sod`)
The matrix of what each role can do per area (bills: enter / approve / pay; journal entries and write-offs: prepare / approve; rate changes & payroll: request / approve / post; cash: count / receive at HQ / deposit), from the permissions and the approval limits. Conflicts in configuration (a role that can do every step) and in activity (one person entered and approved, or approved and paid, the same bill or entry; counted and received the same cash bag; requested and approved a rate change). Acknowledge one with the compensating control; for a role conflict, "Also covers this role's activity" marks that role's activity conflicts as covered. "What people actually did" counts each step per person from the records and the audit log. Tie-out: open + acknowledged + covered = every conflict.

## Cash controls (`/controls/cash`)
Settings: second count at or above an amount from a start date (optionally refused without one), blind HQ counts, and the small-shortage pattern (how many shortages under $5 within how many days). Dual counts lists each count and HQ receipt over the amount with its second counter (missing, off, same person or agreeing) and records missing ones. With blind counts on, the cash chain shows HQ a sealed bag and an empty amount until HQ records what it counted. Repeated small shortages: each under $5 is ignored alone, but the pattern is flagged (SPEC §6.8), with its rows. Variance by person and by store and month; deposits made late or not yet made. Tie-out: by person and by store add to the same net variance as every handoff.

## Fraud signals (`/controls/fraud`)
Eleven pure checks, each with evidence rows that link to their source and add to the signal's amount: duplicate vendors (similar names, same address or bank account), round-dollar payments ($500+ whole hundreds to vendors), amounts within 5% under an approval limit or the journal-entry threshold, voids and refunds by cashier (from an imported POS exception report: the POS daily close has no cashier detail), drive-offs from the log plus tanks short of book inventory, lottery shortages not reviewed, pay after termination, ghost employees (hourly pay with no hours, or no address / W-4 on file), rate changes of 15%+, check gaps / repeats / out of order, and vendor bank accounts changed in the last 90 days. Filter by kind and status. **Dismiss** needs what you found (audited); **Escalate** keeps a note (CFO or owner). A signal that gains a row comes back under a new key. Tabs: import a POS exception CSV (Date, Store, Cashier, Type, Count, Amount; idempotent) and the drive-off log.

## Risk & insurance (`/controls/risk`)
**Risk register:** risk, category, likelihood and impact (1–5, score = L × I; high 15+, medium 8+), owner, mitigation, review date, the policies that insure it. Reviews due within 14 days reach the inbox. **Coverage checklist:** property, general liability, liquor liability, pollution / UST, workers' comp, umbrella, cyber and auto against the Phase 9 policies in force (a package policy can satisfy another line), with limits, premiums and renewal dates; gaps are no policy, a site left out (pollution: every site with tanks; liquor: every site with a beer license) or a limit under the minimum. Tie-out: premiums agree with the policies on file. **Claims:** date of loss, store, policy, claimed, paid, status; open claims tie to their insurance receivable.

## UST compliance (`/controls/ust`)
Per tank (Phase 3 tanks): tank tightness, line tightness, line leak detector, cathodic protection, spill & overfill; per site: facility inspection and financial responsibility. Last done, result, next due (standard interval or the vendor's date) and status (current, due soon, overdue, failed, no record); attach the report to each. **Release detection:** each tank and month from the tank readings: pass when |variance| ≤ 1% of throughput + 130 gallons, with readings on most days. **Documents:** financial responsibility from the pollution / UST policy, UST permits and the UST fee filing (Compliance), and test reports. Tie-out: every active tank and site has a row for every required test.

## Security & backups (`/controls/security`)
What needs the hosted back end (2FA, encryption at rest, daily backups, verified sign-in) with the plan for each, and what is in place on this device. **Download backup** saves the whole books as one JSON file (logged as an export). **Restore from a file** (CFO only): preview the records it holds against this device, type RESTORE, confirm; the restore is written to the audit log. The export log lists every export; the access review shows, per user, the stores they see, what they can approve, their last activity and anything to review.

