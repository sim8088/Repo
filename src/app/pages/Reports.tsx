import { useMemo, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Help, Money, PageHead, TieOut, csvMoney } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { trialBalance } from '../../core/reports';
import { todayInChicago, shortDate } from '../../core/dates';
import { ACCOUNT_TYPE_LABEL } from '../../core/coa';
import { can } from '../../core/permissions';
import { formatMoney } from '../../core/money';
import type { AccountType } from '../../core/types';

export function TrialBalancePage() {
  const { state, lines, user } = useBooks();
  const [sp, setSp] = useSearchParams();
  const asOf = sp.get('asOf') ?? todayInChicago();
  const entityId = sp.get('entity') ?? '';
  const tb = useMemo(() => trialBalance(state, { asOf, entityId: entityId || undefined, lines }), [state, asOf, entityId, lines]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const groups = (['asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'cogs', 'expense'] as AccountType[]).map((t) => ({ t, rows: tb.rows.filter((r) => r.account.type === t) })).filter((g) => g.rows.length);
  const ent = state.entities.find((e) => e.id === entityId);
  if (!can(user, 'view.reports')) return <PageHead title="Trial balance" lede="Your role doesn't include company reports. Ask the CFO for access." />;

  return (
    <>
      <PageHead eyebrow="Reports" title="Trial balance" lede={`${ent ? ent.name : 'All entities, before eliminations'} · as of ${shortDate(asOf)} · fiscal year from ${shortDate(tb.fyStart)}`}>
        <ExportButtons name={`trial-balance-${ent?.code ?? 'all'}-${asOf}`} header={['Number', 'Account', 'Type', 'Debit', 'Credit']} rows={[...tb.rows.map((r) => [r.account.number, r.account.name, ACCOUNT_TYPE_LABEL[r.account.type], csvMoney(r.debit), csvMoney(r.credit)]), ['', 'Total', '', csvMoney(tb.totalDebit), csvMoney(tb.totalCredit)]]} sheet={`Trial balance ${asOf}`} />
      </PageHead>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="tb-asof">As of</label><input id="tb-asof" type="date" value={asOf} onChange={(e) => set('asOf', e.target.value)} /></div>
          <div className="field wide"><label htmlFor="tb-ent">Entity</label><select id="tb-ent" value={entityId} onChange={(e) => set('entity', e.target.value)}><option value="">All entities</option>{state.entities.filter((e) => !e.deleted).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Number</th><th scope="col">Account</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.t}>
                  <tr className="section"><td colSpan={4}>{ACCOUNT_TYPE_LABEL[g.t]}</td></tr>
                  {g.rows.map((r) => (
                    <tr key={r.account.id} className="indent">
                      <td>{r.account.number}</td>
                      <td><Link to={`/books/accounts/${r.account.id}?from=${tb.fyStart}&to=${asOf}`}>{r.account.name}</Link></td>
                      <td className="num">{r.debit ? <Money c={r.debit} /> : ''}</td>
                      <td className="num">{r.credit ? <Money c={r.credit} /> : ''}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="total"><td colSpan={2}>Total</td><td className="num"><Money c={tb.totalDebit} /></td><td className="num"><Money c={tb.totalCredit} /></td></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: tb.difference === 0 ? 'Debits equal credits' : `Out of balance by ${formatMoney(Math.abs(tb.difference), { dollarSign: true })}`, ok: tb.difference === 0 },
          { label: 'Net income year to date', ok: true, detail: <Money c={tb.netIncome} signed dollar /> },
        ]} />
      </section>
      <Help k="trialBalance" />
    </>
  );
}


export { PnlPage } from './Pnl';
