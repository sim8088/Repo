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
    purpose: 'General ledger detail for one account with a running balance.',
    steps: ['Pick the date range and, if needed, a store.', 'Click a reference to open the transaction.'],
    tips: ['The tie-out proves opening + activity = closing, and that closing matches the trial balance.'],
  },
  trialBalance: {
    purpose: 'Every account balance as of a date, by entity or for all entities together.',
    steps: ['Pick the as-of date and the entity.', 'Click an account to see its detail.', 'Export to CSV for the CPA.'],
    tips: ['Each entity balances on its own because intercompany lines are booked automatically.', 'Prior-year profit rolls into retained earnings.'],
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
    tips: ['Bills are here now. Rate changes, write-offs and adjusting entries join as their phases ship; amount limits by role come with controls.'],
  },
} satisfies Record<string, { purpose: string; steps: string[]; tips?: string[] }>;

export type HelpKey = keyof typeof HELP;
