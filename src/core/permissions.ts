import type { Role, User, Store, ID } from './types';

export type Permission =
  | 'txn.create' | 'txn.edit' | 'txn.delete' | 'journal.create'
  | 'period.lock' | 'period.unlock'
  | 'setup.edit' | 'users.edit' | 'export' | 'approve' | 'view.all_stores' | 'view.reports'
  | 'bank.import' | 'bank.reconcile' | 'cash.count' | 'cash.handle'
  | 'payroll.edit' | 'fuel.edit' | 'fuel.post' | 'fuel.readings' | 'bills.enter' | 'bills.pay' | 'ar.edit'
  | 'inside.edit' | 'inside.log'
  | 'compliance.edit' | 'assets.edit' | 'docs.upload'
  | 'debt.edit';

const MATRIX: Record<Role, Permission[]> = {
  cfo: ['txn.create', 'txn.edit', 'txn.delete', 'journal.create', 'period.lock', 'period.unlock', 'setup.edit', 'users.edit', 'export', 'approve', 'view.all_stores', 'view.reports', 'bank.import', 'bank.reconcile', 'cash.count', 'cash.handle', 'payroll.edit', 'fuel.edit', 'fuel.post', 'fuel.readings', 'bills.enter', 'bills.pay', 'ar.edit', 'inside.edit', 'inside.log', 'compliance.edit', 'assets.edit', 'docs.upload', 'debt.edit'],
  bookkeeper: ['txn.create', 'txn.edit', 'txn.delete', 'journal.create', 'setup.edit', 'export', 'view.all_stores', 'view.reports', 'bank.import', 'bank.reconcile', 'cash.count', 'cash.handle', 'payroll.edit', 'fuel.edit', 'fuel.post', 'fuel.readings', 'bills.enter', 'bills.pay', 'ar.edit', 'inside.edit', 'inside.log', 'compliance.edit', 'assets.edit', 'docs.upload', 'debt.edit'],
  store_manager: ['txn.create', 'cash.count', 'fuel.readings', 'bills.enter', 'inside.log', 'docs.upload'],
  owner: ['approve', 'view.all_stores', 'view.reports', 'export'],
  reviewer: ['view.all_stores', 'view.reports', 'export'],
};

export const ROLE_LABEL: Record<Role, string> = {
  cfo: 'CFO / admin',
  bookkeeper: 'Bookkeeper',
  store_manager: 'Store manager',
  owner: 'Owner',
  reviewer: 'Outside accountant',
};

export const ROLE_SUMMARY: Record<Role, string> = {
  cfo: 'Everything, including locking and unlocking months and managing users.',
  bookkeeper: 'Enters and reconciles. Cannot lock or unlock a month.',
  store_manager: 'Enters for their own store only. Sees nothing else.',
  owner: 'Reads every report and signs off approvals.',
  reviewer: 'Reads and exports. Cannot change anything.',
};

export function can(user: User, p: Permission): boolean {
  return user.active && MATRIX[user.role].includes(p);
}

export function permissionsFor(role: Role): Permission[] {
  return MATRIX[role];
}

/** Row-level access: which stores this user may see. */
export function visibleStoreIds(user: User, stores: Store[]): Set<ID> {
  if (can(user, 'view.all_stores')) return new Set(stores.map((s) => s.id));
  return new Set(user.storeIds ?? []);
}

export class PermissionError extends Error {
  constructor(message: string) { super(message); this.name = 'PermissionError'; }
}
