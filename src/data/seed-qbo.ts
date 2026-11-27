import type { SeedCtx } from './seed';
import type { Account, QboAccount } from '../core/types';
import { ACCOUNT_TYPE_LABEL } from '../core/coa';
import { acceptSuggestions, buildPayloads, commitPull, importQboTb, loadQboLists, parseQboTb, parseQboTransactions, portalTbCsv, pushPeriod, qboOf, saveConnection, setMapping } from '../core/qbo';
import { glOf } from '../core/journals';

/** The QBO name a CPA might use for a portal account: title case, " – " as a sub-account colon. */
function qboName(a: Account): string {
  return a.name.replace(/ – /g, ':').replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/ \/ /g, '/');
}

const NOT_IN_QBO = new Set(['acct_fuel_rni', 'acct_over_short']);

/**
 * Phase 10 QuickBooks demo, file connector: QBO lists and mappings (all but two accounts mapped),
 * September and October pushed for every entity except one HM11 accrual, a pull of QBO checks
 * that are all already in the portal, and HM11's October QBO trial balance with two differences:
 * the unpushed accrual and the unmapped cash over / short account.
 */
export function seedQbo({ state, books, cfo, setClock }: SeedCtx): void {
  setClock('2026-11-06');
  const accounts: QboAccount[] = state.accounts.filter((a) => a.active && !NOT_IN_QBO.has(a.id)).map((a) => ({ name: qboName(a), type: ACCOUNT_TYPE_LABEL[a.type] }));
  accounts.push({ name: 'Cash Over/Short', type: 'Expense' }, { name: 'Ask My Accountant', type: 'Expense' }, { name: 'Opening Balance Equity', type: 'Equity' });
  const classes = state.stores.filter((s) => !s.deleted).map((s) => `${s.code} ${s.name}`);
  const vendors = state.parties.filter((p) => !p.deleted && p.type !== 'tenant' && p.type !== 'owner').map((p) => p.name);
  const customers = state.parties.filter((p) => !p.deleted && p.type === 'tenant').map((p) => p.name.replace(' (tenant)', ''));
  loadQboLists(books, cfo, { accounts, classes, vendors, customers }, 'the demo QBO lists');
  for (const e of state.entities.filter((x) => !x.deleted)) saveConnection(books, cfo, e.id, { connector: 'file', companyName: `${e.code} books (QBO demo company)`, closedThrough: '2026-08-31' });
  acceptSuggestions(books, cfo, 'accounts');
  acceptSuggestions(books, cfo, 'classes');
  acceptSuggestions(books, cfo, 'parties');
  if (qboOf(state).mappings.accounts.acct_over_short) setMapping(books, cfo, 'accounts', 'acct_over_short', null);

  // A pull of QBO checks the bookkeeper also entered in the portal: every row is a duplicate.
  const checks = state.transactions.filter((t) => !t.deleted && t.checkNo && t.partyId && t.date >= '2026-10-01' && t.date <= '2026-10-31' && t.lines.some((l) => l.accountId === 'acct_trustmark' && l.credit > 0)).slice(0, 3);
  if (checks.length) {
    const party = (id?: string) => state.parties.find((p) => p.id === id)?.name ?? '';
    const csv = ['Date,Transaction Type,Num,Name,Memo/Description,Account,Split,Amount',
      ...checks.map((t) => {
        const amt = t.lines.filter((l) => l.accountId === 'acct_trustmark' && !l.system).reduce((a, l) => a + l.credit - l.debit, 0);
        return [`${t.date.slice(5, 7)}/${t.date.slice(8)}/${t.date.slice(0, 4)}`, 'Check', t.checkNo, `"${party(t.partyId)}"`, `"${t.description}"`, 'Trustmark Operating', '-Split-', (-amt / 100).toFixed(2)].join(',');
      })].join('\n');
    commitPull(books, cfo, 'ent_corp', { name: 'QBO checks October (demo).csv', rows: parseQboTransactions(csv).rows });
  }

  // Push September and October for every entity, except HM11's October utility accrual (still to push).
  const held = glOf(state).entries.find((j) => j.templateKey === 'accr_utilities' && j.date === '2026-10-31');
  for (const period of ['2026-09', '2026-10']) {
    setClock(period === '2026-09' ? '2026-10-06' : '2026-11-06');
    for (const e of state.entities.filter((x) => !x.deleted)) {
      const keys = buildPayloads(state, e.id, { periods: [period] }).filter((p) => p.status === 'ready' && !(held && p.jeId === held.id)).map((p) => p.key);
      if (keys.length) pushPeriod(books, cfo, e.id, period, keys);
    }
  }

  // HM11's October trial balance from QBO: what was pushed, with cash over / short under QBO's own account.
  setClock('2026-11-10');
  const unpushed = buildPayloads(state, 'ent_hm11', { periods: ['2026-09', '2026-10'] }).filter((p) => p.status !== 'pushed');
  const csv = portalTbCsv(state, 'ent_hm11', '2026-10', (m) => {
    for (const p of unpushed) for (const l of p.lines) {
      const k = qboOf(state).mappings.accounts[l.accountId] ?? `${state.accounts.find((a) => a.id === l.accountId)?.number} ${state.accounts.find((a) => a.id === l.accountId)?.name}`;
      m.set(k, (m.get(k) ?? 0) - (l.debit - l.credit));
    }
    const os = state.accounts.find((a) => a.id === 'acct_over_short')!;
    const k = `${os.number} ${os.name}`;
    if (m.has(k)) { m.set('Cash Over/Short', m.get(k)!); m.delete(k); }
  });
  importQboTb(books, cfo, { entityId: 'ent_hm11', period: '2026-10', fileName: 'HM11 Trial Balance Oct 2026 (QBO demo).csv', parsed: parseQboTb(csv) });
}
