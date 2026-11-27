import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  DEPT_LABEL, PAY_METHOD_LABEL, compareByEmployeeWeek, confirmExtraPay, confirmHire, currentRate, laborPct, laborTarget, ledgerPayroll, markChecklist, newHiresToConfirm,
  payWeek, payWeeks, payoutAllocations, peopleOf, pendingRateChanges, quarterChecklist, quarterOf, rateHistory, recordOffPayroll, recordTaxDeposit, requestRateChange,
  saveEmployee, seasonChecklist, setLaborTarget, taxTracker, terminateEmployee, weekIndex, ytdGustoTie, type ChecklistItem, type CompareStatus, type EmployeeInput,
} from '../../core/payroll';
import { addDays, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { bankStoreId } from '../../core/bank';
import type { Department, Employee, ID, EmployeePayMethod, TaxAgency } from '../../core/types';
import { PeopleGuard, RateApprovals, empName, errText, hrs, pctText, storeCode } from './Payroll';

const DEPTS = Object.keys(DEPT_LABEL) as Department[];
const METHODS = Object.keys(PAY_METHOD_LABEL) as EmployeePayMethod[];
const errs = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);

// ── Employees ────────────────────────────────────────────────────────────
export function EmployeesPage() {
  const { state, user, visible, stores } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const exportCsv = useExport();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const show = sp.get('show') ?? '';
  const store = sp.get('store') ?? '';
  const dept = sp.get('dept') ?? '';
  const status = sp.get('status') ?? 'active';
  const q = (sp.get('q') ?? '').toLowerCase();
  const id = sp.get('id');
  const [adding, setAdding] = useState(false);
  const today = todayInChicago();
  const all = peopleOf(state).employees.filter((e) => visible.has(e.storeId));
  const pending = pendingRateChanges(state, visible);
  const hires = newHiresToConfirm(state, visible);
  const pendingIds = new Set(pending.map((r) => r.employeeId));
  const rows = all.filter((e) => (!store || e.storeId === store) && (!dept || e.department === dept) && (status === 'all' || e.status === status) && (!q || e.name.toLowerCase().includes(q))
    && (show !== 'pending' || pendingIds.has(e.id)) && (show !== 'new' || !e.hireReviewed))
    .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.name.localeCompare(b.name));
  const active = all.filter((e) => e.status === 'active');
  const qtr = quarterOf(today);
  const leavers = all.filter((e) => e.terminatedOn && quarterOf(e.terminatedOn) === qtr);
  const sel = id ? all.find((e) => e.id === id) : undefined;
  const byStore = stores.filter((s) => active.some((e) => e.storeId === s.id)).map((s) => `${s.code} ${active.filter((e) => e.storeId === s.id).length}`).join(' · ');
  return (
    <PeopleGuard title="Employees">
      <PageHead eyebrow="People" title="Employees" lede="Everyone on payroll, how they're paid, and every rate change. A rate only changes once someone with approval rights approves it, with a reason and an effective date.">
        {can(user, 'payroll.edit') && <button className="btn" onClick={() => setAdding(!adding)} aria-expanded={adding}>Add employee</button>}
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('employees', ['Name', 'Store', 'Department', 'Pay type', 'Current rate', 'Paid by', 'Hired', 'Status', 'Left', 'Gusto id'],
          rows.map((e) => [e.name, storeCode(state, e.storeId), DEPT_LABEL[e.department], e.payType, csvMoney(currentRate(state, e, today)), PAY_METHOD_LABEL[e.paidBy], e.hiredOn, e.status, e.terminatedOn ?? '', e.gustoId ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Headcount" style={{ marginBottom: 20 }}>
        <Figure label="Active employees" value={active.length} note={byStore} />
        <Figure label="Rate changes to approve" value={pending.length} note={pending.length ? <button className="btn sm ghost" onClick={() => set('show', 'pending')}>Show them</button> : 'None waiting'} />
        <Figure label="New hires to confirm" value={hires.length} note={hires.length ? hires.map((e) => e.name).join(', ') : 'All confirmed'} />
        <Figure label={`Left in ${qtr}`} value={leavers.length} note={leavers.map((e) => `${e.name} ${shortDate(e.terminatedOn!)}`).join(', ') || 'Nobody'} />
      </section>
      <div className="stack">
        {adding && <EmployeeForm onDone={(e) => { setAdding(false); set('id', e.id); say(`Added ${e.name}.`); }} onCancel={() => setAdding(false)} />}
        {(show === 'pending' || pending.length > 0) && (
          <section className="panel" aria-labelledby="pend-h">
            <div className="panel-head"><h2 id="pend-h">Rate changes awaiting approval</h2>{show && <button className="btn sm ghost" onClick={() => set('show', '')}>Show everyone</button>}</div>
            <RateApprovals list={pending} onMsg={say} />
          </section>
        )}
        {(show === 'new' || hires.length > 0) && (
          <section className="panel" aria-labelledby="hire-h">
            <div className="panel-head"><h2 id="hire-h">New hires to confirm</h2></div>
            {hires.length === 0 ? <p className="panel-pad muted">Every new hire is confirmed.</p> : (
              <ul className="inbox">{hires.map((e) => (
                <li key={e.id} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                  <div className="what"><b><Link to={`/people/employees?id=${e.id}`}>{e.name}</Link></b><span>{storeCode(state, e.storeId)} · {DEPT_LABEL[e.department]} · hired {shortDate(e.hiredOn)} · {formatMoney(currentRate(state, e, today), { dollarSign: true })}{e.payType === 'salary' ? '/week' : '/hr'} · {PAY_METHOD_LABEL[e.paidBy]}. Check the W-4, I-9 and the rate before confirming.</span></div>
                  {can(user, 'payroll.edit') && <ConfirmHireButton id={e.id} onMsg={say} />}
                </li>
              ))}</ul>
            )}
          </section>
        )}
        {sel && <EmployeeDetail e={sel} onClose={() => set('id', '')} onMsg={say} />}
        <section className="panel" aria-labelledby="emp-h">
          <div className="panel-head"><h2 id="emp-h">{rows.length} {status === 'all' ? '' : status} employee{rows.length === 1 ? '' : 's'}</h2></div>
          <div className="filters">
            <div className="field"><label htmlFor="em-q">Search</label><input id="em-q" value={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="Name" /></div>
            <div className="field"><label htmlFor="em-s">Store</label><select id="em-s" value={store} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.filter((s) => s.kind !== 'leased_out').map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <div className="field"><label htmlFor="em-d">Department</label><select id="em-d" value={dept} onChange={(e) => set('dept', e.target.value)}><option value="">All</option>{DEPTS.map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}</select></div>
            <div className="field"><label htmlFor="em-st">Status</label><select id="em-st" value={status} onChange={(e) => set('status', e.target.value)}><option value="active">Active</option><option value="terminated">Terminated</option><option value="all">All</option></select></div>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Name</th><th scope="col">Store</th><th scope="col">Department</th><th scope="col" className="num">Current rate</th><th scope="col">Paid by</th><th scope="col">Hired</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="muted">Nobody matches these filters.</td></tr> : rows.map((e) => (
              <tr key={e.id}>
                <td><Link to={`/people/employees?${new URLSearchParams({ ...Object.fromEntries(sp), id: e.id })}`}>{e.name}</Link></td><td>{storeCode(state, e.storeId)}</td><td>{DEPT_LABEL[e.department]}</td>
                <td className="num"><Money c={currentRate(state, e, today)} />{e.payType === 'salary' ? <span className="muted small"> /wk</span> : <span className="muted small"> /hr</span>}</td>
                <td>{PAY_METHOD_LABEL[e.paidBy]}</td><td>{shortDate(e.hiredOn)}</td>
                <td>{e.status === 'terminated' ? <span className="pill">Left {shortDate(e.terminatedOn!)}</span> : <span className="pill ok">Active</span>}{pendingIds.has(e.id) && <span className="pill warn" style={{ marginLeft: 4 }}>Raise pending</span>}{!e.hireReviewed && <span className="pill warn" style={{ marginLeft: 4 }}>New hire</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[{ label: 'Headcount by store adds to the total', ok: stores.reduce((a, s) => a + active.filter((e) => e.storeId === s.id).length, 0) === active.length, detail: `${active.length} active` }]} />
        </section>
      </div>
      {toast}
      <Help k="employees" />
    </PeopleGuard>
  );
}

function ConfirmHireButton({ id, onMsg }: { id: ID; onMsg: (m: string) => void }) {
  const { books, user } = useBooks();
  return <button className="btn sm" onClick={() => { try { confirmHire(books, user, id); onMsg('New hire confirmed.'); } catch (e) { onMsg(errText(e)); } }}>Confirm hire</button>;
}

function EmployeeForm({ e, onDone, onCancel }: { e?: Employee; onDone: (e: Employee) => void; onCancel: () => void }) {
  const { books, user, stores } = useBooks();
  const [f, setF] = useState({ name: e?.name ?? '', storeId: e?.storeId ?? stores.find((s) => s.kind === 'operating')?.id ?? '', department: e?.department ?? 'front' as Department, payType: e?.payType ?? 'hourly' as Employee['payType'], rate: e ? (e.rateCents / 100).toFixed(2) : '', hiredOn: e?.hiredOn ?? todayInChicago(), gustoId: e?.gustoId ?? '', paidBy: e?.paidBy ?? 'gusto' as EmployeePayMethod });
  const [errors, setErrors] = useState<string[]>([]);
  const k = e ? 'ee' : 'ne';
  return (
    <section className="panel panel-pad" aria-labelledby={k + '-h'}>
      <h2 id={k + '-h'} style={{ marginBottom: 12 }}>{e ? `Edit ${e.name}` : 'Add an employee'}</h2>
      <Errors errors={errors} />
      <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
        <div className="field"><label htmlFor={k + '-n'}>Name</label><input id={k + '-n'} value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></div>
        <div className="field"><label htmlFor={k + '-s'}>Store</label><select id={k + '-s'} value={f.storeId} onChange={(x) => setF({ ...f, storeId: x.target.value })}>{stores.filter((s) => s.kind !== 'leased_out').map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
        <div className="field"><label htmlFor={k + '-d'}>Department</label><select id={k + '-d'} value={f.department} onChange={(x) => setF({ ...f, department: x.target.value as Department })}>{DEPTS.map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}</select></div>
        <div className="field"><label htmlFor={k + '-t'}>Pay type</label><select id={k + '-t'} value={f.payType} disabled={!!e} onChange={(x) => setF({ ...f, payType: x.target.value as Employee['payType'] })}><option value="hourly">Hourly</option><option value="salary">Salary (weekly)</option></select></div>
        {!e && <div className="field"><label htmlFor={k + '-r'}>Starting rate</label><input id={k + '-r'} className="num" inputMode="decimal" value={f.rate} onChange={(x) => setF({ ...f, rate: x.target.value })} placeholder={f.payType === 'hourly' ? 'per hour' : 'per week'} /></div>}
        <div className="field"><label htmlFor={k + '-h2'}>Hired</label><input id={k + '-h2'} type="date" value={f.hiredOn} onChange={(x) => setF({ ...f, hiredOn: x.target.value })} /></div>
        <div className="field"><label htmlFor={k + '-p'}>Paid by</label><select id={k + '-p'} value={f.paidBy} onChange={(x) => setF({ ...f, paidBy: x.target.value as EmployeePayMethod })}>{METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}</select></div>
        <div className="field"><label htmlFor={k + '-g'}>Gusto id</label><input id={k + '-g'} value={f.gustoId} onChange={(x) => setF({ ...f, gustoId: x.target.value })} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => {
          const rate = e ? e.rateCents : parseMoney(f.rate);
          const input: EmployeeInput = { id: e?.id, name: f.name, storeId: f.storeId, department: f.department, payType: f.payType, rateCents: rate ?? NaN, hiredOn: f.hiredOn, gustoId: f.gustoId, paidBy: f.paidBy };
          try { onDone(saveEmployee(books, user, input)); } catch (x) { setErrors(errs(x)); }
        }}>{e ? 'Save details' : 'Add employee'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        {e && <span className="muted small">Rates change through "Change rate" so they go through approval.</span>}
      </div>
    </section>
  );
}

function EmployeeDetail({ e, onClose, onMsg }: { e: Employee; onClose: () => void; onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const today = todayInChicago();
  const [mode, setMode] = useState<'' | 'rate' | 'terminate' | 'edit'>('');
  const [rate, setRate] = useState({ to: '', effective: today, reason: '' });
  const [term, setTerm] = useState({ date: today, reason: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const hist = rateHistory(state, e.id);
  const idx = useMemo(() => weekIndex(state), [state]);
  const recent = [...idx].filter(([, m]) => m.has(e.id)).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).map(([wk, m]) => ({ wk, w: m.get(e.id)! }));
  const canEdit = can(user, 'payroll.edit');
  const userName = (id?: string) => state.users.find((u) => u.id === id)?.name ?? id ?? '';
  if (mode === 'edit') return <EmployeeForm e={e} onDone={() => { setMode(''); onMsg('Saved.'); }} onCancel={() => setMode('')} />;
  return (
    <section className="panel" aria-labelledby="ed-h">
      <div className="panel-head">
        <h2 id="ed-h">{e.name}</h2>
        <div className="actions">
          {canEdit && e.status === 'active' && <><button className="btn sm" aria-pressed={mode === 'rate'} onClick={() => setMode(mode === 'rate' ? '' : 'rate')}>Change rate</button><button className="btn sm" onClick={() => setMode('edit')}>Edit details</button><button className="btn sm ghost" aria-pressed={mode === 'terminate'} onClick={() => setMode(mode === 'terminate' ? '' : 'terminate')}>Terminate…</button></>}
          <button className="btn sm ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="panel-pad">
        <dl className="kv">
          <dt>Store · department</dt><dd>{storeCode(state, e.storeId)} · {DEPT_LABEL[e.department]}</dd>
          <dt>Current rate</dt><dd><Money c={currentRate(state, e, today)} dollar /> {e.payType === 'salary' ? 'a week (salary)' : 'an hour'}{e.payType === 'hourly' && ' · overtime at 1.5× over 40 hours'}</dd>
          <dt>Paid by</dt><dd>{PAY_METHOD_LABEL[e.paidBy]}{e.gustoId && ` · Gusto id ${e.gustoId}`}</dd>
          <dt>Hired</dt><dd>{shortDate(e.hiredOn)} {e.hireReviewed ? <span className="muted small">confirmed by {userName(e.hireReviewed.by)}</span> : <span className="pill warn">To confirm</span>}</dd>
          <dt>Status</dt><dd>{e.status === 'terminated' ? `Left ${shortDate(e.terminatedOn!)}` : 'Active'}</dd>
          {e.notes && <><dt>Notes</dt><dd>{e.notes}</dd></>}
        </dl>
        <Errors errors={errors} />
        {mode === 'rate' && (
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="field"><label htmlFor="rc-to">New rate</label><input id="rc-to" className="num" inputMode="decimal" value={rate.to} onChange={(x) => setRate({ ...rate, to: x.target.value })} placeholder={(currentRate(state, e, today) / 100).toFixed(2)} /></div>
            <div className="field"><label htmlFor="rc-eff">Effective</label><input id="rc-eff" type="date" value={rate.effective} onChange={(x) => setRate({ ...rate, effective: x.target.value })} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="rc-why">Reason</label><input id="rc-why" value={rate.reason} onChange={(x) => setRate({ ...rate, reason: x.target.value })} placeholder="e.g. 90-day review" /></div>
            <div className="actions" style={{ alignSelf: 'end' }}><button className="btn primary" onClick={() => { try { requestRateChange(books, user, { employeeId: e.id, toCents: parseMoney(rate.to) ?? NaN, effective: rate.effective, reason: rate.reason }); setMode(''); setErrors([]); onMsg('Rate change sent for approval.'); } catch (x) { setErrors(errs(x)); } }}>Send for approval</button></div>
          </div>
        )}
        {mode === 'terminate' && (
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="field"><label htmlFor="tm-d">Last day worked</label><input id="tm-d" type="date" value={term.date} onChange={(x) => setTerm({ ...term, date: x.target.value })} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="tm-r">Reason</label><input id="tm-r" value={term.reason} onChange={(x) => setTerm({ ...term, reason: x.target.value })} placeholder="Resigned, let go, seasonal…" /></div>
            <div className="actions" style={{ alignSelf: 'end' }}><button className="btn danger" onClick={() => { try { terminateEmployee(books, user, e.id, term.date, term.reason); setMode(''); setErrors([]); onMsg('Termination recorded. Make sure Gusto has it too.'); } catch (x) { setErrors(errs(x)); } }}>Record termination</button></div>
          </div>
        )}
      </div>
      <div className="table-wrap"><table className="t">
        <caption className="sr-only">Rate history</caption>
        <thead><tr><th scope="col">Effective</th><th scope="col" className="num">From</th><th scope="col" className="num">To</th><th scope="col">Reason</th><th scope="col">Status</th><th scope="col">Decided</th></tr></thead>
        <tbody>
          {hist.map((r) => (
            <tr key={r.id}><td>{shortDate(r.effective)}</td><td className="num"><Money c={r.fromCents} /></td><td className="num"><Money c={r.toCents} /></td><td>{r.reason}<div className="muted small">asked by {userName(r.requestedBy)}</div></td>
              <td><span className={'pill ' + (r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'warn' : 'bad')}>{r.status === 'pending' ? 'Awaiting approval' : r.status === 'approved' ? 'Approved' : 'Rejected'}</span></td>
              <td>{r.decidedAt ? <>{userName(r.decidedBy)} · {shortDate(r.decidedAt.slice(0, 10))}{r.decisionNote && <div className="muted small">{r.decisionNote}</div>}</> : ''}</td></tr>
          ))}
          <tr><td>{shortDate(e.hiredOn)}</td><td className="num muted">—</td><td className="num"><Money c={e.rateCents} /></td><td>Starting rate</td><td><span className="pill ok">Hired</span></td><td /></tr>
        </tbody>
      </table></div>
      {pendingRateChanges(state).some((r) => r.employeeId === e.id) && <RateApprovals list={pendingRateChanges(state).filter((r) => r.employeeId === e.id)} onMsg={onMsg} />}
      <div className="table-wrap"><table className="t">
        <caption className="sr-only">Recent pay</caption>
        <thead><tr><th scope="col">Pay week</th><th scope="col" className="num">Hours</th><th scope="col" className="num">OT</th><th scope="col" className="num">Gusto gross</th><th scope="col" className="num">Gusto net</th><th scope="col" className="num">Cash / check</th></tr></thead>
        <tbody>{recent.length === 0 ? <tr><td colSpan={6} className="muted">No pay recorded yet.</td></tr> : recent.map(({ wk, w }) => (
          <tr key={wk}><td><Link to={`/people/review?week=${wk}`}>{shortDate(wk)}</Link></td><td className="num">{hrs(w.hours + w.offHours)}</td><td className="num">{w.otHours ? hrs(w.otHours) : ''}</td><td className="num"><Money c={w.gross} /></td><td className="num"><Money c={w.net} /></td><td className="num">{w.cash + w.check ? <Money c={w.cash + w.check} /> : ''}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

// ── Cash & check pay ─────────────────────────────────────────────────────
const CMP_LABEL: Record<CompareStatus, string> = { gusto: 'Gusto only', off: 'Cash/check only', both: 'Both: confirm it is extra pay', both_confirmed: 'Both: confirmed extra pay' };

export function CashPayPage() {
  const { state, books, user, visible } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const exportCsv = useExport();
  const showAll = sp.get('all') === '1';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const weeks = payWeeks(state);
  const latest = weeks.find((w) => peopleOf(state).offPayroll.some((o) => o.payDate === w)) ?? weeks[0] ?? '';
  const allocs = payoutAllocations(state).filter((a) => visible.has(a.storeId)).sort((a, b) => b.payout.date.localeCompare(a.payout.date));
  const unassigned = allocs.reduce((a, x) => a + x.payout.amount - x.allocated, 0);
  const rows = useMemo(() => compareByEmployeeWeek(state, { visible, from: weeks[8], onlyOff: !showAll }), [state, visible, showAll, weeks]);
  const toConfirm = compareByEmployeeWeek(state, { visible, onlyOff: true }).filter((r) => r.status === 'both');
  const offs = peopleOf(state).offPayroll.filter((o) => visible.has(peopleOf(state).employees.find((e) => e.id === o.employeeId)?.storeId ?? ''));
  const latestCash = offs.filter((o) => o.payDate === latest).reduce((a, o) => a + o.amount, 0);
  const q = quarterOf(latest || todayInChicago());
  const checksQ = offs.filter((o) => o.method === 'check' && quarterOf(o.payDate) === q).reduce((a, o) => a + o.amount, 0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <PeopleGuard title="Cash & check pay">
      <PageHead eyebrow="People" title="Cash & check pay" lede="Pay outside Gusto, per employee and week: HM11's cash crew, and any extra cash or check pay elsewhere. Cash already paid out in the cash chain is linked, not posted twice. Someone paid by Gusto and in cash the same week is shown side by side, never assumed to be a duplicate.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('cash-check-pay', ['Pay week', 'Employee', 'Store', 'Gusto net', 'Gusto hours', 'Cash', 'Check', 'Hours outside Gusto', 'Status', 'Note'],
          rows.map((r) => [r.payDate, empName(state, r.employeeId), storeCode(state, r.storeId), csvMoney(r.gustoNet), r.gustoHours, csvMoney(r.cash), csvMoney(r.check), r.offHours, CMP_LABEL[r.status], r.note ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Pay outside Gusto" style={{ marginBottom: 20 }}>
        <Figure label={latest ? `Cash & check pay, week of ${shortDate(latest)}` : 'Cash & check pay'} value={<Money c={latestCash} whole dollar />} note={`${offs.filter((o) => o.payDate === latest).length} entries`} />
        <Figure label="Cash payroll not assigned to anyone" value={<Money c={unassigned} whole dollar />} note={unassigned ? 'Split each payout by employee below' : 'Every payout is split by employee'} />
        <Figure label="Paid both ways, to confirm" value={toConfirm.length} note="Gusto and cash/check the same week" />
        <Figure label={`Checks outside Gusto ${q}`} value={<Money c={checksQ} whole dollar />} />
      </section>
      <div className="stack">
        {can(user, 'payroll.edit') && <OffPayrollForm onMsg={say} />}
        <section className="panel" aria-labelledby="cmp-h">
          <div className="panel-head">
            <h2 id="cmp-h">Gusto vs cash/check, by employee and week</h2>
            <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => set('all', e.target.checked ? '1' : '')} /> Include Gusto-only people</label>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Pay week</th><th scope="col">Employee</th><th scope="col">Store</th><th scope="col" className="num">Gusto net</th><th scope="col" className="num">Gusto hours</th><th scope="col" className="num">Cash</th><th scope="col" className="num">Check</th><th scope="col" className="num">Hours</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.length === 0 ? <tr><td colSpan={9} className="muted">No pay outside Gusto in the last eight weeks.</td></tr> : rows.map((r) => {
              const k = r.employeeId + r.payDate;
              return (
                <tr key={k}>
                  <td style={{ whiteSpace: 'nowrap' }}>{shortDate(r.payDate)}</td><td><Link to={`/people/employees?id=${r.employeeId}`}>{empName(state, r.employeeId)}</Link></td><td>{storeCode(state, r.storeId)}</td>
                  <td className="num">{r.gustoNet ? <Money c={r.gustoNet} /> : ''}</td><td className="num">{r.gustoHours ? hrs(r.gustoHours) : ''}</td><td className="num">{r.cash ? <Money c={r.cash} /> : ''}</td><td className="num">{r.check ? <Money c={r.check} /> : ''}</td><td className="num">{r.offHours ? hrs(r.offHours) : ''}</td>
                  <td style={{ minWidth: 220 }}><span className={'pill ' + (r.status === 'both' ? 'warn' : r.status === 'both_confirmed' ? 'ok' : '')}>{CMP_LABEL[r.status]}</span>
                    {r.note && <div className="muted small">{r.note}</div>}
                    {r.status === 'both' && can(user, 'payroll.edit') && (
                      <div className="actions" style={{ marginTop: 4 }}>
                        <label className="sr-only" htmlFor={'cf-' + k}>What the extra pay was for</label>
                        <input id={'cf-' + k} placeholder="What it was for" value={notes[k] ?? ''} onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} style={{ maxWidth: 200 }} />
                        <button className="btn sm" onClick={() => { try { confirmExtraPay(books, user, r.employeeId, r.payDate, notes[k] ?? ''); say('Confirmed as extra pay.'); } catch (e) { say(errText(e)); } }}>Confirm extra pay</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <TieOut items={[{ label: 'Cash + check here = pay recorded outside Gusto', ok: rows.reduce((a, r) => a + r.cash + r.check, 0) === offs.filter((o) => !weeks[8] || o.payDate >= weeks[8]).reduce((a, o) => a + o.amount, 0), detail: `last eight weeks, ${formatMoney(rows.reduce((a, r) => a + r.cash + r.check, 0), { dollarSign: true })}` }]} />
        </section>
        <section className="panel" aria-labelledby="po-h">
          <div className="panel-head"><h2 id="po-h">Payroll payouts in the cash chain</h2><Link className="small" to="/cash">Cash chain</Link></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Paid to</th><th scope="col">Store</th><th scope="col" className="num">Payout</th><th scope="col" className="num">Assigned</th><th scope="col" className="num">People</th><th scope="col">Status</th></tr></thead>
            <tbody>{allocs.length === 0 ? <tr><td colSpan={7} className="muted">No payroll payouts yet.</td></tr> : allocs.slice(0, 16).map((a) => (
              <tr key={a.payout.id}><td>{shortDate(a.payout.date)}</td><td><Link to={`/books/transactions/${a.payout.txnId}`}>{a.payout.payee}</Link></td><td>{storeCode(state, a.storeId)}</td><td className="num"><Money c={a.payout.amount} /></td><td className="num"><Money c={a.allocated} /></td><td className="num">{a.entries.length}</td>
                <td>{a.allocated === a.payout.amount ? <span className="pill ok">Split by employee</span> : <span className="pill warn"><Money c={a.payout.amount - a.allocated} dollar /> to assign</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[{ label: unassigned === 0 ? 'Every payroll payout is split by employee' : 'Some payroll cash is not assigned to an employee yet', ok: unassigned === 0, detail: `${formatMoney(allocs.reduce((a, x) => a + x.allocated, 0), { dollarSign: true })} assigned of ${formatMoney(allocs.reduce((a, x) => a + x.payout.amount, 0), { dollarSign: true })} paid out` }]} />
        </section>
      </div>
      {toast}
      <Help k="cashPay" />
    </PeopleGuard>
  );
}

function OffPayrollForm({ onMsg }: { onMsg: (m: string) => void }) {
  const { state, books, user, visible, stores } = useBooks();
  const corp = bankStoreId(state);
  const emps = peopleOf(state).employees.filter((e) => visible.has(e.storeId) && e.status === 'active').sort((a, b) => a.storeId.localeCompare(b.storeId) || a.name.localeCompare(b.name));
  const [f, setF] = useState({ employeeId: '', payDate: payWeek(todayInChicago()), method: 'cash' as 'cash' | 'check', amount: '', hours: '', source: '', checkNo: '', note: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const e = emps.find((x) => x.id === f.employeeId);
  const wk = /^\d{4}-\d{2}-\d{2}$/.test(f.payDate) ? payWeek(f.payDate) : '';
  const open = payoutAllocations(state).filter((a) => payWeek(a.payout.date) === wk && a.allocated < a.payout.amount && (!e || a.storeId === e.storeId));
  return (
    <section className="panel panel-pad" aria-labelledby="op-h">
      <h2 id="op-h" style={{ marginBottom: 12 }}>Record pay outside Gusto</h2>
      <Errors errors={errors} />
      <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
        <div className="field"><label htmlFor="op-e">Employee</label><select id="op-e" value={f.employeeId} onChange={(x) => setF({ ...f, employeeId: x.target.value })}><option value="">Choose…</option>{emps.map((x) => <option key={x.id} value={x.id}>{storeCode(state, x.storeId)} · {x.name}</option>)}</select></div>
        <div className="field"><label htmlFor="op-d">Pay date</label><input id="op-d" type="date" value={f.payDate} onChange={(x) => setF({ ...f, payDate: x.target.value })} /><span className="hint">{wk && `Week ending ${shortDate(wk)}`}</span></div>
        <div className="field"><label htmlFor="op-m">Paid in</label><select id="op-m" value={f.method} onChange={(x) => setF({ ...f, method: x.target.value as 'cash' | 'check', source: '' })}><option value="cash">Cash</option><option value="check">Check</option></select></div>
        <div className="field"><label htmlFor="op-a">Amount</label><input id="op-a" className="num" inputMode="decimal" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} /></div>
        <div className="field"><label htmlFor="op-h">Hours</label><input id="op-h" className="num" inputMode="decimal" value={f.hours} onChange={(x) => setF({ ...f, hours: x.target.value })} /></div>
        {f.method === 'cash' ? (
          <div className="field"><label htmlFor="op-src">Cash came from</label><select id="op-src" value={f.source} onChange={(x) => setF({ ...f, source: x.target.value })}>
            <option value="">Choose…</option>
            {open.map((a) => <option key={a.payout.id} value={'po:' + a.payout.id}>Part of payout {shortDate(a.payout.date)} ({formatMoney(a.payout.amount - a.allocated, { dollarSign: true })} left)</option>)}
            <option value={'new:' + corp}>New payout from the HQ pool</option>
            {stores.filter((s) => s.kind === 'operating').map((s) => <option key={s.id} value={'new:' + s.id}>New payout from {s.code} registers</option>)}
          </select><span className="hint">Linking to a payout already in the cash chain posts nothing new.</span></div>
        ) : <div className="field"><label htmlFor="op-c">Check #</label><input id="op-c" value={f.checkNo} onChange={(x) => setF({ ...f, checkNo: x.target.value })} /></div>}
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="op-n">Note</label><input id="op-n" value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} placeholder="e.g. covered two extra shifts" /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => {
          if (f.method === 'cash' && !f.source) { setErrors(['Say where the cash came from: an existing payout, the HQ pool or a store\'s registers.']); return; }
          const hours = f.hours.trim() ? Number(f.hours) : undefined;
          try {
            recordOffPayroll(books, user, { employeeId: f.employeeId, payDate: f.payDate, method: f.method, amount: parseMoney(f.amount) ?? NaN, hours, note: f.note,
              payoutId: f.source.startsWith('po:') ? f.source.slice(3) : undefined, fromStoreId: f.source.startsWith('new:') ? f.source.slice(4) : undefined, checkNo: f.checkNo || undefined });
            setF({ ...f, amount: '', hours: '', note: '', checkNo: '' }); setErrors([]); onMsg('Recorded.');
          } catch (x) { setErrors(errs(x)); }
        }}>Record pay</button>
        <span className="muted small">{f.method === 'check' ? 'Posts net pay to 6100 at the employee\'s store and credits Trustmark; the check shows in the checks register.' : f.source.startsWith('new:') ? 'Posts a cash payroll payout: 6100 at the employee\'s store, out of that cash.' : ''}</span>
      </div>
    </section>
  );
}

// ── Labor % of sales ─────────────────────────────────────────────────────
export function LaborPage() {
  const { state, books, user, stores, visible } = useBooks();
  const [toast, say] = useToast();
  const exportCsv = useExport();
  const operating = stores.filter((s) => s.kind === 'operating');
  const weeks = useMemo(() => payWeeks(state).slice(0, 8), [state]);
  const rows = useMemo(() => laborPct(state, weeks, operating.map((s) => s.id)), [state, weeks]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = weeks.find((w) => rows.filter((r) => r.week === w && r.sales > 0).every((r) => r.salesDays === 7) && rows.some((r) => r.week === w && r.sales > 0)) ?? weeks[0];
  const fr = rows.filter((r) => r.week === full && r.sales > 0);
  const sales = fr.reduce((a, r) => a + r.sales, 0);
  const cost = fr.reduce((a, r) => a + r.cost, 0);
  const hours = fr.reduce((a, r) => a + r.hours, 0);
  const over = fr.filter((r) => r.over);
  const [targets, setTargets] = useState<Record<ID, string>>({});
  const runsPosted = (w: string) => peopleOf(state).runs.filter((r) => payWeek(r.payDate) === w).every((r) => r.status === 'posted');
  const tied = rows.filter((r) => runsPosted(r.week));
  const off = tied.filter((r) => r.cost !== r.ledger);
  const led = ledgerPayroll(state);
  if (!visible.size) return null;
  return (
    <PeopleGuard title="Labor % of sales">
      <PageHead eyebrow="People" title="Labor % of sales" lede="Labor cost (gross + employer taxes + cash/check pay) against the store's POS sales for the same Saturday–Friday pay week, with each store's target and sales per labor hour.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('labor-pct', ['Store', 'Pay week', 'Sales', 'Labor cost', 'Hours', 'Labor %', 'Target %', 'Sales per labor hour', 'POS days', 'Ledger 6100+6110'],
          rows.map((r) => [storeCode(state, r.storeId), r.week, csvMoney(r.sales), csvMoney(r.cost), r.hours, r.pct === null ? '' : (r.pct * 100).toFixed(2), (r.targetBps / 100).toFixed(2), r.salesPerHour === null ? '' : csvMoney(r.salesPerHour), r.salesDays, csvMoney(r.ledger)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Labor" style={{ marginBottom: 20 }}>
        <Figure label={`Labor % of sales, week of ${full ? shortDate(full) : ''}`} value={pctText(sales ? cost / sales : null, false)} note="Operating stores, latest full week" />
        <Figure label="Stores over target" value={over.length} note={over.map((r) => `${storeCode(state, r.storeId)} ${pctText(r.pct, false)} vs ${(r.targetBps / 100).toFixed(1)}%`).join(', ') || 'All at or under target'} />
        <Figure label="Sales per labor hour" value={hours ? <Money c={Math.round(sales / hours)} whole dollar /> : '—'} note={`${hrs(hours)} hours`} />
        <Figure label="Labor cost" value={<Money c={cost} whole dollar />} note={<>on <Money c={sales} whole dollar /> of sales</>} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="lp-h">
          <div className="panel-head"><h2 id="lp-h">Labor % by store and week</h2><span className="muted small">Red is over the store's target</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">Target</th>{[...weeks].reverse().map((w) => <th scope="col" key={w} className="num">{shortDate(w).replace(/, \d{4}$/, '')}</th>)}</tr></thead>
            <tbody>{operating.map((s) => (
              <tr key={s.id}><td><b>{s.code}</b></td><td className="num">{(laborTarget(state, s.id) / 100).toFixed(1)}%</td>
                {[...weeks].reverse().map((w) => { const r = rows.find((x) => x.storeId === s.id && x.week === w)!; return (
                  <td key={w} className="num">{r.pct === null ? <span className="muted">—</span> : <span className={'pill ' + (r.over ? 'bad' : 'ok')} title={`${formatMoney(r.cost, { dollarSign: true })} on ${formatMoney(r.sales, { dollarSign: true })}${r.salesDays < 7 ? `, ${r.salesDays} days of sales` : ''}`}>{pctText(r.pct, false)}{r.salesDays < 7 ? '*' : ''}</span>}</td>
                ); })}</tr>
            ))}</tbody>
          </table></div>
          <p className="panel-pad muted small" style={{ paddingTop: 8, paddingBottom: 8 }}>* Part week: fewer than seven days of POS sales so far, so the % reads high until the week closes.</p>
        </section>
        <section className="panel" aria-labelledby="ld-h">
          <div className="panel-head"><h2 id="ld-h">Detail, week of {full ? shortDate(full) : ''}</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">POS sales</th><th scope="col" className="num">Labor cost</th><th scope="col" className="num">Hours</th><th scope="col" className="num">Labor %</th><th scope="col" className="num">Sales / labor hour</th><th scope="col" className="num">In the books</th></tr></thead>
            <tbody>
              {rows.filter((r) => r.week === full).map((r) => (
                <tr key={r.storeId}><td><Link to={`/people/review?week=${r.week}`}>{storeCode(state, r.storeId)}</Link></td><td className="num"><Money c={r.sales} /></td><td className="num"><Money c={r.cost} /></td><td className="num">{hrs(r.hours)}</td><td className="num">{pctText(r.pct, false)}</td><td className="num">{r.salesPerHour === null ? '—' : <Money c={r.salesPerHour} />}</td><td className="num"><Money c={r.ledger} /></td></tr>
              ))}
              <tr className="total"><td>Operating stores</td><td className="num"><Money c={sales} /></td><td className="num"><Money c={cost} /></td><td className="num">{hrs(hours)}</td><td className="num">{pctText(sales ? cost / sales : null, false)}</td><td className="num">{hours ? <Money c={Math.round(sales / hours)} /> : '—'}</td><td className="num"><Money c={fr.reduce((a, r) => a + (led.get(`${r.storeId}|${full}`) ?? 0), 0)} /></td></tr>
            </tbody>
          </table></div>
          <TieOut items={[
            { label: off.length ? `${off.length} posted store-week(s) don't match the books` : 'Labor cost ties to the ledger (6100 + 6110) for every posted week', ok: off.length === 0, detail: off.length ? off.slice(0, 3).map((r) => `${storeCode(state, r.storeId)} ${r.week}: ${formatMoney(r.cost - r.ledger, { dollarSign: true })}`).join('; ') : `${tied.length} store-weeks checked; weeks with runs still to post are left out` },
            { label: 'Sales come from the POS daily close', ok: true, detail: 'fuel, inside and kitchen revenue; sales tax excluded' },
          ]} />
        </section>
        {can(user, 'setup.edit') && (
          <section className="panel panel-pad" aria-labelledby="lt-h">
            <h2 id="lt-h" style={{ marginBottom: 12 }}>Targets</h2>
            <div className="form-grid">
              {operating.map((s) => (
                <div className="field" key={s.id}><label htmlFor={'lt-' + s.id}>{s.code} target (% of sales)</label>
                  <div className="actions"><input id={'lt-' + s.id} className="num" inputMode="decimal" style={{ width: 90 }} value={targets[s.id] ?? (laborTarget(state, s.id) / 100).toFixed(1)} onChange={(e) => setTargets({ ...targets, [s.id]: e.target.value })} />
                    <button className="btn sm" onClick={() => { try { setLaborTarget(books, user, s.id, Math.round(Number(targets[s.id] ?? laborTarget(state, s.id) / 100) * 100)); say(`${s.code} target saved.`); } catch (e) { say(errText(e)); } }}>Save</button></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {toast}
      <Help k="labor" />
    </PeopleGuard>
  );
}

// ── Payroll tax tracker ──────────────────────────────────────────────────
export function PayrollTaxPage() {
  const { state, books, user, visible, stores } = useBooks();
  const [toast, say] = useToast();
  const exportCsv = useExport();
  const rows = useMemo(() => taxTracker(state, visible), [state, visible]);
  const today = todayInChicago();
  const cur = rows[0];
  const year = (cur?.quarter ?? today).slice(0, 4);
  const p = peopleOf(state);
  const runTaxes = p.runs.reduce((a, r) => a + r.lines.filter((l) => visible.has(l.storeId)).reduce((x, l) => x + l.employeeTaxes + l.employerTaxes, 0), 0);
  const ytd = ytdGustoTie(state, year, visible);
  const items: (ChecklistItem & { q: string })[] = rows.flatMap((r) => quarterChecklist(r.quarter).map((i) => ({ ...i, q: r.quarter })));
  const nextDue = items.filter((i) => !p.checklist[i.key]).sort((a, b) => a.due.localeCompare(b.due))[0];
  const vendors1099 = state.parties.filter((x) => x.is1099 && !x.deleted);
  const [dep, setDep] = useState({ date: today, storeId: stores.find((s) => s.kind === 'operating')?.id ?? '', agency: 'state' as TaxAgency, quarter: cur?.quarter ?? quarterOf(today), amount: '', note: '' });
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <PeopleGuard title="Payroll tax tracker">
      <PageHead eyebrow="People" title="Payroll tax tracker" lede="Payroll tax owed (employee + employer taxes on every Gusto run) against what has been deposited, by quarter, plus the quarterly returns and the W-2 / 1099 season. Gusto files and pays; this keeps the proof.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('payroll-taxes', ['Quarter', 'Federal owed', 'Federal deposited', 'Federal difference', 'State owed', 'State deposited', 'State difference', 'Returns due', 'Runs not posted'],
          rows.map((r) => [r.quarter, csvMoney(r.fedLiability), csvMoney(r.fedDeposits), csvMoney(r.fedDiff), csvMoney(r.stateLiability), csvMoney(r.stateDeposits), csvMoney(r.stateDiff), r.due, r.pendingRuns]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Payroll taxes" style={{ marginBottom: 20 }}>
        <Figure label={`Owed ${cur?.quarter ?? ''}`} value={<Money c={(cur?.fedLiability ?? 0) + (cur?.stateLiability ?? 0)} whole dollar />} note="Employee + employer taxes" />
        <Figure label="Deposited" value={<Money c={(cur?.fedDeposits ?? 0) + (cur?.stateDeposits ?? 0)} whole dollar />} note="Federal and state" />
        <Figure label="Not deposited yet" value={<Money c={(cur?.fedDiff ?? 0) + (cur?.stateDiff ?? 0)} whole dollar />} note={cur?.pendingRuns ? `${cur.pendingRuns} run${cur.pendingRuns === 1 ? '' : 's'} not posted; state taxes are deposited monthly` : 'State taxes are deposited monthly'} />
        <Figure label="Next return due" value={nextDue ? shortDate(nextDue.due) : '—'} note={nextDue?.label ?? 'All filed'} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="tq-h">
          <div className="panel-head"><h2 id="tq-h">Owed vs deposited, by quarter</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Quarter</th><th scope="col" className="num">Federal owed</th><th scope="col" className="num">Deposited</th><th scope="col" className="num">Difference</th><th scope="col" className="num">State owed</th><th scope="col" className="num">Deposited</th><th scope="col" className="num">Difference</th><th scope="col">Returns due</th></tr></thead>
            <tbody>{rows.length === 0 ? <tr><td colSpan={8} className="muted">No payroll yet.</td></tr> : rows.map((r) => (
              <tr key={r.quarter}><td><b>{r.quarter}</b>{r.pendingRuns > 0 && <div className="muted small">{r.pendingRuns} run{r.pendingRuns === 1 ? '' : 's'} not posted</div>}</td>
                <td className="num"><Money c={r.fedLiability} /></td><td className="num"><Money c={r.fedDeposits} /></td><td className="num"><Money c={r.fedDiff} className={r.fedDiff ? 'neg' : ''} /></td>
                <td className="num"><Money c={r.stateLiability} /></td><td className="num"><Money c={r.stateDeposits} /></td><td className="num"><Money c={r.stateDiff} className={r.stateDiff ? 'neg' : ''} /></td>
                <td>{shortDate(r.due)}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: 'Taxes owed = employee + employer taxes on every Gusto run', ok: rows.reduce((a, r) => a + r.fedLiability + r.stateLiability, 0) === runTaxes, detail: formatMoney(runTaxes, { dollarSign: true }) },
            { label: `${year} posted Gusto payroll ties to the ledger`, ok: ytd.runs === ytd.ledger, detail: `${formatMoney(ytd.runs, { dollarSign: true })} in runs, ${formatMoney(ytd.ledger, { dollarSign: true })} in 6100 + 6110` },
          ]} />
        </section>
        {can(user, 'payroll.edit') && (
          <section className="panel panel-pad" aria-labelledby="td-h">
            <h2 id="td-h" style={{ marginBottom: 12 }}>Record a tax deposit</h2>
            <Errors errors={errors} />
            <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
              <div className="field"><label htmlFor="td-d">Date</label><input id="td-d" type="date" value={dep.date} onChange={(e) => setDep({ ...dep, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="td-s">Employer (store)</label><select id="td-s" value={dep.storeId} onChange={(e) => setDep({ ...dep, storeId: e.target.value })}>{stores.filter((s) => s.kind !== 'leased_out').map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
              <div className="field"><label htmlFor="td-a">Agency</label><select id="td-a" value={dep.agency} onChange={(e) => setDep({ ...dep, agency: e.target.value as TaxAgency })}><option value="federal">Federal (EFTPS)</option><option value="state">State</option></select></div>
              <div className="field"><label htmlFor="td-q">For quarter</label><input id="td-q" value={dep.quarter} onChange={(e) => setDep({ ...dep, quarter: e.target.value })} /></div>
              <div className="field"><label htmlFor="td-amt">Amount</label><input id="td-amt" className="num" inputMode="decimal" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} /></div>
              <div className="field"><label htmlFor="td-n">Note</label><input id="td-n" value={dep.note} onChange={(e) => setDep({ ...dep, note: e.target.value })} placeholder="Confirmation #" /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { try { recordTaxDeposit(books, user, { ...dep, amount: parseMoney(dep.amount) ?? NaN }); setDep({ ...dep, amount: '', note: '' }); setErrors([]); say('Deposit recorded.'); } catch (e) { setErrors(errs(e)); } }}>Record deposit</button></div>
          </section>
        )}
        <div className="grid-2">
          <Checklist title="Quarterly returns" items={items} onMsg={say} />
          <Checklist title={`W-2 and 1099 season ${year}`} items={seasonChecklist(year)} onMsg={say} extra={<p className="panel-pad muted small" style={{ paddingTop: 8 }}>{vendors1099.length} vendor{vendors1099.length === 1 ? '' : 's'} marked 1099 in Setup: {vendors1099.map((v) => v.name).join(', ') || 'none'}. Cash wages count as wages; agree how HM11's cash pay is reported with the CPA.</p>} />
        </div>
      </div>
      {toast}
      <Help k="payrollTaxes" />
    </PeopleGuard>
  );
}

function Checklist({ title, items, onMsg, extra }: { title: string; items: ChecklistItem[]; onMsg: (m: string) => void; extra?: ReactNode }) {
  const { state, books, user } = useBooks();
  const marks = peopleOf(state).checklist;
  const [conf, setConf] = useState<Record<string, string>>({});
  const today = todayInChicago();
  const canEdit = can(user, 'payroll.edit');
  const id = title.replace(/\W+/g, '-').toLowerCase();
  const done = items.filter((i) => marks[i.key]).length;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head"><h2 id={id}>{title}</h2><span className="muted small">{done} of {items.length} done</span></div>
      <ul className="inbox">{items.map((i) => {
        const m = marks[i.key];
        const late = !m && i.due < today;
        const soon = !m && !late && i.due <= addDays(today, 30);
        return (
          <li key={i.key} style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 6 }}>
            <div>
              <label className="check"><input type="checkbox" checked={!!m} disabled={!canEdit} onChange={(e) => { try { markChecklist(books, user, i.key, e.target.checked, conf[i.key]); onMsg(e.target.checked ? 'Marked done.' : 'Reopened.'); } catch (x) { onMsg(errText(x)); } }} /> {i.label}</label>
              <div className="muted small" style={{ marginLeft: 26 }}>
                {i.key.slice(0, 6).includes('Q') ? `${i.key.slice(0, 6)} · ` : ''}due {shortDate(i.due)} {late && <span className="pill bad">Overdue</span>}{soon && <span className="pill warn">Due within 30 days</span>}
                {m && <> · done by {state.users.find((u) => u.id === m.by)?.name ?? m.by} {shortDate(m.at.slice(0, 10))}{m.confirmation && ` · ${m.confirmation}`}</>}
              </div>
              {!m && canEdit && <div style={{ marginLeft: 26, marginTop: 4 }}><label className="sr-only" htmlFor={'cf-' + i.key}>Confirmation for {i.label}</label><input id={'cf-' + i.key} placeholder="Confirmation # (optional)" value={conf[i.key] ?? ''} onChange={(e) => setConf({ ...conf, [i.key]: e.target.value })} style={{ maxWidth: 260 }} /></div>}
            </div>
          </li>
        );
      })}</ul>
      {extra}
    </section>
  );
}
