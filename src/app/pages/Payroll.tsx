import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  DEPT_LABEL, EMP_FLAG_LABEL, commitRun, decideRateChange, employee, parseGustoCsv, payWeeks, peopleOf, postRun, postWeek, postingCheck, previewRun, quarterOf,
  rateFlags, runStores, runTies, totalsOf, weeklyReview, type Change, type ParsedGusto, type RateFlag,
} from '../../core/payroll';
import { addDays, shortDate } from '../../core/dates';
import { formatMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { canApproveKind } from '../../core/limits';
import { ValidationError } from '../../core/books';
import type { BooksState, ID, PayrollRun, RateChange } from '../../core/types';

export const errText = (e: unknown) => (e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message);
export const pctText = (p: number | null, signed = true) => (p === null ? '—' : `${signed && p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%`);
export const hrs = (h: number) => h.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const storeCode = (state: BooksState, id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
export const empName = (state: BooksState, id: ID) => employee(state, id)?.name ?? 'Unknown employee';

/** Payroll is sensitive: only roles that read reports see it. */
export function PeopleGuard({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useBooks();
  if (!can(user, 'view.reports')) return <PageHead eyebrow="People" title={title} lede="Your role doesn't include payroll. Ask the CFO for access." />;
  return <>{children}</>;
}

export function ChangeCell({ c, money = true }: { c: Change; money?: boolean }) {
  if (c.status === 'none') return <span className="muted">—</span>;
  if (c.status === 'missing') return <span className="pill warn">Not in yet</span>;
  if (c.status === 'new') return <span className="pill">New</span>;
  return <span className={'pill ' + (c.flagged ? 'bad' : '')} title={money ? `${formatMoney(c.prev, { dollarSign: true })} → ${formatMoney(c.now, { dollarSign: true })}` : undefined}>{pctText(c.pct)}</span>;
}

const STATUS_PILL = (r: PayrollRun) => (r.status === 'posted' ? <span className="pill ok">Posted</span> : <span className="pill warn">To review &amp; post</span>);

// ── Payroll runs ─────────────────────────────────────────────────────────
export function PayrollRunsPage() {
  const { state, user, visible } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const tab = sp.get('tab') ?? 'runs';
  const runId = sp.get('run');
  const runs = useMemo(() => peopleOf(state).runs.filter((r) => runStores(r).some((s) => visible.has(s))).sort((a, b) => b.payDate.localeCompare(a.payDate) || a.fileName.localeCompare(b.fileName)), [state, visible]);
  const toPost = runs.filter((r) => r.status === 'imported');
  const latest = runs[0]?.payDate;
  const latestRuns = runs.filter((r) => r.payDate === latest);
  const q = latest ? quarterOf(latest) : '';
  const qGross = runs.filter((r) => quarterOf(r.payDate) === q).reduce((a, r) => a + totalsOf(r.lines).gross, 0);
  const posted = runs.filter((r) => r.status === 'posted');
  const tying = posted.filter((r) => postingCheck(state, r).ok);
  const run = runId ? runs.find((r) => r.id === runId) : undefined;
  return (
    <PeopleGuard title="Payroll runs">
      <PageHead eyebrow="People" title="Payroll runs" lede="Every Gusto run with its employee detail. Each one ties to Gusto's own totals before it can post, and each posted run ties to the entries in the books.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('payroll-runs', ['Pay date', 'Stores', 'Employees', 'Gross', 'Employee taxes', 'Employer taxes', 'Net', 'Company debit', 'Check-paid', 'Status', 'Batch'],
          runs.map((r) => { const t = totalsOf(r.lines); return [r.payDate, runStores(r).map((s) => storeCode(state, s)).join(' '), r.lines.length, csvMoney(t.gross), csvMoney(t.employeeTaxes), csvMoney(t.employerTaxes), csvMoney(t.net), csvMoney(t.companyDebit), csvMoney(t.checkPaid), r.status, r.batchId]; }))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Payroll runs" style={{ marginBottom: 20 }}>
        <Figure label={latest ? `Latest pay date ${shortDate(latest)}` : 'Latest pay date'} value={<Money c={latestRuns.reduce((a, r) => a + totalsOf(r.lines).companyDebit, 0)} whole dollar />} note={`Company debit, ${latestRuns.length} run${latestRuns.length === 1 ? '' : 's'}`} />
        <Figure label="Runs to review and post" value={toPost.length} note={toPost.length ? <Link to="/people/review">Open the weekly review</Link> : 'Everything is posted'} />
        <Figure label={`Gross pay ${q || ''}`} value={<Money c={qGross} whole dollar />} note="Gusto runs this quarter" />
        <Figure label="Posted runs that tie to the books" value={`${tying.length} of ${posted.length}`} note="Net, taxes, Gusto debit and checks" />
      </section>
      <div className="seg" role="group" aria-label="View" style={{ marginBottom: 16 }}>
        {[['runs', `Runs (${runs.length})`], ['import', 'Import a Gusto report']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => { const n = new URLSearchParams(); n.set('tab', k); setSp(n, { replace: true }); }}>{l}</button>)}
      </div>
      {tab === 'import' ? <ImportRun onDone={(id) => { const n = new URLSearchParams(); n.set('run', id); setSp(n, { replace: true }); }} /> : (
        <div className="stack">
          {run && <RunDetail run={run} onClose={() => set('run', '')} />}
          <section className="panel" aria-labelledby="runs-h">
            <div className="panel-head"><h2 id="runs-h">All runs</h2><span className="muted small">Newest first</span></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Pay date</th><th scope="col">Stores</th><th scope="col" className="num">People</th><th scope="col" className="num">Gross</th><th scope="col" className="num">Taxes</th><th scope="col" className="num">Net</th><th scope="col" className="num">Company debit</th><th scope="col" className="num">Checks</th><th scope="col">Status</th><th scope="col">Ties</th></tr></thead>
              <tbody>{runs.length === 0 ? <tr><td colSpan={10} className="muted">No runs yet. Import the Gusto payroll report.</td></tr> : runs.map((r) => {
                const t = totalsOf(r.lines);
                const ties = runTies(r).every((x) => x.ok) && (r.status !== 'posted' || postingCheck(state, r).ok);
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><Link to={`/people/runs?run=${r.id}`}>{shortDate(r.payDate)}</Link></td>
                    <td>{runStores(r).map((s) => storeCode(state, s)).join(', ')}</td>
                    <td className="num">{r.lines.length}</td>
                    <td className="num"><Money c={t.gross} /></td>
                    <td className="num"><Money c={t.employeeTaxes + t.employerTaxes} /></td>
                    <td className="num"><Money c={t.net} /></td>
                    <td className="num"><Money c={t.companyDebit} /></td>
                    <td className="num">{t.checkPaid ? <Money c={t.checkPaid} /> : <span className="muted">—</span>}</td>
                    <td>{STATUS_PILL(r)}</td>
                    <td>{ties ? <span className="pill ok">Ties</span> : <span className="pill bad">Off</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <TieOut items={[
              { label: `${runs.filter((r) => runTies(r).every((x) => x.ok)).length} of ${runs.length} runs tie to the Gusto report totals`, ok: runs.every((r) => runTies(r).every((x) => x.ok)) },
              { label: `${tying.length} of ${posted.length} posted runs tie to the books`, ok: tying.length === posted.length, detail: '6100 net pay, 6110 taxes, Trustmark debit = company debit' },
            ]} />
          </section>
        </div>
      )}
      <Help k="payrollRuns" />
    </PeopleGuard>
  );
}

function RunDetail({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const exportCsv = useExport();
  const t = totalsOf(run.lines);
  const pc = postingCheck(state, run);
  const flags = rateFlags(state, run);
  const groups = new Map<string, typeof t & { n: number }>();
  for (const l of run.lines) {
    const k = `${storeCode(state, l.storeId)} · ${DEPT_LABEL[l.department]}`;
    const g = groups.get(k) ?? { ...totalsOf([]), n: 0 };
    const add = totalsOf([l]);
    for (const f of ['gross', 'employeeTaxes', 'employerTaxes', 'net', 'companyDebit', 'checkPaid'] as const) g[f] += add[f];
    g.n += 1;
    groups.set(k, g);
  }
  const lines = [...run.lines].sort((a, b) => a.storeId.localeCompare(b.storeId) || empName(state, a.employeeId).localeCompare(empName(state, b.employeeId)));
  return (
    <section className="panel" aria-labelledby="rd-h">
      <div className="panel-head">
        <h2 id="rd-h">Run paid {shortDate(run.payDate)} {STATUS_PILL(run)}</h2>
        <div className="actions">
          {can(user, 'export') && <button className="btn sm" onClick={() => exportCsv(`payroll-run-${run.payDate}`, ['Employee', 'Store', 'Department', 'Hours', 'OT hours', 'Gross', 'Employee taxes', 'Employer taxes', 'State taxes', 'Net', 'Paid by'],
            lines.map((l) => [empName(state, l.employeeId), storeCode(state, l.storeId), DEPT_LABEL[l.department], l.hours, l.otHours, csvMoney(l.gross), csvMoney(l.employeeTaxes), csvMoney(l.employerTaxes), csvMoney(l.stateTaxes), csvMoney(l.net), l.check ? `Check ${l.check.checkNo ?? ''}`.trim() : 'Direct deposit']))}>Export CSV</button>}
          <button className="btn sm ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="panel-pad">
        <p className="muted small">{run.fileName} · batch {run.batchId} · imported {shortDate(run.importedAt.slice(0, 10))}{run.periodStart && ` · period ${shortDate(run.periodStart)} – ${shortDate(run.periodEnd ?? run.payDate)}`}</p>
        {flags.length > 0 && <div className="note warn" style={{ marginTop: 8 }}><b>Paid rate differs from the approved rate.</b><ul>{flags.map((f) => <li key={f.line.id}>{rateFlagText(f)}</li>)}</ul></div>}
      </div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Employee</th><th scope="col">Store</th><th scope="col">Dept</th><th scope="col" className="num">Hours</th><th scope="col" className="num">OT</th><th scope="col" className="num">Gross</th><th scope="col" className="num">Employee taxes</th><th scope="col" className="num">Employer taxes</th><th scope="col" className="num">Net</th><th scope="col">Paid by</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}><td><Link to={`/people/employees?id=${l.employeeId}`}>{empName(state, l.employeeId)}</Link></td><td>{storeCode(state, l.storeId)}</td><td>{DEPT_LABEL[l.department]}</td>
              <td className="num">{hrs(l.hours)}</td><td className="num">{l.otHours ? hrs(l.otHours) : ''}</td><td className="num"><Money c={l.gross} /></td><td className="num"><Money c={l.employeeTaxes} /></td><td className="num"><Money c={l.employerTaxes} /></td><td className="num"><Money c={l.net} /></td>
              <td>{l.check ? <span className="pill">Check {l.check.checkNo}</span> : 'Direct deposit'}</td></tr>
          ))}
          <tr className="total"><td colSpan={5}>Run total</td><td className="num"><Money c={t.gross} /></td><td className="num"><Money c={t.employeeTaxes} /></td><td className="num"><Money c={t.employerTaxes} /></td><td className="num"><Money c={t.net} /></td><td /></tr>
        </tbody>
      </table></div>
      <div className="table-wrap"><table className="t">
        <caption className="sr-only">By store and department</caption>
        <thead><tr><th scope="col">Store · department</th><th scope="col" className="num">People</th><th scope="col" className="num">Gross</th><th scope="col" className="num">Taxes</th><th scope="col" className="num">Net</th><th scope="col" className="num">Company debit</th></tr></thead>
        <tbody>{[...groups].sort().map(([k, g]) => <tr key={k}><td>{k}</td><td className="num">{g.n}</td><td className="num"><Money c={g.gross} /></td><td className="num"><Money c={g.employeeTaxes + g.employerTaxes} /></td><td className="num"><Money c={g.net} /></td><td className="num"><Money c={g.companyDebit} /></td></tr>)}</tbody>
      </table></div>
      <TieOut items={[
        ...runTies(run).map((x) => ({ label: `${x.label} ties to the Gusto report`, ok: x.ok, detail: x.detail })),
        { label: run.status === 'posted' ? (pc.ok ? 'Posted entries tie to the run' : 'Posted entries do not tie') : 'Not posted yet', ok: pc.ok, detail: run.status === 'posted' ? (pc.ok ? <>{run.txnIds.map((id) => { const tx = state.transactions.find((x) => x.id === id); return tx ? <Link key={id} to={`/books/transactions/${id}`} style={{ marginRight: 6 }}>{tx.ref}</Link> : null; })}</> : pc.problems.join('; ')) : `Company debit ${formatMoney(t.companyDebit, { dollarSign: true })}${t.checkPaid ? ` + paper checks ${formatMoney(t.checkPaid, { dollarSign: true })}` : ''} will post on ${shortDate(run.payDate)}` },
      ]} />
      {run.status === 'imported' && can(user, 'payroll.edit') && (
        <div className="panel-pad actions">
          <button className="btn primary" onClick={() => { try { const tx = postRun(books, user, run.id); say(`Posted ${tx.map((x) => x.ref).join(', ')}.`); } catch (e) { say(errText(e)); } }}>Post this run</button>
          <span className="muted small">Net pay to 6100 and taxes to 6110 by store, credit Trustmark. <Link to={`/people/review?week=${run.payDate}`}>Review the week first</Link>.</span>
        </div>
      )}
      {toast}
    </section>
  );
}

export function rateFlagText(f: RateFlag): string {
  const base = `${f.employee.name}: paid ${formatMoney(f.paidRate, { dollarSign: true })}/hr, approved rate ${formatMoney(f.approvedRate, { dollarSign: true })}/hr.`;
  return f.pending && f.pending.toCents === f.paidRate ? `${base} Gusto already pays the raise waiting for approval: approve it or fix Gusto.` : `${base} Fix the rate in Gusto or request a rate change.`;
}

function ImportRun({ onDone }: { onDone: (runId: ID) => void }) {
  const { state, books, user } = useBooks();
  const [file, setFile] = useState<{ name: string; parsed: ParsedGusto } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const pv = useMemo(() => (file ? previewRun(state, file.parsed) : null), [file, state]);
  const read = async (f: File | undefined) => {
    setErrors([]);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setErrors(['That file is over 5 MB. Export one payroll run at a time.']); return; }
    if (!/\.(csv|txt)$/i.test(f.name)) { setErrors(['Save the Gusto report as CSV (Reports › Payroll journal › Export CSV) and upload that.']); return; }
    const parsed = parseGustoCsv(await f.text());
    if (!parsed.rows.length) { setErrors(parsed.problems.length ? parsed.problems : ['No employee rows found in that file.']); return; }
    setFile({ name: f.name, parsed });
  };
  return (
    <div className="stack">
      <section className="panel panel-pad" aria-labelledby="gi-h">
        <h2 id="gi-h" style={{ marginBottom: 8 }}>Import a Gusto payroll report</h2>
        <p className="muted">The payroll journal saved as CSV: one row per employee with pay date, employee, location (store code), hours, gross, employee taxes, employer taxes and net pay, plus Gusto's Total row. Importing the same report twice never duplicates a line.</p>
        {can(user, 'payroll.edit') ? <label className="btn" style={{ margin: '8px 0' }}>Choose file<input type="file" accept=".csv,.txt" className="sr-only" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} /></label> : <p className="muted">Your role can't import payroll.</p>}
        <Errors errors={errors} />
      </section>
      {file && pv && (
        <section className="panel" aria-labelledby="gp-h">
          <div className="panel-head"><h2 id="gp-h">Preview: {file.name}</h2><span className="muted small">{pv.payDate ? `Pay date ${shortDate(pv.payDate)}` : 'No pay date'}</span></div>
          {(file.parsed.problems.length > 0 || pv.errors.length > 0 || pv.newEmployees.length > 0) && (
            <div className="panel-pad stack" style={{ gap: 8 }}>
              {pv.errors.length > 0 && <div className="note err" role="alert"><b>Fix these before importing.</b><ul>{pv.errors.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul></div>}
              {file.parsed.problems.length > 0 && <div className="note warn"><b>{file.parsed.problems.length} row(s) skipped.</b><ul>{file.parsed.problems.slice(0, 5).map((x) => <li key={x}>{x}</li>)}</ul></div>}
              {pv.newEmployees.length > 0 && <div className="note">New in Gusto: <b>{pv.newEmployees.join(', ')}</b>. They'll be added and listed as new hires to confirm.</div>}
            </div>
          )}
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Employee</th><th scope="col">Store</th><th scope="col" className="num">Hours</th><th scope="col" className="num">Gross</th><th scope="col" className="num">Taxes</th><th scope="col" className="num">Net</th><th scope="col">Status</th></tr></thead>
            <tbody>{pv.rows.map((r) => (
              <tr key={r.hash}><td>{r.name}</td><td>{r.storeId ? storeCode(state, r.storeId) : <span className="neg">{r.store || '?'}</span>}</td><td className="num">{hrs(r.hours + r.otHours)}</td><td className="num"><Money c={r.gross} /></td><td className="num"><Money c={r.employeeTaxes + r.employerTaxes} /></td><td className="num"><Money c={r.net} /></td>
                <td>{r.duplicate ? <span className="pill">Already imported</span> : !r.rowTies ? <span className="pill bad">Doesn't add up</span> : r.employeeId ? <span className="pill ok">New</span> : <span className="pill warn">New employee</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: `${pv.added} new, ${pv.skipped} already imported`, ok: true, detail: <>gross <Money c={pv.totals.gross} dollar /> · company debit <Money c={pv.totals.companyDebit} dollar />{pv.totals.checkPaid ? <> · paper checks <Money c={pv.totals.checkPaid} dollar /></> : null}</> },
            ...pv.checks,
          ]} />
          <div className="panel-pad actions">
            <button className="btn primary" disabled={!pv.added || pv.errors.length > 0} onClick={() => { try { const r = commitRun(books, user, file.name, file.parsed); setFile(null); onDone(r.id); } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); } }}>Import {pv.added} new line{pv.added === 1 ? '' : 's'}</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Weekly review ────────────────────────────────────────────────────────
export function WeeklyReviewPage() {
  const { state, books, user, visible } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const exportCsv = useExport();
  const weeks = useMemo(() => payWeeks(state), [state]);
  const week = sp.get('week') ?? weeks[0] ?? '';
  const onlyFlagged = sp.get('all') !== '1';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const r = useMemo(() => weeklyReview(state, week || '2026-11-27', visible), [state, week, visible]);
  const [posted, setPosted] = useState<string[]>([]);
  const flaggedStores = r.stores.filter((s) => s.cost.flagged);
  const empRows = onlyFlagged ? r.employees.filter((e) => e.flags.some((f) => f !== 'overtime') || e.flags.length > 1) : r.employees;
  const newHires = r.stores.flatMap((s) => s.newHires);
  const terms = r.stores.flatMap((s) => s.terminations);
  const runsTie = r.runs.every((x) => runTies(x).every((y) => y.ok));
  if (!weeks.length) return <PeopleGuard title="Weekly payroll review"><PageHead eyebrow="People" title="Weekly payroll review" lede="No payroll yet. Import the Gusto report first." /></PeopleGuard>;
  return (
    <PeopleGuard title="Weekly payroll review">
      <PageHead eyebrow="People" title="Weekly payroll review" lede={<>Pay week {shortDate(addDays(r.week, -6))} – {shortDate(r.week)} against the week before. Work down the page: the run, the stores, the people, rate changes, then post.</>}>
        <div className="field" style={{ width: 200 }}><label htmlFor="wr-week">Pay date</label><select id="wr-week" value={r.week} onChange={(e) => set('week', e.target.value)}>{weeks.map((w) => <option key={w} value={w}>{shortDate(w)}</option>)}</select></div>
      </PageHead>
      <section className="figures" aria-label="This week" style={{ marginBottom: 20 }}>
        <Figure label="Labor cost this week" value={<Money c={r.total.cost.now} whole dollar />} note={<>vs <Money c={r.total.cost.prev} whole dollar /> last week · {pctText(r.total.cost.pct)}</>} />
        <Figure label="Hours" value={hrs(r.total.hours.now)} note={`${r.total.otHours ? hrs(r.total.otHours) + ' overtime · ' : ''}last week ${hrs(r.total.hours.prev)}`} />
        <Figure label="Headcount paid" value={r.total.headcount.now} note={`${newHires.length} new hire${newHires.length === 1 ? '' : 's'} · ${terms.length} termination${terms.length === 1 ? '' : 's'}`} />
        <Figure label="Stores over 15% week to week" value={flaggedStores.length} note={flaggedStores.length ? flaggedStores.map((s) => `${storeCode(state, s.storeId)} ${pctText(s.cost.pct)}`).join(', ') : 'None'} />
        <Figure label="Rate changes to approve" value={r.pending.length} note={r.rateFlags.length ? `${r.rateFlags.length} paid at a rate not yet approved` : 'Gusto rates match approvals'} />
      </section>

      <div className="stack">
        <section className="panel" aria-labelledby="s1-h">
          <div className="panel-head"><h2 id="s1-h">1 · Gusto runs for the week</h2><Link className="btn sm" to="/people/runs?tab=import">Import a report</Link></div>
          {r.runs.length === 0 ? <p className="panel-pad muted">No Gusto run for this pay date yet. Import the report from Gusto first.</p> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Run</th><th scope="col" className="num">People</th><th scope="col" className="num">Gross</th><th scope="col" className="num">Company debit</th><th scope="col">Ties to Gusto</th><th scope="col">Status</th></tr></thead>
              <tbody>{r.runs.map((x) => { const t = totalsOf(x.lines); const ok = runTies(x).every((y) => y.ok); return (
                <tr key={x.id}><td><Link to={`/people/runs?run=${x.id}`}>{runStores(x).map((s) => storeCode(state, s)).join(', ')} · {shortDate(x.payDate)}</Link></td><td className="num">{x.lines.length}</td><td className="num"><Money c={t.gross} /></td><td className="num"><Money c={t.companyDebit} /></td><td>{ok ? <span className="pill ok">Ties</span> : <span className="pill bad">Off</span>}</td><td>{STATUS_PILL(x)}</td></tr>
              ); })}</tbody>
            </table></div>
          )}
          <TieOut items={[{ label: runsTie ? 'Every run ties to its Gusto report totals' : 'A run does not tie to its report', ok: runsTie && r.runs.length > 0, detail: `${r.runs.length} run${r.runs.length === 1 ? '' : 's'}` }]} />
        </section>

        <section className="panel" aria-labelledby="s2-h">
          <div className="panel-head"><h2 id="s2-h">2 · This week vs last, by store</h2><span className="muted small">Labor cost = gross + employer taxes + cash/check pay</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">This week</th><th scope="col" className="num">Last week</th><th scope="col">Change</th><th scope="col" className="num">Hours</th><th scope="col">Hours change</th><th scope="col" className="num">OT</th><th scope="col" className="num">People</th><th scope="col">Hires · leavers · rates</th></tr></thead>
            <tbody>
              {r.stores.map((s) => (
                <tr key={s.storeId}>
                  <td><b>{storeCode(state, s.storeId)}</b>{(s.now?.cash || s.now?.unassigned) ? <div className="muted small">incl. cash <Money c={(s.now?.cash ?? 0) + (s.now?.unassigned ?? 0)} /></div> : null}</td>
                  <td className="num"><Money c={s.cost.now} /></td><td className="num"><Money c={s.cost.prev} /></td><td><ChangeCell c={s.cost} /></td>
                  <td className="num">{hrs(s.hours.now)}</td><td><ChangeCell c={s.hours} money={false} /></td><td className="num">{s.now?.otHours ? hrs(s.now.otHours) : ''}</td><td className="num">{s.now?.headcount ?? 0}</td>
                  <td className="small">{[s.newHires.length && `${s.newHires.length} hired`, s.terminations.length && `${s.terminations.length} left`, s.rateChanges.length && `${s.rateChanges.length} rate change${s.rateChanges.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                </tr>
              ))}
              <tr className="total"><td>Total</td><td className="num"><Money c={r.total.cost.now} /></td><td className="num"><Money c={r.total.cost.prev} /></td><td><ChangeCell c={r.total.cost} /></td><td className="num">{hrs(r.total.hours.now)}</td><td><ChangeCell c={r.total.hours} money={false} /></td><td className="num">{hrs(r.total.otHours)}</td><td className="num">{r.total.headcount.now}</td><td /></tr>
            </tbody>
          </table></div>
          <TieOut items={[{ label: 'Store rows add to the total', ok: r.stores.reduce((a, s) => a + s.cost.now, 0) === r.total.cost.now && r.stores.reduce((a, s) => a + s.cost.prev, 0) === r.total.cost.prev },
            ...(r.stores.some((s) => s.cost.status === 'missing') ? [{ label: 'Some stores have no payroll recorded for this week yet', ok: false, detail: r.stores.filter((s) => s.cost.status === 'missing').map((s) => storeCode(state, s.storeId)).join(', ') + ' — record cash pay on Cash & check pay' }] : [])]} />
        </section>

        <section className="panel" aria-labelledby="s3-h">
          <div className="panel-head">
            <h2 id="s3-h">3 · By employee</h2>
            <div className="actions">
              <label className="check"><input type="checkbox" checked={onlyFlagged} onChange={(e) => set('all', e.target.checked ? '' : '1')} /> Only people with something to check</label>
              {can(user, 'export') && <button className="btn sm" onClick={() => exportCsv(`weekly-review-${r.week}`, ['Employee', 'Store', 'Pay this week', 'Pay last week', 'Change %', 'Hours this week', 'Hours last week', 'OT hours', 'Cash/check', 'Flags'],
                r.employees.map((e) => [empName(state, e.employeeId), storeCode(state, e.storeId), csvMoney(e.pay.now), csvMoney(e.pay.prev), e.pay.pct === null ? '' : (e.pay.pct * 100).toFixed(1), e.hours.now, e.hours.prev, e.now?.otHours ?? 0, csvMoney((e.now?.cash ?? 0) + (e.now?.check ?? 0)), e.flags.map((f) => EMP_FLAG_LABEL[f]).join('; ')]))}>Export CSV</button>}
            </div>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Employee</th><th scope="col">Store</th><th scope="col" className="num">Pay this week</th><th scope="col" className="num">Last week</th><th scope="col">Change</th><th scope="col" className="num">Hours</th><th scope="col" className="num">OT</th><th scope="col">To check</th></tr></thead>
            <tbody>{empRows.length === 0 ? <tr><td colSpan={8} className="muted">Nothing unusual for anyone this week.</td></tr> : empRows.map((e) => (
              <tr key={e.employeeId}>
                <td><Link to={`/people/employees?id=${e.employeeId}`}>{empName(state, e.employeeId)}</Link></td><td>{storeCode(state, e.storeId)}</td>
                <td className="num"><Money c={e.pay.now} />{e.now && (e.now.cash + e.now.check) > 0 && <div className="muted small">cash/check <Money c={e.now.cash + e.now.check} /></div>}</td><td className="num"><Money c={e.pay.prev} /></td><td><ChangeCell c={e.pay} /></td>
                <td className="num">{hrs(e.hours.now)}</td><td className="num">{e.now?.otHours ? hrs(e.now.otHours) : ''}</td>
                <td>{e.flags.map((f) => <span key={f} className={'pill ' + (f === 'wow' || f === 'paid_after_termination' || f === 'rate_mismatch' ? 'bad' : f === 'overtime' ? '' : 'warn')} style={{ marginRight: 4 }}>{EMP_FLAG_LABEL[f]}</span>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[{ label: 'Employee pay adds to the store totals', ok: r.employees.reduce((a, e) => a + (e.now ? e.now.gross + e.now.employerTaxes + e.now.cash + e.now.check : 0), 0) + r.stores.reduce((a, s) => a + (s.now?.unassigned ?? 0), 0) === r.total.cost.now, detail: `${r.employees.length} people paid this week or last` }]} />
        </section>

        <section className="panel" aria-labelledby="s4-h">
          <div className="panel-head"><h2 id="s4-h">4 · Rate changes to approve</h2><Link className="small" to="/people/employees?show=pending">All rate changes</Link></div>
          {r.rateFlags.length > 0 && <div className="panel-pad"><div className="note warn"><b>Paid rate differs from the approved rate.</b><ul>{r.rateFlags.map((f) => <li key={f.line.id}>{rateFlagText(f)}</li>)}</ul></div></div>}
          <RateApprovals list={r.pending} onMsg={say} />
        </section>

        <section className="panel" aria-labelledby="s5-h">
          <div className="panel-head"><h2 id="s5-h">5 · Post to the books</h2></div>
          <div className="panel-pad">
            {r.toPost.length === 0 ? <p className="muted">{r.runs.length ? 'Every run for this week is posted.' : 'Nothing to post yet.'} {posted.length > 0 && <>Posted {posted.join(', ')}.</>}</p> : (
              <>
                <p>Posts {r.toPost.length} run{r.toPost.length === 1 ? '' : 's'} on {shortDate(r.week)}: net pay <Money c={r.toPost.reduce((a, x) => a + totalsOf(x.lines).net, 0)} dollar /> to 6100 and taxes <Money c={r.toPost.reduce((a, x) => { const t = totalsOf(x.lines); return a + t.employeeTaxes + t.employerTaxes; }, 0)} dollar /> to 6110 by store, credit Trustmark <Money c={r.toPost.reduce((a, x) => { const t = totalsOf(x.lines); return a + t.companyDebit + t.checkPaid; }, 0)} dollar />.</p>
                {(r.rateFlags.length > 0 || flaggedStores.length > 0) && <p className="note warn">{r.rateFlags.length > 0 && 'A rate in Gusto is not approved yet. '}{flaggedStores.length > 0 && `${flaggedStores.map((s) => storeCode(state, s.storeId)).join(', ')} moved more than 15%: make sure you know why.`}</p>}
                {can(user, 'payroll.edit') ? <button className="btn primary" style={{ marginTop: 8 }} onClick={() => { try { const tx = postWeek(books, user, r.week, visible); setPosted(tx.map((t) => t.ref)); say(`Posted ${tx.length} entries.`); } catch (e) { say(errText(e)); } }}>Post {r.toPost.length} run{r.toPost.length === 1 ? '' : 's'} to the books</button> : <p className="muted">Your role can't post payroll.</p>}
              </>
            )}
          </div>
          <TieOut items={r.runs.some((x) => x.status === 'posted')
            ? r.runs.filter((x) => x.status === 'posted').map((x) => { const pc = postingCheck(state, x); return { label: `${runStores(x).map((s) => storeCode(state, s)).join(', ')} posted entries tie to the run`, ok: pc.ok, detail: pc.ok ? formatMoney(pc.gustoDebit + pc.checks, { dollarSign: true }) : pc.problems.join('; ') }; })
            : [{ label: r.runs.length ? 'Not posted yet' : 'No runs this week', ok: false, detail: r.runs.length ? 'the tie to the books shows here once posted' : 'import the Gusto report first' }]} />
        </section>
      </div>
      {toast}
      <Help k="weeklyReview" />
    </PeopleGuard>
  );
}

/** Approve or reject pending rate changes in place. */
export function RateApprovals({ list, onMsg }: { list: RateChange[]; onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const [notes, setNotes] = useState<Record<ID, string>>({});
  if (!list.length) return <p className="panel-pad muted">No rate changes waiting for approval.</p>;
  const canApprove = canApproveKind(state, user, 'rate_change');
  return (
    <ul className="inbox">{list.map((r) => {
      const e = employee(state, r.employeeId);
      const by = state.users.find((u) => u.id === r.requestedBy)?.name ?? r.requestedBy;
      return (
        <li key={r.id} style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
          <div><b>{e?.name}</b> <span className="muted">({e && storeCode(state, e.storeId)} · {e && DEPT_LABEL[e.department]})</span>: <Money c={r.fromCents} dollar /> → <b><Money c={r.toCents} dollar /></b>{e?.payType === 'salary' ? ' a week' : ' an hour'} from {shortDate(r.effective)}
            <span className="pill warn" style={{ marginLeft: 6 }}>{pctText((r.toCents - r.fromCents) / r.fromCents)}</span>
            <div className="muted small">“{r.reason}” · requested by {by} {shortDate(r.requestedAt.slice(0, 10))}</div>
          </div>
          {canApprove ? (
            <div className="actions">
              <button className="btn sm primary" onClick={() => { try { decideRateChange(books, user, r.id, 'approved'); onMsg(`Approved the raise for ${e?.name}.`); } catch (x) { onMsg(errText(x)); } }}>Approve</button>
              <label className="sr-only" htmlFor={'rj-' + r.id}>Reason for rejecting</label>
              <input id={'rj-' + r.id} placeholder="Reason, if rejecting" value={notes[r.id] ?? ''} onChange={(ev) => setNotes({ ...notes, [r.id]: ev.target.value })} style={{ maxWidth: 260 }} />
              <button className="btn sm" onClick={() => { try { decideRateChange(books, user, r.id, 'rejected', notes[r.id]); onMsg('Rejected.'); } catch (x) { onMsg(errText(x)); } }}>Reject</button>
            </div>
          ) : <span className="muted small">Waiting for the CFO or an owner to approve.</span>}
        </li>
      );
    })}</ul>
  );
}
