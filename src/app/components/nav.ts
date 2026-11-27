export interface NavItem { label: string; to: string; badge?: 'inbox' | 'uncat' | 'unmatched' | 'unclassified' | 'cash'; }
export interface NavGroup { title: string; items: NavItem[]; }

/** Built screens. The full information architecture, phase by phase, is on /roadmap. */
export const NAV: NavGroup[] = [
  { title: 'Today', items: [{ label: 'My day', to: '/', badge: 'inbox' }] },
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
  { title: 'Reports', items: [{ label: 'Profit & loss by store', to: '/reports/pnl' }, { label: 'Trial balance', to: '/reports/trial-balance' }] },
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
