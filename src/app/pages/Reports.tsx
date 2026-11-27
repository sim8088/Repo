import { useMemo, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Figure, Help, Money, PageHead, TieOut, csvMoney } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { tbColumns } from '../../core/journals';
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
  const c = useMemo(() => tbColumns(state, { asOf, entityId: entityId || undefined, lines }), [state, asOf, entityId, lines]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const groups = (['asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'cogs', 'expense'] as AccountType[]).map((t) => ({ t, rows: c.rows.filter((r) => r.account.type === t) })).filter((g) => g.rows.length);
  const ent = state.entities.find((e) => e.id === entityId);
  if (!can(user, 'view.reports')) return <PageHead title="Trial balance" lede="Your role doesn't include company reports. Ask the CFO for access." />;
  const cell = (n: number) => (n ? <Money c={n} /> : '');
  const tot = (k: keyof typeof c.totals) => c.totals[k];

  return (
    <>
      <PageHead eyebrow="Reports" title="Trial balance" lede={`${ent ? ent.name : 'All entities, before eliminations'} · as of ${shortDate(asOf)} · fiscal year from ${shortDate(c.fyStart)}. Debits positive, credits in parentheses.`}>
        <ExportButtons name={`trial-balance-${ent?.code ?? 'all'}-${asOf}`} header={['Number', 'Account', 'Type', 'Unadjusted', 'Adjusting', 'Adjusted', `Prior ${c.priorAsOf}`, 'Change', 'Adjusted debit', 'Adjusted credit']}
          rows={[...c.rows.map((r) => [r.account.number, r.account.name, ACCOUNT_TYPE_LABEL[r.account.type], csvMoney(r.unadjusted), csvMoney(r.adjusting), csvMoney(r.adjusted), csvMoney(r.prior), csvMoney(r.adjusted - r.prior), csvMoney(Math.max(r.adjusted, 0)), csvMoney(Math.max(-r.adjusted, 0))]),
            ['', 'Total debits', '', csvMoney(tot('unadjusted').debit), csvMoney(tot('adjusting').debit), csvMoney(tot('adjusted').debit), csvMoney(tot('prior').debit), '', csvMoney(tot('adjusted').debit), csvMoney(tot('adjusted').credit)]]} sheet={`Trial balance ${asOf}`} />
      </PageHead>
      <section className="figures" aria-label="Trial balance" style={{ marginBottom: 20 }}>
        <Figure label="Adjusted debits" value={<Money c={tot('adjusted').debit} whole dollar />} note={tot('adjusted').debit === tot('adjusted').credit ? 'Equal to credits' : 'Not equal to credits'} />
        <Figure label="Adjusting entries" value={c.adjustingCount} note={`Dated ${shortDate(c.from)} – ${shortDate(asOf)}`} href="/books/journals" />
        <Figure label="Net income YTD" value={<Money c={c.netIncome} whole dollar />} note={<>Prior month end <Money c={c.priorNetIncome} whole dollar /></>} />
        <Figure label="Accounts" value={c.rows.length} />
      </section>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="tb-asof">As of</label><input id="tb-asof" type="date" value={asOf} onChange={(e) => set('asOf', e.target.value)} /></div>
          <div className="field wide"><label htmlFor="tb-ent">Entity</label><select id="tb-ent" value={entityId} onChange={(e) => set('entity', e.target.value)}><option value="">All entities</option>{state.entities.filter((e) => !e.deleted).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></div>
          <Link className="btn sm" to={`/books/consolidation?asOf=${asOf}`} style={{ alignSelf: 'end' }}>Consolidated with eliminations</Link>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Number</th><th scope="col">Account</th><th scope="col" className="num">Unadjusted</th><th scope="col" className="num">Adjusting</th><th scope="col" className="num">Adjusted</th><th scope="col" className="num">Prior {shortDate(c.priorAsOf)}</th><th scope="col" className="num">Change</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.t}>
                  <tr className="section"><td colSpan={7}>{ACCOUNT_TYPE_LABEL[g.t]}</td></tr>
                  {g.rows.map((r) => (
                    <tr key={r.account.id} className="indent">
                      <td>{r.account.number}</td>
                      <td><Link to={`/books/accounts/${r.account.id}?from=${c.fyStart}&to=${asOf}${entityId ? `&entity=${entityId}` : ''}`}>{r.account.name}</Link></td>
                      <td className="num">{cell(r.unadjusted)}</td>
                      <td className="num">{cell(r.adjusting)}</td>
                      <td className="num"><b>{cell(r.adjusted)}</b></td>
                      <td className="num">{cell(r.prior)}</td>
                      <td className="num">{cell(r.adjusted - r.prior)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="total"><td colSpan={2}>Total debits</td><td className="num"><Money c={tot('unadjusted').debit} /></td><td className="num"><Money c={tot('adjusting').debit} /></td><td className="num"><Money c={tot('adjusted').debit} /></td><td className="num"><Money c={tot('prior').debit} /></td><td /></tr>
              <tr className="total"><td colSpan={2}>Total credits</td><td className="num"><Money c={-tot('unadjusted').credit} /></td><td className="num"><Money c={-tot('adjusting').credit} /></td><td className="num"><Money c={-tot('adjusted').credit} /></td><td className="num"><Money c={-tot('prior').credit} /></td><td /></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: tot('adjusted').debit === tot('adjusted').credit ? 'Debits equal credits' : `Out of balance by ${formatMoney(Math.abs(tot('adjusted').debit - tot('adjusted').credit), { dollarSign: true })}`, ok: tot('adjusted').debit === tot('adjusted').credit },
          { label: c.balanced ? 'Unadjusted, adjusting and prior columns each balance' : 'A column is out of balance', ok: c.balanced },
          { label: c.rowsTie ? 'Unadjusted + adjusting = adjusted on every account' : 'A row doesn\'t add across', ok: c.rowsTie },
          { label: 'Net income year to date', ok: true, detail: <Money c={c.netIncome} signed dollar /> },
        ]} />
      </section>
      <Help k="trialBalance" />
    </>
  );
}


export { PnlPage } from './Pnl';
