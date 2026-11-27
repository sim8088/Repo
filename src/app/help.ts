/** The "how to use this screen" note that ships with each Phase 1 screen. Mirrored in docs/HOW-TO.md. */
export const HELP = {
  today: {
    purpose: 'Your morning check. The inbox lists everything that needs a decision; the figures show where cash stands and how yesterday went.',
    steps: [
      'Work the inbox from the top. Each line opens the screen that fixes it.',
      'Check the bank figure against the $30,000 floor. It turns red below the floor.',
      'Click any figure to see the transactions behind it.',
    ],
    tips: ['Counts update the moment you fix something.', 'Modules that arrive in later phases (bank feed, fuel, payroll) add their own inbox lines.'],
  },
  transactions: {
    purpose: 'Every transaction in the books, newest first. Filter, fix, bulk-edit and export.',
    steps: [
      'Use the queue buttons to see only uncategorized items or possible duplicates.',
      'Search by description, reference, check number, party or an amount such as 4,077.40.',
      'Tick rows to bulk-move them to another category or store.',
      'Open a row to see every line, its attachments and its change history.',
    ],
    tips: ['Deleted transactions stay in the books, hidden; tick "Show deleted" to restore one.', 'Export downloads exactly what the filters show.'],
  },
  txnForm: {
    purpose: 'Enter money out, money in, or a full journal entry. The ledger keeps both sides balanced.',
    steps: [
      'Pick the type. Money out and money in need a bank/cash account, an amount and one or more categories.',
      'Split a category across stores by amount or by percent; the cents always add back to the total.',
      'For a journal entry, enter each debit and credit line. Post is disabled until they balance.',
      'Attach the invoice, receipt or notice after saving, from the transaction page.',
    ],
    tips: ['When Corporate pays a store bill, the ledger adds the due-to / due-from lines for you so each entity balances.', 'Dates in a locked month are refused.'],
  },
  txnDetail: {
    purpose: 'One transaction, the lines behind it, its documents and who changed what.',
    steps: ['Check the lines and the tie-out (debits = credits).', 'Attach a photo or PDF of the source document.', 'Edit, delete (with a reason) or restore.'],
    tips: ['Grey "auto" lines are intercompany entries the ledger added; they change when you edit the lines they balance.'],
  },
  accounts: {
    purpose: 'The chart of accounts: fuel by grade, departments, kitchen, contra revenue, cost of goods and expenses.',
    steps: ['Click an account to open its general ledger detail.', 'Add an account, or edit a name, number, line of business or floor.', 'Deactivate accounts you no longer use; history stays.'],
    tips: ['System accounts (intercompany, retained earnings, uncategorized) cannot be removed.'],
  },
  accountDetail: {
    purpose: 'General ledger detail for any account and date range, with a running balance and a drill to the source of every line.',
    steps: ['Pick the account, the dates and, if needed, an entity or a store.', 'Click a reference to open the transaction; the Source column opens the journal entry, bill or other record behind it.', 'Export to CSV or Excel for the CPA.'],
    tips: ['The tie-out proves opening + activity = closing, and that closing matches the trial balance (for the same entity).'],
  },
  trialBalance: {
    purpose: 'Every account balance as of a date, by entity or for all entities together, in three columns: unadjusted, adjusting and adjusted, with the prior month end beside it.',
    steps: ['Pick the as-of date and the entity.', 'Read the adjusting column: entries tagged adjusting dated this month (accruals, reclasses, count adjustments).', 'Compare with the prior month end in the last two columns.', 'Click an account to see its detail. Export to CSV or Excel for the CPA.'],
    tips: ['Unadjusted + adjusting = adjusted on every row, and each column balances; the tie-out checks both.', 'Each entity balances on its own because intercompany lines are booked automatically. For the group with eliminations, open Consolidation.', 'Prior-year profit rolls into retained earnings.'],
  },
  journals: {
    purpose: 'Every manual journal entry: what waits for approval, what posted, the templates, recurring schedules and reversing entries.',
    steps: ['Start a new entry, or pick a template (accruals, prepaids, depreciation, intercompany, reclass, owner, inventory, write-offs).', 'Entries over the approval limit wait here and on Approvals until someone other than the preparer approves them; nothing posts before that.', 'Recurring: set a schedule, then generate the runs that are due. Each month runs once.', 'Reversing: post the reversals that have come due; each posts once, on its own date.'],
    tips: ['The limit is in Setup › Settings (journal entry approval limit).', 'Accrual templates reverse on the 1st of the next month automatically.'],
  },
  journalForm: {
    purpose: 'Prepare a balanced journal entry with a memo, an entity and store on every line, and support attached.',
    steps: ['Pick a template to fill the accounts and sides, then give the amounts, stores and date. Or leave it on None and enter the lines.', 'Check the lines: each one\'s entity comes from its store; cross-entity lines get their due-to / due-from automatically.', 'Write the memo (required), tick Adjusting where it applies, and set an auto-reverse date for accruals.', 'Post. Over the limit it goes for approval instead.'],
    tips: ['Locked months refuse the entry and the reversal date.', 'Prepaid amortization and depreciation schedules arrive with Phase 9; the templates here are for one-off entries.'],
  },
  journalDetail: {
    purpose: 'One journal entry: its lines, who prepared and approved it, the posting and the reversal.',
    steps: ['If it is waiting and you can approve, approve it (it posts on its own date) or reject it with a reason.', 'Open the posted transaction to attach support or see the automatic intercompany lines.'],
    tips: ['The preparer can never approve their own entry.'],
  },
  recons: {
    purpose: 'The monthly reconciliation of every balance-sheet account: GL against support, the difference and two sign-offs.',
    steps: ['Pick the month (it defaults to the last month that has ended).', 'Work the accounts marked To prepare: support comes from the subledger where one exists (bank rec, Craddock, Dash, party ledgers, bills, payroll) or is entered by hand with its document.', 'The preparer signs; someone else with approval rights reviews.', 'Fix or explain every difference before signing.'],
    tips: ['A sign-off lapses (GL changed after sign-off) when anything posts to the account in that month afterwards; prepare it again.', 'Loans and fixed assets are entered by hand until the Phase 9 schedules merge.'],
  },
  reconDetail: {
    purpose: 'One account\'s reconciliation for a month.',
    steps: ['Read the support: each line shows where its number comes from, and the link opens the subledger.', 'Where the support is manual, enter the balance with what it is and attach the document.', 'Sign as preparer (explain any difference), then a reviewer signs.'],
    tips: ['The tie-outs prove the support detail adds up and the GL ties to the account detail.'],
  },
  consolidation: {
    purpose: 'The group: each entity\'s books side by side, the eliminations and the consolidated trial balance.',
    steps: ['Pick the date.', 'Read the elimination entries: each pair of entities\' due-to / due-from, and intercompany management fees income against expense.', 'Check the tie-outs: eliminations net to zero, nothing intercompany is left, net income unchanged.', 'Record the consolidation to keep its elimination entries in the log.'],
    tips: ['Eliminations never post to an entity\'s ledger.', 'Related parties outside the group (Dhunna, SKD, Cheers…) are real balances and stay.'],
  },
  qboStatus: {
    purpose: 'Where each entity\'s QuickBooks Online sync stands.',
    steps: ['Read the status: the live connection needs the hosted back end, so syncing runs by file for now.', 'Set each entity\'s QBO company and QBO\'s closing date.', 'Follow the steps below the table: map, pull, push, prove.'],
    tips: ['The sync model is the same one the API connector will use once the back end ships.'],
  },
  qboMapping: {
    purpose: 'Line up the portal\'s accounts, stores and vendors with their QuickBooks names.',
    steps: ['Load QBO\'s account list if it changed.', 'Accept the suggestions you agree with, or pick names one by one.', 'Clear the unmapped list: entries touching an unmapped account are held back from pushes.'],
    tips: ['Suggestions match the account number first, then the name.'],
  },
  qboSync: {
    purpose: 'Move data between the portal and QuickBooks by file.',
    steps: ['Push: pick the entity and month, check the entries (approved journal entries and the sales, fuel COGS, card fees and payroll summaries), push and import the downloaded CSV in QBO.', 'Pull: paste or choose QBO\'s Transaction List export; duplicates of portal entries are skipped, new ones post with the batch id.', 'QBO trial balance: import it each month end, then open the Differences report.'],
    tips: ['Locked months and QBO\'s closing date refuse pushes.', 'Re-pushing an unchanged entry or re-pulling a file does nothing.'],
  },
  qboDifferences: {
    purpose: 'The portal\'s trial balance against QuickBooks\' for an entity and month, with the likely cause of each difference.',
    steps: ['Pick the entity and month (an imported QBO trial balance is needed).', 'Work each difference by its cause: map an unmapped account, push what isn\'t pushed, agree dates for timing.', 'Re-import QBO\'s trial balance after fixing and check it clears.'],
    tips: ['Differences over $5 go to the inbox.'],
  },
  qboLog: {
    purpose: 'The record of every sync: what moved, when, who did it, who approved it, errors and fixes.',
    steps: ['Filter by kind.', 'Open a push to see each entry\'s QBO id.', 'Export it for the CPA.'],
  },
  pnl: {
    purpose: 'Profit and loss by store on three bases. Booked is the ledger as posted. Cash puts every line on the day its cash moved. Accrual puts every line on its transaction date and replaces paid fuel invoices with accrual fuel cost of sales. Compare shows cash and accrual side by side with the bridge between them.',
    steps: [
      'Pick the months, a store if you want one, and the basis.',
      'Change the view: by store, by month (the trend), or against the prior period of the same length. Tick % of sales to see every line as a share of sales.',
      'Click any amount for the entries behind it; each one opens its transaction.',
      'On cash, accrual or compare, read the bridge: every difference between the two bases, grouped by why its dates differ. It ties to the cent.',
      'Export CSV or Excel, or print to PDF.',
    ],
    tips: [
      'Cash basis: a line counts on the date its bank line cleared. An uncleared check is left out until it clears; other uncleared bank items (ACH, card, online) count on their book date. Bills count when paid. Cash on hand, cash in transit and supplier / card clearing count as cash, so card sales and Craddock / Dash settlement items count on their book date.',
      'Accrual basis: every line on its transaction date; bills on their bill (invoice) date; paid fuel invoices (5000) taken out and replaced by gallons sold × that month\'s delivered cost per gallon (Plus blended 50/50), dated the month end.',
      'The bridge also splits the fuel difference into the change in fuel inventory at cost and fuel delivered but not yet paid; neither is posted to the ledger yet.',
      'Budget comparison arrives in phase 8.',
    ],
  },
  commandCenter: {
    purpose: 'The board: every store with activity in one month — sales, gross margin, labor % and net profit — and the company total.',
    steps: ['It opens on the latest month with sales and says so. Pick another month or basis if you need it.', 'Click a store\'s net profit for its P&L, then any amount for the transactions.', 'Labor shows red when it is over the store\'s target (People › Labor %).'],
    tips: ['Labor % here is net pay + payroll taxes (6100 + 6110) ÷ net sales on the same basis.', 'The tie-out proves the stores add to the total and the total equals the P&L.'],
  },
  drill: {
    purpose: 'Every entry behind one figure on the P&L or the bridge, on the basis you clicked from.',
    steps: ['Read the date the basis uses, the book date and the cash date.', 'Click a reference to open the transaction; accrual fuel cost links to the fuel margin screen.', 'Export the list to CSV or Excel.'],
    tips: ['"Not in cash" means the line has no cash date yet: an uncleared check or an unpaid bill.', 'The tie-out proves the entries add to the P&L figure.'],
  },
  balanceSheet: {
    purpose: 'Assets, liabilities and equity as of any date, for one entity or consolidated.',
    steps: ['Pick the date and the entity.', 'Intercompany accounts are broken out by party and group entity.', 'Click an account for its general ledger.'],
    tips: ['Equity includes owner capital, owner draws, retained earnings and current-year earnings.', 'Tie-outs: assets = liabilities + equity; every balance agrees with the trial balance; consolidated, due-from and due-to group entities eliminate.', 'Fuel inventory isn\'t adjusted for gallons in the tanks yet (see the accrual bridge).'],
  },
  cashFlow: {
    purpose: 'The indirect cash flow statement: net income, then working capital, investing and financing, adding up to the change in cash and cash equivalents.',
    steps: ['Pick the months and the entity.', 'Click a line for the account behind it.', 'Use the 13-week forecast for the months ahead.'],
    tips: ['Cash and cash equivalents = bank, cash on hand and in transit, and supplier / card clearing.', 'Net income is on the booked basis, so the statement ties to the ledger\'s cash accounts.', 'Loans and bills paid for related parties are investing; mortgages, related-party payables, group entities and equity are financing.'],
  },
  scorecards: {
    purpose: 'Each store\'s KPIs for a month against thresholds: green, amber or red, with notes.',
    steps: ['Pick the month.', 'Read across a store; each pill says the value and its rating.', 'Add a note explaining the month.', 'The CFO or bookkeeper can change a threshold (green and amber lines) below.'],
    tips: ['Accrual basis: fuel margin uses accrual fuel cost.', 'Labor is rated on points over each store\'s labor target. Break-even sales = fixed costs ÷ contribution margin; it is rated on how far sales are above it.', 'Food cost % is purchases ÷ food sales until kitchen counts arrive in phase 7.'],
  },
  boardPack: {
    purpose: 'A one-page monthly pack for the owners: letter, P&L, balance sheet, cash, KPIs, intercompany and open issues.',
    steps: ['Pick the month.', 'Read the letter written from the numbers and edit it.', 'Print / PDF to save or send it.'],
    tips: ['Your edits last until you change month or reset the letter; they are not saved to the books.', 'Open issues are the inbox items that need someone.'],
  },
  reportBuilder: {
    purpose: 'Build your own report: rows of accounts or groups, columns of stores or months, on any basis.',
    steps: ['Tick row groups or add account rows.', 'Pick columns, months, basis and stores.', 'Save it; open it again from Saved reports.', 'Pick a schedule to keep a cadence with the report.'],
    tips: ['Scheduling stores the cadence only: nothing is emailed yet, because sending needs the hosted back end.', 'The tie-out proves every row adds across and net profit agrees with the P&L.'],
  },
  periods: {
    purpose: 'Open and locked months. A locked month refuses every change.',
    steps: ['Lock a month once it is closed.', 'To change a locked month, unlock it with a reason. The reason is kept in the audit log.'],
    tips: ['Only the CFO can lock or unlock.'],
  },
  stores: {
    purpose: 'Stores and locations. Add a fifth store here without any code change.',
    steps: ['Add or edit a store: code, name, owning entity, fuel supplier, payroll and features.', 'Leased-out stores (like HM14) stay out of operating reports.'],
  },
  entities: {
    purpose: 'The legal entities that keep their own books.',
    steps: ['Add or edit an entity and its tax classification.', 'Exactly one entity is the hub (Corporate); store entities settle intercompany through it.'],
  },
  parties: {
    purpose: 'Vendors, related companies, owners, tenants and lenders.',
    steps: ['Add a party and its type.', 'Set a default account so new entries fill in faster.'],
  },
  rules: {
    purpose: 'Bank-description rules: if the description contains this text, suggest this category and store.',
    steps: ['Add a rule by hand, or let the inbox learn one each time you categorize.', 'Confidence rises when a suggestion is accepted and falls when it is changed.'],
  },
  users: {
    purpose: 'People and roles. Store managers only see their own store.',
    steps: ['Add a user and choose a role.', 'Use "Acting as" in the top bar to see the portal the way that role does.'],
    tips: ['2FA and sign-in arrive with the hosted back end; this phase runs on one device.'],
  },
  audit: {
    purpose: 'Every change: who, what, when, before and after, and why.',
    steps: ['Filter by type or search.', 'Expand an entry to see the before and after.'],
  },
  settings: {
    purpose: 'Company-wide settings.',
    steps: ['Set the fiscal year start, materiality and the owner-withdrawal policy.', 'Reset to the demo dataset to start over.'],
  },
  bank: {
    purpose: 'Get every bank line matched to the books, then reconcile to the statement so the bank balance is proven.',
    steps: [
      'Import: upload the CSV, OFX or QFX from the bank. The preview shows totals and whether the running balance ties; importing twice never duplicates.',
      'To match: click Auto-match, then take a suggested match, or open "Something else…" to book a bank-only line, match several entries to one deposit, or exclude a line with a reason.',
      'Reconcile: pick the statement date and type the ending balance. Outstanding checks and bank-only items are listed; mark reconciled when the difference is $0.00.',
    ],
    tips: ['Booking a line from the feed teaches the rules, so next month it comes suggested.', 'Lines inside a reconciled period are locked; undo the reconciliation (CFO, with a reason) to change them.'],
  },
  checks: {
    purpose: 'Every check written, whether it cleared, and which are going stale.',
    steps: ['Filter by status.', 'Follow up stale checks with the payee, or void one that will never be cashed (with a reason).', '"Cleared, not in books" means the bank paid a check nobody entered: book it from the bank feed.'],
    tips: ['A check that already cleared can\'t be voided; book a reversing entry instead.'],
  },
  deposits: {
    purpose: 'Where each deposit came from: store cash, card settlement, Fiserv, rent, rebates, ATM, loan repayments and so on.',
    steps: ['Tick "Only unclassified" to see what still needs a source.', 'Pick the source in the row; it saves straight away.', 'The side panel totals deposits by source for the month and ties to the total.'],
  },
  cash: {
    purpose: 'Follow every dollar of register cash from the store count to the bank, and see every handoff variance.',
    steps: [
      'Pick the business day. Each store\'s bag shows its count, pickup, HQ receipt and deposit.',
      'Record the next step in the row: the amount is prefilled from the step before, so type only what was actually counted.',
      'Tick received bags and record the pooled deposit with the slip total. Cash kept back for payouts stays at HQ.',
      'Record cash paid out of the pool: payroll, vendors, change for a store, owner withdrawals.',
      'Review flagged variances and sign each one off with what you found.',
    ],
    tips: ['Any difference posts to Cash over / short at the store, so the books always match the cash.', 'Differences of $5.00 or more are flagged; smaller ones are posted but not flagged.'],
  },
  forecast: {
    purpose: 'Thirteen weeks of projected bank balance against the floor, built from what actually recurs in the books.',
    steps: ['Read the weekly table: inflows, outflows and the ending balance. Weeks below the floor are red.', 'Switch off any detected recurring item that won\'t repeat.', 'Add one-off or recurring items the history can\'t know about: a tax payment, a loan, a new store opening.'],
    tips: ['It starts from the book balance, which already counts checks written but not cleared.', 'Fuel loads and supplier netting arrive with phase 3 and make the fuel side sharper.'],
  },
  // ── People & payroll (phase 6)
  payrollRuns: {
    purpose: 'Every Gusto payroll run with its employee detail, tied to Gusto\'s own totals and, once posted, to the entries in the books.',
    steps: [
      'Import: in Gusto, export the payroll journal for one pay date as CSV and upload it. The preview checks every line (gross = net + employee taxes) and ties the lines to the report\'s Total row.',
      'Fix anything the preview lists (a missing row, a store code it doesn\'t know) and upload again. Importing the same report twice never duplicates a line; every line keeps its batch id.',
      'Open a run to see each employee, the totals by store and department, and whether it ties.',
      'Post from the weekly review (or from the run): net pay goes to 6100 and employee + employer taxes to 6110 by store on the pay date; Trustmark is credited with the company debit, and each paper check posts on its own.',
    ],
    tips: ['People Gusto pays who aren\'t on file yet are added and wait in "New hires to confirm".', 'A posted run shows the entries it made; the tie-out proves they add to the run.'],
  },
  weeklyReview: {
    purpose: 'The Friday payroll review on one screen: the run, this week vs last by store and by employee, rate changes, then post.',
    steps: [
      'Check step 1: every Gusto run for the pay date is in and ties to its report.',
      'Read step 2: labor cost, hours and headcount by store against last week. Anything over 15% either way is red: know why before posting.',
      'Read step 3: the people with something to check (new hire, leaver, rate change, overtime, a big change, paid in Gusto and cash).',
      'Approve or reject rate changes in step 4. A red note means Gusto is already paying a rate nobody has approved.',
      'Post in step 5. The tie-out shows the posted entries match the runs.',
    ],
    tips: ['"Not in yet" means that store has no payroll for the week so far (HM11 cash pay is recorded on Friday).', 'Use the pay date menu to look back at any earlier week.'],
  },
  employees: {
    purpose: 'Everyone on payroll: store, department, how they are paid, current rate and the full rate history.',
    steps: [
      'Filter by store, department or status, or search by name. Open a name for the details, rate history and recent pay.',
      'Change rate sends a rate change for approval with a reason and an effective date; it applies only once approved (CFO or owner).',
      'Confirm new hires after checking the W-4, I-9 and starting rate.',
      'Record a termination with the last day worked and why.',
    ],
    tips: ['The current rate is the starting rate plus every approved change effective by today.', 'A pending raise shows on the employee and in the weekly review until someone decides.'],
  },
  cashPay: {
    purpose: 'Pay outside Gusto, by employee and week: HM11\'s cash crew and any extra cash or check pay elsewhere.',
    steps: [
      'Record each person\'s pay for the week. If the cash already went out as a payroll payout in the cash chain, pick that payout so nothing posts twice.',
      'New cash comes from the HQ pool or a store\'s registers and posts as a cash payroll payout; a check posts as money out with its check number.',
      'In the comparison, anyone paid by Gusto and in cash or check the same week is marked "Both". Find out what it was for and confirm it as extra pay; it is never assumed to be a duplicate.',
    ],
    tips: ['The payouts table shows how much of each weekly cash payout is split by employee; the tie-out goes green when all of it is.'],
  },
  labor: {
    purpose: 'Labor cost as a % of POS sales by store and pay week, against each store\'s target, plus sales per labor hour.',
    steps: [
      'Read the grid: red weeks are over the store\'s target. Hover a cell for the dollars.',
      'Check the detail for the latest full week, with hours and sales per labor hour.',
      'Set each store\'s target (CFO or bookkeeper).',
    ],
    tips: ['Labor cost = gross pay + employer taxes + cash/check pay, which equals 6100 + 6110 in the books once the week is posted.', 'Weeks marked * have fewer than seven days of sales so far.'],
  },
  payrollTaxes: {
    purpose: 'Payroll taxes owed vs deposited by quarter, the quarterly returns and the W-2 / 1099 season.',
    steps: [
      'Compare owed and deposited for each quarter. A difference is normal mid-quarter (state taxes are deposited monthly); at quarter end it should be zero.',
      'Record any deposit Gusto did not make for you.',
      'Tick each return when it is filed and add the confirmation number.',
      'Work the W-2 / 1099 list before 31 January.',
    ],
    tips: ['Owed = employee + employer taxes on every Gusto run, split into federal and state.', 'HM11\'s cash pay is wages too: agree the reporting with the CPA before W-2s go out.'],
  },
  fuelMargin: {
    purpose: 'Gallons, retail and margin per gallon by store and grade, by month or by day, with discounts, card fees and the break-even margin.',
    steps: [
      'Pick the stores and the month. Switch to By day to see each day, or By grade for the month.',
      'Read cpg margin against the target band. Cost per gallon is that month\'s delivered cost from the invoices; Plus is blended 50/50 Regular/Premium.',
      'Break-even cpg is discounts plus card fees per gallon: the margin fuel needs before it earns anything.',
      'The tie-out proves the structured fuel sales add up to fuel revenue in the ledger, and shows the accrual fuel cost the phase 4 P&L will use.',
    ],
    tips: ['HM15 diesel comes from the Comdata truck-lane summary, not the store POS; it is counted here once.', 'Card fees per gallon include inside-store card sales, because the supplier charges them on the whole batch.'],
  },
  fuelInvoices: {
    purpose: 'Every fuel delivery: the BOL, the invoice, gallons by grade, cost, freight, taxes, due date, and how it was settled.',
    steps: [
      'Use the filters to see open, missing (BOL with no invoice), flagged (duplicates and price outliers) or settled deliveries.',
      'Log a delivery by hand with its BOL and, when it arrives, the invoice number and cost per grade. The total must equal lines + freight + taxes.',
      'Import a file of invoices: the preview groups rows into invoices, totals them, and skips any already on file.',
      'Open an invoice to attach the PDF, see the notice or Dash payment that settled it, or remove a duplicate with a reason.',
    ],
    tips: ['Craddock invoices are paid by netting on the next EFT notice; Dash invoices come out of Dash clearing on their due date.', 'A price outlier is a cost per gallon more than 5% from that month\'s average for the grade.'],
  },
  fuelSettlement: {
    purpose: 'Post each Craddock EFT notice and prove it nets to zero; follow the Craddock receivable and the Dash clearing account.',
    steps: [
      'Upload or paste the notice (Type and Amount columns at least). Proceeds are +, fees, discounts, invoices and deposits are −, a draft is +.',
      'Check the parsed lines: the notice must net to zero, each invoice line must match an invoice on file, and card proceeds are compared with the POS card sales for each day.',
      'Post it. Card fees and host discounts are dated to each sales day, invoices and network fees to the notice date, and the draft or deposit to the next business day.',
      'Pick any date to see the Craddock receivable and the card batches not yet on a notice. Switch to Dash clearing for card money in, invoices out on their due dates, and who owes whom.',
    ],
    tips: ['Importing the same notice twice adds nothing; every line keeps its batch id.', 'A posted notice can be unposted with a reason while its month is open and the bank line is not reconciled.'],
  },
  fuelTruck: {
    purpose: 'The HM15 truck lane: Comdata gallons and sales kept apart from the store POS, Mudflap discounts and true-ups, and Fiserv merchant deposits and fees.',
    steps: [
      'Import the weekly Comdata summary (Date, Gallons, Sales, Transactions). Days already on file are skipped.',
      'Post Mudflap fuel-code discounts and card true-ups; they go to 4910 contra revenue against the merchant clearing.',
      'Check the Fiserv table: deposits by month, the fees debited the month after, and the effective fee rate.',
    ],
    tips: ['The tie-out compares Comdata sales with diesel revenue in the ledger and with truck-lane cards into Fiserv clearing.'],
  },
  fuelTanks: {
    purpose: 'Book-to-physical by tank: yesterday\'s reading plus deliveries minus sales against today\'s stick or ATG reading, with water and reorder alerts.',
    steps: [
      'Read each tank\'s gallons, days of supply and 30-day variance against its allowance (1% of gallons sold + 130 gallons).',
      'Open a tank for its daily book-to-physical table.',
      'Record a stick or ATG reading. Store managers can record their own store\'s tanks.',
    ],
    tips: ['Water over 1 inch is an alert: call the tank contractor before it reaches the pumps.', 'Plus draws half from the Regular tank and half from the Premium tank.'],
  },
  fuelPricing: {
    purpose: 'Our posted prices against nearby competitors, what matching would do to margin, and when to order the next load.',
    steps: [
      'Pick a store. Each grade shows our price, the competitors seen in the last week, the spread and the margin per gallon at our price.',
      'Matching impact is the change in a week\'s margin dollars if we matched the lowest competitor and sold the same gallons.',
      'Log a competitor price or change our posted price.',
      'The ordering plan suggests the next delivery date and gallons per tank from sales velocity and tank room.',
    ],
  },
  // ── Phase 5: intercompany, payables, receivables ──
  intercompany: {
    purpose: 'Who owes whom across the related businesses, owners, tenants and lenders, and where each store entity stands with Corporate.',
    steps: [
      'Read the figures: owed to us, what we owe, the net, and anyone over their limit.',
      'Click a party for its running ledger, aging and printable statement.',
      'Record a movement when the shared account pays another business\'s bill, lends money, or gets paid back. Bills paid for them go to their receivable (1920), never to store expenses.',
    ],
    tips: ['The tie-out proves the party ledgers add up to 1910, 1920 and 2400 in the ledger, and that every line on those accounts names a party.', 'Store entity balances come from the due-to / due-from lines the ledger adds automatically.'],
  },
  partyStatement: {
    purpose: 'One party\'s statement: every movement with a running balance, the aging of what is open, and its limit.',
    steps: ['Pick the date range. The opening balance carries in everything before it.', 'Print for a PDF to send, or export CSV.', 'Set a limit; the inbox alerts when the balance goes above it.'],
    tips: ['Positive balances are owed to us; negative ones we owe.', 'Tenant statements show the rent schedule\'s charges (marked scheduled) against rent received.', 'Aging settles the oldest items first, so what is left open is the newest.'],
  },
  draws: {
    purpose: 'Owner withdrawals year to date, kept apart from everything else.',
    steps: ['Check the total and each owner\'s share.', 'Open any withdrawal to see the entry and its document.'],
    tips: ['Under the current policy withdrawals are booked as Corporate · Miscellaneous expense. This view finds them on that account (when an owner is named) and on the draws account, so switching the policy in Settings loses nothing.'],
  },
  eliminations: {
    purpose: 'The group as one company, with the intercompany between the store entities and Corporate netted out.',
    steps: ['Pick the as-of date.', 'Check that each entity pair agrees, and that due-from and due-to net to zero.', 'Read the consolidated balance sheet; export it for the CPA.'],
    tips: ['Balances with related parties outside the group (Dhunna, SKD, Cheers and the rest) are real receivables and payables, so they are not eliminated.'],
  },
  rentTemplates: {
    purpose: 'Monthly rent pass-throughs: a related party pays the store mortgage, the store books rent, and Corporate owes the party.',
    steps: ['Check the templates and the next run date.', 'Pick a month and generate it. A month already generated is skipped, so it never duplicates.', 'Pause a template when a mortgage is paid off; add one for a new store.'],
    tips: ['Each entry debits the store\'s rent and credits Corporate\'s due to related parties for that party, which then shows on the party\'s statement.'],
  },
  bills: {
    purpose: 'Every bill from entry to payment: awaiting approval, approved, scheduled, paid.',
    steps: ['Filter by status, or search a vendor or invoice number.', 'Open a bill to approve it, schedule it, record its payment or attach the invoice.', 'Enter a new bill from the bills inbox.'],
    tips: ['Nothing posts until a bill is approved; then it is an expense against 2000 Accounts payable on the bill date.', 'The tie-out proves open bills equal the 2000 balance in the ledger.'],
  },
  billDetail: {
    purpose: 'One bill: its lines by store, its documents, and the next step.',
    steps: ['Approve (owner or CFO) to post the expense to accounts payable.', 'Schedule the payment date and method, or record the payment with the check number or confirmation.', 'Attach the invoice and the payment confirmation.'],
    tips: ['Paying posts 2000 Accounts payable → Trustmark, so the bank feed matches it like any other payment.', 'Void an approved bill that was entered by mistake: its entry is reversed with your reason.'],
  },
  billsInbox: {
    purpose: 'Turn a photo, PDF or emailed bill into a bill awaiting approval.',
    steps: ['Upload the photo or PDF, or paste the email text.', 'Click "Read it". Amounts, dates, the invoice number, vendor, store and utility account are pulled out where the text shows them.', 'Check every field, fix what is wrong, split the amount across stores if needed, and save.'],
    tips: ['There is no OCR service yet, so a photo or PDF only gives what its file name says. The file is still kept with the bill.', 'Saving never posts anything: the bill waits for approval.'],
  },
  apAging: {
    purpose: 'What we owe vendors, by how late it is.',
    steps: ['Pick the as-of date.', 'Read the buckets: current, then days past due.', 'Click a vendor to see their bills.'],
    tips: ['The tie-out proves the aging (plus any manual entries on 2000) equals the Accounts payable balance in the ledger.'],
  },
  paymentCalendar: {
    purpose: 'Bills by the day they go out, against the projected bank balance.',
    steps: ['Read down the days: bills paying that day, and the balance projected after them.', 'Days that would end below the floor are red: move a payment or bring cash in.', 'Schedule unscheduled bills from their bill page.'],
    tips: ['The projection is the 13-week forecast with approved and scheduled bills added; a bill replaces the matching recurring payment so nothing counts twice.', 'Bills awaiting approval are listed, but not in the projection.'],
  },
  utilities: {
    purpose: 'Every utility account: who, where, account number, autopay, and the bill history.',
    steps: ['Scan the flags: past due, disconnect notice, and jumps of more than 25% over the bill before.', 'Expand a row for the amount history.', 'Add an account when a new service starts.'],
    tips: ['Autopay drafts with no bill entered still count in the history, straight from the bank.'],
  },
  vendorStatements: {
    purpose: 'Check a vendor\'s statement against what our books say we owe them.',
    steps: ['Record the statement: date, balance, and each open invoice on it.', 'Read each line: agrees, amount differs, paid but not yet credited, or not entered.', 'Fix what is ours (enter the missing bill) and ask the vendor about the rest.'],
    tips: ['The explanations add up to the difference exactly; anything left over is shown as not explained.'],
  },
  ten99: {
    purpose: 'Payments to 1099 vendors this year, flagged at $600.',
    steps: ['Mark vendors as 1099 in Setup › Vendors & parties.', 'Check who is at $600 or more: they need a 1099-NEC in January.', 'Export the list for the CPA.'],
    tips: ['Paid means money that left the bank or cash, on transactions naming the vendor.'],
  },
  rentRoll: {
    purpose: 'Tenant rent, due vs received, month by month.',
    steps: ['Read the late items first.', 'Record rent received when a tenant pays; it applies to the oldest month still open.', 'Open a tenant for their statement.'],
    tips: ['Rent is late once the grace days after the due date have passed.', 'The tie-out proves rent received here equals rent income from those tenants in the ledger.'],
  },
  otherReceivables: {
    purpose: 'Money owed to us outside rent: rebates and programs, ATM income, insurance claims and refunds.',
    steps: ['Pick the tab.', 'Record money as it arrives, or apply a deposit already in the books.', 'Close an item that will never pay, with the reason.'],
    tips: ['Expected = received + outstanding on every line.', 'A rebate that arrived at the bank but isn\'t booked: book it from the bank feed, then apply it here.'],
  },
  approvals: {
    purpose: 'Everything waiting for a yes or no.',
    steps: ['Read the item and open it if you need the detail.', 'Approve (with an optional note) or reject with a reason.'],
    tips: ['Bills and journal entries over the approval limit are here; the preparer of a journal entry can never approve it. Amount limits by role come with controls.'],
  },
  // Phase 9: compliance, assets & debt, ask.
  complianceCalendar: {
    purpose: 'Every return, payment and annual filing with its due date, status and confirmation. Anything overdue or due within 30 days is in the inbox.',
    steps: ['Start with "Overdue & due in 30 days".', 'Press Update on a row: set the status, the filed date, the confirmation number and, for payments, the date and amount (and the TX-ref of the payment if it is in the books).', 'Attach the filing confirmation.', 'Add new obligations at the bottom; monthly, quarterly and annual ones repeat on the same day of the month.'],
    tips: ['Done means filed, plus paid when the item needs a payment, or accepted.', 'The tie-out checks every filed item has a confirmation or document, and every linked payment agrees with the books.'],
  },
  licenses: {
    purpose: 'Beer, tobacco, food service, UST and business licenses by store, with expiry dates and documents.',
    steps: ['Read the expiring and expired figures first.', 'Renew: enter the new expiry; the old one stays in the license history.', 'Attach the permit itself.'],
    tips: ['The tie-out checks each operating store holds what its activity needs: beer where 4100 has sales this year, food service where there is a kitchen, and tobacco, UST and business everywhere.'],
  },
  insurance: {
    purpose: 'Insurance policies (carrier, terms, limits, expiry, documents) and leases, whether we rent the premises or let them.',
    steps: ['Switch between policies and leases.', 'Attach declarations pages and signed leases.', 'Follow the links to the prepaid schedule, rent pass-through or tenant rent.'],
    tips: ['Prepaid premiums must equal their prepaid schedule; leases we rent from related parties must equal the rent pass-through; tenant leases must equal the rent schedule.'],
  },
  notices: {
    purpose: 'Letters from the IRS and the state: what each says, the deadline, what we sent and how it ended.',
    steps: ['Record a notice the day it arrives, with the deadline printed on it.', 'Attach the letter.', 'Update it as you work it: responded (what and when), then closed with the outcome.'],
    tips: ['Open notices stay in the inbox until they are closed.'],
  },
  vault: {
    purpose: 'One searchable index of every document: transaction, bill and fuel invoice attachments, compliance and asset records, and files uploaded here.',
    steps: ['Search by words, or filter by type, store, month or tag.', 'Tag / link a document: set its type and tags, or link it to a transaction (by TX-ref), a vendor, a store or a month.', 'Upload a file on its own and link it later.'],
    tips: ['Linking to a transaction also attaches the file to it, so it leaves the "no document" queue.', 'Demo documents are records only; their files are not in the demo.'],
  },
  fixedAssets: {
    purpose: 'The fixed asset register by store, with book depreciation, and its tie to the ledger.',
    steps: ['Open an asset for its monthly schedule, documents and the disposal form.', 'Add an asset: cost, salvage, in-service date and life. Tick "post the purchase" to post it from Trustmark.', 'Check the register vs ledger table: cost ties to 1500 + 1510 and accumulated depreciation to 1590, store by store.'],
    tips: ['Depreciation is straight line from the month placed in service (full-month convention).', 'Disposal posts in the month it happens; depreciation stops the month before.', 'Phase 11 adds tax depreciation alongside book.'],
  },
  depreciation: {
    purpose: 'Monthly book depreciation by store, generated from the register.',
    steps: ['After a month ends, press Post for it. One entry carries a line per asset.', 'Posting twice does nothing: each asset is posted once per month.'],
    tips: ['Months before the register went live are in the opening balance.', 'The tie-out compares 6400 with the register month by month.'],
  },
  maintenance: {
    purpose: 'The equipment maintenance log, what is due next, and warranty end dates.',
    steps: ['Log each repair, service, inspection or calibration, with its cost, the payment TX-ref and when the next one is due.', 'Work the "Coming due" list; it reaches the inbox 30 days ahead.'],
    tips: ['A logged cost linked to a payment must agree with that payment at the store.'],
  },
  prepaids: {
    purpose: 'Property tax, insurance and annual fees paid up front and spread evenly over their months (SPEC §6.10).',
    steps: ['Add a prepaid: amount, first month, months, and post the payment to 1400 if it came from Trustmark.', 'After each month ends, post its amortization: 1400 → the expense, one entry for every schedule.'],
    tips: ['The cents always add back to the amount.', 'The tie-out proves what is left on the schedules equals 1400 in the ledger.'],
  },
  loans: {
    purpose: 'Loans and mortgages: terms, balances, next payments and the tie to the liability accounts.',
    steps: ['Post each payment when it goes out: principal to the loan account, interest to 6500, from Trustmark.', 'Open a loan for its amortization table, terms and covenants.'],
    tips: ['Store mortgages carried by Dhunna / SKD are information only: we book the rent pass-through, not the mortgage, so nothing is counted twice.', 'The debt dashboard and covenant monitor (Assets & debt) build on these loans.'],
  },
  loanDetail: {
    purpose: 'One loan: terms, the amortization table (principal vs interest each month) and the payoff date.',
    steps: ['Post a due payment from its row.', 'For a line of credit, record draws and paydowns; interest is actual days on the daily balance.', 'Export the table to CSV for the lender or CPA.'],
    tips: ['The table ties: principal repays the original amount, and the balance ties to the ledger.'],
  },
  ask: {
    purpose: 'Questions in plain English, answered from the books with the transactions as proof.',
    steps: ['Type a question or pick an example. ⌘K also offers "Ask: …" when you type a question.', 'Read "How I read it" to check the filters used.', 'Open any proof row, copy the answer as text, or export the rows to CSV.'],
    tips: ['There is no AI service behind this: questions are read with fixed patterns, and the answer is always the sum of its proof rows.', 'When a question is not understood or the data is not in the books, it says exactly what is missing and suggests a phrasing.'],
  },
  // ── Phase 7: inside store and kitchen
  insideDepts: {
    purpose: 'Sales and true margin by department: POS sales, purchases mapped to departments and the inventory counts.',
    steps: [
      'Pick the month and store. Sales come from the POS daily close; units and customer counts from the POS department import.',
      'Cost of goods = purchases − the increase in counted inventory. Click purchases to see the entries behind them.',
      'To add a day, open "Import POS department sales", pick the store and day, and paste or upload the department report. The preview must tie to the file total and to the POS close before you import.',
    ],
    tips: ['Importing the same report twice adds nothing; a corrected report needs the earlier import undone first.', 'A month with no closing count shows purchases only, so margin moves with delivery timing.'],
  },
  insidePurchases: {
    purpose: 'Every merchandise and food purchase in the books (check, EFT, cash and approved bills), assigned to departments.',
    steps: ['Filter by month, store or department.', 'Check "Without a department" is zero; add a vendor mapping for anything that is not.', "A vendor mapped to several departments is split by that store's sales of them that month."],
    tips: ['Purchases with no mapping follow their account: 5100 beer, 5110 tobacco, 5120 grocery, beverages and other (by sales), 5200 kitchen.'],
  },
  insideInventory: {
    purpose: 'Count inventory by department, see shrink, and post the inventory adjustment through the ledger.',
    steps: [
      'Pick the store and count date, then enter each department counted at cost.',
      "Book = last count + purchases − sales at the department's expected cost. Shrink = book − counted, shown as a % of the department's sales.",
      "Post count moves 1310 Merchandise inventory to the counted total against each department's cost of goods. Store managers save the count; the CFO or bookkeeper posts it.",
    ],
    tips: ['Counts post in date order and never into a locked month.', "Red shrink is over the department's threshold; it lands in the inbox."],
  },
  insideBudgets: {
    purpose: 'Monthly buying budgets per store and department, against what has been bought so far.',
    steps: ['Pick the month. Spent is purchases to date; awaiting approval is bills not yet approved.', 'Type a budget and press Save to change it.', 'A red bar is over budget and shows in the inbox.'],
    tips: ['This is purchasing control. The profit-and-loss budget arrives with Budgets & close.'],
  },
  insideRebates: {
    purpose: 'Scan-data and loyalty programs: what each manufacturer owes from units sold, against what it paid.',
    steps: ["Expected = department units sold × the manufacturer's share × the rate per unit.", 'When a period ends, Claim it: the amount goes onto the rebate in Receivables, where the deposit is applied.', 'A payment below the scan-data figure shows Short-paid; follow up with the manufacturer.'],
    tips: ['Units come from the POS department import, so import every day first.'],
  },
  insideLottery: {
    purpose: 'Each lottery week: sales, payouts, commission and settlement, and whether the register took what the lottery says it should.',
    steps: ["Enter the week from the lottery's weekly report and the register's lottery net.", 'Settlement should equal sales − payouts − commission.', 'A register short of the lottery report is a shortage. Look into it and sign it off with what you found.'],
    tips: ['Commissions tie to 4140 Lottery commissions in the ledger, month by month.'],
  },
  insideAgeChecks: {
    purpose: 'A log of tobacco and alcohol ID checks and what was done about each failure.',
    steps: ['Log every check: date, store, product, result and who ran it.', 'A failure needs a follow-up and a due date.', 'Close the follow-up when it is done.'],
    tips: ['License expiry dates live with Compliance.'],
  },
  kitchenSales: {
    purpose: 'Food sales by store and day, and what sold.',
    steps: ['Pick the month and store. Daily sales come from 4200 on the POS daily close.', 'Import the POS item report for a store and period to see the menu mix; it must add to food sales in the books.'],
  },
  kitchenFoodCost: {
    purpose: "Food cost % by store and month against each store's target.",
    steps: ['Food cost = kitchen purchases ± the change in counted kitchen inventory; it always equals 5200 in the ledger.', 'A month is measured once it has a kitchen count near its end. Until then it shows purchases only, marked *.', "Set each store's target below. Red is outside the target band and goes to the inbox."],
    tips: ['Waste % shows how much of the cost is food thrown away.'],
  },
  kitchenWaste: {
    purpose: 'What the kitchen threw away, what it cost, and how many points of food cost it is.',
    steps: ['Log each item with qty, cost and a reason.', 'Read the points of food cost and the cost % without waste.'],
    tips: ['Waste is not posted: it was already bought, so it is inside food cost.'],
  },
  kitchenPrime: {
    purpose: 'Kitchen labor and prime cost (food + kitchen labor) as a share of food sales.',
    steps: ["Pick the month. Kitchen labor is payroll's Kitchen department for pay weeks paid in the month.", 'Compare prime cost % across stores.'],
    tips: ['Put each cook in the Kitchen department on People › Employees so their pay lands here.'],
  },
  kitchenPrices: {
    purpose: 'Supplier price changes on the items the kitchen buys most.',
    steps: ["Import the supplier's invoice detail. Each invoice is matched to its purchase in the books.", 'Read the alerts: a top item whose latest price moved more than the threshold from the price before.', 'Mark an alert reviewed once you have checked it with the supplier or re-priced the menu.'],
  },
  // ── Phase 8: budgets & close ──
  budgetAnnual: {
    purpose: 'The budget for a fiscal year: every store × P&L line × month, on the accrual basis. Build it from last year\'s actuals plus growth, or start from zero, then edit the grid. One version per year is active; everything else compares against it.',
    steps: [
      'Pick the fiscal year and the version. "All stores" shows the company; pick one store to edit its lines.',
      'Type a figure in any month and leave the cell (or press Enter) to save it. Sales and costs are both entered as positive numbers.',
      'Use "Copy Jan →" to repeat the first month across the year, or "Even out" to spread the year\'s total evenly over twelve months.',
      'Add a line the store has no budget for yet with "Add a line".',
      'Build another version (a stretch plan, a zero-based draft or a copy of the active one) below, and make it active when it is agreed.',
    ],
    tips: ['The demo books start in September 2026, so "last year + growth" annualizes the complete months on file (Sep and Oct) flat across the year and says so on the version. A store that opened this month is scaled up from its days so far.', 'The tie-out checks the grid against the version\'s cells and against the rolling forecast\'s budget column.'],
  },
  budgetBva: {
    purpose: 'Budget vs actual on every P&L line: variance in dollars and percent, and a comment on every variance over the threshold. The month-end close needs those comments before it can lock.',
    steps: [
      'Pick the month (or a range), a store and the basis. Accrual is the default because the budget is built on it.',
      'Read the variance column: green helps profit, red hurts it. Click a line for the entries behind the actual.',
      'Work the list of variances over the threshold: say in a sentence why each one happened and save it.',
      'Set the threshold (a percent and a dollar floor) at the bottom.',
    ],
    tips: ['Variances are judged per store, line and month, the level the budget is set at.', 'The actual column ties to the P&L on the same basis; the budget column ties to the annual budget grid.'],
  },
  budgetForecast: {
    purpose: 'The fiscal year as it is turning out: actuals for every month that is over, actual-to-date plus the rest of the plan for this month, and the budget (or the run rate) for the months to come.',
    steps: [
      'Pick the year and a store.',
      'Switch "Months to come" between the budget and the run rate of the last three complete months.',
      'With one store picked, type over any forecast month to override it; clear it to go back to the plan.',
      'Compare the year and budget columns at the right.',
    ],
    tips: ['A year with no budget of its own uses last year\'s actuals plus the last budget\'s growth as a stand-in, and says so.'],
  },
  budgetScenarios: {
    purpose: 'What-ifs on top of the rolling forecast, side by side: fuel margin up or down so many cents a gallon, a new store opening in a given month, closing a kitchen one day a week, or a percent change to any group of lines.',
    steps: [
      'Pick the fiscal year. Saved scenarios show as columns next to the base forecast; untick one to hide it.',
      'Build a scenario: add one or more changes, watch the draft column, then save it with a name.',
      'Read each scenario\'s breakdown: what every change does to net profit and how it was figured.',
    ],
    tips: ['Fuel margin uses forecast gallons (forecast fuel sales ÷ the store\'s average price per gallon).', 'A new store copies another store\'s forecast: sales, cost of goods and card fees ramp from the opening level; fixed costs start in full.', 'Closing a kitchen removes that weekday\'s share of kitchen sales and food cost, and the same share of the kitchen\'s part of labor.', 'Changes apply only to months still to come.'],
  },
  budgetBreakEven: {
    purpose: 'How much each store has to sell to cover its fixed costs: fixed costs ÷ contribution margin %, in sales dollars, sales a day and gallons.',
    steps: ['Pick the months, and actual or budget figures.', 'Read the margin of safety: how far sales are above (or below) break-even.', 'Export the table for the owners.'],
    tips: ['Variable costs are cost of goods plus card and network fees; everything else is fixed.', 'The figures agree with the break-even on the store scorecards for the same month.'],
  },
  closeChecklist: {
    purpose: 'The one-screen month-end close: twelve steps for every store and for the company, with an owner and a due date each. Where the data can prove a step (bank reconciled, notices posted, payroll posted…), it turns done by itself and shows its evidence.',
    steps: [
      'Pick the month. The figures show how many steps are done, open and overdue.',
      'Click a status to see its evidence. "Open …" takes you to the screen that does the work; come back and the step updates.',
      'For manual steps (accruals, inventory counts) set the status, add a note and attach the support.',
      'Agree intercompany balances in step 7: each related party\'s month-end balance, once they confirm it.',
      'Lock the month in step 12 once every other step is done. The CFO can lock anyway with a reason, which is kept with the month.',
    ],
    tips: ['A step proved by the data can\'t be marked done by hand: fix the data instead, or mark it blocked with a note.', 'Change owners and due dates (business days after month end) under "Owners and due dates".', 'Inventory counts arrive with Inside store (phase 7); until then step 9 is manual.'],
  },
  closeBinder: {
    purpose: 'Everything an outside accountant or the owners need for the month, in one printable document: P&L on both bases with the bridge, balance sheet, cash flow, bank reconciliation, budget vs actual, the checklist with its evidence, schedules and an index of supporting documents.',
    steps: ['Pick the month.', 'Open the printable binder and print it to PDF, or download the HTML.', 'Download the ZIP of CSVs for the schedules.'],
    tips: ['Each section carries its tie-outs; a red one is worth fixing before sending.', 'Export downloads are written to the audit log.'],
  },
  debtDashboard: {
    purpose: 'Every loan in one place: balance, rate, payment, maturity, collateral, guarantor, prepayment penalty and covenants, with the weighted-average cost of debt and a maturity ladder.',
    steps: ['Read the figures: company debt (tied to 2300–2320), WACD before and after tax, interest to date and projected, the next maturity.', 'Open a loan for its amortization table; open the covenants for the tests.', 'Use the maturity ladder to see what comes due each year, balloons included.'],
    tips: ['Store mortgages carried by related parties are listed for information and never post.', 'Interest to date is the 6500 posted by each loan\'s payments; projected interest comes from the schedules.'],
  },
  covenants: {
    purpose: 'DSCR, leverage, minimum liquidity and fixed-charge coverage each month from the statements, with headroom and a forecast breach date.',
    steps: ['Read each covenant: limit, actual, headroom and status. Near = inside the headroom band or forecast to break within two quarters.', 'Check the monthly calculation and its tie-outs to the P&L, 6500 and the loan accounts.', 'Open the lender package to print the compliance certificate or export it to Excel.'],
    tips: ['With fewer than 12 months on the books the ratios are annualized; the note above the table says by how much, and the settings below turn it off.', 'Liquidity breaches come from the 13-week cash forecast; ratio breaches from a straight-line trend once three complete months exist.', 'EBITDA = net income + interest + depreciation; debt service = scheduled principal and interest on our loans (balloons left out).'],
  },
  lenderPackage: {
    purpose: 'The pack a lender asks for: compliance certificate, monthly ratios, debt schedule, EBITDA and the balance sheet.',
    steps: ['Pick the loan.', 'Print to PDF for the lender, or export every sheet to one Excel workbook.'],
    tips: ['Every number ties back to the statements: the tie-outs at the bottom say so.'],
  },
  refinance: {
    purpose: 'The current loan against a proposed one: payment change, interest saved, break-even months, NPV, DSCR before and after and cash freed.',
    steps: ['Pick a loan (it starts from the latest market quote) or a saved scenario.', 'Change the rate, term, amortization, fees, penalty or cash out; the results update as you type.', 'Save the scenario to come back to it. Triggers below list where refinancing may pay.'],
    tips: ['Break-even = fees + penalty ÷ the monthly saving. NPV discounts both payment streams at the cost of capital.', 'Interest saved is shown over the months both loans run, because a longer new term adds interest at the end.', 'Record market rates and property values here; the triggers read them.'],
  },
  paydown: {
    purpose: 'Pay down debt or invest? Each debt\'s after-tax cost against the after-tax return of the alternatives, ranked, with the effect on DSCR, liquidity and next-store timing.',
    steps: ['Read the ranking: highest after-tax rate first (avalanche).', 'Enter an amount to see a different deployment; it defaults to the cash above the reserve.', 'Add the alternatives you are weighing, with their expected return.'],
    tips: ['Paying down a line of credit cuts interest at once; prepaying an amortizing loan shortens its term, so the payment (and DSCR) stays the same.', 'Nothing is recommended while cash is below the reserve target.'],
  },
  reserve: {
    purpose: 'How much cash to keep: N weeks of fixed costs plus one fuel load per store plus one payroll. Anything above is deployable.',
    steps: ['Read the build-up: fixed costs from the P&L, the typical fuel load at each store, the average weekly payroll.', 'Check the month ends: two or more in a row above the target puts a line in the inbox.', 'Change the policy below if the owners want a bigger or smaller cushion.'],
    tips: ['Fixed costs leave out card fees (they move with sales), payroll (counted once on its own) and depreciation (not cash).', 'Cash counts the bank, cash on hand and supplier / card clearing by default.'],
  },
  rpLoans: {
    purpose: 'Loans to and from the related businesses: the written terms, the balance agreed each month, and a flag where the rate is below the AFR.',
    steps: ['Record each loan\'s terms: rate, repayment schedule, start and maturity, and whether a signed note is on file.', 'At each month end, record the balance the other side confirmed. A difference needs a note.', 'Read the AFR flags with the CPA: imputed interest may be income to us (or a deduction) for tax.'],
    tips: ['Balances come straight from 1910 and 2400 by party, so they tie to the party statements.'],
  },
} satisfies Record<string, { purpose: string; steps: string[]; tips?: string[] }>;

export type HelpKey = keyof typeof HELP;
