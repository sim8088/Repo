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
    purpose: 'Profit and loss by store straight from the ledger, by line of business. The full cash / accrual P&L with bridge arrives in phase 4.',
    steps: ['Pick a month or range.', 'Click any amount to see the transactions behind it.', 'Print for a PDF, or export to CSV.'],
    tips: ['This is booked basis: fuel cost is the fuel invoices dated in the month.'],
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
} satisfies Record<string, { purpose: string; steps: string[]; tips?: string[] }>;

export type HelpKey = keyof typeof HELP;
