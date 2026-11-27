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
