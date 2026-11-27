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
