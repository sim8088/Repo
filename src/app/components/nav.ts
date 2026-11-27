export interface NavItem { label: string; to: string; badge?: 'inbox' | 'uncat' | 'unmatched' | 'unclassified' | 'cash'; }
export interface NavGroup { title: string; items: NavItem[]; }

/** Built screens. The full information architecture, phase by phase, is on /roadmap. */
export const NAV: NavGroup[] = [
  { title: 'Today', items: [{ label: 'My day', to: '/', badge: 'inbox' }, { label: 'Approvals', to: '/approvals' }, { label: 'Ask', to: '/ask' }] },
  {
    title: 'Bank & cash',
    items: [
      { label: 'Bank feed & reconciliation', to: '/bank', badge: 'unmatched' },
      { label: 'Checks register', to: '/bank/checks' },
      { label: 'Deposits', to: '/bank/deposits', badge: 'unclassified' },
      { label: 'Cash chain', to: '/cash', badge: 'cash' },
      { label: 'Cash forecast', to: '/cash/forecast' },
    ],
  },
  {
    title: 'Fuel',
    items: [
      { label: 'Gallons & margin', to: '/fuel' },
      { label: 'Invoices & BOLs', to: '/fuel/invoices' },
      { label: 'Supplier settlement', to: '/fuel/settlement' },
      { label: 'Truck lane', to: '/fuel/truck' },
      { label: 'Tanks', to: '/fuel/tanks' },
      { label: 'Pricing & ordering', to: '/fuel/pricing' },
    ],
  },
  {
    title: 'Intercompany',
    items: [
      { label: 'Related parties', to: '/intercompany/parties' },
      { label: 'Rent pass-throughs', to: '/intercompany/rent' },
      { label: 'Owner draws', to: '/intercompany/draws' },
      { label: 'Elimination view', to: '/intercompany/eliminations' },
    ],
  },
  {
    title: 'Payables',
    items: [
      { label: 'Bills', to: '/payables/bills' },
      { label: 'Bills inbox', to: '/payables/inbox' },
      { label: 'AP aging', to: '/payables/aging' },
      { label: 'Payment calendar', to: '/payables/calendar' },
      { label: 'Utilities', to: '/payables/utilities' },
      { label: 'Vendor statements', to: '/payables/statements' },
      { label: '1099 vendors', to: '/payables/1099' },
    ],
  },
  {
    title: 'Receivables',
    items: [
      { label: 'Tenant rent', to: '/receivables/rent' },
      { label: 'Rebates & other income', to: '/receivables/other' },
    ],
  },
  { title: 'Reports', items: [{ label: 'Profit & loss by store', to: '/reports/pnl' }, { label: 'Trial balance', to: '/reports/trial-balance' }] },
  {
    title: 'People',
    items: [
      { label: 'Payroll runs', to: '/people/runs' },
      { label: 'Weekly review', to: '/people/review' },
      { label: 'Employees', to: '/people/employees' },
      { label: 'Cash & check pay', to: '/people/cash-pay' },
      { label: 'Labor %', to: '/people/labor' },
      { label: 'Payroll tax tracker', to: '/people/taxes' },
    ],
  },
  {
    title: 'Books',
    items: [
      { label: 'Transactions', to: '/books/transactions', badge: 'uncat' },
      { label: 'New entry', to: '/books/new' },
      { label: 'Chart of accounts', to: '/books/accounts' },
    ],
  },
  { title: 'Close', items: [{ label: 'Periods', to: '/close/periods' }] },
  {
    title: 'Compliance',
    items: [
      { label: 'Calendar', to: '/compliance/calendar' },
      { label: 'Licenses & permits', to: '/compliance/licenses' },
      { label: 'Insurance & leases', to: '/compliance/insurance' },
      { label: 'Notices', to: '/compliance/notices' },
      { label: 'Document vault', to: '/compliance/vault' },
    ],
  },
  {
    title: 'Assets & debt',
    items: [
      { label: 'Fixed assets', to: '/assets' },
      { label: 'Depreciation', to: '/assets/depreciation' },
      { label: 'Loans', to: '/assets/loans' },
      { label: 'Maintenance', to: '/assets/maintenance' },
      { label: 'Prepaids', to: '/assets/prepaids' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { label: 'Stores', to: '/setup/stores' },
      { label: 'Entities', to: '/setup/entities' },
      { label: 'Vendors & parties', to: '/setup/parties' },
      { label: 'Rules', to: '/setup/rules' },
      { label: 'Users & roles', to: '/setup/users' },
      { label: 'Audit log', to: '/setup/audit' },
      { label: 'Settings', to: '/setup/settings' },
    ],
  },
];
