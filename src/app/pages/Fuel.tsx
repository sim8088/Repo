import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  GRADES, GRADE_LABEL, TANK_GRADES, costTable, fuelCostOfSales, fuelMargin, fuelOf, ledgerFuelRevenue, orderingPlan, pricingBoard,
  recordCompetitorPrice, recordReading, salesRows, setPostedPrice, tankBook, tankStatus,
} from '../../core/fuel';
import type { FuelGrade } from '../../core/fuelTypes';
import { addDays, lastDayOfPeriod, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import type { BooksState, ID, Store } from '../../core/types';

export const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
export const errText = (e: unknown) => errList(e).join(' ');
/** Cents per gallon, e.g. 24.3¢. */
export const cpg = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}¢`);
/** Dollars per gallon from cents per gallon, e.g. $2.719. */
export const dpg = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `$${(n / 100).toFixed(3)}`);
export const gal = (n: number) => Math.round(n).toLocaleString('en-US');

/** Stores that buy fuel and that this user may see. */
export function useFuelStores(): Store[] {
  const { stores } = useBooks();
  return stores.filter((s) => s.kind === 'operating' && s.fuelSupplier !== 'none');
}

/** The latest date with fuel data on or before today (the demo ends before today). */
export function fuelAsOf(state: BooksState, storeIds: ID[]): string {
  const today = todayInChicago();
  const ids = new Set(storeIds);
  const last = fuelOf(state).sales.filter((s) => ids.has(s.storeId) && s.date <= today).reduce((m, s) => (s.date > m ? s.date : m), '');
  return last || today;
}

function useParam(key: string, fallback: string): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  return [sp.get(key) ?? fallback, (v: string) => { const n = new URLSearchParams(sp); if (v && v !== fallback) n.set(key, v); else n.delete(key); setSp(n, { replace: true }); }];
}

// ── Gallons & margin ─────────────────────────────────────────────────────
export function FuelMarginPage() {
  const { state, user, version } = useBooks();
  const exportCsv = useExport();
  const fuelStores = useFuelStores();
  const allIds = fuelStores.map((s) => s.id);
  const asOf = fuelAsOf(state, allIds);
  const months = useMemo(() => [...new Set(salesRows(state, { storeIds: allIds }).map((r) => r.date.slice(0, 7)))].sort().reverse(), [state, version, allIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [month, setMonth] = useParam('month', asOf.slice(0, 7));
  const [storeSel, setStore] = useParam('store', '');
  const [view, setView] = useParam('view', 'store');
  const ids = storeSel ? [storeSel] : allIds;
  const from = `${month}-01`;
  const to = lastDayOfPeriod(month) < asOf ? lastDayOfPeriod(month) : asOf;
  const tg = fuelOf(state).targets;
  const m = useMemo(() => fuelMargin(state, { storeIds: ids, from, to, by: view === 'day' ? 'day' : 'month' }), [state, version, ids.join(), from, to, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => (view === 'trend' ? fuelMargin(state, { storeIds: ids, from: `${months.at(-1) ?? month}-01`, to: asOf, by: 'month' }) : null), [state, version, view, ids.join(), months, month, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const sum = (xs: { gallons: number; retail: number; cogs: number }[]) => xs.reduce((a, x) => ({ gallons: a.gallons + x.gallons, retail: a.retail + x.retail, cogs: a.cogs + x.cogs }), { gallons: 0, retail: 0, cogs: 0 });
  const tot = sum(m.stores);
  const disc = m.stores.reduce((a, s) => a + s.discounts, 0);
  const fees = m.stores.reduce((a, s) => a + s.cardFees, 0);
  const truck = m.stores.reduce((a, s) => a + s.truckGallons, 0);
  const per = (v: number) => (tot.gallons ? v / tot.gallons : 0);
  const ledger = ledgerFuelRevenue(state, ids, from, to);
  const rowsSum = sum(m.rows);
  const accrual = view === 'day' ? null : ids.reduce((a, s) => a + fuelCostOfSales(state, s, month, costTable(state)).cogs, 0);
  const fullMonth = to === lastDayOfPeriod(month);
  const band = (c: number) => (c < tg.cpgMin ? <span className="pill bad">Below {tg.cpgMin}¢</span> : c > tg.cpgMax ? <span className="pill warn">Above {tg.cpgMax}¢</span> : <span className="pill ok">In target</span>);

  const byDay = useMemo(() => {
    if (view !== 'day') return [];
    const d = new Map<string, { gallons: number; retail: number; cogs: number }>();
    for (const r of m.rows) { const x = d.get(r.bucket) ?? { gallons: 0, retail: 0, cogs: 0 }; x.gallons += r.gallons; x.retail += r.retail; x.cogs += r.cogs; d.set(r.bucket, x); }
    return [...d].sort((a, b) => b[0].localeCompare(a[0]));
  }, [m, view]);
  const byMonth = useMemo(() => {
    if (!trend) return [];
    const d = new Map<string, { gallons: number; retail: number; cogs: number }>();
    for (const r of trend.rows) { const x = d.get(r.bucket) ?? { gallons: 0, retail: 0, cogs: 0 }; x.gallons += r.gallons; x.retail += r.retail; x.cogs += r.cogs; d.set(r.bucket, x); }
    return [...d].sort((a, b) => b[0].localeCompare(a[0]));
  }, [trend]);

  const doExport = () => {
    if (view === 'day') exportCsv(`fuel-by-day-${month}`, ['Date', 'Gallons', 'Retail', 'COGS (accrual)', 'Margin', 'Margin cpg'], byDay.map(([d, x]) => [d, Math.round(x.gallons), csvMoney(x.retail), csvMoney(x.cogs), csvMoney(x.retail - x.cogs), x.gallons ? ((x.retail - x.cogs) / x.gallons).toFixed(2) : '']));
    else exportCsv(`fuel-margin-${month}`, ['Store', 'Grade', 'Gallons', 'Retail', 'Retail per gal', 'Cost per gal', 'COGS (accrual)', 'Margin', 'Margin cpg'], m.rows.map((r) => [code(r.storeId), GRADE_LABEL[r.grade], r.gallons, csvMoney(r.retail), (r.retailCpg / 100).toFixed(3), r.costCpg === null ? '' : (r.costCpg / 100).toFixed(3), csvMoney(r.cogs), csvMoney(r.margin), r.marginCpg.toFixed(2)]));
  };

  return (
    <>
      <PageHead eyebrow="Fuel" title="Gallons & margin" lede={<>Gallons, retail and margin per gallon by store and grade. Cost is each month's delivered cost from the invoices (Plus blended 50/50). Data through <b>{shortDate(asOf)}</b>.</>}>
        {can(user, 'export') && <button className="btn" onClick={doExport}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Fuel this month" style={{ marginBottom: 20 }}>
        <Figure label={`Gallons · ${periodLabel(month)}`} value={gal(tot.gallons)} note={truck ? `Includes ${gal(truck)} truck-lane gallons (Comdata)` : `${fullMonth ? 'Full month' : 'Month to date'}`} />
        <Figure label="Fuel margin" value={<Money c={tot.retail - tot.cogs} whole dollar />} note={<>{cpg(per(tot.retail - tot.cogs))} a gallon · target {tg.cpgMin}–{tg.cpgMax}¢</>} />
        <Figure label="Discounts per gallon" value={cpg(per(disc), 2)} note={<>Host, Mudflap and fuel discounts <Money c={disc} whole dollar /></>} />
        <Figure label="Card fees per gallon" value={cpg(per(fees), 2)} note={<>Card and network fees <Money c={fees} whole dollar /></>} />
        <Figure label="Break-even cpg" value={cpg(per(disc + fees), 2)} note={<>Net {cpg(per(tot.retail - tot.cogs - disc - fees))} after discounts and fees</>} />
      </section>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="fm-month">Month</label><select id="fm-month" value={month} onChange={(e) => setMonth(e.target.value)}>{(months.length ? months : [month]).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="fm-store">Store</label><select id="fm-store" value={storeSel} onChange={(e) => setStore(e.target.value)}><option value="">All fuel stores</option>{fuelStores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
          <div className="seg" role="group" aria-label="View" style={{ marginBottom: 2 }}>
            {[['store', 'By store & grade'], ['day', 'By day'], ['trend', 'By month']].map(([k, l]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
          </div>
        </div>
        {view === 'store' && (
          <>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Store</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Retail / gal</th><th scope="col" className="num">Cost / gal</th><th scope="col" className="num">Margin cpg</th><th scope="col" className="num">Margin</th><th scope="col" className="num">Discounts / gal</th><th scope="col" className="num">Card fee / gal</th><th scope="col" className="num">Break-even</th><th scope="col" className="num">Net cpg</th><th scope="col">Target</th></tr></thead>
              <tbody>
                {m.stores.length === 0 && <tr><td colSpan={11} className="muted">No fuel sales in {periodLabel(month)}.</td></tr>}
                {m.stores.map((s) => (
                  <tr key={s.storeId}>
                    <td><b>{code(s.storeId)}</b>{s.truckGallons > 0 && <div className="muted small">incl. truck lane</div>}</td>
                    <td className="num">{gal(s.gallons)}</td><td className="num">{dpg(s.retail / s.gallons)}</td><td className="num">{dpg(s.cogs / s.gallons)}</td>
                    <td className="num"><b>{cpg(s.marginCpg)}</b></td><td className="num"><Money c={s.margin} whole /></td>
                    <td className="num">{cpg(s.discountsCpg, 2)}</td><td className="num">{cpg(s.cardFeeCpg, 2)}</td><td className="num">{cpg(s.breakEvenCpg, 2)}</td><td className="num">{cpg(s.netCpg)}</td>
                    <td>{band(s.marginCpg)}</td>
                  </tr>
                ))}
                {m.stores.length > 1 && <tr className="total"><td>All stores</td><td className="num">{gal(tot.gallons)}</td><td className="num">{dpg(per(tot.retail))}</td><td className="num">{dpg(per(tot.cogs))}</td><td className="num">{cpg(per(tot.retail - tot.cogs))}</td><td className="num"><Money c={tot.retail - tot.cogs} whole /></td><td className="num">{cpg(per(disc), 2)}</td><td className="num">{cpg(per(fees), 2)}</td><td className="num">{cpg(per(disc + fees), 2)}</td><td className="num">{cpg(per(tot.retail - tot.cogs - disc - fees))}</td><td /></tr>}
              </tbody>
            </table></div>
            <div className="panel-head" style={{ borderTop: '1px solid var(--rule)' }}><h2>By grade</h2><span className="muted small">{periodLabel(month)}{fuelOf(state).invoices.some((i) => i.batchId === 'stationbooks') && ' · costs per grade are approximate: StationBooks keeps one blended cost per load, so store totals are exact but grade margins are not'}</span></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Store</th><th scope="col">Grade</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Retail</th><th scope="col" className="num">Retail / gal</th><th scope="col" className="num">Delivered cost / gal</th><th scope="col" className="num">COGS (accrual)</th><th scope="col" className="num">Margin cpg</th></tr></thead>
              <tbody>{m.rows.map((r) => (
                <tr key={r.storeId + r.grade}><td>{code(r.storeId)}</td><td>{GRADE_LABEL[r.grade]}{r.grade === 'plus' && <span className="muted small"> · blended</span>}</td><td className="num">{gal(r.gallons)}</td><td className="num"><Money c={r.retail} /></td><td className="num">{dpg(r.retailCpg)}</td><td className="num">{dpg(r.costCpg)}</td><td className="num"><Money c={r.cogs} /></td><td className="num">{cpg(r.marginCpg)}</td></tr>
              ))}</tbody>
            </table></div>
          </>
        )}
        {view === 'day' && (
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Day</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Retail</th><th scope="col" className="num">Retail / gal</th><th scope="col" className="num">COGS (accrual)</th><th scope="col" className="num">Margin</th><th scope="col" className="num">Margin cpg</th></tr></thead>
            <tbody>{byDay.map(([d, x]) => (
              <tr key={d}><td>{shortDate(d)}</td><td className="num">{gal(x.gallons)}</td><td className="num"><Money c={x.retail} /></td><td className="num">{dpg(x.gallons ? x.retail / x.gallons : null)}</td><td className="num"><Money c={x.cogs} /></td><td className="num"><Money c={x.retail - x.cogs} /></td><td className="num">{cpg(x.gallons ? (x.retail - x.cogs) / x.gallons : null)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {view === 'trend' && (
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Retail</th><th scope="col" className="num">Retail / gal</th><th scope="col" className="num">Cost / gal</th><th scope="col" className="num">COGS (accrual)</th><th scope="col" className="num">Margin cpg</th></tr></thead>
            <tbody>{byMonth.map(([p, x]) => (
              <tr key={p}><td>{periodLabel(p)}</td><td className="num">{gal(x.gallons)}</td><td className="num"><Money c={x.retail} /></td><td className="num">{dpg(x.gallons ? x.retail / x.gallons : null)}</td><td className="num">{dpg(x.gallons ? x.cogs / x.gallons : null)}</td><td className="num"><Money c={x.cogs} /></td><td className="num">{cpg(x.gallons ? (x.retail - x.cogs) / x.gallons : null)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <TieOut items={[
          { label: ledger === rowsSum.retail ? 'Fuel sales tie to fuel revenue in the ledger' : 'Fuel sales do not tie to the ledger', ok: ledger === rowsSum.retail, detail: <>structured sales <Money c={rowsSum.retail} dollar /> · accounts 4000–4030 <Money c={ledger} dollar />{ledger !== rowsSum.retail && <> · off by <Money c={rowsSum.retail - ledger} dollar /></>}</> },
          { label: 'Rows add to the store totals', ok: rowsSum.cogs === tot.cogs && rowsSum.retail === tot.retail, detail: <>margin <Money c={rowsSum.retail - rowsSum.cogs} dollar /></> },
          ...(accrual !== null && view === 'store' ? [{ label: accrual === rowsSum.cogs ? 'Accrual fuel COGS for phase 4 ties' : 'Accrual fuel COGS differs', ok: accrual === rowsSum.cogs, detail: <>fuelCostOfSales <Money c={accrual} dollar /></> }] : []),
        ]} />
      </section>
      <Help k="fuelMargin" />
    </>
  );
}

// ── Tanks ────────────────────────────────────────────────────────────────
export function TanksPage() {
  const { state, books, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const fuelStores = useFuelStores();
  const f = fuelOf(state);
  const tanks = f.tanks.filter((t) => t.active && visible.has(t.storeId));
  const lastReading = f.readings.filter((r) => tanks.some((t) => t.id === r.tankId)).reduce((m, r) => (r.date > m && r.date <= todayInChicago() ? r.date : m), '');
  const [asOf, setAsOf] = useParam('asof', lastReading || todayInChicago());
  const [tankId, setTankId] = useParam('tank', '');
  const status = useMemo(() => tanks.map((t) => tankStatus(state, t.id, asOf)!), [state, version, asOf, tanks.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const varN = status.filter((s) => s.varianceFlag).length;
  const waterN = status.filter((s) => s.waterFlag).length;
  const reorder = status.filter((s) => s.reorder);
  const low = status.filter((s) => s.daysOfSupply !== null).sort((a, b) => a.daysOfSupply! - b.daysOfSupply!)[0];
  const onHand = status.reduce((a, s) => a + s.gallons, 0);
  const sel = tankId ? tanks.find((t) => t.id === tankId) : undefined;
  const detail = useMemo(() => (sel ? tankBook(state, sel.id, addDays(asOf, -29), asOf) : []), [state, version, sel, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState({ tankId: tanks[0]?.id ?? '', date: asOf, gallons: '', water: '0', method: 'stick' as 'stick' | 'atg' });
  const [errors, setErrors] = useState<string[]>([]);

  const rowsWithReading = detail.filter((d) => d.physical !== null && d.variance !== null);
  const first = detail.find((d) => d.physical !== null);
  const lastD = [...detail].reverse().find((d) => d.physical !== null);
  const startIdx = first ? detail.indexOf(first) : -1;
  const later = detail.slice(startIdx + 1);
  const varSum = Math.round(rowsWithReading.reduce((a, d) => a + d.variance!, 0) * 1000) / 1000;
  const independent = first && lastD ? Math.round((lastD.physical! - (first.physical! + later.reduce((a, d) => a + d.deliveries - d.sales, 0))) * 1000) / 1000 : 0;
  const rowsTie = detail.every((d) => Math.abs(d.opening + d.deliveries - d.sales - d.book) < 0.01);

  return (
    <>
      <PageHead eyebrow="Fuel" title="Tanks" lede={<>Book-to-physical by tank, water and days of supply, from the end-of-day stick or ATG readings. As of <b>{shortDate(asOf)}</b>.</>}>
        <div className="field" style={{ width: 170 }}><label htmlFor="tk-asof">As of</label><input id="tk-asof" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></div>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`tanks-${asOf}`, ['Store', 'Tank', 'Grade', 'Capacity', 'Gallons', 'Fill %', 'Days of supply', '30-day variance', 'Allowance', 'Water (in)', 'Reading date'], status.map((s) => [code(s.tank.storeId), s.tank.label, GRADE_LABEL[s.tank.grade], s.tank.capacity, s.gallons, s.fillPct.toFixed(0), s.daysOfSupply?.toFixed(1) ?? '', s.variance30, s.threshold, s.lastReading?.waterInches ?? '', s.lastReading?.date ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Tank alerts" style={{ marginBottom: 20 }}>
        <Figure label="Variance over allowance" value={varN} note={`30 days, ${f.targets.variancePct}% of gallons sold + ${f.targets.varianceAllowanceGal} gal`} />
        <Figure label="Water alerts" value={waterN} note={`Over ${f.targets.waterInches} inch`} />
        <Figure label="Tanks to reorder" value={reorder.length} note={reorder.length ? reorder.map((s) => `${code(s.tank.storeId)} ${s.tank.label}`).join(', ') : `Every tank has over ${f.targets.reorderDays} days`} />
        <Figure label="Lowest days of supply" value={low ? low.daysOfSupply!.toFixed(1) : '—'} note={low ? `${code(low.tank.storeId)} ${low.tank.label} ${GRADE_LABEL[low.tank.grade]}` : undefined} />
        <Figure label="Gallons on hand" value={gal(onHand)} note={`${tanks.length} tanks at ${fuelStores.length} stores`} />
      </section>
      <section className="panel" aria-labelledby="tk-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="tk-h">Every tank</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Tank</th><th scope="col">Grade</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Fill</th><th scope="col" className="num">Days of supply</th><th scope="col" className="num">30-day variance</th><th scope="col">Book-to-physical</th><th scope="col">Water</th><th scope="col">Last reading</th></tr></thead>
          <tbody>{status.map((s) => (
            <tr key={s.tank.id}>
              <td><button className="btn sm ghost" onClick={() => setTankId(s.tank.id)} aria-pressed={tankId === s.tank.id}>{code(s.tank.storeId)} {s.tank.label}</button></td>
              <td>{GRADE_LABEL[s.tank.grade]}</td>
              <td className="num">{gal(s.gallons)} <span className="muted small">of {gal(s.tank.capacity)}</span></td>
              <td className="num">{s.fillPct.toFixed(0)}%</td>
              <td className="num">{s.daysOfSupply === null ? '—' : s.daysOfSupply.toFixed(1)}{s.reorder && <> <span className="pill warn">Reorder</span></>}</td>
              <td className="num">{gal(s.variance30)} gal</td>
              <td>{s.varianceFlag ? <span className="pill bad">Over allowance ({gal(s.threshold)})</span> : <span className="pill ok">Within {gal(s.threshold)}</span>}</td>
              <td>{s.waterFlag ? <span className="pill bad">{s.lastReading?.waterInches}" water</span> : <span className="muted small">{s.lastReading?.waterInches ?? 0}"</span>}</td>
              <td>{s.lastReading ? <>{shortDate(s.lastReading.date)} <span className="muted small">{s.lastReading.method === 'atg' ? 'ATG' : 'stick'}</span></> : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[(() => { const missing = status.filter((s) => s.lastReading?.date !== asOf); return { label: missing.length ? `${missing.length} tank${missing.length === 1 ? ' has' : 's have'} no reading for ${shortDate(asOf)}` : `Every tank has a reading for ${shortDate(asOf)}`, ok: !missing.length, detail: missing.length ? missing.map((s) => `${code(s.tank.storeId)} ${s.tank.label}`).join(', ') : `${gal(onHand)} gal on hand` }; })()]} />
      </section>

      {sel && (
        <section className="panel" aria-labelledby="tb-h" style={{ marginBottom: 20 }}>
          <div className="panel-head"><h2 id="tb-h">{code(sel.storeId)} {sel.label} · {GRADE_LABEL[sel.grade]} · last 30 days</h2>
            <div className="actions">
              {can(user, 'export') && <button className="btn sm" onClick={() => exportCsv(`tank-${code(sel.storeId)}-${sel.label}-${asOf}`, ['Date', 'Opening', 'Deliveries', 'Sales', 'Book', 'Physical', 'Variance', 'Water'], detail.map((d) => [d.date, d.opening, d.deliveries, d.sales, d.book, d.physical ?? '', d.variance ?? '', d.water ?? '']))}>Export CSV</button>}
              <button className="btn sm ghost" onClick={() => setTankId('')}>Close</button>
            </div>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Day</th><th scope="col" className="num">Opening</th><th scope="col" className="num">+ Deliveries</th><th scope="col" className="num">− Sales</th><th scope="col" className="num">= Book</th><th scope="col" className="num">Physical</th><th scope="col" className="num">Variance</th><th scope="col" className="num">Water</th></tr></thead>
            <tbody>{[...detail].reverse().map((d) => (
              <tr key={d.date}><td>{shortDate(d.date)}</td><td className="num">{gal(d.opening)}</td><td className="num">{d.deliveries ? gal(d.deliveries) : ''}</td><td className="num">{gal(d.sales)}</td><td className="num">{gal(d.book)}</td><td className="num">{d.physical === null ? '—' : gal(d.physical)}</td>
                <td className={'num ' + (d.variance !== null && Math.abs(d.variance) >= 15 ? 'neg' : '')}>{d.variance === null ? '—' : gal(d.variance)}</td><td className="num">{d.water ?? '—'}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: 'Opening + deliveries − sales = book on every day', ok: rowsTie },
            { label: Math.abs(varSum - independent) < 0.01 ? 'Daily variances add to the period\'s book-to-physical' : 'Daily variances do not add up', ok: Math.abs(varSum - independent) < 0.01, detail: `${gal(varSum)} gal = last reading − (first reading + deliveries − sales)` },
          ]} />
        </section>
      )}

      {can(user, 'fuel.readings') && tanks.length > 0 && (
        <section className="panel panel-pad" aria-labelledby="rd-h">
          <h2 id="rd-h" style={{ marginBottom: 12 }}>Record a reading</h2>
          <Errors errors={errors} />
          <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
            <div className="field"><label htmlFor="rd-tank">Tank</label><select id="rd-tank" value={form.tankId} onChange={(e) => setForm({ ...form, tankId: e.target.value })}>{tanks.map((t) => <option key={t.id} value={t.id}>{code(t.storeId)} {t.label} · {GRADE_LABEL[t.grade]}</option>)}</select></div>
            <div className="field"><label htmlFor="rd-date">Date</label><input id="rd-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="rd-gal">Gallons</label><input id="rd-gal" className="num" inputMode="decimal" value={form.gallons} onChange={(e) => setForm({ ...form, gallons: e.target.value })} /></div>
            <div className="field"><label htmlFor="rd-water">Water (inches)</label><input id="rd-water" className="num" inputMode="decimal" value={form.water} onChange={(e) => setForm({ ...form, water: e.target.value })} /></div>
            <div className="field"><label htmlFor="rd-method">Method</label><select id="rd-method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as 'stick' | 'atg' })}><option value="stick">Stick</option><option value="atg">ATG</option></select></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => {
              try { recordReading(books, user, { tankId: form.tankId, date: form.date, gallons: Number(form.gallons.replace(/,/g, '')), waterInches: Number(form.water || 0), method: form.method }); setErrors([]); setForm({ ...form, gallons: '' }); say('Reading saved.'); }
              catch (e) { setErrors(errList(e)); }
            }}>Save reading</button>
            <span className="muted small">A reading for the same tank and day replaces the earlier one; both stay in the audit log.</span>
          </div>
        </section>
      )}
      {toast}
      <Help k="fuelTanks" />
    </>
  );
}

// ── Pricing & ordering ───────────────────────────────────────────────────
export function PricingPage() {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const fuelStores = useFuelStores();
  const [storeId, setStoreId] = useParam('store', fuelStores[0]?.id ?? '');
  const asOf = fuelAsOf(state, fuelStores.map((s) => s.id));
  const board = useMemo(() => (storeId ? pricingBoard(state, storeId, asOf) : []), [state, version, storeId, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const plans = useMemo(() => fuelStores.map((s) => orderingPlan(state, s.id, asOf)), [state, version, asOf, fuelStores.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = fuelOf(state);
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const reg = board.find((r) => r.grade === 'regular');
  const impact = board.reduce((a, r) => a + (r.matchImpact ?? 0), 0);
  const history = f.prices.filter((p) => p.storeId === storeId).sort((a, b) => b.effective.localeCompare(a.effective) || GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
  const comps = f.competitors.filter((c) => c.storeId === storeId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 24);
  const [cp, setCp] = useState({ competitor: '', grade: 'regular' as FuelGrade, date: asOf, price: '' });
  const [pp, setPp] = useState({ grade: 'regular' as FuelGrade, effective: asOf, price: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const toCpg = (s: string) => { const n = Number(s.replace(/[$,\s]/g, '')); return n > 0 && n < 20 ? n * 100 : n; };
  const planOk = plans.every((p) => p.total <= f.targets.loadGallons && p.byTank.every((t) => t.gallons >= 0 && t.gallons % 100 === 0));

  return (
    <>
      <PageHead eyebrow="Fuel" title="Pricing & ordering" lede={<>Our posted prices against nearby competitors, the margin effect of matching, and when each store needs its next load. As of <b>{shortDate(asOf)}</b>.</>}>
        <div className="field" style={{ width: 200 }}><label htmlFor="pr-store">Store</label><select id="pr-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{fuelStores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`pricing-${code(storeId)}-${asOf}`, ['Grade', 'Our price', 'Lowest competitor', 'Spread cpg', 'Cost per gal', 'Margin cpg', 'Week gallons', 'Weekly impact of matching'], board.map((r) => [GRADE_LABEL[r.grade], r.ours === null ? '' : (r.ours / 100).toFixed(3), r.lowest === null ? '' : (r.lowest / 100).toFixed(3), r.spread?.toFixed(1) ?? '', r.costCpg === null ? '' : (r.costCpg / 100).toFixed(3), r.marginCpg?.toFixed(1) ?? '', Math.round(r.weekGallons), r.matchImpact === null ? '' : csvMoney(r.matchImpact)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Pricing" style={{ marginBottom: 20 }}>
        <Figure label="Our Regular" value={dpg(reg?.ours)} note={`${code(storeId)} posted price`} />
        <Figure label="Lowest nearby" value={dpg(reg?.lowest)} note={reg?.competitors.length ? `${reg.competitors.length} competitors seen this week` : 'No sightings this week'} />
        <Figure label="Spread" value={reg?.spread === null || reg?.spread === undefined ? '—' : `${reg.spread > 0 ? '+' : ''}${reg.spread.toFixed(1)}¢`} note="Ours minus the lowest, Regular" />
        <Figure label="Regular margin" value={cpg(reg?.marginCpg)} note={`Cost ${dpg(reg?.costCpg)} this month`} />
        <Figure label="Matching all grades" value={<Money c={impact} whole dollar />} note="A week's margin at the lowest prices, same gallons" />
      </section>
      <section className="panel" aria-labelledby="pb-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="pb-h">Price board · {code(storeId)}</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Grade</th><th scope="col" className="num">Ours</th><th scope="col">Competitors (last 7 days)</th><th scope="col" className="num">Spread</th><th scope="col" className="num">Cost / gal</th><th scope="col" className="num">Margin cpg</th><th scope="col" className="num">Gallons, 7 days</th><th scope="col" className="num">If we match</th></tr></thead>
          <tbody>{board.map((r) => (
            <tr key={r.grade}><td>{GRADE_LABEL[r.grade]}</td><td className="num"><b>{dpg(r.ours)}</b></td>
              <td>{r.competitors.length ? r.competitors.map((c) => <div key={c.name} className="small">{c.name}: {dpg(c.cpg)} <span className="muted">{shortDate(c.date)}</span></div>) : <span className="muted small">None logged</span>}</td>
              <td className={'num ' + ((r.spread ?? 0) > 0 ? 'neg' : '')}>{r.spread === null ? '—' : `${r.spread > 0 ? '+' : ''}${r.spread.toFixed(1)}¢`}</td><td className="num">{dpg(r.costCpg)}</td><td className="num">{cpg(r.marginCpg)}</td><td className="num">{gal(r.weekGallons)}</td>
              <td className="num">{r.matchImpact === null ? '—' : <Money c={r.matchImpact} signed />}</td></tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[{ label: 'Margin = our price − delivered cost on every grade', ok: board.every((r) => r.marginCpg === null || r.ours === null || r.costCpg === null || Math.abs(r.ours - r.costCpg - r.marginCpg) < 1e-6) }, { label: 'Grade impacts add to the total', ok: board.reduce((a, r) => a + (r.matchImpact ?? 0), 0) === impact, detail: <Money c={impact} dollar /> }]} />
      </section>

      <section className="panel" aria-labelledby="op-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="op-h">Ordering plan</h2><span className="muted small">One transport is {gal(f.targets.loadGallons)} gal; tanks fill to {f.targets.safeFillPct}%</span>
          {can(user, 'export') && <button className="btn sm" onClick={() => exportCsv(`ordering-plan-${asOf}`, ['Store', 'Deliver on', 'Grade', 'Gallons', 'Days of supply at delivery', 'Reason'], plans.flatMap((p) => p.byTank.map((t) => [code(p.storeId), p.deliverOn ?? '', GRADE_LABEL[t.grade], t.gallons, t.daysOfSupplyAtDelivery?.toFixed(1) ?? '', p.reason])))}>Export CSV</button>}</div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col">Next load</th>{TANK_GRADES.map((g) => <th key={g} scope="col" className="num">{GRADE_LABEL[g]}</th>)}<th scope="col" className="num">Total</th><th scope="col">Why</th></tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.storeId}><td><b>{code(p.storeId)}</b></td><td>{p.deliverOn ? <>{shortDate(p.deliverOn)}{p.deliverOn <= asOf && <> <span className="pill warn">Order now</span></>}</> : '—'}</td>
              {TANK_GRADES.map((g) => { const t = p.byTank.find((x) => x.grade === g); return <td key={g} className="num">{t ? <>{gal(t.gallons)}<div className="muted small">{t.daysOfSupplyAtDelivery === null ? '' : `${t.daysOfSupplyAtDelivery.toFixed(1)} days left`}</div></> : '—'}</td>; })}
              <td className="num">{gal(p.total)}</td><td className="small">{p.reason}</td></tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[{ label: planOk ? 'Every load fits one transport in 100-gallon compartments' : 'A load is over one transport', ok: planOk, detail: `${gal(plans.reduce((a, p) => a + p.total, 0))} gal planned across ${plans.filter((p) => p.total).length} stores` }]} />
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="ph-h">
          <div className="panel-head"><h2 id="ph-h">Our posted prices</h2></div>
          <div className="table-wrap" data-static="1" tabIndex={0} role="region" aria-label="Our posted prices, scrolls" style={{ maxHeight: 360 }}><table className="t">
            <thead><tr><th scope="col">From</th><th scope="col">Grade</th><th scope="col" className="num">Price</th></tr></thead>
            <tbody>{history.map((p) => <tr key={p.id}><td>{shortDate(p.effective)}</td><td>{GRADE_LABEL[p.grade]}</td><td className="num">{dpg(p.cpg)}</td></tr>)}</tbody>
          </table></div>
          {can(user, 'fuel.edit') && (
            <div className="panel-pad">
              <div className="form-grid">
                <div className="field"><label htmlFor="pp-grade">Grade</label><select id="pp-grade" value={pp.grade} onChange={(e) => setPp({ ...pp, grade: e.target.value as FuelGrade })}>{GRADES.map((g) => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}</select></div>
                <div className="field"><label htmlFor="pp-date">Effective</label><input id="pp-date" type="date" value={pp.effective} onChange={(e) => setPp({ ...pp, effective: e.target.value })} /></div>
                <div className="field"><label htmlFor="pp-price">Price per gallon</label><input id="pp-price" className="num" inputMode="decimal" placeholder="2.749" value={pp.price} onChange={(e) => setPp({ ...pp, price: e.target.value })} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { try { setPostedPrice(books, user, { storeId, grade: pp.grade, effective: pp.effective, cpg: toCpg(pp.price) }); setPp({ ...pp, price: '' }); setErrors([]); say('Posted price saved.'); } catch (e) { setErrors(errList(e)); } }}>Save posted price</button></div>
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="cl-h">
          <div className="panel-head"><h2 id="cl-h">Competitor log</h2></div>
          <div className="table-wrap" data-static="1" tabIndex={0} role="region" aria-label="Competitor log, scrolls" style={{ maxHeight: 360 }}><table className="t">
            <thead><tr><th scope="col">Seen</th><th scope="col">Competitor</th><th scope="col">Grade</th><th scope="col" className="num">Price</th></tr></thead>
            <tbody>{comps.map((c) => <tr key={c.id}><td>{shortDate(c.date)}</td><td className="trunc" title={c.competitor}>{c.competitor}</td><td>{GRADE_LABEL[c.grade]}</td><td className="num">{dpg(c.cpg)}</td></tr>)}</tbody>
          </table></div>
          {can(user, 'fuel.readings') && (
            <div className="panel-pad">
              <div className="form-grid">
                <div className="field"><label htmlFor="cp-name">Competitor</label><input id="cp-name" value={cp.competitor} placeholder="Station A – north frontage road" onChange={(e) => setCp({ ...cp, competitor: e.target.value })} /></div>
                <div className="field"><label htmlFor="cp-grade">Grade</label><select id="cp-grade" value={cp.grade} onChange={(e) => setCp({ ...cp, grade: e.target.value as FuelGrade })}>{GRADES.map((g) => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}</select></div>
                <div className="field"><label htmlFor="cp-date">Seen on</label><input id="cp-date" type="date" value={cp.date} onChange={(e) => setCp({ ...cp, date: e.target.value })} /></div>
                <div className="field"><label htmlFor="cp-price">Their price</label><input id="cp-price" className="num" inputMode="decimal" placeholder="2.699" value={cp.price} onChange={(e) => setCp({ ...cp, price: e.target.value })} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { try { recordCompetitorPrice(books, user, { storeId, competitor: cp.competitor, grade: cp.grade, date: cp.date, cpg: toCpg(cp.price) }); setCp({ ...cp, price: '' }); setErrors([]); say('Competitor price logged.'); } catch (e) { setErrors(errList(e)); } }}>Log price</button></div>
            </div>
          )}
        </section>
      </div>
      <div style={{ marginTop: 12 }}><Errors errors={errors} /></div>
      <p className="muted small" style={{ marginTop: 12 }}>Tank detail is on <Link to="/fuel/tanks">Tanks</Link>.</p>
      {toast}
      <Help k="fuelPricing" />
    </>
  );
}
