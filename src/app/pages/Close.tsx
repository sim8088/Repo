import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, useExport, useToast } from '../components/ui';
import { useEntries } from '../components/reportkit';
import {
  acknowledgeBalance, addCloseEvidence, cellName, closeChecklist, COMPANY, intercompanyAgreement, lockMonth, openPastMonths, setCloseStep, setStepConfig, stepConfig,
  STATUS_LABEL, STEPS, type CellStatus, type ChecklistCell,
} from '../../core/close';
import { binderCsvs, binderHtml, binderZip, closeBinder } from '../../core/binder';
import { addDays, lastDayOfPeriod, periodLabel, periodOf, shortDate, todayInChicago } from '../../core/dates';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { putFile, getFile } from '../../data/storage';
import type { CloseStatus, CloseStepKey, ID } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const PILL: Record<CellStatus, string> = { done: 'ok', in_progress: 'warn', blocked: 'bad', not_started: '', na: 'na' };

/** Months the checklist can show: from the first month with activity to the current one. */
function useMonths(): { months: string[]; dflt: string } {
  const { state } = useBooks();
  return useMemo(() => {
    const today = todayInChicago();
    const cur = periodOf(today);
    const ms = new Set<string>();
    for (const t of state.transactions) if (!t.deleted && t.kind !== 'opening') ms.add(periodOf(t.date));
    ms.add(cur);
    const months = [...ms].filter((p) => p <= cur).sort().reverse();
    const open = openPastMonths(state, today);
    return { months, dflt: open[0] ?? periodOf(addDays(`${cur}-01`, -1)) };
  }, [state]);
}

export function ChecklistPage() {
  const { state, user, stores, visible } = useBooks();
  const entries = useEntries();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const { months, dflt } = useMonths();
  const period = sp.get('month') ?? dflt;
  const today = todayInChicago();
  const ids = stores.map((s) => s.id);
  const cl = useMemo(() => closeChecklist(state, period, { today, storeIds: ids, entries }), [state, period, today, ids.join(), entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = { step: (sp.get('step') ?? '') as CloseStepKey | '', store: sp.get('store') ?? COMPANY };
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } if (!n.get('month')) n.set('month', period); setSp(n, { replace: true }); };
  const cells = cl.rows.flatMap((r) => r.cells);
  const applicable = cells.filter((c) => c.status !== 'na');
  const done = applicable.filter((c) => c.status === 'done');
  const overdue = applicable.filter((c) => c.overdue);
  const blocked = applicable.filter((c) => c.status === 'blocked');
  const selected = sel.step ? cells.find((c) => c.step === sel.step && c.storeId === (STEPS.find((s) => s.key === sel.step)!.scope === 'company' ? COMPANY : sel.store)) : undefined;
  const userName = (id?: ID) => state.users.find((u) => u.id === id)?.name ?? '—';
  const colLabel = (id: ID) => cl.columns.find((c) => c.id === id)?.label ?? id;
  const csv = useExport();
  const countsOk = Object.values(cl.counts).reduce((a, b) => a + b, 0) === cl.rows.length * cl.columns.length;
  const seesCompany = visible.has(state.stores.find((s) => s.kind === 'corporate')?.id ?? '');

  if (!can(user, 'view.reports')) return <PageHead eyebrow="Close" title="Month-end checklist" lede="Your role doesn't include the month-end close. Ask the CFO for access." />;
  return (
    <>
      <PageHead eyebrow="Close" title="Month-end checklist" lede={<>{periodLabel(period)}. Every step in one place: what the data already proves, what is left, who owns it and when it is due. Each step opens the screen that does it.</>}>
        {can(user, 'export') && <button className="btn" onClick={() => csv(`close-checklist-${period}`, ['Step', 'Store', 'Status', 'Owner', 'Due', 'Evidence', 'Note'], applicable.map((c) => [cellName(state, c), colLabel(c.storeId), STATUS_LABEL[c.status], userName(c.ownerId), c.due, [...(c.proof?.evidence ?? []), ...(c.proof?.missing ?? [])].join(' '), c.item?.note ?? '']))}>Export CSV</button>}
        <Link className="btn" to={`/close/binder?month=${period}`}>Close binder</Link>
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <Figure label="Steps done" value={`${done.length} of ${applicable.length}`} note={`${cl.counts.na} not applicable`} />
        <Figure label="Still open" value={cl.open.length} note={blocked.length ? `${blocked.length} blocked` : 'none blocked'} />
        <Figure label="Overdue" value={overdue.length} note={`lock due ${shortDate(cl.lockDue)}`} />
        <Figure label="Lock" value={cl.locked ? 'Locked' : cl.ready ? 'Ready' : 'Waiting'} note={cl.locked ? (cl.override ? 'locked with an override' : 'every step done') : cl.ready ? 'every other step is done' : `${cl.open.length} step${cl.open.length === 1 ? '' : 's'} to go`} />
      </section>

      <LockPanel period={period} ready={cl.ready} locked={cl.locked} openCount={cl.open.length} override={cl.override} onMsg={say} />

      <section className="panel" aria-labelledby="cl-h" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h2 id="cl-h">Steps by store</h2>
          <div className="field" style={{ width: 200 }}><label htmlFor="cl-month" className="sr-only">Month</label><select id="cl-month" value={period} onChange={(e) => set({ month: e.target.value, step: '', store: '' })}>{months.map((p) => <option key={p} value={p}>{periodLabel(p)}{state.periods[p]?.status === 'locked' ? ' (locked)' : ''}</option>)}</select></div>
        </div>
        <div className="table-wrap">
          <table className="t close-matrix">
            <thead><tr><th scope="col">Step</th><th scope="col">Owner · due</th>{cl.columns.map((c) => <th scope="col" key={c.id} title={c.title}>{c.label}</th>)}</tr></thead>
            <tbody>
              {cl.rows.map((r) => (
                <tr key={r.def.key}>
                  <td><b>{r.def.n}. {r.def.label}</b><div className="muted small">{r.def.auto ? 'proved by the data' : 'manual'}</div></td>
                  <td className="small">{userName(stepConfig(state, r.def.key).ownerId)}<div className="muted">{shortDate(r.cells[0].due).replace(/, \d{4}$/, '')}</div></td>
                  {r.cells.map((c) => (
                    <td key={c.storeId}>
                      {c.status === 'na' ? <span className="muted small" title="Not applicable">n/a</span> : (
                        <button type="button" className={`pill status-btn ${PILL[c.status]}${selected === c ? ' sel' : ''}`} aria-pressed={selected === c} aria-label={`${cellName(state, c)}: ${STATUS_LABEL[c.status]}${c.overdue ? ' · late' : ''}`} onClick={() => set({ step: c.step, store: c.storeId })}>
                          {STATUS_LABEL[c.status]}{c.overdue && ' · late'}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: countsOk ? `${cells.length} cells: ${done.length} done, ${cl.open.length + (cl.locked ? 0 : 1)} open, ${cl.counts.na} not applicable` : 'Counts do not add up', ok: countsOk },
          { label: cl.ready ? 'Lock gate open: every other step is done' : `Lock gate closed: ${cl.open.length} step${cl.open.length === 1 ? '' : 's'} open`, ok: cl.ready },
        ]} />
      </section>

      {selected ? <StepPanel key={`${period}|${selected.step}|${selected.storeId}`} period={period} cell={selected} onMsg={say} onClose={() => set({ step: '', store: '' })} />
        : <p className="muted small" style={{ marginTop: 12 }}>Pick a status above to see its evidence, change its owner or status, add a note or attach evidence.</p>}
      {seesCompany && <ConfigPanel onMsg={say} />}
      {toast}
      <Help k="closeChecklist" />
    </>
  );
}

function LockPanel({ period, ready, locked, openCount, override, onMsg }: { period: string; ready: boolean; locked: boolean; openCount: number; override?: { by: ID; at: string; reason: string; open: string[] }; onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const [reason, setReason] = useState('');
  const [forcing, setForcing] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const over = period < periodOf(todayInChicago());
  const lock = (o?: string) => { try { lockMonth(books, user, period, { override: o }); setErrs([]); setForcing(false); onMsg(`${periodLabel(period)} locked.`); } catch (e) { setErrs(errList(e)); } };
  const who = (id: ID) => state.users.find((u) => u.id === id)?.name ?? id;
  return (
    <section className="panel" aria-labelledby="lock-h">
      <div className="panel-head"><h2 id="lock-h">12. Lock {periodLabel(period)}</h2>{locked ? <span className="pill">Locked</span> : ready ? <span className="pill ok">Ready to lock</span> : <span className="pill warn">{openCount} step{openCount === 1 ? '' : 's'} open</span>}</div>
      <div className="panel-pad">
        <Errors errors={errs} />
        {locked ? (
          <p style={{ margin: 0 }}>Locked {state.periods[period].lockedAt ? `on ${shortDate(state.periods[period].lockedAt!.slice(0, 10))}` : ''} by {who(state.periods[period].lockedBy ?? '')}. Locked months refuse every change. {override && <>Locked with an override: “{override.reason}” ({override.open.length} step{override.open.length === 1 ? '' : 's'} open then). </>}To change it, <Link to="/close/periods">unlock it in Periods</Link> with a reason.</p>
        ) : !over ? (
          <p style={{ margin: 0 }} className="muted">{periodLabel(period)} isn't over yet. The lock opens once the month has ended and every other step is done.</p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>{ready ? 'Every other step is done. Locking makes the month read-only; unlocking later needs a reason and is logged.' : 'Lock is the last step: it opens once every other step is done.'}</p>
            <div className="actions">
              {can(user, 'period.lock') ? <button className="btn primary" disabled={!ready} onClick={() => lock()}>Lock {periodLabel(period)}</button> : <span className="muted small">Only the CFO can lock a month.</span>}
              {!ready && can(user, 'period.lock') && !forcing && <button className="btn ghost" onClick={() => setForcing(true)}>Lock anyway…</button>}
            </div>
            {forcing && (
              <div style={{ marginTop: 12, maxWidth: 560 }} role="region" aria-label="Override the lock gate">
                <div className="field"><label htmlFor="ov-reason">Why lock with {openCount} step{openCount === 1 ? '' : 's'} open?</label><input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Board pack due; HM15 count follows next week" /></div>
                <div className="actions" style={{ marginTop: 8 }}><button className="btn danger" disabled={!reason.trim()} onClick={() => lock(reason)}>Override and lock</button><button className="btn ghost" onClick={() => setForcing(false)}>Cancel</button></div>
                <p className="muted small">The reason and the open steps are kept with the month and in the audit log.</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StepPanel({ period, cell, onMsg, onClose }: { period: string; cell: ChecklistCell; onMsg: (m: string) => void; onClose: () => void }) {
  const { state, books, user } = useBooks();
  const def = STEPS.find((s) => s.key === cell.step)!;
  const locked = state.periods[period]?.status === 'locked';
  const edit = can(user, 'close.edit') && !locked && def.key !== 'lock';
  const [status, setStatus] = useState<CloseStatus>(cell.item?.status ?? (cell.status === 'na' ? 'not_started' : cell.status));
  const [owner, setOwner] = useState(cell.item?.ownerId ?? '');
  const [note, setNote] = useState(cell.item?.note ?? '');
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const statuses: CloseStatus[] = cell.auto ? ['not_started', 'in_progress', 'blocked'] : ['not_started', 'in_progress', 'blocked', 'done'];
  const save = () => {
    try { setCloseStep(books, user, { period, storeId: cell.storeId, step: cell.step, status, ownerId: owner, note }); setErrs([]); onMsg('Saved.'); } catch (e) { setErrs(errList(e)); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > 15 * 1024 * 1024) { onMsg(`${f.name} is over 15 MB. Save a smaller PDF.`); continue; }
        const id = books.nextId('att');
        if (!(await putFile(id, f))) { onMsg('This browser is blocking storage, so the file could not be kept.'); continue; }
        addCloseEvidence(books, user, { period, storeId: cell.storeId, step: cell.step, attachment: { id, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, addedAt: new Date().toISOString(), addedBy: user.id } });
        onMsg(`Attached ${f.name}.`);
      }
    } catch (e) { onMsg(errList(e).join(' ')); }
    setBusy(false);
  };
  const open = async (id: string, name: string) => {
    const blob = await getFile(id);
    if (!blob) { onMsg(`${name} isn't on this device.`); return; }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const store = cell.storeId === COMPANY ? 'Company-wide' : state.stores.find((s) => s.id === cell.storeId)?.name;
  return (
    <section className="panel" aria-labelledby="step-h" style={{ marginTop: 20 }}>
      <div className="panel-head">
        <h2 id="step-h">{cellName(state, cell)}</h2>
        <div className="actions"><span className={'pill ' + PILL[cell.status]}>{STATUS_LABEL[cell.status]}</span>{cell.to && <Link className="btn sm primary" to={cell.to}>Open {def.screen}</Link>}<button className="btn sm ghost" onClick={onClose}>Close</button></div>
      </div>
      <div className="grid-2 panel-pad">
        <div>
          <p className="muted small" style={{ marginTop: 0 }}>{store} · {def.hint}</p>
          <dl className="kv">
            <dt>Status</dt><dd>{STATUS_LABEL[cell.status]}{cell.auto ? ' — from the data' : ''}</dd>
            <dt>Owner</dt><dd>{state.users.find((u) => u.id === cell.ownerId)?.name ?? '—'}</dd>
            <dt>Due</dt><dd>{shortDate(cell.due)}{cell.overdue && <span className="pill bad" style={{ marginLeft: 6 }}>overdue</span>}</dd>
          </dl>
          {cell.proof && (
            <>
              <h3 style={{ margin: '14px 0 6px' }}>Evidence</h3>
              <ul className="evidence">{cell.proof.evidence.map((e) => <li key={e} className="ok">{e}</li>)}{cell.proof.missing.map((e) => <li key={e} className="bad">{e}</li>)}</ul>
            </>
          )}
          {cell.step === 'intercompany' && <IcAgree period={period} onMsg={onMsg} />}
          {cell.item?.attachments.length ? (
            <>
              <h3 style={{ margin: '14px 0 6px' }}>Attached</h3>
              <ul className="rb-list">{cell.item.attachments.map((a) => <li key={a.id}><span>{a.name}</span><button className="btn sm" onClick={() => void open(a.id, a.name)}>Open</button></li>)}</ul>
            </>
          ) : null}
        </div>
        <div>
          {edit ? (
            <>
              <Errors errors={errs} />
              <div className="form-grid">
                <div className="field"><label htmlFor="st-status">Status</label><select id="st-status" value={status} onChange={(e) => setStatus(e.target.value as CloseStatus)}>{statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
                <div className="field"><label htmlFor="st-owner">Owner</label><select id="st-owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Step default ({state.users.find((u) => u.id === stepConfig(state, cell.step).ownerId)?.name})</option>{state.users.filter((u) => u.active && u.role !== 'reviewer').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              </div>
              <div className="field" style={{ marginTop: 10 }}><label htmlFor="st-note">Note</label><textarea id="st-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={cell.auto ? 'What is it waiting on?' : 'What was done, and where the support is'} /></div>
              {cell.auto && <p className="muted small">This step is proved by the data, so it turns done by itself once the evidence holds. You can mark it in progress or blocked with a note.</p>}
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={save}>Save step</button>
                <label className="btn" style={{ margin: 0 }} aria-disabled={busy}>{busy ? 'Saving…' : 'Attach evidence'}<input type="file" multiple className="sr-only" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>
              </div>
            </>
          ) : (
            <p className="muted">{locked ? 'The month is locked; unlock it in Periods to change the checklist.' : def.key === 'lock' ? 'Use the lock panel above.' : cell.item?.note ? `Note: ${cell.item.note}` : 'Your role can read the checklist but not change it.'}</p>
          )}
          {!edit && cell.item?.note && locked && <p>Note: {cell.item.note}</p>}
        </div>
      </div>
    </section>
  );
}

function IcAgree({ period, onMsg }: { period: string; onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const ag = intercompanyAgreement(state, period);
  const edit = can(user, 'close.edit') && state.periods[period]?.status !== 'locked';
  const who = (id: ID) => state.users.find((u) => u.id === id)?.name ?? id;
  return (
    <>
      <h3 style={{ margin: '14px 0 6px' }}>Balances at {shortDate(lastDayOfPeriod(period))}</h3>
      <ul className="rb-list" aria-label="Related-party balances to agree">
        {ag.rows.map((r) => (
          <li key={r.id}>
            <span><Link to={`/intercompany/parties/${r.id}`}>{r.name}</Link> <Money c={r.balance} dollar />{r.agreed ? <span className="muted small"> · agreed by {who(r.ack!.by)}</span> : r.ack ? <span className="neg small"> · changed since agreed</span> : null}</span>
            {r.agreed ? <span className="pill ok">Agreed</span> : edit ? <button className="btn sm" onClick={() => { try { acknowledgeBalance(books, user, { period, counterpartyId: r.id, note: 'Agreed from the close checklist.' }); onMsg(`${r.name} agreed.`); } catch (e) { onMsg(errList(e).join(' ')); } }} aria-label={`Mark ${r.name} agreed`}>Agreed</button> : <span className="pill warn">Open</span>}
          </li>
        ))}
      </ul>
      <p className="muted small">{ag.eliminates ? 'Group due-to / due-from lines eliminate to $0.00.' : 'Group due-to / due-from lines do not eliminate: see the elimination view.'} Send each party its <Link to="/intercompany/parties">statement</Link>, then record their agreement here.</p>
    </>
  );
}

function ConfigPanel({ onMsg }: { onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const edit = can(user, 'close.edit');
  return (
    <details className="panel" style={{ marginTop: 20 }}>
      <summary className="panel-pad" style={{ cursor: 'pointer' }}><b>Owners and due dates</b> <span className="muted small">business days after month end</span></summary>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th scope="col">Step</th><th scope="col">Owner</th><th scope="col" className="num">Due (business days)</th></tr></thead>
          <tbody>{STEPS.map((s) => {
            const c = stepConfig(state, s.key);
            return (
              <tr key={s.key}>
                <td>{s.n}. {s.label}</td>
                <td>{edit ? <select aria-label={`${s.label} owner`} value={c.ownerId ?? ''} onChange={(e) => { setStepConfig(books, user, s.key, { ownerId: e.target.value, dueDays: c.dueDays }); onMsg('Owner saved.'); }}>{state.users.filter((u) => u.active && u.role !== 'reviewer').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : state.users.find((u) => u.id === c.ownerId)?.name}</td>
                <td className="num">{edit ? <input aria-label={`${s.label} due, business days after month end`} className="num grid-input" type="number" min={0} max={30} defaultValue={c.dueDays} key={c.dueDays} onBlur={(e) => { const n = Number(e.target.value); if (n === c.dueDays) return; try { setStepConfig(books, user, s.key, { ownerId: c.ownerId, dueDays: n }); onMsg('Due date saved.'); } catch (err) { onMsg(errList(err).join(' ')); } }} /> : c.dueDays}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </details>
  );
}

// ── Close binder ─────────────────────────────────────────────────────────
export function BinderPage() {
  const { state, books, user, stores } = useBooks();
  const [sp, setSp] = useSearchParams();
  const { months, dflt } = useMonths();
  const period = sp.get('month') ?? dflt;
  const ids = stores.map((s) => s.id);
  const b = useMemo(() => closeBinder(state, period, { visible: ids }), [state, period, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const ties = b.sections.flatMap((s) => s.ties);
  const tables = b.sections.reduce((a, s) => a + s.tables.length, 0);
  const csvs = useMemo(() => binderCsvs(b), [b]);
  const download = (name: string, data: BlobPart, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { books.logExport(user, name); } catch { /* no export permission: buttons are hidden */ }
  };
  const openPrint = () => {
    const url = URL.createObjectURL(new Blob([binderHtml(state, b)], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    try { books.logExport(user, `close-binder-${period}.html`); } catch { /* read only */ }
  };
  if (!can(user, 'view.reports')) return <PageHead eyebrow="Close" title="Close binder" lede="Your role doesn't include the month-end close. Ask the CFO for access." />;
  const exp = can(user, 'export');
  return (
    <>
      <PageHead eyebrow="Close" title="Close binder" lede={<>{periodLabel(period)}{b.locked ? ', locked' : ', not locked yet (figures can still change)'}. One printable document with the statements on both bases, the bank reconciliation, the checklist and its evidence, the schedules and an index of supporting documents.</>}>
        {exp && <button className="btn primary" onClick={openPrint}>Open printable binder</button>}
        {exp && <button className="btn" onClick={() => download(`close-binder-${period}.html`, binderHtml(state, b), 'text/html')}>Download HTML</button>}
        {exp && <button className="btn" onClick={() => download(`close-binder-${period}-schedules.zip`, binderZip(b) as BlobPart, 'application/zip')}>Download ZIP of CSVs</button>}
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <Figure label="Sections" value={b.sections.length} note={`${tables} tables`} />
        <Figure label="CSV files" value={csvs.length} note="in the ZIP" />
        <Figure label="Supporting documents" value={b.documents} note="indexed with where each is filed" />
        <Figure label="Tie-outs" value={`${ties.filter((t) => t.ok).length} of ${ties.length}`} note={ties.every((t) => t.ok) ? 'everything ties' : 'see the red ones below'} />
      </section>
      <section className="panel" aria-labelledby="bind-h">
        <div className="panel-head"><h2 id="bind-h">Contents</h2><div className="field" style={{ width: 200 }}><label htmlFor="bind-month" className="sr-only">Month</label><select id="bind-month" value={period} onChange={(e) => setSp({ month: e.target.value }, { replace: true })}>{months.map((p) => <option key={p} value={p}>{periodLabel(p)}{state.periods[p]?.status === 'locked' ? ' (locked)' : ''}</option>)}</select></div></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col" className="num">#</th><th scope="col">Section</th><th scope="col">Tables (CSV file)</th><th scope="col">Tie-outs</th></tr></thead>
            <tbody>{b.sections.map((s, i) => (
              <tr key={s.key}>
                <td className="num">{i + 1}</td>
                <td><b>{s.title}</b>{s.note && <div className="muted small">{s.note}</div>}</td>
                <td className="small">{s.tables.map((t) => <div key={t.file}>{t.caption} <span className="muted">({t.file}, {t.rows.length} rows)</span></div>)}</td>
                <td className="small">{s.ties.map((t) => <div key={t.label}><span className={'tie ' + (t.ok ? 'ok' : 'bad')}><span aria-hidden>{t.ok ? '✓' : '✗'}</span>{t.label}</span></div>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <TieOut items={[{ label: ties.every((t) => t.ok) ? 'Every section ties' : `${ties.filter((t) => !t.ok).length} tie-out(s) need attention`, ok: ties.every((t) => t.ok) }, { label: `${csvs.length} CSV files, one per table`, ok: csvs.length === tables }]} />
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>Print the binder to PDF from the browser's print dialog. Attachments stay with the record they support (this device until the hosted back end ships); the index lists each one. Checklist: <Link to={`/close?month=${period}`}>{periodLabel(period)}</Link>.</p>
      <Help k="closeBinder" />
    </>
  );
}
