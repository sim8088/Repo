import type { Account, AccountSubtype, AccountType, LineOfBusiness } from './types';
import { SYS } from './ledger';

type Row = [number: string, id: string, name: string, type: AccountType, subtype: AccountSubtype, lob?: LineOfBusiness, system?: boolean];

/** Chart of accounts tailored to fuel & convenience retail. Fully editable in Books › Chart of accounts. */
const ROWS: Row[] = [
  // Assets
  ['1000', 'acct_trustmark', 'Trustmark operating', 'asset', 'bank'],
  ['1010', 'acct_cash_registers', 'Cash on hand – registers & safe', 'asset', 'cash'],
  ['1020', 'acct_cash_transit', 'Cash at HQ / in transit', 'asset', 'cash'],
  ['1100', 'acct_craddock', 'Craddock receivable (clearing)', 'asset', 'clearing'],
  ['1110', 'acct_dash', 'Dash Oil clearing', 'asset', 'clearing'],
  ['1120', 'acct_fiserv', 'Fiserv / AccessOne clearing', 'asset', 'clearing'],
  ['1200', 'acct_ar_tenants', 'Rent receivable – tenants', 'asset', 'receivable'],
  ['1210', 'acct_ar_rebates', 'Rebates receivable', 'asset', 'receivable'],
  ['1300', 'acct_inv_fuel', 'Fuel inventory', 'asset', 'inventory'],
  ['1310', 'acct_inv_merch', 'Merchandise inventory', 'asset', 'inventory'],
  ['1400', 'acct_prepaid', 'Prepaid expenses', 'asset', 'prepaid'],
  ['1500', 'acct_equipment', 'Equipment & dispensers', 'asset', 'fixed_asset'],
  ['1510', 'acct_buildings', 'Buildings & improvements', 'asset', 'fixed_asset'],
  ['1590', 'acct_accum_dep', 'Accumulated depreciation', 'asset', 'fixed_asset'],
  ['1900', SYS.dueFrom, 'Due from related entities', 'asset', 'intercompany', undefined, true],
  ['1910', 'acct_loans_related', 'Loans & advances to related parties', 'asset', 'intercompany'],
  ['1920', 'acct_paid_for_related', 'Due from related parties – bills paid for them', 'asset', 'intercompany'],
  // Liabilities
  ['2000', 'acct_ap', 'Accounts payable', 'liability', 'payable'],
  ['2100', 'acct_accrued_payroll', 'Accrued payroll', 'liability', 'accrued'],
  ['2110', 'acct_payroll_tax', 'Payroll taxes payable', 'liability', 'accrued'],
  ['2200', 'acct_sales_tax', 'Sales tax payable', 'liability', 'accrued'],
  ['2300', 'acct_mortgages', 'Notes payable – mortgages', 'liability', 'loan'],
  ['2310', 'acct_notes_equipment', 'Notes payable – equipment', 'liability', 'loan'],
  ['2320', 'acct_loc', 'Line of credit', 'liability', 'loan'],
  ['2400', 'acct_due_related', 'Due to related parties (Dhunna / SKD)', 'liability', 'intercompany'],
  ['2900', SYS.dueTo, 'Due to related entities', 'liability', 'intercompany', undefined, true],
  // Equity
  ['3000', 'acct_owner_capital', 'Owner capital', 'equity', 'equity'],
  ['3100', 'acct_owner_draws', 'Owner draws', 'equity', 'draws'],
  ['3900', SYS.retained, 'Retained earnings', 'equity', 'retained', undefined, true],
  // Revenue
  ['4000', 'acct_fuel_regular', 'Fuel sales – Regular', 'revenue', 'general', 'fuel'],
  ['4010', 'acct_fuel_plus', 'Fuel sales – Plus', 'revenue', 'general', 'fuel'],
  ['4020', 'acct_fuel_premium', 'Fuel sales – Premium', 'revenue', 'general', 'fuel'],
  ['4030', 'acct_fuel_diesel', 'Fuel sales – Diesel', 'revenue', 'general', 'fuel'],
  ['4100', 'acct_sales_beer', 'Beer & wine', 'revenue', 'general', 'inside'],
  ['4110', 'acct_sales_tobacco', 'Tobacco', 'revenue', 'general', 'inside'],
  ['4120', 'acct_sales_grocery', 'Grocery & snacks', 'revenue', 'general', 'inside'],
  ['4130', 'acct_sales_bev', 'Beverages', 'revenue', 'general', 'inside'],
  ['4140', 'acct_sales_lottery', 'Lottery commissions', 'revenue', 'general', 'inside'],
  ['4150', 'acct_sales_merch_other', 'Other merchandise', 'revenue', 'general', 'inside'],
  ['4200', 'acct_sales_kitchen', 'Kitchen – hot food', 'revenue', 'general', 'kitchen'],
  ['4300', 'acct_rent_income', 'Rent income', 'revenue', 'general', 'other'],
  ['4310', 'acct_atm_income', 'ATM income', 'revenue', 'general', 'other'],
  ['4320', 'acct_rebates', 'Rebates & programs', 'revenue', 'general', 'other'],
  ['4390', 'acct_other_income', 'Other income', 'revenue', 'general', 'other'],
  ['4999', SYS.uncatIncome, 'Uncategorized income', 'revenue', 'uncategorized', 'other', true],
  // Contra revenue
  ['4900', 'acct_fuel_discounts', 'Fuel discounts', 'contra_revenue', 'general', 'fuel'],
  ['4910', 'acct_mudflap', 'Mudflap discounts & true-ups', 'contra_revenue', 'general', 'fuel'],
  ['4920', 'acct_host_discounts', 'Host discounts & rewards', 'contra_revenue', 'general', 'fuel'],
  // COGS
  ['5000', 'acct_cogs_fuel', 'Fuel cost of goods', 'cogs', 'general', 'fuel'],
  ['5100', 'acct_cogs_beer', 'Purchases – Beer & wine', 'cogs', 'general', 'inside'],
  ['5110', 'acct_cogs_tobacco', 'Purchases – Tobacco', 'cogs', 'general', 'inside'],
  ['5120', 'acct_cogs_grocery', 'Purchases – Grocery & beverages', 'cogs', 'general', 'inside'],
  ['5200', 'acct_cogs_food', 'Purchases – Kitchen food', 'cogs', 'general', 'kitchen'],
  // Expenses
  ['6000', 'acct_card_fees', 'Credit card / merchant fees', 'expense', 'general'],
  ['6010', 'acct_network_fees', 'Network fees (Cybera / POS)', 'expense', 'general'],
  ['6100', 'acct_wages', 'Payroll – net pay', 'expense', 'general'],
  ['6110', 'acct_payroll_taxes', 'Payroll taxes', 'expense', 'general'],
  ['6200', 'acct_rent', 'Rent', 'expense', 'general'],
  ['6210', 'acct_utilities', 'Utilities', 'expense', 'general'],
  ['6220', 'acct_repairs', 'Repairs & maintenance', 'expense', 'general'],
  ['6230', 'acct_insurance', 'Insurance', 'expense', 'general'],
  ['6240', 'acct_property_tax', 'Property tax', 'expense', 'general'],
  ['6250', 'acct_income_taxes', 'Income & franchise taxes (entity level)', 'expense', 'general'],
  ['6300', 'acct_professional', 'Professional fees', 'expense', 'general'],
  ['6310', 'acct_bank_fees', 'Bank fees', 'expense', 'general'],
  ['6320', 'acct_supplies', 'Store supplies', 'expense', 'general'],
  ['6330', 'acct_licenses', 'Licenses & permits', 'expense', 'general'],
  ['6340', 'acct_over_short', 'Cash over / short', 'expense', 'general'],
  ['6350', 'acct_meals', 'Meals (business)', 'expense', 'general'],
  ['6360', 'acct_penalties', 'Penalties & fines', 'expense', 'general'],
  ['6400', 'acct_depreciation', 'Depreciation', 'expense', 'general'],
  ['6410', 'acct_disposal', 'Loss (gain) on asset disposals', 'expense', 'general'],
  ['6500', 'acct_interest', 'Interest expense', 'expense', 'general'],
  ['6900', 'acct_misc', 'Miscellaneous', 'expense', 'general'],
  ['6999', SYS.uncatExpense, 'Uncategorized expense', 'expense', 'uncategorized', undefined, true],
];

export function defaultChartOfAccounts(): Account[] {
  return ROWS.map(([number, id, name, type, subtype, lob, system]) => ({
    id, number, name, type, subtype, lob, active: true, system: system || undefined,
    floorCents: id === 'acct_trustmark' ? 3_000_000 : undefined,
  }));
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  contra_revenue: 'Contra revenue',
  cogs: 'Cost of goods',
  expense: 'Expense',
};

export const LOB_LABEL: Record<LineOfBusiness, string> = {
  fuel: 'Fuel',
  inside: 'Inside store',
  kitchen: 'Kitchen',
  other: 'Other',
};
