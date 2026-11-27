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
