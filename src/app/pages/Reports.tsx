import { useMemo, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Help, Money, PageHead, TieOut, csvMoney, useExport } from '../components/ui';
import { latestSalesPeriod, pnl, trialBalance, type PnlRow, type PnlSection } from '../../core/reports';
import { lastDayOfPeriod, periodLabel, periodOf, todayInChicago, shortDate } from '../../core/dates';
import { ACCOUNT_TYPE_LABEL, LOB_LABEL } from '../../core/coa';
import { can } from '../../core/permissions';
import { formatMoney } from '../../core/money';
import type { AccountType, LineOfBusiness } from '../../core/types';

export function TrialBalancePage() {
  const { state, lines, user } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
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
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`trial-balance-${ent?.code ?? 'all'}-${asOf}`, ['Number', 'Account', 'Type', 'Debit', 'Credit'], [...tb.rows.map((r) => [r.account.number, r.account.name, ACCOUNT_TYPE_LABEL[r.account.type], csvMoney(r.debit), csvMoney(r.credit)]), ['', 'Total', '', csvMoney(tb.totalDebit), csvMoney(tb.totalCredit)]])}>Export CSV</button>}
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
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

const SECTION_LABEL: Record<PnlSection, string> = { revenue: 'Sales', contra_revenue: 'Discounts', cogs: 'Cost of goods', expense: 'Operating expenses' };

export function PnlPage() {
  const { state, lines, stores, user } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const latest = useMemo(() => latestSalesPeriod(state, lines) ?? periodOf(todayInChicago()), [state, lines]);
  const fromP = sp.get('from') ?? latest;
  const toP = sp.get('to') ?? fromP;
  const storeFilter = sp.get('store') ?? '';
  const defaulted = !sp.get('from');
  const cols = stores.filter((s) => (storeFilter ? s.id === storeFilter : true));
  const r = useMemo(() => pnl(state, { from: fromP, to: toP, storeIds: cols.map((s) => s.id), lines }), [state, fromP, toP, cols.map((c) => c.id).join(), lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = cols.filter((s) => s.kind !== 'leased_out' || r.rows.some((row) => row.byStore[s.id]));
  const periods = useMemo(() => [...new Set(lines.map((f) => f.period))].sort(), [lines]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const drill = (accountId: string, storeId?: string) => `/books/transactions?account=${accountId}${storeId ? `&store=${storeId}` : ''}&from=${fromP}-01&to=${lastDayOfPeriod(toP)}`;
  const pct = (v: number, base: number) => (base ? ((v / base) * 100).toFixed(1) + '%' : '–');
  const sumCols = shown.reduce((a, s) => a + r.netIncome[s.id], 0);
  const hidden = cols.filter((s) => !shown.includes(s));
  const colsOk = sumCols + hidden.reduce((a, s) => a + r.netIncome[s.id], 0) === r.netIncome.total;
  const label = fromP === toP ? periodLabel(fromP) : `${periodLabel(fromP)} – ${periodLabel(toP)}`;

  const line = (title: string, vals: Record<string, number>, cls = 'sub', base?: Record<string, number>) => (
    <tr className={cls}>
      <td>{title}</td>
      {shown.map((s) => <td className="num" key={s.id}><Money c={vals[s.id]} />{base && <div className="muted small">{pct(vals[s.id], base[s.id])}</div>}</td>)}
      <td className="num"><Money c={vals.total} />{base && <div className="muted small">{pct(vals.total, base.total)}</div>}</td>
    </tr>
  );
  const rowsOf = (sections: PnlSection[]) => r.rows.filter((x) => sections.includes(x.section));
  const accountRow = (x: PnlRow) => (
    <tr key={x.account.id} className="indent">
      <td><Link to={`/books/accounts/${x.account.id}?from=${fromP}-01&to=${lastDayOfPeriod(toP)}`}>{x.account.name}</Link></td>
      {shown.map((s) => <td className="num" key={s.id}>{x.byStore[s.id] ? <Link className="cell-link" to={drill(x.account.id, s.id)} aria-label={`${x.account.name}, ${s.code}: ${formatMoney(x.byStore[s.id])} — see transactions`}><Money c={x.byStore[s.id]} /></Link> : <span className="muted">–</span>}</td>)}
      <td className="num"><Link className="cell-link" to={drill(x.account.id)}><Money c={x.total} /></Link></td>
    </tr>
  );

  return (
    <>
      <PageHead eyebrow="Reports · booked basis" title="Profit & loss by store" lede={<>{label}{defaulted && ' — the latest month with sales'}. Click any amount for the transactions behind it.</>}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`pnl-${fromP}-to-${toP}`, ['Account', 'Section', 'Line of business', ...shown.map((s) => s.code), 'Total'], [...r.rows.map((x) => [x.account.name, SECTION_LABEL[x.section], LOB_LABEL[x.lob], ...shown.map((s) => csvMoney(x.byStore[s.id] ?? 0)), csvMoney(x.total)]), ['Net profit', '', '', ...shown.map((s) => csvMoney(r.netIncome[s.id])), csvMoney(r.netIncome.total)]])}>Export CSV</button>}
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
      </PageHead>

      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">Net sales</div><div className="value"><Money c={r.netSales.total} whole dollar /></div></div>
        <div className="figure"><div className="label">Gross profit</div><div className="value"><Money c={r.grossProfit.total} whole dollar /></div><div className="fig-note">{pct(r.grossProfit.total, r.netSales.total)} of sales</div></div>
        <div className="figure"><div className="label">Operating expenses</div><div className="value"><Money c={r.expenses.total} whole dollar /></div><div className="fig-note">{pct(r.expenses.total, r.netSales.total)} of sales</div></div>
        <div className="figure"><div className="label">Net profit</div><div className="value"><Money c={r.netIncome.total} whole dollar signed /></div><div className="fig-note">{pct(r.netIncome.total, r.netSales.total)} of sales</div></div>
      </section>

      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="p-from">From month</label><select id="p-from" value={fromP} onChange={(e) => { const n = new URLSearchParams(sp); n.set('from', e.target.value); if (toP < e.target.value) n.set('to', e.target.value); setSp(n, { replace: true }); }}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="p-to">To month</label><select id="p-to" value={toP} onChange={(e) => { const n = new URLSearchParams(sp); n.set('from', fromP); n.set('to', e.target.value); setSp(n, { replace: true }); }}>{periods.filter((p) => p >= fromP).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="p-store">Store</label><select id="p-store" value={storeFilter} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
          <div className="actions" style={{ marginLeft: 'auto' }}><span className="muted small">Cash, accrual and the bridge between them arrive in phase 4.</span></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Line</th>{shown.map((s) => <th scope="col" className="num" key={s.id}><span title={s.name}>{s.code}</span></th>)}<th scope="col" className="num">Total</th></tr></thead>
            <tbody>
              {(['fuel', 'inside', 'kitchen', 'other'] as LineOfBusiness[]).map((lob) => {
                const rows = rowsOf(['revenue', 'contra_revenue']).filter((x) => x.lob === lob);
                if (!rows.length) return null;
                return (
                  <Fragment key={lob}>
                    <tr className="section"><td colSpan={shown.length + 2}>{LOB_LABEL[lob]} sales</td></tr>
                    {rows.map(accountRow)}
                  </Fragment>
                );
              })}
              {line('Net sales', r.netSales)}
              <tr className="section"><td colSpan={shown.length + 2}>Cost of goods</td></tr>
              {rowsOf(['cogs']).map(accountRow)}
              {line('Total cost of goods', r.cogs)}
              {line('Gross profit', r.grossProfit, 'sub', r.netSales)}
              {(['fuel', 'inside', 'kitchen'] as LineOfBusiness[]).map((lob) => r.salesByLob[lob].total ? <Fragment key={lob}>{line(`${LOB_LABEL[lob]} margin`, r.gpByLob[lob], 'indent', r.salesByLob[lob])}</Fragment> : null)}
              <tr className="section"><td colSpan={shown.length + 2}>Operating expenses</td></tr>
              {rowsOf(['expense']).map(accountRow)}
              {line('Total operating expenses', r.expenses)}
              {line('Net profit', r.netIncome, 'total', r.netSales)}
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: r.difference === 0 ? 'Ties to the ledger' : `Differs from the ledger by ${formatMoney(Math.abs(r.difference), { dollarSign: true })}`, ok: r.difference === 0, detail: 'every P&L line in range, summed independently' },
          { label: colsOk ? 'Store columns add to the total' : 'Store columns do not add up', ok: colsOk },
        ]} />
      </section>
      <Help k="pnl" />
    </>
  );
}
