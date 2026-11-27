import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  D, METHOD_LABEL, addPosAlias, budgetStatus, claimScanPeriod, commitPosImport, countTotal, deptMargin, deptName, departments, insideMonth, insideOf, inventoryTie, isShortage,
  logAgeCheck, lotteryCommissionTie, lotteryMath, mappingFor, parsePosFile, postCount, postedCounts, previewPosImport, purchaseLines, removeVendorMapping, resolveAgeCheck,
  reviewCount, reviewLotteryWeek, saveCount, saveLotteryWeek, saveScanProgram, saveVendorMapping, scanPeriods, setBudget, shrinkHistory, storeTraffic, undoPosBatch, voidCount,
  type ParsedPos,
} from '../../core/inside';
import type { AgeCheck, InsideBatch } from '../../core/insideTypes';
import { addDays, lastDayOfPeriod, periodLabel, periodsBetween, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import type { BooksState, ID } from '../../core/types';

export const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
export const errText = (e: unknown) => errList(e).join(' ');
export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(digits)}%`);
export const code = (state: BooksState, id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;

export function useParam(key: string, fallback: string): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  return [sp.get(key) ?? fallback, (v: string) => { const n = new URLSearchParams(sp); if (v && v !== fallback) n.set(key, v); else n.delete(key); setSp(n, { replace: true }); }];
}

/** Report screens need report access; store managers use the count, lottery, age-check and waste screens for their store. */
export function ReportGuard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  const { user } = useBooks();
  if (!can(user, 'view.reports')) return <PageHead eyebrow={eyebrow} title={title} lede="Your role doesn't include store margins and purchasing. Ask the CFO for access." />;
  return <>{children}</>;
}

/** Spend against budget: accent while inside, red once over. */
export function Bar({ used, label }: { used: number; label: string }) {
  const w = Math.max(0, Math.min(1, used));
  return (
    <div role="img" aria-label={label} style={{ height: 8, minWidth: 90, background: 'var(--rule)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${w * 100}%`, height: '100%', background: used > 1 ? 'var(--neg)' : 'var(--accent)' }} />
    </div>
  );
}

/** Months from the first demo month through the latest month with sales. */
export function useMonths(): { months: string[]; latest: string } {
  const { state, version } = useBooks();
  return useMemo(() => {
    const latest = insideMonth(state, todayInChicago());
    const first = state.transactions.filter((t) => !t.deleted && t.tags.includes('pos')).reduce((m, t) => (!m || t.date < m ? t.date : m), '');
    return { months: first ? periodsBetween(first.slice(0, 7), latest).reverse() : [latest], latest };
  }, [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function MonthSelect({ id, value, onChange, months }: { id: string; value: string; onChange: (v: string) => void; months: string[] }) {
  return <div className="field"><label htmlFor={id}>Month</label><select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>;
}

export function StorePick({ id, value, onChange, storeIds, all = 'All stores' }: { id: string; value: string; onChange: (v: string) => void; storeIds: ID[]; all?: string | null }) {
  const { state } = useBooks();
  return (
    <div className="field"><label htmlFor={id}>Store</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {all !== null && <option value="">{all}</option>}
        {storeIds.map((s) => <option key={s} value={s}>{code(state, s)} · {state.stores.find((x) => x.id === s)?.name}</option>)}
      </select>
    </div>
  );
}

export function useOperating(): ID[] {
  const { stores } = useBooks();
  return stores.filter((s) => s.kind === 'operating').map((s) => s.id);
}

/** File picker + paste box that hands back the text. */
export function FileOrPaste({ id, label, onText, placeholder, button }: { id: string; label: string; onText: (name: string, text: string) => void; placeholder: string; button: string }) {
  const [text, setText] = useState('');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="actions">
        <label className="btn">Choose file<input type="file" accept=".csv,.txt,.tsv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onText(f.name, await f.text()); }} /></label>
        <span className="muted small">CSV or tab-separated text pasted from the report.</span>
      </div>
      <div className="field"><label htmlFor={id}>{label}</label><textarea id={id} rows={6} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} /></div>
      <div className="actions"><button className="btn" disabled={!text.trim()} onClick={() => onText('pasted text', text)}>{button}</button></div>
    </div>
  );
}

export function BatchList({ batches, onUndo }: { batches: InsideBatch[]; onUndo?: (id: ID) => void }) {
  const { state } = useBooks();
  if (!batches.length) return null;
  return (
    <section className="panel" aria-labelledby="bl-h">
      <div className="panel-head"><h2 id="bl-h">Imports</h2><span className="muted small">Every row keeps its batch id</span></div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">File</th><th scope="col">Batch</th><th scope="col">Imported</th><th scope="col">By</th><th scope="col" className="num">Added</th><th scope="col" className="num">Skipped</th>{onUndo && <th scope="col"><span className="sr-only">Undo</span></th>}</tr></thead>
        <tbody>{[...batches].reverse().slice(0, 12).map((b) => (
          <tr key={b.id}><td>{b.fileName}</td><td className="muted small">{b.id}</td><td>{shortDate(b.importedAt.slice(0, 10))}</td><td>{state.users.find((u) => u.id === b.by)?.name}</td><td className="num">{b.added}</td><td className="num">{b.skipped}</td>
            {onUndo && <td>{b.source === 'import' && <button className="btn sm ghost" onClick={() => onUndo(b.id)} aria-label={`Undo import ${b.fileName}`}>Undo</button>}</td>}</tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

// ── Department sales and margin ──────────────────────────────────────────
export function DeptSalesPage() {
  const { state, user, version } = useBooks();
  const exportCsv = useExport();
  const ops = useOperating();
  const { months, latest } = useMonths();
  const [month, setMonth] = useParam('month', latest);
  const [store, setStore] = useParam('store', '');
  const [tab, setTab] = useParam('tab', 'margin');
  const ids = store ? [store] : ops;
  const from = `${month}-01`;
  const to = lastDayOfPeriod(month);
  const m = useMemo(() => deptMargin(state, { storeIds: ids, from, to }), [state, version, ids.join(), from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const traffic = useMemo(() => storeTraffic(state, ids, from, to), [state, version, ids.join(), from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const inside = m.rows.filter((r) => !departments(state).find((d) => d.id === r.departmentId)?.kitchen);
  const iSales = inside.reduce((a, r) => a + r.sales, 0);
  const iMargin = inside.reduce((a, r) => a + r.margin, 0);
  const stocked = m.rows.filter((r) => r.purchases && r.marginPct !== null);
  const weakest = [...stocked].sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))[0];
  return (
    <ReportGuard eyebrow="Inside store" title="Department sales & margin">
      <PageHead eyebrow="Inside store" title="Department sales & margin" lede="Sales by department from the POS daily close, units and customer counts from the POS department export, and purchases mapped to departments with the inventory counts, for true department margin.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`department-margin-${month}`, ['Department', 'Sales', 'POS import', 'Units', 'Purchases', 'Inventory change', 'Cost of goods', 'Margin', 'Margin %'],
          m.rows.map((r) => [deptName(state, r.departmentId), csvMoney(r.sales), csvMoney(r.posSales), r.units, csvMoney(r.purchases), csvMoney(r.invChange), csvMoney(r.cogs), csvMoney(r.margin), r.marginPct === null ? '' : (r.marginPct * 100).toFixed(2)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Inside store" style={{ marginBottom: 20 }}>
        <Figure label={`Inside sales · ${periodLabel(month)}`} value={<Money c={iSales} whole dollar />} note={`Plus kitchen ${formatMoney(m.sales - iSales, { dollarSign: true, whole: true })}`} />
        <Figure label="Inside gross margin" value={pct(iSales ? iMargin / iSales : null)} note={<Money c={iMargin} whole dollar />} />
        <Figure label="Average ticket" value={traffic.avgTicket === null ? '—' : <Money c={traffic.avgTicket} dollar />} note={`${traffic.days} days with a customer count`} />
        <Figure label="Transactions a day" value={traffic.perDay === null ? '—' : Math.round(traffic.perDay).toLocaleString('en-US')} note={`${traffic.transactions.toLocaleString('en-US')} customers`} />
        <Figure label="Thinnest margin" value={weakest ? pct(weakest.marginPct) : '—'} note={weakest ? deptName(state, weakest.departmentId) : 'No purchases yet'} />
      </section>
      <div className="seg" role="group" aria-label="View" style={{ marginBottom: 16 }}>
        {[['margin', 'Margin by department'], ['import', 'Import POS department sales']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'import' ? <PosImport /> : (
        <section className="panel">
          <div className="filters">
            <MonthSelect id="dm-month" value={month} onChange={setMonth} months={months} />
            <StorePick id="dm-store" value={store} onChange={setStore} storeIds={ops} />
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Department</th><th scope="col" className="num">Sales</th><th scope="col" className="num">Share</th><th scope="col" className="num">Units</th><th scope="col" className="num">Purchases</th><th scope="col" className="num">Inventory change</th><th scope="col" className="num">Cost of goods</th><th scope="col" className="num">Margin</th><th scope="col" className="num">Margin %</th></tr></thead>
            <tbody>
              {m.rows.map((r) => {
                const d = departments(state).find((x) => x.id === r.departmentId);
                return (
                  <tr key={r.departmentId}><td><b>{deptName(state, r.departmentId)}</b>{r.departmentId === D.lottery && <div className="muted small">Commissions; lottery sales are agency sales</div>}</td>
                    <td className="num"><Money c={r.sales} /></td><td className="num">{pct(r.share)}</td><td className="num">{r.units ? r.units.toLocaleString('en-US') : '—'}</td>
                    <td className="num">{d?.cogsAccountId ? <Link to={`/inside/purchases?month=${month}${store ? `&store=${store}` : ''}&dept=${r.departmentId}`}><Money c={r.purchases} /></Link> : '—'}</td>
                    <td className="num">{d?.counted ? <Money c={r.invChange} /> : '—'}</td><td className="num"><Money c={r.cogs} /></td><td className="num"><Money c={r.margin} /></td>
                    <td className="num">{r.marginPct === null ? '—' : <span className={r.marginPct < 0 ? 'neg' : undefined}>{pct(r.marginPct)}</span>}</td></tr>
                );
              })}
              <tr className="total"><td>Total</td><td className="num"><Money c={m.sales} /></td><td /><td /><td className="num"><Money c={m.rows.reduce((a, r) => a + r.purchases, 0)} /></td><td className="num"><Money c={m.rows.reduce((a, r) => a + r.invChange, 0)} /></td><td className="num"><Money c={m.cogs} /></td><td className="num"><Money c={m.margin} /></td><td className="num">{pct(m.sales ? m.margin / m.sales : null)}</td></tr>
            </tbody>
          </table></div>
          <p className="panel-pad muted small" style={{ paddingTop: 8, paddingBottom: 8 }}>Cost of goods = purchases − the increase in counted inventory. A month without a closing count shows purchases only, so its margin moves with delivery timing.</p>
          <TieOut items={[
            { label: m.cogs === m.ledgerCogs ? 'Cost of goods ties to 5100–5200 in the ledger' : 'Cost of goods does not tie to the ledger', ok: m.cogs === m.ledgerCogs, detail: m.cogs === m.ledgerCogs ? `${formatMoney(m.ledgerCogs, { dollarSign: true })}: purchases plus count adjustments` : `off by ${formatMoney(m.cogs - m.ledgerCogs, { dollarSign: true })}` },
            { label: m.posOff.length ? `${m.posOff.length} imported POS day(s) differ from the POS close` : 'POS department import ties to the POS daily close', ok: m.posOff.length === 0, detail: m.posOff.length ? m.posOff.slice(0, 3).map((x) => `${code(state, x.storeId)} ${x.date} ${formatMoney(x.diff, { dollarSign: true })}`).join('; ') : `${m.posDays} of ${m.closeDays} store-days imported` },
            { label: m.unassigned ? 'Some purchases have no department' : 'Every purchase is assigned to a department', ok: m.unassigned === 0, detail: m.unassigned ? <Link to="/inside/purchases">Map {formatMoney(m.unassigned, { dollarSign: true })}</Link> : undefined },
          ]} />
        </section>
      )}
      <Help k="insideDepts" />
    </ReportGuard>
  );
}

function PosImport() {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const ops = useOperating();
  const [storeId, setStoreId] = useState(ops[0] ?? '');
  const [date, setDate] = useState(addDays(todayInChicago(), -1));
  const [file, setFile] = useState<{ name: string; parsed: ParsedPos } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [alias, setAlias] = useState<Record<string, string>>({});
  const pv = useMemo(() => (file ? previewPosImport(state, file.parsed) : null), [file, state]);
  const ins = insideOf(state);
  const read = (name: string, text: string) => {
    setErrors([]);
    const parsed = parsePosFile(text, { storeCode: code(state, storeId), date });
    if (!parsed.rows.length) { setErrors(parsed.problems.length ? parsed.problems : ['No department rows found.']); setFile(null); return; }
    setFile({ name, parsed });
  };
  const unmapped = pv ? [...new Set(pv.rows.filter((r) => !r.departmentId).map((r) => r.posDept))] : [];
  return (
    <div className="stack">
      <section className="panel panel-pad" aria-labelledby="pi-h">
        <h2 id="pi-h" style={{ marginBottom: 8 }}>Import POS department sales</h2>
        <p className="muted">The daily department sales report from the POS (PDI C-Store Essentials "Department Sales" or CStorePro "Department Report") saved as CSV: Department and Sales, plus Units or Qty. A Total row and a Customer count row are read too. Pick the store and day when the file doesn't say. Importing the same file twice adds nothing.</p>
        {can(user, 'inside.edit') ? (
          <>
            <div className="form-grid" style={{ margin: '12px 0' }}>
              <StorePick id="pi-store" value={storeId} onChange={setStoreId} storeIds={ops} all={null} />
              <div className="field"><label htmlFor="pi-date">Business day</label><input id="pi-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <FileOrPaste id="pi-paste" label="Paste the department report" button="Read report" onText={read} placeholder={'Department,Net Sales,Qty Sold,Transactions\nCigarettes,812.40,97,\nPackaged beverage,402.15,171,\nTotal,1214.55,268,131'} />
          </>
        ) : <p className="muted">Your role can't import POS sales.</p>}
        <Errors errors={errors} />
      </section>
      {file && pv && (
        <section className="panel" aria-labelledby="pp-h">
          <div className="panel-head"><h2 id="pp-h">Preview: {file.name}</h2><span className="muted small">{pv.added} new, {pv.skipped} already imported or with a problem</span></div>
          {(file.parsed.problems.length > 0 || unmapped.length > 0) && (
            <div className="panel-pad stack" style={{ gap: 8 }}>
              {file.parsed.problems.length > 0 && <div className="note warn"><b>Rows skipped.</b><ul>{file.parsed.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
              {unmapped.map((u) => (
                <div className="actions" key={u}>
                  <span>POS department <b>{u}</b> isn't mapped.</span>
                  <label className="sr-only" htmlFor={'al-' + u}>Department for {u}</label>
                  <select id={'al-' + u} style={{ width: 200 }} value={alias[u] ?? ''} onChange={(e) => setAlias({ ...alias, [u]: e.target.value })}><option value="">Choose…</option>{departments(state).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                  <button className="btn sm" disabled={!alias[u]} onClick={() => { try { addPosAlias(books, user, alias[u], u); say(`"${u}" now maps to ${deptName(state, alias[u])}.`); } catch (e) { say(errText(e)); } }}>Map it</button>
                </div>
              ))}
            </div>
          )}
          <div className="table-wrap"><table className="t">
            <caption className="sr-only">Days in the file</caption>
            <thead><tr><th scope="col">Store</th><th scope="col">Day</th><th scope="col" className="num">File</th><th scope="col" className="num">File total row</th><th scope="col" className="num">POS close in the books</th><th scope="col" className="num">Customers</th><th scope="col">Ties</th></tr></thead>
            <tbody>{pv.days.map((d) => (
              <tr key={d.storeId + d.date}><td>{code(state, d.storeId)}</td><td>{shortDate(d.date)}</td><td className="num"><Money c={d.fileSales} /></td><td className="num">{d.reportedTotal === undefined ? '—' : <Money c={d.reportedTotal} />}</td>
                <td className="num">{d.closeFound ? <Money c={d.ledgerInClose} /> : <span className="muted">No close</span>}</td><td className="num">{d.transactions ?? '—'}</td>
                <td>{d.tiesLedger && d.tiesFile ? <span className="pill ok">Ties</span> : <span className="pill bad">{!d.tiesFile ? 'File total off' : d.closeFound ? `Off ${formatMoney(d.fileInClose - d.ledgerInClose, { dollarSign: true })}` : 'No POS close'}</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="table-wrap"><table className="t">
            <caption className="sr-only">Department rows</caption>
            <thead><tr><th scope="col">POS department</th><th scope="col">Our department</th><th scope="col" className="num">Sales</th><th scope="col" className="num">Units</th><th scope="col">Status</th></tr></thead>
            <tbody>{pv.rows.map((r) => (
              <tr key={r.row}><td>{r.posDept}</td><td>{r.departmentId ? deptName(state, r.departmentId) : '—'}</td><td className="num"><Money c={r.sales} /></td><td className="num">{r.units}</td>
                <td>{r.status === 'new' ? <span className="pill ok">New</span> : r.status === 'duplicate' ? <span className="pill">Already imported</span> : <span className="pill bad" title={r.problem}>{r.problem}</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: pv.days.every((d) => d.tiesFile) ? 'Ties to the file total' : 'Rows do not add to the file total', ok: pv.days.every((d) => d.tiesFile), detail: `${formatMoney(pv.days.reduce((a, d) => a + d.fileSales, 0), { dollarSign: true })} across ${pv.days.length} day(s)` },
            { label: pv.days.every((d) => d.tiesLedger) ? 'Ties to the POS daily close in the books' : 'Does not tie to the POS daily close', ok: pv.days.every((d) => d.tiesLedger), detail: 'department by department; lottery is not on the close' },
          ]} />
          <div className="panel-pad actions">
            <button className="btn primary" disabled={!pv.added} onClick={() => { try { const r = commitPosImport(books, user, file); say(`Imported ${r.rows.length} rows (batch ${r.batch.id}).`); setFile(null); } catch (e) { say(errText(e)); } }}>Import {pv.added} new row{pv.added === 1 ? '' : 's'}</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </section>
      )}
      <BatchList batches={ins.batches.filter((b) => b.kind === 'pos')} onUndo={can(user, 'inside.edit') ? (id) => { try { say(`Removed ${undoPosBatch(books, user, id)} rows.`); } catch (e) { say(errText(e)); } } : undefined} />
      {toast}
    </div>
  );
}

// ── Vendor purchases ─────────────────────────────────────────────────────
export function VendorPurchasesPage() {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ops = useOperating();
  const { months, latest } = useMonths();
  const [month, setMonth] = useParam('month', latest);
  const [store, setStore] = useParam('store', '');
  const [dept, setDept] = useParam('dept', '');
  const ids = store ? [store] : ops;
  const from = `${month}-01`;
  const to = lastDayOfPeriod(month);
  const lines = useMemo(() => purchaseLines(state, { storeIds: ids, from, to }), [state, version, ids.join(), from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = dept ? lines.filter((l) => l.alloc.some((a) => a.departmentId === dept)) : lines;
  const amt = (l: (typeof lines)[number]) => (dept ? l.alloc.filter((a) => a.departmentId === dept).reduce((s, a) => s + a.amount, 0) : l.amount);
  const total = shown.reduce((a, l) => a + amt(l), 0);
  const party = (id?: ID) => (id ? state.parties.find((p) => p.id === id)?.name ?? id : 'No vendor');
  const byVendor = new Map<string, { amount: number; n: number }>();
  for (const l of shown) { const k = party(l.partyId); const v = byVendor.get(k) ?? { amount: 0, n: 0 }; v.amount += amt(l); v.n += 1; byVendor.set(k, v); }
  const vendors = [...byVendor].sort((a, b) => b[1].amount - a[1].amount);
  const byMethod = new Map<string, number>();
  for (const l of shown) byMethod.set(l.method, (byMethod.get(l.method) ?? 0) + amt(l));
  const allocOk = lines.every((l) => l.alloc.reduce((a, x) => a + x.amount, 0) === l.amount || !l.alloc.length);
  const unmapped = lines.filter((l) => !l.alloc.length);
  const maps = insideOf(state).vendorMaps;
  const [nm, setNm] = useState<{ partyId: string; accountId: string; depts: ID[]; note: string }>({ partyId: '', accountId: '', depts: [], note: '' });
  const [errs, setErrs] = useState<string[]>([]);
  const cogsAccts = state.accounts.filter((a) => departments(state).some((d) => d.cogsAccountId === a.id));
  return (
    <ReportGuard eyebrow="Inside store" title="Vendor purchases">
      <PageHead eyebrow="Inside store" title="Vendor purchases" lede="Every merchandise and food purchase in the books (checks, EFT, cash and approved bills), assigned to departments by vendor. A vendor that ships several departments is split by that store's sales of them.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`vendor-purchases-${month}`, ['Date', 'Ref', 'Store', 'Vendor', 'Account', 'Paid by', 'Amount', 'Departments'],
          shown.map((l) => [l.date, l.ref, code(state, l.storeId), party(l.partyId), state.accounts.find((a) => a.id === l.accountId)?.number ?? '', METHOD_LABEL[l.method], csvMoney(amt(l)), l.alloc.map((a) => `${deptName(state, a.departmentId)} ${csvMoney(a.amount)}`).join('; ')]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Purchases" style={{ marginBottom: 20 }}>
        <Figure label={`Purchases · ${periodLabel(month)}`} value={<Money c={total} whole dollar />} note={`${shown.length} entries${dept ? ` · ${deptName(state, dept)}` : ''}`} />
        <Figure label="Largest vendor" value={vendors[0] ? <Money c={vendors[0][1].amount} whole dollar /> : '—'} note={vendors[0]?.[0] ?? 'None'} />
        <Figure label="Paid by" value={byMethod.size} note={[...byMethod].map(([k, v]) => `${METHOD_LABEL[k as keyof typeof METHOD_LABEL]} ${formatMoney(v, { dollarSign: true, whole: true })}`).join(' · ') || '—'} />
        <Figure label="Without a department" value={unmapped.length} note={unmapped.length ? 'Add a vendor mapping below' : 'All assigned'} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="vp-h">
          <div className="panel-head"><h2 id="vp-h">Purchases</h2></div>
          <div className="filters">
            <MonthSelect id="vp-month" value={month} onChange={setMonth} months={months} />
            <StorePick id="vp-store" value={store} onChange={setStore} storeIds={ops} />
            <div className="field"><label htmlFor="vp-dept">Department</label><select id="vp-dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{departments(state).filter((d) => d.cogsAccountId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          </div>
          <div className="table-wrap"><table className="t">
            <caption className="sr-only">By vendor</caption>
            <thead><tr><th scope="col">Vendor</th><th scope="col" className="num">Entries</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>{vendors.map(([v, x]) => <tr key={v}><td>{v}</td><td className="num">{x.n}</td><td className="num"><Money c={x.amount} /></td></tr>)}
              <tr className="total"><td>Total</td><td className="num">{shown.length}</td><td className="num"><Money c={total} /></td></tr></tbody>
          </table></div>
          <div className="table-wrap"><table className="t">
            <caption className="sr-only">Entries</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Entry</th><th scope="col">Store</th><th scope="col">Vendor</th><th scope="col">Paid by</th><th scope="col" className="num">Amount</th><th scope="col">Departments</th></tr></thead>
            <tbody>{shown.slice(0, 200).map((l, i) => (
              <tr key={l.txnId + i}><td>{shortDate(l.date)}</td><td><Link to={`/books/transactions/${l.txnId}`}>{l.ref}</Link></td><td>{code(state, l.storeId)}</td><td>{party(l.partyId)}</td><td>{METHOD_LABEL[l.method]}</td><td className="num"><Money c={amt(l)} /></td>
                <td className="small">{l.alloc.length ? l.alloc.map((a) => `${deptName(state, a.departmentId)}${l.alloc.length > 1 ? ` ${formatMoney(a.amount, { dollarSign: true })}` : ''}`).join(', ') : <span className="pill bad">None</span>}{l.mappedBy === 'vendor' && <span className="muted"> · vendor map</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: allocOk ? 'Department splits add back to each purchase' : 'A department split does not add up', ok: allocOk },
            { label: 'Read from the ledger: 5100–5200 lines, count adjustments left out', ok: true, detail: <Link to="/inside">See department margin</Link> },
          ]} />
        </section>
        <section className="panel" aria-labelledby="vm-h">
          <div className="panel-head"><h2 id="vm-h">Vendor mappings</h2><span className="muted small">Anything unmapped follows its account's department</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Vendor</th><th scope="col">Account</th><th scope="col">Departments</th><th scope="col">Note</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {maps.map((m) => (
                <tr key={m.id}><td>{party(m.partyId)}</td><td>{m.accountId ? state.accounts.find((a) => a.id === m.accountId)?.number : 'Any'}</td><td>{m.departmentIds.map((d) => deptName(state, d)).join(', ')}{m.departmentIds.length > 1 && <span className="muted small"> (by sales)</span>}</td><td className="small">{m.note}</td>
                  <td>{can(user, 'inside.edit') && <button className="btn sm ghost" onClick={() => { try { removeVendorMapping(books, user, m.id); say('Mapping removed.'); } catch (e) { say(errText(e)); } }} aria-label={`Remove mapping for ${party(m.partyId)}`}>Remove</button>}</td></tr>
              ))}
              {cogsAccts.map((a) => <tr key={a.id}><td className="muted">Default</td><td>{a.number}</td><td className="muted">{mappingFor({ ...state, inside: { ...insideOf(state), vendorMaps: [] } }, undefined, a.id).departmentIds.map((d) => deptName(state, d)).join(', ')}</td><td /><td /></tr>)}
            </tbody>
          </table></div>
          {can(user, 'inside.edit') && (
            <div className="panel-pad stack" style={{ gap: 10 }}>
              <div className="form-grid">
                <div className="field"><label htmlFor="vm-party">Vendor</label><select id="vm-party" value={nm.partyId} onChange={(e) => setNm({ ...nm, partyId: e.target.value })}><option value="">Any vendor</option>{state.parties.filter((p) => p.type === 'vendor' || p.type === 'related_company').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div className="field"><label htmlFor="vm-acct">Account</label><select id="vm-acct" value={nm.accountId} onChange={(e) => setNm({ ...nm, accountId: e.target.value })}><option value="">Any account</option>{cogsAccts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select></div>
                <div className="field"><label htmlFor="vm-note">Note</label><input id="vm-note" value={nm.note} onChange={(e) => setNm({ ...nm, note: e.target.value })} /></div>
              </div>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Departments</legend>
                <div className="actions">{departments(state).filter((d) => d.cogsAccountId).map((d) => <label key={d.id} className="check"><input type="checkbox" checked={nm.depts.includes(d.id)} onChange={(e) => setNm({ ...nm, depts: e.target.checked ? [...nm.depts, d.id] : nm.depts.filter((x) => x !== d.id) })} /> {d.name}</label>)}</div>
              </fieldset>
              <Errors errors={errs} />
              <div className="actions"><button className="btn primary" onClick={() => { try { saveVendorMapping(books, user, { partyId: nm.partyId || undefined, accountId: nm.accountId || undefined, departmentIds: nm.depts, note: nm.note }); setErrs([]); setNm({ partyId: '', accountId: '', depts: [], note: '' }); say('Mapping saved.'); } catch (e) { setErrs(errList(e)); } }}>Save mapping</button></div>
            </div>
          )}
        </section>
      </div>
      {toast}
      <Help k="insidePurchases" />
    </ReportGuard>
  );
}

// ── Inventory counts and shrink ──────────────────────────────────────────
export function InventoryPage() {
  const { state, books, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ops = useOperating();
  const [store, setStore] = useParam('store', ops[0] ?? '');
  const asOf = useMemo(() => { const m = insideMonth(state, todayInChicago()); const last = state.transactions.filter((t) => !t.deleted && t.tags.includes('pos') && t.date.startsWith(m)).reduce((x, t) => (t.date > x ? t.date : x), ''); return last || todayInChicago(); }, [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState(asOf);
  const counted = departments(state, { counted: true });
  const lastCount = postedCounts(state, store).at(-1);
  // The departments on the store's last count; a first count offers every counted department (kitchen only where there is one).
  const depts = counted.filter((d) => (lastCount ? lastCount.lines.some((l) => l.departmentId === d.id) : !d.kitchen || state.stores.find((s) => s.id === store)?.hasKitchen));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const lines = depts.map((d) => ({ departmentId: d.id, counted: parseMoney(vals[d.id] ?? '') ?? 0 }));
  const entered = depts.some((d) => (vals[d.id] ?? '').trim());
  const review = useMemo(() => (store ? reviewCount(state, { storeId: store, date, lines }) : null), [state, version, store, date, JSON.stringify(lines)]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => shrinkHistory(state, new Set(ops)), [state, version, ops.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const drafts = insideOf(state).counts.filter((c) => c.status === 'draft' && visible.has(c.storeId));
  const latestByStore = ops.map((s) => postedCounts(state, s).at(-1)).filter((c): c is NonNullable<typeof c> => !!c);
  const value = latestByStore.reduce((a, c) => a + countTotal(c), 0);
  const latestRows = history.filter((h) => latestByStore.some((c) => c.id === h.countId) && h.shrink !== null);
  const shrink = latestRows.reduce((a, r) => a + (r.shrink ?? 0), 0);
  const sales = latestRows.reduce((a, r) => a + r.sales, 0);
  const over = latestRows.filter((r) => r.over && !departments(state).find((d) => d.id === r.departmentId)?.kitchen);
  const ties = ops.map((s) => ({ s, t: inventoryTie(state, s, todayInChicago()) }));
  const submit = (post: boolean) => {
    try {
      const c = saveCount(books, user, { storeId: store, date, lines: lines.filter((_, i) => (vals[depts[i].id] ?? '').trim() !== ''), note });
      if (post) postCount(books, user, c.id);
      setErrs([]); setVals({}); setNote('');
      say(post ? `Posted the ${code(state, store)} count.` : `Saved the ${code(state, store)} count for posting.`);
    } catch (e) { setErrs(errList(e)); }
  };
  const showShrink = can(user, 'view.reports');
  return (
    <>
      <PageHead eyebrow="Inside store" title="Inventory & shrink" lede="Enter each department's count at cost. Book inventory is the last count plus purchases less sales at the department's expected cost; shrink is book less counted. Posting a count moves 1310 Merchandise inventory to the counted value against each department's cost of goods.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('shrink-by-department', ['Store', 'Count date', 'Department', 'Previous count', 'Purchases', 'Sales', 'Sales at cost', 'Book', 'Counted', 'Shrink', 'Shrink % of sales', 'Adjustment posted'],
          history.map((h) => [code(state, h.storeId), h.date, deptName(state, h.departmentId), h.previous === null ? '' : csvMoney(h.previous), csvMoney(h.purchases), csvMoney(h.sales), csvMoney(h.salesAtCost), h.book === null ? '' : csvMoney(h.book), csvMoney(h.counted), h.shrink === null ? '' : csvMoney(h.shrink), h.shrinkPct === null ? '' : (h.shrinkPct * 100).toFixed(2), csvMoney(h.adjustment)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Inventory" style={{ marginBottom: 20 }}>
        <Figure label="Inventory at cost" value={<Money c={value} whole dollar />} note={`Latest count at ${latestByStore.length} store${latestByStore.length === 1 ? '' : 's'}`} />
        {showShrink && <Figure label="Shrink on the latest counts" value={<Money c={shrink} whole dollar />} note={`${pct(sales ? shrink / sales : null, 2)} of department sales`} />}
        {showShrink && <Figure label="Departments over threshold" value={over.length} note={over.map((r) => `${code(state, r.storeId)} ${deptName(state, r.departmentId)} ${pct(r.shrinkPct)}`).join(', ') || 'None'} />}
        <Figure label="Counts waiting to post" value={drafts.length} note={drafts.length ? drafts.map((c) => `${code(state, c.storeId)} ${shortDate(c.date)}`).join(', ') : 'Nothing waiting'} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="ce-h">
          <div className="panel-head"><h2 id="ce-h">Enter a count</h2><span className="muted small">At cost, by department</span></div>
          <div className="filters">
            <StorePick id="ce-store" value={store} onChange={(v) => { setStore(v); setVals({}); }} storeIds={ops} all={null} />
            <div className="field"><label htmlFor="ce-date">Count date</label><input id="ce-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          {can(user, 'inside.log') ? (
            <>
              <div className="table-wrap"><table className="t">
                <thead><tr><th scope="col">Department</th><th scope="col" className="num">Last count</th>{showShrink && <><th scope="col" className="num">Purchases since</th><th scope="col" className="num">Sales at cost</th><th scope="col" className="num">Book</th></>}<th scope="col">Counted at cost</th>{showShrink && <><th scope="col" className="num">Shrink</th><th scope="col" className="num">% of sales</th></>}</tr></thead>
                <tbody>{depts.map((d) => {
                  const r = review?.lines.find((l) => l.departmentId === d.id);
                  const has = (vals[d.id] ?? '').trim() !== '';
                  return (
                    <tr key={d.id}><td><b>{d.name}</b></td><td className="num">{r?.previous === null || r?.previous === undefined ? '—' : <><Money c={r.previous} /><div className="muted small">{shortDate(r.previousDate!)}</div></>}</td>
                      {showShrink && <><td className="num">{r?.book === null ? '—' : <Money c={r?.purchases ?? 0} />}</td><td className="num">{r?.book === null ? '—' : <Money c={r?.salesAtCost ?? 0} />}</td><td className="num">{r?.book === null || r?.book === undefined ? '—' : <Money c={r.book} />}</td></>}
                      <td><label className="sr-only" htmlFor={'cv-' + d.id}>{d.name} counted at cost</label><input id={'cv-' + d.id} className="num" inputMode="decimal" style={{ width: 130 }} value={vals[d.id] ?? ''} onChange={(e) => setVals({ ...vals, [d.id]: e.target.value })} /></td>
                      {showShrink && <><td className="num">{has && r?.shrink !== null && r?.shrink !== undefined ? <Money c={r.shrink} /> : '—'}</td>
                        <td className="num">{has && r?.shrinkPct !== null && r?.shrinkPct !== undefined ? <span className={'pill ' + (r.over ? 'bad' : 'ok')}>{pct(r.shrinkPct, 2)}</span> : '—'}</td></>}</tr>
                  );
                })}</tbody>
              </table></div>
              <div className="panel-pad stack" style={{ gap: 10 }}>
                <div className="field"><label htmlFor="ce-note">Note</label><input id="ce-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who counted, anything unusual" /></div>
                {entered && review && showShrink && <p className="small">Counted <b><Money c={lines.reduce((a, l) => a + l.counted, 0)} dollar /></b>. Posting moves 1310 at {code(state, store)} from <Money c={review.ledgerBefore} dollar /> to the counted total, an adjustment of <b><Money c={review.adjustment} dollar /></b>.</p>}
                <Errors errors={errs} />
                <div className="actions">
                  {can(user, 'inside.edit') && <button className="btn primary" disabled={!entered} onClick={() => submit(true)}>Post count</button>}
                  <button className="btn" disabled={!entered} onClick={() => submit(false)}>Save for posting</button>
                  <span className="muted small">Store managers save; the CFO or bookkeeper posts.</span>
                </div>
              </div>
            </>
          ) : <p className="panel-pad muted">Your role can't enter counts.</p>}
        </section>
        {drafts.length > 0 && (
          <section className="panel" aria-labelledby="cd-h">
            <div className="panel-head"><h2 id="cd-h">Counts waiting to post</h2></div>
            <ul className="inbox">{drafts.map((c) => (
              <li key={c.id}><span className="n">{code(state, c.storeId)}</span><span className="what"><b>{shortDate(c.date)} · <Money c={countTotal(c)} dollar /></b><span>{c.lines.length} departments, entered by {state.users.find((u) => u.id === c.enteredBy)?.name}</span></span>
                <span className="actions">{can(user, 'inside.edit') && <button className="btn sm primary" onClick={() => { try { postCount(books, user, c.id); say('Count posted.'); } catch (e) { say(errText(e)); } }}>Post</button>}
                  {can(user, 'inside.edit') && <button className="btn sm ghost" onClick={() => { try { voidCount(books, user, c.id, 'Entered in error'); say('Count voided.'); } catch (e) { say(errText(e)); } }}>Void</button>}</span></li>
            ))}</ul>
          </section>
        )}
        {showShrink && (
          <section className="panel" aria-labelledby="sh-h">
            <div className="panel-head"><h2 id="sh-h">Shrink by department</h2><span className="muted small">Red is over the department's threshold</span></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Store</th><th scope="col">Count</th><th scope="col">Department</th><th scope="col" className="num">Book</th><th scope="col" className="num">Counted</th><th scope="col" className="num">Shrink</th><th scope="col" className="num">% of sales</th><th scope="col" className="num">Posted adjustment</th></tr></thead>
              <tbody>{history.filter((h) => !store || h.storeId === store).slice(0, 60).map((h) => {
                const c = insideOf(state).counts.find((x) => x.id === h.countId);
                return (
                  <tr key={h.countId + h.departmentId}><td>{code(state, h.storeId)}</td><td>{shortDate(h.date)}{c?.posted?.txnId && h.departmentId === c.lines[0].departmentId && <> · <Link to={`/books/transactions/${c.posted.txnId}`}>entry</Link></>}</td><td>{deptName(state, h.departmentId)}</td>
                    <td className="num">{h.book === null ? <span className="muted">Opening</span> : <Money c={h.book} />}</td><td className="num"><Money c={h.counted} /></td><td className="num">{h.shrink === null ? '—' : <Money c={h.shrink} />}</td>
                    <td className="num">{h.shrinkPct === null ? '—' : <span className={'pill ' + (h.over ? 'bad' : 'ok')}>{pct(h.shrinkPct, 2)}</span>}</td><td className="num"><Money c={h.adjustment} /></td></tr>
                );
              })}</tbody>
            </table></div>
            <TieOut items={ties.filter((x) => x.t.hasCounts).map(({ s, t }) => ({ label: t.ok ? `${code(state, s)} 1310 ties to the latest counts` : `${code(state, s)} 1310 differs from the counts`, ok: t.ok, detail: t.ok ? formatMoney(t.ledger, { dollarSign: true }) : `ledger ${formatMoney(t.ledger, { dollarSign: true })} vs counted ${formatMoney(t.counted, { dollarSign: true })}` }))} />
          </section>
        )}
      </div>
      {toast}
      <Help k="insideInventory" />
    </>
  );
}

// ── Purchasing budgets ───────────────────────────────────────────────────
export function BudgetsPage() {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ops = useOperating();
  const { months, latest } = useMonths();
  const [month, setMonth] = useParam('month', latest);
  const [store, setStore] = useParam('store', '');
  const ids = store ? [store] : ops;
  const rows = useMemo(() => budgetStatus(state, month, ids), [state, version, month, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const purchases = useMemo(() => purchaseLines(state, { storeIds: ids, from: `${month}-01`, to: lastDayOfPeriod(month) }), [state, version, month, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const budget = rows.reduce((a, r) => a + (r.budget ?? 0), 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  const committed = rows.reduce((a, r) => a + r.committed, 0);
  const over = rows.filter((r) => r.over);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const purchTotal = purchases.reduce((a, p) => a + p.amount, 0);
  return (
    <ReportGuard eyebrow="Inside store" title="Purchasing budgets">
      <PageHead eyebrow="Inside store" title="Purchasing budgets" lede="A monthly buying budget per store and department, against purchases to date and bills waiting for approval. This controls buying; the profit-and-loss budget comes with Budgets & close.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`purchasing-budget-${month}`, ['Store', 'Department', 'Budget', 'Spent', 'Awaiting approval', 'Remaining', 'Used %'],
          rows.map((r) => [code(state, r.storeId), deptName(state, r.departmentId), r.budget === null ? '' : csvMoney(r.budget), csvMoney(r.spent), csvMoney(r.committed), r.remaining === null ? '' : csvMoney(r.remaining), r.used === null ? '' : (r.used * 100).toFixed(1)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Budgets" style={{ marginBottom: 20 }}>
        <Figure label={`Budget · ${periodLabel(month)}`} value={<Money c={budget} whole dollar />} note={`${rows.filter((r) => r.budget !== null).length} store-departments`} />
        <Figure label="Spent to date" value={<Money c={spent} whole dollar />} note={`${pct(budget ? spent / budget : null)} of budget`} />
        <Figure label="Remaining" value={<Money c={budget - spent - committed} whole dollar />} note={committed ? <>after <Money c={committed} whole dollar /> awaiting approval</> : 'Nothing awaiting approval'} />
        <Figure label="Over budget" value={over.length} note={over.map((r) => `${code(state, r.storeId)} ${deptName(state, r.departmentId)}`).join(', ') || 'Every line is inside'} />
      </section>
      <section className="panel">
        <div className="filters">
          <MonthSelect id="pb-month" value={month} onChange={setMonth} months={[...new Set([...months, ...insideOf(state).budgets.map((b) => b.period)])].sort().reverse()} />
          <StorePick id="pb-store" value={store} onChange={setStore} storeIds={ops} />
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col">Department</th><th scope="col" className="num">Budget</th><th scope="col" className="num">Spent</th><th scope="col" className="num">Awaiting approval</th><th scope="col" className="num">Remaining</th><th scope="col">Used</th></tr></thead>
          <tbody>{rows.map((r) => {
            const k = `${r.storeId}|${r.departmentId}`;
            return (
              <tr key={k}><td>{code(state, r.storeId)}</td><td>{deptName(state, r.departmentId)}</td>
                <td className="num">{can(user, 'inside.edit') ? (
                  <span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><label className="sr-only" htmlFor={'bg-' + k}>Budget {code(state, r.storeId)} {deptName(state, r.departmentId)}</label>
                    <input id={'bg-' + k} className="num" inputMode="decimal" style={{ width: 110 }} value={edit[k] ?? (r.budget === null ? '' : (r.budget / 100).toFixed(2))} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                    {edit[k] !== undefined && <button className="btn sm" onClick={() => { try { setBudget(books, user, { storeId: r.storeId, period: month, departmentId: r.departmentId, amount: parseMoney(edit[k]) ?? -1 }); const n = { ...edit }; delete n[k]; setEdit(n); say('Budget saved.'); } catch (e) { say(errText(e)); } }}>Save</button>}</span>
                ) : r.budget === null ? '—' : <Money c={r.budget} />}</td>
                <td className="num"><Link to={`/inside/purchases?month=${month}&store=${r.storeId}&dept=${r.departmentId}`}><Money c={r.spent} /></Link></td><td className="num">{r.committed ? <Money c={r.committed} /> : '—'}</td>
                <td className="num">{r.remaining === null ? <span className="pill warn">No budget</span> : <span className={r.remaining < 0 ? 'neg' : undefined}><Money c={r.remaining} /></span>}</td>
                <td style={{ minWidth: 120 }}>{r.used === null ? '' : <><Bar used={r.used} label={`${pct(r.used, 0)} of budget used`} /><span className={'small ' + (r.over ? 'neg' : 'muted')}>{pct(r.used, 0)}</span></>}</td></tr>
            );
          })}
            <tr className="total"><td colSpan={2}>Total</td><td className="num"><Money c={budget} /></td><td className="num"><Money c={spent} /></td><td className="num"><Money c={committed} /></td><td className="num"><Money c={budget - spent - committed} /></td><td /></tr></tbody>
        </table></div>
        <TieOut items={[
          { label: spent === purchTotal ? 'Spent ties to vendor purchases for the month' : 'Spent does not tie to vendor purchases', ok: spent === purchTotal, detail: formatMoney(purchTotal, { dollarSign: true }) },
        ]} />
      </section>
      {toast}
      <Help k="insideBudgets" />
    </ReportGuard>
  );
}

// ── Scan-data and loyalty rebates ────────────────────────────────────────
export function RebatesPage() {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ops = useOperating();
  const today = todayInChicago();
  const progs = insideOf(state).scanPrograms;
  const periods = useMemo(() => progs.map((p) => ({ p, rows: scanPeriods(state, p.id, today) })), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = periods.flatMap((x) => x.rows.map((r) => ({ ...r, p: x.p })));
  const expected = all.filter((r) => r.ended).reduce((a, r) => a + r.expected, 0);
  const received = all.reduce((a, r) => a + r.received, 0);
  const short = all.filter((r) => r.status === 'short');
  const accruing = all.filter((r) => r.status === 'accruing').reduce((a, r) => a + r.expected, 0);
  const mismatch = all.filter((r) => r.itemId && r.itemExpected !== r.expected && r.ended);
  const [np, setNp] = useState({ manufacturer: '', departmentId: D.tobacco as string, rate: '', share: '', cadence: 'quarterly' as 'quarterly' | 'monthly', payDays: '30' });
  const [errs, setErrs] = useState<string[]>([]);
  const STATUS: Record<string, [string, string]> = { accruing: ['Accruing', ''], to_claim: ['Claim it', 'warn'], open: ['Claimed', ''], overdue: ['Overdue', 'bad'], received: ['Received', 'ok'], short: ['Short-paid', 'bad'], closed: ['Closed', ''] };
  return (
    <ReportGuard eyebrow="Inside store" title="Scan-data & rebates">
      <PageHead eyebrow="Inside store" title="Scan-data & rebates" lede="Manufacturer scan-data and loyalty programs. Expected = units sold in the department × the manufacturer's share × the rate. Claiming a period puts that amount on the rebate in Receivables, where the payment is applied, so nothing is tracked twice.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('scan-data', ['Program', 'Period', 'Units', 'Qualifying', 'Rate (cents)', 'Expected', 'Received', 'Short', 'Status'],
          all.map((r) => [r.p.manufacturer, r.key, r.units, r.qualifying, r.p.rateCentsPerUnit, csvMoney(r.expected), csvMoney(r.received), csvMoney(r.short), r.status]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Scan-data" style={{ marginBottom: 20 }}>
        <Figure label="Expected, ended periods" value={<Money c={expected} whole dollar />} note={`${progs.length} programs`} />
        <Figure label="Received" value={<Money c={received} whole dollar />} note={<Link to="/receivables/other">On Receivables</Link>} />
        <Figure label="Short-paid" value={<Money c={short.reduce((a, r) => a + r.short, 0)} whole dollar />} note={short.map((r) => `${r.p.manufacturer} ${r.key}`).join(', ') || 'None'} />
        <Figure label="Accruing this period" value={<Money c={accruing} whole dollar />} note="From units sold so far" />
      </section>
      <div className="stack">
        {periods.map(({ p, rows }) => (
          <section className="panel" key={p.id} aria-labelledby={'sp-' + p.id}>
            <div className="panel-head"><h2 id={'sp-' + p.id}>{p.manufacturer}</h2><span className="muted small">{deptName(state, p.departmentId)} · {(p.shareBps / 100).toFixed(0)}% of units · {p.rateCentsPerUnit}¢ a unit · {p.cadence}, due {p.payDays} days after</span></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Period</th><th scope="col" className="num">Units sold</th><th scope="col" className="num">Qualifying</th><th scope="col" className="num">Expected</th><th scope="col" className="num">On Receivables</th><th scope="col" className="num">Received</th><th scope="col" className="num">Short</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key}><td>{r.key}<div className="muted small">due {shortDate(r.due)}</div></td><td className="num">{r.units.toLocaleString('en-US')}</td><td className="num">{r.qualifying.toLocaleString('en-US')}</td><td className="num"><Money c={r.expected} /></td>
                  <td className="num">{r.itemExpected === undefined ? '—' : <Money c={r.itemExpected} />}</td><td className="num"><Money c={r.received} /></td><td className="num">{r.short ? <span className="neg"><Money c={r.short} /></span> : '—'}</td>
                  <td><span className={'pill ' + STATUS[r.status][1]}>{STATUS[r.status][0]}</span></td>
                  <td>{can(user, 'inside.edit') && can(user, 'ar.edit') && r.ended && (!r.itemId || r.itemExpected !== r.expected) && <button className="btn sm" onClick={() => { try { claimScanPeriod(books, user, p.id, r.key, today); say(`${p.manufacturer} ${r.key} is on Receivables at ${formatMoney(r.expected, { dollarSign: true })}.`); } catch (e) { say(errText(e)); } }}>{r.itemId ? 'Update receivable' : 'Claim'}</button>}</td></tr>
              ))}</tbody>
            </table></div>
          </section>
        ))}
        <TieOut items={[
          { label: mismatch.length ? `${mismatch.length} claimed period(s) differ from Receivables` : 'Claimed periods agree with Receivables', ok: mismatch.length === 0, detail: mismatch.length ? 'Update the receivable to the scan-data amount' : 'received amounts are the deposits applied on Receivables' },
        ]} />
        {can(user, 'inside.edit') && (
          <section className="panel panel-pad" aria-labelledby="np-h">
            <h2 id="np-h" style={{ marginBottom: 12 }}>Add a program</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="np-m">Manufacturer</label><input id="np-m" value={np.manufacturer} onChange={(e) => setNp({ ...np, manufacturer: e.target.value })} /></div>
              <div className="field"><label htmlFor="np-d">Department</label><select id="np-d" value={np.departmentId} onChange={(e) => setNp({ ...np, departmentId: e.target.value })}>{departments(state).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <div className="field"><label htmlFor="np-r">Rate per unit (cents)</label><input id="np-r" className="num" inputMode="decimal" value={np.rate} onChange={(e) => setNp({ ...np, rate: e.target.value })} /></div>
              <div className="field"><label htmlFor="np-s">Share of units (%)</label><input id="np-s" className="num" inputMode="decimal" value={np.share} onChange={(e) => setNp({ ...np, share: e.target.value })} /></div>
              <div className="field"><label htmlFor="np-c">Paid</label><select id="np-c" value={np.cadence} onChange={(e) => setNp({ ...np, cadence: e.target.value as 'quarterly' | 'monthly' })}><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option></select></div>
              <div className="field"><label htmlFor="np-p">Due days after period</label><input id="np-p" className="num" inputMode="numeric" value={np.payDays} onChange={(e) => setNp({ ...np, payDays: e.target.value })} /></div>
            </div>
            <Errors errors={errs} />
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { try { saveScanProgram(books, user, { manufacturer: np.manufacturer, departmentId: np.departmentId, rateCentsPerUnit: Number(np.rate), shareBps: Math.round(Number(np.share) * 100), cadence: np.cadence, storeIds: ops, payDays: Number(np.payDays), active: true }); setErrs([]); say('Program added.'); } catch (e) { setErrs(errList(e)); } }}>Add program</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="insideRebates" />
    </ReportGuard>
  );
}

// ── Lottery ──────────────────────────────────────────────────────────────
const LOT_FIELDS = [['instantSales', 'Instant sales'], ['onlineSales', 'Online sales'], ['instantCashes', 'Instant cashes'], ['onlinePayouts', 'Online payouts'], ['commission', 'Commission'], ['settlement', 'Settlement swept'], ['posNet', 'Register lottery net']] as const;

export function LotteryPage() {
  const { state, books, user, visible } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ops = useOperating();
  const [store, setStore] = useParam('store', '');
  const [show, setShow] = useParam('show', '');
  const all = insideOf(state).lottery.filter((w) => visible.has(w.storeId) && (!store || w.storeId === store)).sort((a, b) => b.weekEnding.localeCompare(a.weekEnding) || a.storeId.localeCompare(b.storeId));
  const rows = show === 'short' ? all.filter((w) => isShortage(state, w)) : all;
  const lastWeek = all[0]?.weekEnding;
  const recent = all.filter((w) => lastWeek && w.weekEnding > addDays(lastWeek, -28));
  const sum = (f: (w: (typeof all)[number]) => number) => recent.reduce((a, w) => a + f(w), 0);
  const shortages = all.filter((w) => isShortage(state, w) && !w.reviewed);
  const periods = [...new Set(all.map((w) => w.weekEnding.slice(0, 7)))].sort().reverse();
  const ties = periods.map((p) => ({ p, t: lotteryCommissionTie(state, store ? [store] : ops, p) }));
  const [f, setF] = useState<Record<string, string>>({ storeId: ops[0] ?? '', weekEnding: '' });
  const [errs, setErrs] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <>
      <PageHead eyebrow="Inside store" title="Lottery" lede="Each store's lottery week: sales, payouts, commission and the settlement the lottery sweeps, against the lottery net the register took. A register short of the lottery report is a lottery shortage.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('lottery-weeks', ['Store', 'Week ending', 'Instant sales', 'Online sales', 'Cashes & payouts', 'Commission', 'Due to lottery', 'Settlement', 'Settlement difference', 'Register net', 'Register variance'],
          rows.map((w) => { const m = lotteryMath(w); return [code(state, w.storeId), w.weekEnding, csvMoney(w.instantSales), csvMoney(w.onlineSales), csvMoney(m.payouts), csvMoney(w.commission), csvMoney(m.due), csvMoney(w.settlement), csvMoney(m.settlementDiff), csvMoney(w.posNet), csvMoney(m.variance)]; }))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Lottery" style={{ marginBottom: 20 }}>
        <Figure label="Lottery sales, last 4 weeks" value={<Money c={sum((w) => w.instantSales + w.onlineSales)} whole dollar />} note={lastWeek ? `Through ${shortDate(lastWeek)}` : 'No weeks yet'} />
        <Figure label="Cashes & payouts" value={<Money c={sum((w) => w.instantCashes + w.onlinePayouts)} whole dollar />} note="Prizes paid at the counter" />
        <Figure label="Commissions" value={<Money c={sum((w) => w.commission)} whole dollar />} note="4140 Lottery commissions" />
        <Figure label="Shortages to look into" value={shortages.length} note={shortages.map((w) => `${code(state, w.storeId)} ${shortDate(w.weekEnding)} ${formatMoney(-lotteryMath(w).variance, { dollarSign: true })}`).join(', ') || 'None open'} />
      </section>
      <div className="stack">
        <section className="panel">
          <div className="filters">
            <StorePick id="lt-store" value={store} onChange={setStore} storeIds={ops} />
            <div className="seg" role="group" aria-label="Show" style={{ marginBottom: 2 }}>{[['', 'All weeks'], ['short', 'Shortages']].map(([k, l]) => <button key={k} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}</div>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col">Week ending</th><th scope="col" className="num">Sales</th><th scope="col" className="num">Payouts</th><th scope="col" className="num">Commission</th><th scope="col" className="num">Due to lottery</th><th scope="col" className="num">Settlement</th><th scope="col" className="num">Register net</th><th scope="col" className="num">Variance</th><th scope="col"><span className="sr-only">Review</span></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} className="muted">No lottery weeks{show ? ' with a shortage' : ''}.</td></tr>}
              {rows.slice(0, 80).map((w) => {
                const m = lotteryMath(w);
                const sh = isShortage(state, w);
                return (
                  <tr key={w.id}><td>{code(state, w.storeId)}</td><td>{shortDate(w.weekEnding)}</td><td className="num"><Money c={m.sales} /></td><td className="num"><Money c={m.payouts} /></td><td className="num"><Money c={w.commission} /></td><td className="num"><Money c={m.due} /></td>
                    <td className="num"><Money c={w.settlement} />{m.settlementDiff !== 0 && <div className="neg small">off <Money c={m.settlementDiff} /></div>}</td><td className="num"><Money c={w.posNet} /></td>
                    <td className="num">{sh ? <span className="pill bad">Short <Money c={-m.variance} /></span> : m.variance ? <span className="muted"><Money c={m.variance} /></span> : <span className="pill ok">Balanced</span>}</td>
                    <td>{sh && (w.reviewed ? <span className="small muted">{w.reviewed.note}</span> : can(user, 'inside.edit') && (
                      <span className="actions" style={{ flexWrap: 'nowrap' }}><label className="sr-only" htmlFor={'lr-' + w.id}>What you found, {code(state, w.storeId)} {w.weekEnding}</label><input id={'lr-' + w.id} style={{ width: 160 }} value={notes[w.id] ?? ''} onChange={(e) => setNotes({ ...notes, [w.id]: e.target.value })} placeholder="What you found" />
                        <button className="btn sm" onClick={() => { try { reviewLotteryWeek(books, user, w.id, notes[w.id] ?? ''); say('Signed off.'); } catch (e) { say(errText(e)); } }}>Sign off</button></span>))}</td></tr>
                );
              })}
            </tbody>
          </table></div>
          <TieOut items={[
            ...ties.slice(0, 3).map(({ p, t }) => ({ label: t.ok ? `${periodLabel(p)} commissions tie to 4140 in the ledger` : `${periodLabel(p)} commissions do not tie to 4140`, ok: t.ok, detail: t.ok ? formatMoney(t.ledger, { dollarSign: true }) : `weeks ${formatMoney(t.weeks, { dollarSign: true })} vs ledger ${formatMoney(t.ledger, { dollarSign: true })}` })),
            { label: rows.every((w) => lotteryMath(w).settlementDiff === 0) ? 'Every settlement = sales − payouts − commission' : 'A settlement does not match the lottery report', ok: rows.every((w) => lotteryMath(w).settlementDiff === 0) },
          ]} />
        </section>
        {can(user, 'inside.log') && (
          <section className="panel panel-pad" aria-labelledby="le-h">
            <h2 id="le-h" style={{ marginBottom: 12 }}>Enter a lottery week</h2>
            <div className="form-grid">
              <StorePick id="le-store" value={f.storeId} onChange={(v) => setF({ ...f, storeId: v })} storeIds={ops} all={null} />
              <div className="field"><label htmlFor="le-week">Week ending (Saturday)</label><input id="le-week" type="date" value={f.weekEnding} onChange={(e) => setF({ ...f, weekEnding: e.target.value })} /></div>
              {LOT_FIELDS.map(([k, l]) => <div className="field" key={k}><label htmlFor={'le-' + k}>{l}</label><input id={'le-' + k} className="num" inputMode="decimal" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
            </div>
            <Errors errors={errs} />
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
              try {
                const m = (k: string) => parseMoney(f[k] ?? '') ?? (k === 'settlement' || k === 'posNet' ? NaN : -1);
                saveLotteryWeek(books, user, { storeId: f.storeId, weekEnding: f.weekEnding, instantSales: m('instantSales'), onlineSales: m('onlineSales'), instantCashes: m('instantCashes'), onlinePayouts: m('onlinePayouts'), commission: m('commission'), settlement: m('settlement'), posNet: m('posNet') });
                setErrs([]); setF({ storeId: f.storeId, weekEnding: '' }); say('Lottery week saved.');
              } catch (e) { setErrs(errList(e)); }
            }}>Save week</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="insideLottery" />
    </>
  );
}

// ── Age-check audits ─────────────────────────────────────────────────────
export function AgeChecksPage() {
  const { state, books, user, visible } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ops = useOperating();
  const [store, setStore] = useParam('store', '');
  const list = insideOf(state).ageChecks.filter((a) => visible.has(a.storeId) && (!store || a.storeId === store)).sort((a, b) => b.date.localeCompare(a.date));
  const today = todayInChicago();
  const recent = list.filter((a) => a.date >= addDays(today, -90));
  const fails = recent.filter((a) => a.result === 'fail');
  const open = list.filter((a) => a.result === 'fail' && !a.resolved);
  const [f, setF] = useState<{ date: string; storeId: string; product: AgeCheck['product']; result: AgeCheck['result']; checkedBy: string; clerk: string; followUp: string; followUpDue: string; note: string }>({ date: today, storeId: ops[0] ?? '', product: 'tobacco', result: 'pass', checkedBy: '', clerk: '', followUp: '', followUpDue: '', note: '' });
  const [errs, setErrs] = useState<string[]>([]);
  const [res, setRes] = useState<Record<string, string>>({});
  const allFollowed = list.every((a) => a.result === 'pass' || !!a.followUp);
  return (
    <>
      <PageHead eyebrow="Inside store" title="Age-check audits" lede="Every tobacco and alcohol ID check, from the state, a mystery shopper or our own: pass or fail, and what was done about a failure. License expiry lives with Compliance.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('age-checks', ['Date', 'Store', 'Product', 'Result', 'Checked by', 'Clerk', 'Follow-up', 'Due', 'Done'],
          list.map((a) => [a.date, code(state, a.storeId), a.product, a.result, a.checkedBy, a.clerk ?? '', a.followUp ?? '', a.followUpDue ?? '', a.resolved?.note ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Age checks" style={{ marginBottom: 20 }}>
        <Figure label="Audits, last 90 days" value={recent.length} note={`${new Set(recent.map((a) => a.storeId)).size} stores`} />
        <Figure label="Pass rate" value={pct(recent.length ? (recent.length - fails.length) / recent.length : null, 0)} note={`${fails.length} failed`} />
        <Figure label="Follow-ups open" value={open.length} note={open.map((a) => `${code(state, a.storeId)} due ${a.followUpDue ? shortDate(a.followUpDue) : '—'}`).join(', ') || 'None'} />
      </section>
      <div className="stack">
        <section className="panel">
          <div className="filters"><StorePick id="ag-store" value={store} onChange={setStore} storeIds={ops} /></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Store</th><th scope="col">Product</th><th scope="col">Result</th><th scope="col">Checked by</th><th scope="col">Clerk</th><th scope="col">Follow-up</th></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a.id}><td>{shortDate(a.date)}</td><td>{code(state, a.storeId)}</td><td>{a.product === 'both' ? 'Tobacco & alcohol' : a.product === 'tobacco' ? 'Tobacco' : 'Alcohol'}</td>
                <td><span className={'pill ' + (a.result === 'pass' ? 'ok' : 'bad')}>{a.result === 'pass' ? 'Pass' : 'Fail'}</span></td><td>{a.checkedBy}</td><td>{a.clerk ?? '—'}</td>
                <td className="small">{a.followUp ? <>{a.followUp}{a.followUpDue && <> · due {shortDate(a.followUpDue)}</>}{a.resolved ? <div className="pos">Done: {a.resolved.note}</div> : can(user, 'inside.log') && (
                  <div className="actions" style={{ marginTop: 4 }}><label className="sr-only" htmlFor={'ar-' + a.id}>What was done</label><input id={'ar-' + a.id} style={{ width: 180 }} value={res[a.id] ?? ''} onChange={(e) => setRes({ ...res, [a.id]: e.target.value })} placeholder="What was done" />
                    <button className="btn sm" onClick={() => { try { resolveAgeCheck(books, user, a.id, res[a.id] ?? ''); say('Follow-up closed.'); } catch (e) { say(errText(e)); } }}>Close follow-up</button></div>)}</> : '—'}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[{ label: allFollowed ? 'Every failed check has a follow-up' : 'A failed check has no follow-up', ok: allFollowed, detail: `${open.length} still open` }]} />
        </section>
        {can(user, 'inside.log') && (
          <section className="panel panel-pad" aria-labelledby="al-h">
            <h2 id="al-h" style={{ marginBottom: 12 }}>Log an audit</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="al-date">Date</label><input id="al-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <StorePick id="al-store" value={f.storeId} onChange={(v) => setF({ ...f, storeId: v })} storeIds={ops} all={null} />
              <div className="field"><label htmlFor="al-prod">Product</label><select id="al-prod" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value as AgeCheck['product'] })}><option value="tobacco">Tobacco</option><option value="alcohol">Alcohol</option><option value="both">Both</option></select></div>
              <div className="field"><label htmlFor="al-res">Result</label><select id="al-res" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as AgeCheck['result'] })}><option value="pass">Pass</option><option value="fail">Fail</option></select></div>
              <div className="field"><label htmlFor="al-by">Checked by</label><input id="al-by" value={f.checkedBy} onChange={(e) => setF({ ...f, checkedBy: e.target.value })} placeholder="State compliance check" /></div>
              <div className="field"><label htmlFor="al-clerk">Clerk</label><input id="al-clerk" value={f.clerk} onChange={(e) => setF({ ...f, clerk: e.target.value })} /></div>
              {f.result === 'fail' && <div className="field"><label htmlFor="al-fu">Follow-up</label><input id="al-fu" value={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.value })} /></div>}
              {f.result === 'fail' && <div className="field"><label htmlFor="al-due">Follow-up due</label><input id="al-due" type="date" value={f.followUpDue} onChange={(e) => setF({ ...f, followUpDue: e.target.value })} /></div>}
            </div>
            <Errors errors={errs} />
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { try { logAgeCheck(books, user, { date: f.date, storeId: f.storeId, product: f.product, result: f.result, checkedBy: f.checkedBy, clerk: f.clerk, followUp: f.result === 'fail' ? f.followUp : undefined, followUpDue: f.result === 'fail' && f.followUpDue ? f.followUpDue : undefined, note: f.note }); setErrs([]); say('Audit logged.'); } catch (e) { setErrs(errList(e)); } }}>Log audit</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="insideAgeChecks" />
    </>
  );
}
