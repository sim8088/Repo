import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { AttachButton, DocList } from '../components/docs';
import {
  COVERAGE_KINDS, HOSTED_ITEMS, IN_PLACE, LIMIT_KINDS, LIMIT_LABEL, LIMIT_ROLES, POS_KIND_LABEL, RESTORE_WORD, RISK_CATEGORY_LABEL, SIGNAL_LABEL, SIGNAL_SOURCE, SOD_AREAS,
  UST_LABEL, UST_SITE_KINDS, UST_TANK_KINDS, accessReview, acknowledgeSod, approvalHistory, attachToUst, controlHealth, controlsOf, coverageChecklist, depositTimeliness,
  dismissSignal, dualCountRows, escalateSignal, exportBackup, exportLog, financialResponsibility, fraudSignals, importPosExceptions, isNewSignal, isOpenConflict,
  lastBackup, limitTable, parseBackup, parsePosExceptions, recordSecondCount, releaseDetection, reopenSignal, restoreBackup, riskLevel, riskScore, risksDue,
  saveApprovalLimits, saveCashControls, saveClaim, saveDriveOff, saveRisk, saveUstRecord, shortagePatterns, sodActivity, sodConflicts, sodMatrix, ustSchedule,
  varianceByPerson, varianceByStore, varianceRows, whoCanApprove, cashControlsOf, STAGE_LABEL,
  type BackupFile, type BackupPreview, type EvidenceRow, type FraudSignal, type PosExceptionRow, type RiskDraft, type SignalKind, type SodConflict, type UstStatus,
} from '../../core/controls';
import { POLICY_LABEL, complianceOf, LICENSE_LABEL } from '../../core/compliance';
import { ROLE_LABEL, can } from '../../core/permissions';
import { formatMoney, parseMoney } from '../../core/money';
import { daysBetween, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { ValidationError } from '../../core/books';
import { bankStoreId } from '../../core/bank';
import { fuelOf } from '../../core/fuel';
import type { ApprovalLimit, ID, InsuranceClaim, LimitKind, Risk, Role, UstTestKind } from '../../core/types';

const errText = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const money = (c: number) => formatMoney(c, { dollarSign: true });
const PILL: Record<string, string> = { ok: 'ok', warn: 'warn', bad: 'bad', high: 'bad', medium: 'warn', low: '' };

function useCodes() {
  const { state } = useBooks();
  return (id?: ID) => state.stores.find((s) => s.id === id)?.code ?? (id ? id : '—');
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label} style={{ marginBottom: 16, flexWrap: 'wrap' }}>
      {options.map((o) => <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  );
}

function useTab<T extends string>(values: T[], key = 'tab'): [T, (v: T) => void] {
  const [sp, setSp] = useSearchParams();
  const v = (values.includes(sp.get(key) as T) ? sp.get(key) : values[0]) as T;
  return [v, (x: T) => { const n = new URLSearchParams(sp); if (x === values[0]) n.delete(key); else n.set(key, x); setSp(n, { replace: true }); }];
}

/** Evidence rows with links, and the tie-out that they add to the stated amount. */
function EvidenceTable({ rows, amount, caption }: { rows: EvidenceRow[]; amount: number; caption: string }) {
  const code = useCodes();
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <div className="table-wrap"><table className="t">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">Evidence</th><th scope="col">Date</th><th scope="col">Store</th><th scope="col" className="num">Amount</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id + r.label}><td>{r.to ? <Link to={r.to}>{r.label}</Link> : r.label}{r.detail && <div className="muted small">{r.detail}</div>}</td><td>{r.date ? shortDate(r.date) : '—'}</td><td>{r.storeId ? code(r.storeId) : '—'}</td><td className="num"><Money c={r.amount} /></td></tr>
          ))}
          <tr className="total"><td colSpan={3}>Total</td><td className="num"><Money c={total} /></td></tr>
        </tbody>
      </table></div>
      <TieOut items={[{ label: total === amount ? 'Evidence rows add to the stated amount' : 'Evidence rows do not add to the stated amount', ok: total === amount, detail: <Money c={amount} dollar /> }]} />
    </>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────
export function ControlsOverviewPage() {
  const { state, visible, version } = useBooks();
  const today = todayInChicago();
  const health = useMemo(() => controlHealth(state, today, visible), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const signals = useMemo(() => fraudSignals(state, { today, visible }), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflicts = useMemo(() => sodConflicts(state).filter(isOpenConflict), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const ust = ustSchedule(state, today, visible);
  const gaps = coverageChecklist(state, today).filter((r) => r.status === 'gap' || r.status === 'under_limit');
  const open = signals.filter((s) => !s.dismissed);
  const openAmt = open.reduce((a, s) => a + s.amount, 0);
  const evidenceAmt = open.reduce((a, s) => a + s.evidence.reduce((x, r) => x + r.amount, 0), 0);
  const overdue = ust.filter((r) => r.status === 'overdue' || r.status === 'never' || r.status === 'failed');
  const fresh = open.filter(isNewSignal);
  const healthFraud = health.find((h) => h.key === 'fraud')!;
  return (
    <>
      <PageHead eyebrow="Controls" title="Control health" lede="Where the controls stand today: approval limits, segregation of duties, cash, fraud signals, insurance and the tanks. Each line opens the screen that fixes it.">
        <ExportButtons name="control-health" header={['Control', 'Status', 'Value', 'Detail']} rows={health.map((h) => [h.label, h.status, h.value, h.detail])} print={false} />
      </PageHead>
      <section className="figures" aria-label="Control health" style={{ marginBottom: 20 }}>
        <Figure label="Open fraud signals" value={open.length} note={`${fresh.length} new · ${money(openAmt)} in the evidence`} href="/controls/fraud" />
        <Figure label="Duty conflicts open" value={conflicts.length} note={`${conflicts.filter((c) => c.type === 'activity').length} in activity, ${conflicts.filter((c) => c.type === 'config').length} in configuration`} href="/controls/sod" />
        <Figure label="UST items overdue" value={overdue.length} note={overdue.slice(0, 2).map((r) => `${r.label} ${UST_LABEL[r.kind].toLowerCase()}`).join('; ') || 'Every test is current'} href="/controls/ust" />
        <Figure label="Coverage gaps" value={gaps.length} note={gaps.map((g) => POLICY_LABEL[g.kind]).join(', ') || 'Every required policy is in force'} href="/controls/risk?tab=coverage" />
      </section>
      <section className="panel" aria-labelledby="ch-h">
        <div className="panel-head"><h2 id="ch-h">Controls</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Control</th><th scope="col">Status</th><th scope="col">Now</th><th scope="col">Detail</th></tr></thead>
          <tbody>{health.map((h) => (
            <tr key={h.key}><td><Link to={h.to}><b>{h.label}</b></Link></td><td><span className={'pill ' + PILL[h.status]}>{h.status === 'ok' ? 'In order' : h.status === 'warn' ? 'Look at' : 'Act now'}</span></td><td>{h.value}</td><td className="small">{h.detail}</td></tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[
          { label: evidenceAmt === openAmt ? 'Open signals add to their evidence rows' : 'Open signals do not add to their evidence', ok: evidenceAmt === openAmt, detail: <Money c={openAmt} dollar /> },
          { label: healthFraud.value === `${open.length} open` ? 'Fraud count agrees with the Fraud signals screen' : 'Fraud count differs from the Fraud signals screen', ok: healthFraud.value === `${open.length} open` },
        ]} />
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>Today is {shortDate(today)}. Signals look back 90 days unless the screen says otherwise; cash patterns use the window set under Cash controls.</p>
      <Help k="controlsOverview" />
    </>
  );
}

// ── Approval limits ──────────────────────────────────────────────────────
export function ApprovalLimitsPage() {
  const { state, books, user, version } = useBooks();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const table = useMemo(() => limitTable(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (r: Role, k: LimitKind) => `${r}|${k}`;
  const initial = () => Object.fromEntries(table.map((t) => [key(t.role, t.kind), t.maxCents === null ? '' : (t.maxCents / 100).toFixed(2)]));
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const edit = can(user, 'controls.edit');
  const history = useMemo(() => approvalHistory(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const outside = history.filter((h) => !h.within);
  const bkBill = table.find((t) => t.role === 'bookkeeper' && t.kind === 'bill')!.maxCents;
  const name = (id: ID) => state.users.find((u) => u.id === id)?.name ?? id;
  const editable: Role[] = ['cfo', 'owner', 'bookkeeper'];
  const save = () => {
    setErrors([]);
    try {
      const rows: ApprovalLimit[] = LIMIT_ROLES.flatMap((role) => LIMIT_KINDS.map((kind) => {
        if (!editable.includes(role)) return { role, kind, maxCents: 0 };
        const v = (draft[key(role, kind)] ?? '').trim();
        return { role, kind, maxCents: v === '' ? null : parseMoney(v) ?? NaN };
      }));
      saveApprovalLimits(books, user, rows);
      say('Approval limits saved.');
    } catch (e) { setErrors(errText(e)); }
  };
  const example = (kind: LimitKind, amt: number) => whoCanApprove(state, kind, amt).map((u) => u.name).join(', ') || 'nobody';
  return (
    <>
      <PageHead eyebrow="Controls" title="Approval limits" lede="Who may approve how much. An approval over the approver's limit is refused, and the message names who can approve it. The journal-entry threshold still decides which entries need approval at all.">
        <ExportButtons name="approval-limits" header={['Role', 'Kind', 'Limit']} rows={table.map((t) => [ROLE_LABEL[t.role], LIMIT_LABEL[t.kind], t.maxCents === null ? 'No limit' : t.maxCents === 0 ? 'Cannot approve' : csvMoney(t.maxCents)])} print={false} />
      </PageHead>
      <section className="figures" aria-label="Approval limits" style={{ marginBottom: 20 }}>
        <Figure label="Bookkeeper bill limit" value={bkBill === null ? 'No limit' : bkBill === 0 ? 'None' : <Money c={bkBill} whole dollar />} note="Above it, the CFO or an owner approves" />
        <Figure label="Journal entries need approval over" value={<Money c={state.settings.jeApprovalLimitCents} whole dollar />} note="Setup › Settings; preparer ≠ approver" />
        <Figure label="Approvals on file" value={history.length} note="Bills, journal entries and rate changes" />
        <Figure label="Outside today's limits" value={outside.length} note={outside.length ? 'Approved before a limit was lowered' : 'Every approval is within its limit'} />
      </section>
      <Errors errors={errors} />
      <section className="panel" aria-labelledby="lim-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="lim-h">Limits by role</h2><span className="muted small">Blank = no limit · 0 = can't approve</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Role</th>{LIMIT_KINDS.map((k) => <th scope="col" key={k} className="num">{LIMIT_LABEL[k]}</th>)}</tr></thead>
          <tbody>{LIMIT_ROLES.map((role) => (
            <tr key={role}><td><b>{ROLE_LABEL[role]}</b><div className="muted small">{state.users.filter((u) => u.role === role && u.active).map((u) => u.name).join(', ') || 'No users'}</div></td>
              {LIMIT_KINDS.map((kind) => {
                const t = table.find((x) => x.role === role && x.kind === kind)!;
                if (!editable.includes(role)) return <td key={kind} className="num muted small">Can't approve</td>;
                if (!edit) return <td key={kind} className="num">{t.maxCents === null ? 'No limit' : t.maxCents === 0 ? 'None' : <Money c={t.maxCents} whole />}</td>;
                const id = `lim-${role}-${kind}`;
                return <td key={kind} className="num"><label className="sr-only" htmlFor={id}>{`${ROLE_LABEL[role]} limit for ${LIMIT_LABEL[kind].toLowerCase()}`}</label><input id={id} className="num grid-input" inputMode="decimal" placeholder="No limit" value={draft[key(role, kind)] ?? ''} onChange={(e) => setDraft({ ...draft, [key(role, kind)]: e.target.value })} /></td>;
              })}
            </tr>
          ))}</tbody>
        </table></div>
        {edit && <div className="panel-pad actions"><button className="btn primary" onClick={save}>Save limits</button><button className="btn ghost" onClick={() => { setDraft(initial()); setErrors([]); }}>Undo changes</button></div>}
        <TieOut items={LIMIT_KINDS.map((k) => { const top = state.users.filter((u) => u.active && table.find((t) => t.role === u.role && t.kind === k)?.maxCents === null); return { label: top.length ? `${LIMIT_LABEL[k]}: someone can approve any amount` : `${LIMIT_LABEL[k]}: nobody can approve large amounts`, ok: top.length > 0, detail: top.map((u) => u.name).join(', ') }; })} />
      </section>
      <section className="panel panel-pad" aria-labelledby="who-h" style={{ marginBottom: 20 }}>
        <h2 id="who-h" style={{ marginBottom: 8 }}>Who can approve</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>A $1,000 bill: {example('bill', 100_000)}.</li>
          <li>A $5,000 bill: {example('bill', 500_000)}.</li>
          <li>A $15,000 journal entry: {example('journal', 1_500_000)} (never the person who prepared it).</li>
          <li>A write-off: {example('writeoff', 100_000)}.</li>
          <li>A rate change (counted at its yearly cost, per hour × 2,080 or per week × 52): {example('rate_change', 200_000)}.</li>
        </ul>
      </section>
      <section className="panel" aria-labelledby="ah-h">
        <div className="panel-head"><h2 id="ah-h">Approvals given</h2><span className="muted small">{history.length} on file</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Item</th><th scope="col">Kind</th><th scope="col">Approved</th><th scope="col">By</th><th scope="col">Entered by</th><th scope="col" className="num">Amount</th><th scope="col">Limit</th></tr></thead>
          <tbody>{history.slice(0, 60).map((h) => (
            <tr key={h.kind + h.id}><td><Link to={h.to}>{h.ref}</Link></td><td>{LIMIT_LABEL[h.kind]}</td><td>{shortDate(h.date)}</td><td>{name(h.by)}</td><td>{name(h.enteredBy)}{h.enteredBy === h.by && <span className="pill warn" style={{ marginLeft: 6 }}>Same person</span>}</td><td className="num"><Money c={h.amount} /></td><td><span className={'pill ' + (h.within ? 'ok' : 'bad')}>{h.within ? 'Within' : 'Over today\'s limit'}</span></td></tr>
          ))}</tbody>
        </table></div>
        {history.length > 60 && <p className="panel-pad muted small">Showing the latest 60. Export for the full list.</p>}
      </section>
      {toast}
      <Help k="controlsLimits" />
    </>
  );
}

// ── Segregation of duties ────────────────────────────────────────────────
export function SodPage() {
  const { state, books, user, version } = useBooks();
  const [toast, say] = useToast();
  const [show, setShow] = useTab(['open', 'all']);
  const [errors, setErrors] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [covers, setCovers] = useState<Record<string, boolean>>({});
  const matrix = useMemo(() => sodMatrix(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const activity = useMemo(() => sodActivity(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => sodConflicts(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = all.filter(isOpenConflict);
  const acked = all.filter((c) => c.ack);
  const covered = all.filter((c) => !c.ack && c.covered);
  const list = (show === 'open' ? open : all).sort((a, b) => (a.type === b.type ? (b.date ?? '').localeCompare(a.date ?? '') : a.type === 'activity' ? -1 : 1));
  const edit = can(user, 'controls.edit');
  const name = (id?: ID) => state.users.find((u) => u.id === id)?.name ?? id;
  const ack = (c: SodConflict) => { setErrors([]); try { acknowledgeSod(books, user, c.key, reasons[c.key] ?? '', { coversActivity: covers[c.key] }); say('Acknowledged.'); } catch (e) { setErrors(errText(e)); } };
  const mark = (on: boolean, lim?: number | null) => (on ? (lim ? `✓ ≤ ${formatMoney(lim, { dollarSign: true, whole: true })}` : '✓') : '—');
  return (
    <>
      <PageHead eyebrow="Controls" title="Segregation of duties" lede="Who can enter, approve and pay, from the role matrix and the approval limits, and who actually did. Conflicts are flagged in both; accept one only with a reason (a compensating control).">
        <ExportButtons name="sod-conflicts" header={['Type', 'Area', 'Conflict', 'Detail', 'Amount', 'Status', 'Reason']} rows={all.map((c) => [c.type, c.area, c.title, c.detail, csvMoney(c.amount), c.ack ? 'Acknowledged' : c.covered ? 'Covered' : 'Open', c.ack?.reason ?? c.covered?.reason ?? ''])} print={false} />
      </PageHead>
      <section className="figures" aria-label="Segregation of duties" style={{ marginBottom: 20 }}>
        <Figure label="Open in activity" value={open.filter((c) => c.type === 'activity').length} note="One person did two steps on the same record" />
        <Figure label="Open in configuration" value={open.filter((c) => c.type === 'config').length} note="A role that can do every step" />
        <Figure label="Acknowledged" value={acked.length} note="Accepted with a reason" />
        <Figure label="Covered by a role's control" value={covered.length} note="Activity of a role whose conflict was accepted" />
      </section>
      <Errors errors={errors} />
      <section className="panel" aria-labelledby="sm-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="sm-h">What each role can do</h2><span className="muted small">From permissions and approval limits</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Area</th>{LIMIT_ROLES.map((r) => <th scope="col" key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>{SOD_AREAS.map((a) => (
            <tr key={a.area}><th scope="row" style={{ textAlign: 'left' }}>{a.label}<div className="muted small">{a.steps.filter(Boolean).join(' · ')}</div></th>
              {LIMIT_ROLES.map((r) => {
                const c = matrix.find((m) => m.role === r && m.area === a.area)!;
                const conflict = c.enter && c.approve && (c.pay === null || c.pay);
                return <td key={r} className="small">{a.steps[0]}: {mark(c.enter)}<br />{a.steps[1]}: {mark(c.approve, a.area === 'cash' ? null : c.approveLimit)}{a.steps[2] && <><br />{a.steps[2]}: {mark(!!c.pay)}</>}{conflict && <div><span className="pill warn">All steps</span></div>}</td>;
              })}
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="panel" aria-labelledby="sc-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="sc-h">Conflicts</h2><Seg label="Show" value={show} onChange={setShow} options={[{ v: 'open', label: `Open (${open.length})` }, { v: 'all', label: `All (${all.length})` }]} /></div>
        {list.length === 0 ? <p className="panel-pad muted">No open conflicts.</p> : (
          <ul className="inbox">{list.slice(0, 80).map((c) => (
            <li key={c.key} style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline' }}>
                <b style={{ flex: 1, minWidth: 200 }}>{c.title}</b>
                <span className={'pill ' + (c.ack || c.covered ? 'ok' : c.type === 'activity' ? 'bad' : 'warn')}>{c.ack ? 'Acknowledged' : c.covered ? 'Covered' : c.type === 'activity' ? 'Activity' : 'Configuration'}</span>
                {c.amount > 0 && <span className="num"><Money c={c.amount} dollar /></span>}
              </div>
              <span className="muted small">{c.detail}{c.evidence[0]?.to && <> · <Link to={c.evidence[0].to}>{c.evidence[0].label}</Link></>}</span>
              {(c.ack || c.covered) && <span className="small">“{(c.ack ?? c.covered)!.reason}” — {name((c.ack ?? c.covered)!.by)}, {shortDate((c.ack ?? c.covered)!.at.slice(0, 10))}</span>}
              {!c.ack && edit && (
                <div className="actions" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ width: 320, maxWidth: '100%' }}><label htmlFor={`sr-${c.key}`}>Reason / compensating control</label><input id={`sr-${c.key}`} value={reasons[c.key] ?? ''} onChange={(e) => setReasons({ ...reasons, [c.key]: e.target.value })} /></div>
                  {c.type === 'config' && <label className="check small"><input type="checkbox" checked={!!covers[c.key]} onChange={(e) => setCovers({ ...covers, [c.key]: e.target.checked })} /> Also covers this role's activity</label>}
                  <button className="btn sm" onClick={() => ack(c)} aria-label={`Acknowledge ${c.title}`}>Acknowledge</button>
                </div>
              )}
            </li>
          ))}</ul>
        )}
        <TieOut items={[{ label: open.length + acked.length + covered.length === all.length ? 'Open + acknowledged + covered = every conflict' : 'Conflict counts do not add up', ok: open.length + acked.length + covered.length === all.length, detail: `${all.length}` }]} />
      </section>
      <section className="panel" aria-labelledby="sa-h">
        <div className="panel-head"><h2 id="sa-h">What people actually did</h2><span className="muted small">From the records (bills, entries, rate changes, payroll, cash bags) and the audit log</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Person</th><th scope="col">Area</th><th scope="col" className="num">Entered</th><th scope="col" className="num">Approved</th><th scope="col" className="num">Paid / deposited</th></tr></thead>
          <tbody>{activity.map((a) => {
            const steps = SOD_AREAS.find((x) => x.area === a.area)!;
            const multi = [a.enter, a.approve, a.pay].filter((n) => n > 0).length >= 2;
            return <tr key={a.area + a.who}><td>{a.who}{multi && <span className="pill warn" style={{ marginLeft: 6 }}>More than one step</span>}</td><td>{steps.label}</td><td className="num">{a.enter}</td><td className="num">{a.approve}</td><td className="num">{steps.steps[2] ? a.pay : '—'}</td></tr>;
          })}</tbody>
        </table></div>
      </section>
      {toast}
      <Help k="controlsSod" />
    </>
  );
}

// ── Cash controls ────────────────────────────────────────────────────────
export function CashControlsPage() {
  const { state, books, user, visible, version } = useBooks();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const today = todayInChicago();
  const code = useCodes();
  const cc = cashControlsOf(state);
  const [f, setF] = useState({ amount: (cc.dualCountAboveCents / 100).toFixed(2), from: cc.dualFrom, enforce: cc.enforceDual, blind: cc.blindHq, min: String(cc.patternMin), days: String(cc.patternWindowDays) });
  const dual = useMemo(() => dualCountRows(state, visible), [state, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => varianceRows(state, { visible }), [state, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const persons = useMemo(() => varianceByPerson(state, rows, { visible }), [state, rows, visible]);
  const byStore = useMemo(() => varianceByStore(rows), [rows]);
  const patterns = useMemo(() => shortagePatterns(state, { visible, to: today }), [state, visible, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const deposits = useMemo(() => depositTimeliness(state, today, visible), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [second, setSecond] = useState<Record<string, { person: string; amount: string }>>({});
  const exceptions = dual.filter((d) => d.status !== 'ok');
  const overdue = deposits.filter((d) => d.overdue);
  const done = deposits.filter((d) => d.deposited);
  const avgDays = done.length ? done.reduce((a, d) => a + d.days, 0) / done.length : 0;
  const late = done.filter((d) => d.days > state.settings.depositWithinDays);
  const netRows = rows.reduce((a, r) => a + r.diff, 0);
  const netPersons = persons.reduce((a, p) => a + p.net, 0);
  const netStores = byStore.reduce((a, s) => a + s.net, 0);
  const periods = [...new Set(byStore.map((s) => s.period))].sort();
  const storeIds = [...new Set(byStore.map((s) => s.storeId))];
  const edit = can(user, 'controls.edit');
  const save = () => {
    setErrors([]);
    try { saveCashControls(books, user, { dualCountAboveCents: parseMoney(f.amount) ?? NaN, dualFrom: f.from, enforceDual: f.enforce, blindHq: f.blind, patternMin: Number(f.min), patternWindowDays: Number(f.days) }); say('Cash controls saved.'); } catch (e) { setErrors(errText(e)); }
  };
  const rec = (k: string, r: (typeof dual)[number]) => {
    setErrors([]);
    const s = second[k] ?? { person: '', amount: '' };
    try { recordSecondCount(books, user, { bagId: r.bagId, stage: r.stage, person: s.person, amount: s.amount.trim() ? parseMoney(s.amount) ?? NaN : r.amount }); say('Second count recorded.'); } catch (e) { setErrors(errText(e)); }
  };
  return (
    <>
      <PageHead eyebrow="Controls" title="Cash controls" lede="Dual counts over a set amount, blind HQ counts, deposits within the allowed days, and variance trends by person and by store, with repeated small shortages flagged even when each is under $5.">
        <ExportButtons name="cash-variance-by-person" header={['Person', 'Stores', 'Handoffs', 'Shortages', 'Under materiality', 'Short total', 'Over total', 'Net']} rows={persons.map((p) => [p.person, p.stores.map(code).join(' '), p.handoffs, p.shortages, p.small, csvMoney(p.shortTotal), csvMoney(p.overTotal), csvMoney(p.net)])} print={false} />
      </PageHead>
      <section className="figures" aria-label="Cash controls" style={{ marginBottom: 20 }}>
        <Figure label="Second counts missing or off" value={exceptions.length} note={`Of ${dual.length} counts of ${money(cc.dualCountAboveCents)}+ since ${shortDate(cc.dualFrom)}`} />
        <Figure label="Blind HQ counts" value={cc.blindHq ? 'On' : 'Off'} note={cc.blindHq ? 'HQ sees the pickup amount only after counting' : 'Turn on below'} />
        <Figure label="Deposits overdue" value={overdue.length} note={`Within ${state.settings.depositWithinDays} days of pickup · average ${avgDays.toFixed(1)} days`} href="/cash?show=overdue" />
        <Figure label="Small-shortage patterns" value={patterns.length} note={`${cc.patternMin}+ shortages under ${money(state.settings.materialityCents)} in ${cc.patternWindowDays} days`} />
      </section>
      <Errors errors={errors} />
      <section className="panel" aria-labelledby="cs-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="cs-h">Settings</h2></div>
        <div className="panel-pad form-grid">
          <div className="field"><label htmlFor="cc-amt">Second count at or above</label><input id="cc-amt" className="num" inputMode="decimal" value={f.amount} disabled={!edit} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="field"><label htmlFor="cc-from">Second counts from</label><input id="cc-from" type="date" value={f.from} disabled={!edit} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="cc-min">Pattern: shortages</label><input id="cc-min" className="num" inputMode="numeric" value={f.min} disabled={!edit} onChange={(e) => setF({ ...f, min: e.target.value })} /></div>
          <div className="field"><label htmlFor="cc-days">Pattern: within days</label><input id="cc-days" className="num" inputMode="numeric" value={f.days} disabled={!edit} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
          <label className="check"><input type="checkbox" checked={f.enforce} disabled={!edit} onChange={(e) => setF({ ...f, enforce: e.target.checked })} /> Refuse a count over the amount without a second counter</label>
          <label className="check"><input type="checkbox" checked={f.blind} disabled={!edit} onChange={(e) => setF({ ...f, blind: e.target.checked })} /> Blind HQ counts (hide the pickup amount until HQ counts)</label>
        </div>
        {edit && <div className="panel-pad actions" style={{ paddingTop: 0 }}><button className="btn primary" onClick={save}>Save cash controls</button><Link to="/cash" className="btn ghost">Open the cash chain</Link></div>}
      </section>
      <section className="panel" aria-labelledby="dc-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="dc-h">Dual counts</h2><span className="muted small">{dual.length - exceptions.length} of {dual.length} second-counted and agreeing</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Bag</th><th scope="col">Step</th><th scope="col">Counted by</th><th scope="col" className="num">Amount</th><th scope="col">Second count</th></tr></thead>
          <tbody>{[...exceptions, ...dual.filter((d) => d.status === 'ok')].slice(0, 40).map((r) => {
            const k = `${r.bagId}|${r.stage}`;
            const canDo = r.stage === 'count' ? can(user, 'cash.count') : can(user, 'cash.handle');
            return (
              <tr key={k}><td><Link to={`/cash?date=${r.businessDate}`}>{code(r.storeId)} {shortDate(r.businessDate)}</Link></td><td>{STAGE_LABEL[r.stage]}</td><td>{r.person}</td><td className="num"><Money c={r.amount} /></td>
                <td>{r.second ? <><span className={'pill ' + (r.status === 'ok' ? 'ok' : 'bad')}>{r.status === 'ok' ? 'Agrees' : r.status === 'mismatch' ? `Off ${money(r.second.amount - r.amount)}` : 'Same person'}</span> <span className="small">{r.second.person}</span></>
                  : canDo ? (
                    <div className="actions">
                      <label className="sr-only" htmlFor={`sc-p-${k}`}>Second counter for {code(r.storeId)} {r.businessDate} {STAGE_LABEL[r.stage]}</label>
                      <input id={`sc-p-${k}`} placeholder="Who counted" style={{ width: 150 }} value={second[k]?.person ?? ''} onChange={(e) => setSecond({ ...second, [k]: { amount: second[k]?.amount ?? '', person: e.target.value } })} />
                      <label className="sr-only" htmlFor={`sc-a-${k}`}>Second count amount</label>
                      <input id={`sc-a-${k}`} className="num" inputMode="decimal" placeholder={(r.amount / 100).toFixed(2)} style={{ width: 110 }} value={second[k]?.amount ?? ''} onChange={(e) => setSecond({ ...second, [k]: { person: second[k]?.person ?? '', amount: e.target.value } })} />
                      <button className="btn sm" onClick={() => rec(k, r)}>Record</button>
                    </div>
                  ) : <span className="pill bad">Missing</span>}
                </td></tr>
            );
          })}</tbody>
        </table></div>
      </section>
      <section className="panel" aria-labelledby="sp-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="sp-h">Repeated small shortages</h2><span className="muted small">Each under {money(state.settings.materialityCents)}: ignored alone, flagged as a pattern (SPEC §6.8)</span></div>
        {patterns.length === 0 ? <p className="panel-pad muted">No pattern.</p> : patterns.map((p) => (
          <div key={p.person} style={{ borderTop: '1px solid var(--rule)' }}>
            <p className="panel-pad" style={{ paddingBottom: 6 }}><b>{p.person}</b> ({p.storeIds.map(code).join(', ')}): {p.count} shortages from {shortDate(p.from)} to {shortDate(p.to)}, <Money c={p.total} dollar /> in all.</p>
            <EvidenceTable caption={`Shortages by ${p.person}`} amount={p.total} rows={p.rows.map((r) => ({ id: r.bagId + r.stage, label: `${STAGE_LABEL[r.stage]} short`, date: r.date, amount: r.diff, storeId: r.storeId, to: `/cash?date=${r.date}` }))} />
          </div>
        ))}
      </section>
      <div className="grid-2" style={{ marginBottom: 20 }}>
        <section className="panel" aria-labelledby="vp-h">
          <div className="panel-head"><h2 id="vp-h">Variance by person</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Person</th><th scope="col" className="num">Handoffs</th><th scope="col" className="num">Short</th><th scope="col" className="num">Under $5</th><th scope="col" className="num">Net</th></tr></thead>
            <tbody>{persons.map((p) => <tr key={p.person}><td>{p.person}<div className="muted small">{p.stores.map(code).join(', ')}</div></td><td className="num">{p.handoffs}</td><td className="num">{p.shortages}</td><td className="num">{p.small}</td><td className="num"><Money c={p.net} /></td></tr>)}
              <tr className="total"><td colSpan={4}>Net variance</td><td className="num"><Money c={netPersons} /></td></tr></tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="vs-h">
          <div className="panel-head"><h2 id="vs-h">Variance by store and month</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th>{periods.map((p) => <th scope="col" key={p} className="num">{periodLabel(p)}</th>)}</tr></thead>
            <tbody>{storeIds.map((s) => <tr key={s}><td>{code(s)}</td>{periods.map((p) => { const x = byStore.find((b) => b.storeId === s && b.period === p); return <td key={p} className="num">{x ? <><Money c={x.net} /><div className="muted small">{x.shortages} short</div></> : '—'}</td>; })}</tr>)}
              <tr className="total"><td>Net</td>{periods.map((p) => <td key={p} className="num"><Money c={byStore.filter((b) => b.period === p).reduce((a, b) => a + b.net, 0)} /></td>)}</tr></tbody>
          </table></div>
        </section>
      </div>
      <TieOut items={[{ label: netRows === netPersons && netRows === netStores ? 'By person and by store add to the same net variance as every handoff' : 'By person and by store do not agree', ok: netRows === netPersons && netRows === netStores, detail: <Money c={netRows} dollar /> }]} />
      <section className="panel" aria-labelledby="dt-h" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2 id="dt-h">Deposit within {state.settings.depositWithinDays} days</h2><span className="muted small">{late.length} deposited late · {overdue.length} not yet deposited</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Bag</th><th scope="col">Picked up</th><th scope="col">Deposited</th><th scope="col" className="num">Days</th></tr></thead>
          <tbody>{[...overdue, ...late].slice(0, 30).map((d) => <tr key={d.bagId}><td><Link to={`/cash?date=${d.businessDate}`}>{code(d.storeId)} {shortDate(d.businessDate)}</Link></td><td>{shortDate(d.pickedUp)}</td><td>{d.deposited ? shortDate(d.deposited) : <span className="pill bad">Not deposited</span>}</td><td className="num">{d.days}</td></tr>)}
            {overdue.length + late.length === 0 && <tr><td colSpan={4} className="muted">Every bag reached the bank on time.</td></tr>}</tbody>
        </table></div>
      </section>
      {toast}
      <Help k="controlsCash" />
    </>
  );
}

// ── Fraud signals ────────────────────────────────────────────────────────
export function FraudSignalsPage() {
  const { state, visible, version } = useBooks();
  const [tab, setTab] = useTab(['signals', 'pos', 'driveoffs'] as const);
  const today = todayInChicago();
  const signals = useMemo(() => fraudSignals(state, { today, visible }), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = signals.filter((s) => !s.dismissed);
  const fresh = open.filter(isNewSignal);
  return (
    <>
      <PageHead eyebrow="Controls" title="Fraud signals" lede="Patterns worth a second look, each with the rows that raised it. Dismiss one with what you found (it goes in the audit log), or escalate it with a note.">
        <ExportButtons name="fraud-signals" header={['Signal', 'Kind', 'Severity', 'Date', 'Amount', 'Evidence rows', 'Status', 'Reason / note']} rows={signals.map((s) => [s.title, SIGNAL_LABEL[s.kind], s.severity, s.date, csvMoney(s.amount), s.evidence.length, s.dismissed ? 'Dismissed' : s.escalated ? 'Escalated' : 'New', s.dismissed?.reason ?? s.escalated?.note ?? ''])} print={false} />
      </PageHead>
      <section className="figures" aria-label="Fraud signals" style={{ marginBottom: 20 }}>
        <Figure label="New" value={fresh.length} note={`${fresh.filter((s) => s.severity === 'high').length} high`} />
        <Figure label="Escalated" value={open.length - fresh.length} note="Open, with a follow-up note" />
        <Figure label="Dismissed" value={signals.length - open.length} note="Closed with a reason" />
        <Figure label="In open signals" value={<Money c={open.reduce((a, s) => a + s.amount, 0)} whole dollar />} note="Sum of their evidence rows" />
      </section>
      <Seg label="Show" value={tab} onChange={setTab} options={[{ v: 'signals', label: 'Signals' }, { v: 'pos', label: 'POS exceptions' }, { v: 'driveoffs', label: 'Drive-off log' }]} />
      {tab === 'signals' ? <SignalList signals={signals} /> : tab === 'pos' ? <PosImport /> : <DriveOffLog />}
      <Help k="controlsFraud" />
    </>
  );
}

function SignalList({ signals }: { signals: FraudSignal[] }) {
  const { state, books, user } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [text, setText] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Record<string, 'dismiss' | 'escalate' | undefined>>({});
  const kind = (sp.get('kind') ?? '') as SignalKind | '';
  const show = sp.get('show') ?? 'open';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const list = signals.filter((s) => (!kind || s.kind === kind) && (show === 'all' || (show === 'dismissed' ? !!s.dismissed : !s.dismissed)));
  const canDismiss = can(user, 'controls.edit');
  const canEscalate = canDismiss || can(user, 'approve');
  const name = (id: ID) => state.users.find((u) => u.id === id)?.name ?? id;
  const code = useCodes();
  const run = (fn: () => void, msg: string, key: string) => { setErrors([]); try { fn(); say(msg); setMode({ ...mode, [key]: undefined }); } catch (e) { setErrors(errText(e)); } };
  const counts = new Map<SignalKind, number>();
  for (const s of signals.filter((x) => !x.dismissed)) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  return (
    <>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="filters">
          <div className="field wide"><label htmlFor="fs-kind">Signal</label><select id="fs-kind" value={kind} onChange={(e) => set('kind', e.target.value)}><option value="">Every signal</option>{(Object.keys(SIGNAL_LABEL) as SignalKind[]).map((k) => <option key={k} value={k}>{SIGNAL_LABEL[k]} ({counts.get(k) ?? 0})</option>)}</select></div>
          <div className="field"><label htmlFor="fs-show">Status</label><select id="fs-show" value={show} onChange={(e) => set('show', e.target.value === 'open' ? '' : e.target.value)}><option value="open">Open</option><option value="dismissed">Dismissed</option><option value="all">All</option></select></div>
        </div>
        <details className="panel-pad small"><summary>Where each signal comes from</summary><ul>{(Object.keys(SIGNAL_SOURCE) as SignalKind[]).map((k) => <li key={k}><b>{SIGNAL_LABEL[k]}:</b> {SIGNAL_SOURCE[k]}</li>)}</ul></details>
      </section>
      <Errors errors={errors} />
      {list.length === 0 && <p className="note">No signals here.</p>}
      {list.map((s) => (
        <section key={s.key} className="panel" aria-labelledby={`sg-${s.key}`} style={{ marginBottom: 16 }}>
          <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h2 id={`sg-${s.key}`} style={{ fontSize: 18 }}>{s.title}</h2>
            <div className="actions"><span className={'pill ' + PILL[s.severity]}>{s.severity === 'high' ? 'High' : s.severity === 'medium' ? 'Medium' : 'Low'}</span><span className="pill">{SIGNAL_LABEL[s.kind]}</span>{s.storeId && <span className="pill">{code(s.storeId)}</span>}<b className="num"><Money c={s.amount} dollar /></b></div>
          </div>
          <p className="panel-pad small" style={{ paddingBottom: 8 }}>{s.detail}</p>
          {s.dismissed && <p className="panel-pad small" style={{ paddingTop: 0 }}><span className="pill ok">Dismissed</span> “{s.dismissed.reason}” — {name(s.dismissed.by)}, {shortDate(s.dismissed.at.slice(0, 10))}</p>}
          {s.escalated && <p className="panel-pad small" style={{ paddingTop: 0 }}><span className="pill warn">Escalated</span> “{s.escalated.note}” — {name(s.escalated.by)}, {shortDate(s.escalated.at.slice(0, 10))}</p>}
          <EvidenceTable rows={s.evidence} amount={s.amount} caption={`Evidence for ${s.title}`} />
          {(canDismiss || canEscalate) && (
            <div className="panel-pad actions" style={{ alignItems: 'flex-end' }}>
              {mode[s.key] ? (
                <>
                  <div className="field" style={{ width: 340, maxWidth: '100%' }}><label htmlFor={`sx-${s.key}`}>{mode[s.key] === 'dismiss' ? 'What did you find?' : 'Note for follow-up'}</label><input id={`sx-${s.key}`} value={text[s.key] ?? ''} onChange={(e) => setText({ ...text, [s.key]: e.target.value })} /></div>
                  {mode[s.key] === 'dismiss'
                    ? <button className="btn danger sm" onClick={() => run(() => dismissSignal(books, user, s.key, text[s.key] ?? ''), 'Dismissed. The reason is in the audit log.', s.key)}>Confirm dismiss</button>
                    : <button className="btn primary sm" onClick={() => run(() => escalateSignal(books, user, s.key, text[s.key] ?? ''), 'Escalated with your note.', s.key)}>Save note</button>}
                  <button className="btn ghost sm" onClick={() => setMode({ ...mode, [s.key]: undefined })}>Cancel</button>
                </>
              ) : (
                <>
                  {canDismiss && !s.dismissed && <button className="btn sm" onClick={() => setMode({ ...mode, [s.key]: 'dismiss' })} aria-label={`Dismiss ${s.title}`}>Dismiss…</button>}
                  {canDismiss && s.dismissed && <button className="btn sm ghost" onClick={() => run(() => reopenSignal(books, user, s.key), 'Reopened.', s.key)} aria-label={`Reopen ${s.title}`}>Reopen</button>}
                  {canEscalate && !s.dismissed && <button className="btn sm ghost" onClick={() => setMode({ ...mode, [s.key]: 'escalate' })} aria-label={`Escalate ${s.title}`}>{s.escalated ? 'Change note…' : 'Escalate…'}</button>}
                </>
              )}
            </div>
          )}
        </section>
      ))}
      {toast}
    </>
  );
}

function PosImport() {
  const { state, books, user, visible } = useBooks();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [file, setFile] = useState<{ name: string; rows: PosExceptionRow[] } | null>(null);
  const code = useCodes();
  const c = controlsOf(state);
  const rows = c.posExceptions.filter((x) => visible.has(x.storeId)).sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set(c.posExceptions.map((x) => x.hash));
  const good = file?.rows.filter((r) => !r.errors.length) ?? [];
  const fresh = good.filter((r) => !seen.has(r.hash));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const batchTotal = c.posBatches.reduce((a, b) => a + b.total, 0);
  return (
    <>
      <p className="note" style={{ marginBottom: 16 }}>The POS daily close the portal imports has no cashier detail, so voids and refunds by cashier need the POS's own exception report. Export it as CSV with Date, Store, Cashier, Type (void, refund, no sale, discount), Count and Amount, and import it here. Until then this signal stays quiet.</p>
      <Errors errors={errors} />
      {can(user, 'risk.edit') && (
        <section className="panel panel-pad" aria-labelledby="pi-h" style={{ marginBottom: 16 }}>
          <h2 id="pi-h" style={{ marginBottom: 8 }}>Import a POS exception report</h2>
          <label htmlFor="pi-file" className="sr-only">POS exception report (CSV)</label>
          <input id="pi-file" type="file" accept=".csv,text/csv" onChange={async (e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (!fl) return; setFile({ name: fl.name, rows: parsePosExceptions(state, await fl.text()) }); }} />
          {file && (
            <div style={{ marginTop: 12 }}>
              <p className="small">{file.rows.length} rows read: {good.length} clean, {file.rows.length - good.length} with problems; {fresh.length} new, {good.length - fresh.length} already imported. Total {money(good.reduce((a, r) => a + (r.amount ?? 0), 0))}.</p>
              {file.rows.some((r) => r.errors.length) && <p className="small neg">Rows {file.rows.filter((r) => r.errors.length).map((r) => `${r.row} (${r.errors.join(', ')})`).join('; ')} can't be read and are skipped.</p>}
              <button className="btn primary" disabled={!fresh.length} onClick={() => { setErrors([]); try { const b = importPosExceptions(books, user, file.name, file.rows); setFile(null); say(`Imported ${b.added} rows.`); } catch (er) { setErrors(errText(er)); } }}>Import {fresh.length} new rows</button>
            </div>
          )}
        </section>
      )}
      <section className="panel" aria-labelledby="pl-h">
        <div className="panel-head"><h2 id="pl-h">Imported exceptions</h2><span className="muted small">{rows.length} rows</span></div>
        {rows.length === 0 ? <p className="panel-pad muted">Nothing imported yet.</p> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Store</th><th scope="col">Cashier</th><th scope="col">Type</th><th scope="col" className="num">Count</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>{rows.slice(0, 100).map((r) => <tr key={r.id}><td>{shortDate(r.date)}</td><td>{code(r.storeId)}</td><td>{r.cashier}</td><td>{POS_KIND_LABEL[r.kind]}</td><td className="num">{r.count}</td><td className="num"><Money c={r.amount} /></td></tr>)}</tbody>
          </table></div>
        )}
        <TieOut items={[{ label: total === batchTotal ? 'Rows add to the import batch totals' : 'Rows differ from the import batch totals', ok: total === batchTotal || rows.length !== c.posExceptions.length, detail: <Money c={total} dollar /> }]} />
      </section>
      {toast}
    </>
  );
}

function DriveOffLog() {
  const { state, books, user, stores, visible } = useBooks();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const code = useCodes();
  const fuelStores = stores.filter((s) => fuelOf(state).tanks.some((t) => t.storeId === s.id));
  const [f, setF] = useState({ storeId: fuelStores[0]?.id ?? '', date: todayInChicago(), grade: 'regular', gallons: '', amount: '', pump: '', note: '' });
  const rows = controlsOf(state).driveOffs.filter((d) => visible.has(d.storeId)).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Errors errors={errors} />
      {can(user, 'fuel.readings') && (
        <section className="panel" aria-labelledby="do-h" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h2 id="do-h">Log a drive-off</h2></div>
          <div className="panel-pad form-grid">
            <div className="field"><label htmlFor="do-s">Store</label><select id="do-s" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}>{fuelStores.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></div>
            <div className="field"><label htmlFor="do-d">Date</label><input id="do-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="do-g">Grade</label><select id="do-g" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}><option value="regular">Regular</option><option value="plus">Plus</option><option value="premium">Premium</option><option value="diesel">Diesel</option></select></div>
            <div className="field"><label htmlFor="do-gal">Gallons</label><input id="do-gal" className="num" inputMode="decimal" value={f.gallons} onChange={(e) => setF({ ...f, gallons: e.target.value })} /></div>
            <div className="field"><label htmlFor="do-amt">Amount</label><input id="do-amt" className="num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            <div className="field"><label htmlFor="do-p">Pump</label><input id="do-p" value={f.pump} onChange={(e) => setF({ ...f, pump: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="do-n">Note</label><input id="do-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          </div>
          <div className="panel-pad" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => { setErrors([]); try { saveDriveOff(books, user, { storeId: f.storeId, date: f.date, grade: f.grade, gallons: Number(f.gallons), amount: parseMoney(f.amount) ?? NaN, pump: f.pump, note: f.note }); setF({ ...f, gallons: '', amount: '', pump: '', note: '' }); say('Drive-off logged.'); } catch (e) { setErrors(errText(e)); } }}>Log drive-off</button></div>
        </section>
      )}
      <section className="panel" aria-labelledby="dl-h">
        <div className="panel-head"><h2 id="dl-h">Drive-off log</h2><span className="muted small">{rows.length} logged</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Date</th><th scope="col">Store</th><th scope="col">Pump · grade</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Amount</th><th scope="col">Note</th></tr></thead>
          <tbody>{rows.map((d) => <tr key={d.id}><td>{shortDate(d.date)}</td><td>{code(d.storeId)}</td><td>{[d.pump && `Pump ${d.pump}`, d.grade].filter(Boolean).join(' · ')}</td><td className="num">{d.gallons}</td><td className="num"><Money c={d.amount} /></td><td className="small">{d.note}</td></tr>)}
            {!rows.length && <tr><td colSpan={6} className="muted">No drive-offs logged.</td></tr>}
            <tr className="total"><td colSpan={4}>Total</td><td className="num"><Money c={rows.reduce((a, d) => a + d.amount, 0)} /></td><td /></tr></tbody>
        </table></div>
      </section>
      {toast}
    </>
  );
}

// ── Risk & insurance ─────────────────────────────────────────────────────
const blankRisk = (today: string): RiskDraft => ({ title: '', category: 'operational', likelihood: 3, impact: 3, owner: '', mitigation: '', reviewDate: today, status: 'open' });

export function RiskPage() {
  const { state, books, user, version } = useBooks();
  const [tab, setTab] = useTab(['register', 'coverage', 'claims'] as const);
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const today = todayInChicago();
  const code = useCodes();
  const c = controlsOf(state);
  const risks = [...c.risks].sort((a, b) => riskScore(b) - riskScore(a));
  const due = risksDue(state, today);
  const coverage = useMemo(() => coverageChecklist(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const gaps = coverage.filter((r) => r.status === 'gap' || r.status === 'under_limit');
  const policies = complianceOf(state).policies;
  const premiums = policies.reduce((a, p) => a + p.premium, 0);
  const checklistPremium = coverage.reduce((a, r) => a + r.premium, 0) + policies.filter((p) => !COVERAGE_KINDS.includes(p.kind)).reduce((a, p) => a + p.premium, 0);
  const [draft, setDraft] = useState<RiskDraft | null>(null);
  const edit = can(user, 'risk.edit');
  const exportRows = tab === 'register'
    ? { name: 'risk-register', header: ['Risk', 'Category', 'Likelihood', 'Impact', 'Score', 'Owner', 'Mitigation', 'Review date', 'Status'], rows: risks.map((r) => [r.title, RISK_CATEGORY_LABEL[r.category], r.likelihood, r.impact, riskScore(r), r.owner, r.mitigation, r.reviewDate, r.status]) }
    : tab === 'coverage'
      ? { name: 'coverage-checklist', header: ['Coverage', 'Required', 'Status', 'Policies', 'Limit', 'Premium', 'Renews', 'Detail'], rows: coverage.map((r) => [POLICY_LABEL[r.kind], r.need.required ? 'Yes' : 'No', r.status, r.policies.map((p) => p.policyNo).join(' '), r.limit ? csvMoney(r.limit) : '', csvMoney(r.premium), r.expires ?? '', r.detail]) }
      : { name: 'insurance-claims', header: ['Date', 'Store', 'Description', 'Policy', 'Claimed', 'Paid', 'Status'], rows: c.claims.map((x) => [x.date, code(x.storeId), x.description, policies.find((p) => p.id === x.policyId)?.policyNo ?? '', csvMoney(x.amount), csvMoney(x.paid), x.status]) };
  const saveR = () => { if (!draft) return; setErrors([]); try { saveRisk(books, user, draft); setDraft(null); say('Risk saved.'); } catch (e) { setErrors(errText(e)); } };
  return (
    <>
      <PageHead eyebrow="Controls" title="Risk & insurance" lede="The risk register, the coverage checklist against the policies on file (Compliance › Insurance), and the claims history.">
        <ExportButtons name={exportRows.name} header={exportRows.header} rows={exportRows.rows} print={false} />
      </PageHead>
      <section className="figures" aria-label="Risk and insurance" style={{ marginBottom: 20 }}>
        <Figure label="Open risks" value={risks.filter((r) => r.status === 'open').length} note={`${risks.filter((r) => r.status === 'open' && riskLevel(r) === 'high').length} high`} />
        <Figure label="Reviews due" value={due.length} note={due.slice(0, 2).map((r) => `${r.title} ${shortDate(r.reviewDate)}`).join('; ') || 'None in the next 14 days'} />
        <Figure label="Coverage gaps" value={gaps.length} note={gaps.map((g) => POLICY_LABEL[g.kind]).join(', ') || 'None'} href="/controls/risk?tab=coverage" />
        <Figure label="Annual premiums" value={<Money c={premiums} whole dollar />} note={`${policies.length} policies · ${c.claims.filter((x) => x.status === 'open').length} open claim(s)`} href="/compliance/insurance" />
      </section>
      <Seg label="Show" value={tab} onChange={setTab} options={[{ v: 'register', label: 'Risk register' }, { v: 'coverage', label: 'Coverage checklist' }, { v: 'claims', label: 'Claims' }]} />
      <Errors errors={errors} />
      {tab === 'register' && (
        <section className="panel" aria-labelledby="rr-h">
          <div className="panel-head"><h2 id="rr-h">Risk register</h2>{edit && !draft && <button className="btn sm" onClick={() => setDraft(blankRisk(today))}>Add a risk</button>}</div>
          {draft && (
            <div className="panel-pad" style={{ borderBottom: '1px solid var(--rule)' }}>
              <div className="form-grid">
                <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="rk-t">Risk</label><input id="rk-t" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
                <div className="field"><label htmlFor="rk-c">Category</label><select id="rk-c" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Risk['category'] })}>{Object.entries(RISK_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="field"><label htmlFor="rk-l">Likelihood (1–5)</label><input id="rk-l" className="num" inputMode="numeric" value={draft.likelihood} onChange={(e) => setDraft({ ...draft, likelihood: Number(e.target.value) })} /></div>
                <div className="field"><label htmlFor="rk-i">Impact (1–5)</label><input id="rk-i" className="num" inputMode="numeric" value={draft.impact} onChange={(e) => setDraft({ ...draft, impact: Number(e.target.value) })} /></div>
                <div className="field"><label htmlFor="rk-o">Owner</label><input id="rk-o" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} /></div>
                <div className="field"><label htmlFor="rk-r">Next review</label><input id="rk-r" type="date" value={draft.reviewDate} onChange={(e) => setDraft({ ...draft, reviewDate: e.target.value })} /></div>
                <div className="field"><label htmlFor="rk-s">Status</label><select id="rk-s" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Risk['status'] })}><option value="open">Open</option><option value="closed">Closed</option></select></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="rk-m">Mitigation</label><input id="rk-m" value={draft.mitigation} onChange={(e) => setDraft({ ...draft, mitigation: e.target.value })} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={saveR}>Save risk</button><button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button></div>
            </div>
          )}
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Risk</th><th scope="col" className="num">L × I</th><th scope="col">Owner</th><th scope="col">Mitigation</th><th scope="col">Review</th>{edit && <th scope="col"><span className="sr-only">Edit</span></th>}</tr></thead>
            <tbody>{risks.map((r) => (
              <tr key={r.id}><td><b>{r.title}</b><div className="muted small">{RISK_CATEGORY_LABEL[r.category]}{r.status === 'closed' ? ' · closed' : ''}{r.policyIds?.length ? ` · insured: ${r.policyIds.map((id) => policies.find((p) => p.id === id)?.policyNo ?? id).join(', ')}` : ''}</div></td>
                <td className="num">{r.likelihood} × {r.impact} <span className={'pill ' + PILL[riskLevel(r)]}>{riskScore(r)}</span></td><td>{r.owner}</td><td className="small">{r.mitigation}</td>
                <td>{shortDate(r.reviewDate)}{r.status === 'open' && r.reviewDate < today ? <div><span className="pill bad">Overdue</span></div> : due.includes(r) ? <div><span className="pill warn">Due soon</span></div> : null}</td>
                {edit && <td><button className="btn sm ghost" onClick={() => setDraft({ ...r })} aria-label={`Edit ${r.title}`}>Edit</button></td>}</tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[{ label: 'Scores are likelihood × impact (high 15+, medium 8+)', ok: risks.every((r) => riskScore(r) === r.likelihood * r.impact) }]} />
        </section>
      )}
      {tab === 'coverage' && (
        <section className="panel" aria-labelledby="cv-h">
          <div className="panel-head"><h2 id="cv-h">Coverage checklist</h2><Link to="/compliance/insurance" className="small">Policies on file</Link></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Coverage</th><th scope="col">Status</th><th scope="col">Policy</th><th scope="col" className="num">Limit</th><th scope="col" className="num">Premium</th><th scope="col">Renews</th></tr></thead>
            <tbody>{coverage.map((r) => (
              <tr key={r.kind}><td><b>{POLICY_LABEL[r.kind]}</b><div className="muted small">{r.need.required ? 'Required' : 'Optional'}{r.need.minLimitCents ? ` · at least ${formatMoney(r.need.minLimitCents, { dollarSign: true, whole: true })}` : ''}</div></td>
                <td><span className={'pill ' + (r.status === 'covered' ? 'ok' : r.status === 'gap' || r.status === 'under_limit' ? 'bad' : r.status === 'expiring' ? 'warn' : '')}>{r.status === 'covered' ? 'Covered' : r.status === 'gap' ? 'Gap' : r.status === 'under_limit' ? 'Under limit' : r.status === 'expiring' ? 'Renew soon' : 'Not required'}</span></td>
                <td className="small">{r.detail || '—'}</td><td className="num">{r.limit ? <Money c={r.limit} whole /> : '—'}</td><td className="num">{r.premium ? <Money c={r.premium} /> : '—'}</td><td>{r.expires ? shortDate(r.expires) : '—'}</td></tr>
            ))}
              <tr className="total"><td colSpan={4}>Premiums</td><td className="num"><Money c={coverage.reduce((a, r) => a + r.premium, 0)} /></td><td /></tr></tbody>
          </table></div>
          <TieOut items={[{ label: checklistPremium === premiums ? 'Premiums agree with every policy on file' : 'Premiums differ from the policies on file', ok: checklistPremium === premiums, detail: <Money c={premiums} dollar /> }]} />
        </section>
      )}
      {tab === 'claims' && <ClaimsPanel onMsg={say} onErr={setErrors} />}
      {toast}
      <Help k="controlsRisk" />
    </>
  );
}

function ClaimsPanel({ onMsg, onErr }: { onMsg: (m: string) => void; onErr: (e: string[]) => void }) {
  const { state, books, user, stores } = useBooks();
  const code = useCodes();
  const c = controlsOf(state);
  const policies = complianceOf(state).policies;
  const items = state.receivables?.items ?? [];
  const [f, setF] = useState({ storeId: stores[0]?.id ?? '', policyId: '', date: todayInChicago(), description: '', amount: '' });
  const linked = c.claims.filter((x) => x.receivableId && x.status === 'open');
  const off = linked.filter((x) => items.find((i) => i.id === x.receivableId)?.expected !== x.amount);
  const setStatus = (x: InsuranceClaim, status: InsuranceClaim['status']) => { try { saveClaim(books, user, { ...x, status }); onMsg('Claim updated.'); } catch (e) { onErr(errText(e)); } };
  return (
    <section className="panel" aria-labelledby="cl-h">
      <div className="panel-head"><h2 id="cl-h">Claims history</h2><span className="muted small">{c.claims.length} claims</span></div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Loss</th><th scope="col">Store</th><th scope="col">Policy</th><th scope="col" className="num">Claimed</th><th scope="col" className="num">Paid</th><th scope="col">Status</th></tr></thead>
        <tbody>{[...c.claims].sort((a, b) => b.date.localeCompare(a.date)).map((x) => (
          <tr key={x.id}><td><b>{x.description}</b><div className="muted small">{shortDate(x.date)}{x.note ? ` · ${x.note}` : ''}{x.receivableId ? <> · <Link to="/receivables/other?tab=insurance">receivable</Link></> : ''}</div></td><td>{code(x.storeId)}</td><td className="small">{policies.find((p) => p.id === x.policyId)?.policyNo ?? '—'}</td><td className="num"><Money c={x.amount} /></td><td className="num"><Money c={x.paid} /></td>
            <td>{can(user, 'risk.edit') ? <><label className="sr-only" htmlFor={`cs-${x.id}`}>Status of {x.description}</label><select id={`cs-${x.id}`} value={x.status} onChange={(e) => setStatus(x, e.target.value as InsuranceClaim['status'])}><option value="open">Open</option><option value="paid">Paid</option><option value="denied">Denied</option><option value="closed">Closed</option></select></> : x.status}</td></tr>
        ))}
          <tr className="total"><td colSpan={3}>Total</td><td className="num"><Money c={c.claims.reduce((a, x) => a + x.amount, 0)} /></td><td className="num"><Money c={c.claims.reduce((a, x) => a + x.paid, 0)} /></td><td /></tr></tbody>
      </table></div>
      <TieOut items={[{ label: off.length ? `${off.length} open claim(s) differ from their receivable` : `Open claims agree with their receivables (${linked.length})`, ok: !off.length, detail: <Link to="/receivables/other?tab=insurance">Insurance receivables</Link> }]} />
      {can(user, 'risk.edit') && (
        <div className="panel-pad" style={{ borderTop: '1px solid var(--rule)' }}>
          <h3 style={{ marginBottom: 8 }}>Record a claim</h3>
          <div className="form-grid">
            <div className="field"><label htmlFor="cl-s">Store</label><select id="cl-s" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <div className="field"><label htmlFor="cl-p">Policy</label><select id="cl-p" value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}><option value="">None</option>{policies.map((p) => <option key={p.id} value={p.id}>{POLICY_LABEL[p.kind]} · {p.policyNo}</option>)}</select></div>
            <div className="field"><label htmlFor="cl-d">Date of loss</label><input id="cl-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="cl-a">Amount claimed</label><input id="cl-a" className="num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="cl-x">What happened</label><input id="cl-x" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          </div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => { onErr([]); try { saveClaim(books, user, { storeId: f.storeId, policyId: f.policyId || undefined, date: f.date, description: f.description, amount: parseMoney(f.amount) ?? NaN, paid: 0, status: 'open' }); setF({ ...f, description: '', amount: '' }); onMsg('Claim recorded.'); } catch (e) { onErr(errText(e)); } }}>Record claim</button>
        </div>
      )}
    </section>
  );
}

// ── UST compliance ───────────────────────────────────────────────────────
const UST_PILL: Record<UstStatus, string> = { ok: 'ok', due_soon: 'warn', overdue: 'bad', never: 'bad', failed: 'bad' };
const UST_STATUS: Record<UstStatus, string> = { ok: 'Current', due_soon: 'Due soon', overdue: 'Overdue', never: 'No record', failed: 'Failed' };

export function UstPage() {
  const { state, books, user, visible, version } = useBooks();
  const [tab, setTab] = useTab(['tests', 'release', 'documents'] as const);
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const today = todayInChicago();
  const code = useCodes();
  const sched = useMemo(() => ustSchedule(state, today, visible), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const release = useMemo(() => releaseDetection(state, today, { visible }), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const fr = financialResponsibility(state, today, visible);
  const [show, setShow] = useState<'attention' | 'all'>('attention');
  const tanks = fuelOf(state).tanks.filter((t) => t.active && visible.has(t.storeId));
  const sites = [...new Set(tanks.map((t) => t.storeId))];
  const bad = sched.filter((r) => r.status === 'overdue' || r.status === 'never' || r.status === 'failed');
  const soon = sched.filter((r) => r.status === 'due_soon');
  const lastMonth = release.filter((r) => r.period === release.map((x) => x.period).sort().at(-1));
  const relFail = release.filter((r) => r.result === 'fail');
  const list = show === 'all' ? sched : sched.filter((r) => r.status !== 'ok');
  const edit = can(user, 'risk.edit');
  const [f, setF] = useState({ storeId: sites[0] ?? '', tankId: '', kind: 'line_leak_detector' as UstTestKind, date: today, result: 'pass' as 'pass' | 'fail', vendor: '', note: '' });
  const expected = tanks.length * UST_TANK_KINDS.length + sites.length * UST_SITE_KINDS.length;
  const licenses = complianceOf(state).licenses.filter((l) => l.kind === 'ust' && visible.has(l.storeId));
  const fees = complianceOf(state).items.filter((i) => /ust/i.test(i.title));
  const records = controlsOf(state).ust.filter((r) => visible.has(r.storeId));
  const periods = [...new Set(release.map((r) => r.period))].sort();
  return (
    <>
      <PageHead eyebrow="Controls" title="UST compliance" lede="Per tank: tank and line tightness, line leak detectors, cathodic protection and spill/overfill tests; per site: inspections and financial responsibility; and monthly release detection from the tank readings.">
        <ExportButtons name="ust-schedule" header={['Tank / site', 'Test', 'Last done', 'Result', 'Next due', 'Status']} rows={sched.map((r) => [r.label, UST_LABEL[r.kind], r.last?.date ?? '', r.last?.result ?? '', r.nextDue ?? '', UST_STATUS[r.status]])} print={false} />
      </PageHead>
      <section className="figures" aria-label="UST compliance" style={{ marginBottom: 20 }}>
        <Figure label="Overdue or missing" value={bad.length} note={bad.slice(0, 2).map((r) => `${r.label}: ${UST_LABEL[r.kind].toLowerCase()}`).join('; ') || 'Every test is current'} />
        <Figure label="Due in 30 days" value={soon.length} note={soon.slice(0, 2).map((r) => `${r.label} ${r.nextDue}`).join('; ') || 'None'} />
        <Figure label="Release detection" value={`${lastMonth.filter((r) => r.result === 'pass').length} of ${lastMonth.length}`} note={`Tanks passing ${lastMonth[0] ? periodLabel(lastMonth[0].period) : ''} so far`} href="/controls/ust?tab=release" />
        <Figure label="Financial responsibility" value={`${fr.filter((x) => x.ok).length} of ${fr.length}`} note="Sites with an in-force pollution / UST policy" href="/controls/ust?tab=documents" />
      </section>
      <Seg label="Show" value={tab} onChange={setTab} options={[{ v: 'tests', label: 'Tests & inspections' }, { v: 'release', label: 'Release detection' }, { v: 'documents', label: 'Documents' }]} />
      <Errors errors={errors} />
      {tab === 'tests' && (
        <>
          <section className="panel" aria-labelledby="ut-h" style={{ marginBottom: 20 }}>
            <div className="panel-head"><h2 id="ut-h">Tests by tank and site</h2><Seg label="Rows" value={show} onChange={setShow} options={[{ v: 'attention', label: `Needs attention (${sched.length - sched.filter((r) => r.status === 'ok').length})` }, { v: 'all', label: `All (${sched.length})` }]} /></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Tank / site</th><th scope="col">Test</th><th scope="col">Last done</th><th scope="col">Next due</th><th scope="col">Status</th><th scope="col">Documents</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.label + r.kind}><td>{r.label}</td><td>{UST_LABEL[r.kind]}</td><td>{r.last ? <>{shortDate(r.last.date)}<div className="muted small">{r.last.result}{r.last.vendor ? ` · ${r.last.vendor}` : ''}{r.last.note ? ` · ${r.last.note}` : ''}</div></> : '—'}</td><td>{r.nextDue ? shortDate(r.nextDue) : '—'}</td><td><span className={'pill ' + UST_PILL[r.status]}>{UST_STATUS[r.status]}</span></td>
                  <td>{r.last ? <><DocList items={r.last.attachments} say={say} />{edit && <AttachButton books={books} userId={user.id} label="Attach" say={say} onFile={(a) => { attachToUst(books, user, r.last!.id, a); say(`Attached ${a.name}.`); }} />}</> : '—'}</td></tr>
              ))}
                {!list.length && <tr><td colSpan={6} className="muted">Nothing needs attention.</td></tr>}</tbody>
            </table></div>
            <TieOut items={[{ label: sched.length === expected ? `Every active tank and site has a row for every required test (${tanks.length} tanks, ${sites.length} sites)` : 'Some tanks or sites are missing tests', ok: sched.length === expected, detail: `${sched.length} rows` }]} />
          </section>
          {edit && (
            <section className="panel" aria-labelledby="ur-h">
              <div className="panel-head"><h2 id="ur-h">Record a test or inspection</h2></div>
              <div className="panel-pad form-grid">
                <div className="field"><label htmlFor="ur-s">Site</label><select id="ur-s" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value, tankId: '' })}>{sites.map((s) => <option key={s} value={s}>{code(s)}</option>)}</select></div>
                <div className="field"><label htmlFor="ur-k">Test</label><select id="ur-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as UstTestKind })}>{[...UST_TANK_KINDS, ...UST_SITE_KINDS].map((k) => <option key={k} value={k}>{UST_LABEL[k]}</option>)}</select></div>
                <div className="field"><label htmlFor="ur-t">Tank</label><select id="ur-t" value={f.tankId} onChange={(e) => setF({ ...f, tankId: e.target.value })}><option value="">Whole site</option>{tanks.filter((t) => t.storeId === f.storeId).map((t) => <option key={t.id} value={t.id}>{t.label} ({t.grade})</option>)}</select></div>
                <div className="field"><label htmlFor="ur-d">Date</label><input id="ur-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
                <div className="field"><label htmlFor="ur-r">Result</label><select id="ur-r" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as 'pass' | 'fail' })}><option value="pass">Pass</option><option value="fail">Fail</option></select></div>
                <div className="field"><label htmlFor="ur-v">Done by</label><input id="ur-v" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ur-n">Note</label><input id="ur-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
              </div>
              <div className="panel-pad" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => { setErrors([]); try { saveUstRecord(books, user, { storeId: f.storeId, tankId: f.tankId || undefined, kind: f.kind, date: f.date, result: f.result, vendor: f.vendor, note: f.note }); say('Test recorded.'); } catch (e) { setErrors(errText(e)); } }}>Record test</button></div>
            </section>
          )}
        </>
      )}
      {tab === 'release' && (
        <section className="panel" aria-labelledby="rd-h">
          <div className="panel-head"><h2 id="rd-h">Monthly release detection</h2><span className="muted small">Inventory control: |variance| ≤ 1% of throughput + 130 gal</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Tank</th><th scope="col">Method</th>{periods.map((p) => <th scope="col" key={p} className="num">{periodLabel(p)}</th>)}</tr></thead>
            <tbody>{[...new Set(release.map((r) => r.tankId))].map((tid) => {
              const mine = release.filter((r) => r.tankId === tid);
              return <tr key={tid}><td>{mine[0].label}</td><td className="small">{mine[0].method}</td>{periods.map((p) => { const r = mine.find((x) => x.period === p); return <td key={p} className="num">{r ? <><span className={'pill ' + (r.result === 'pass' ? 'ok' : r.result === 'fail' ? 'bad' : 'warn')}>{r.result === 'pass' ? 'Pass' : r.result === 'fail' ? 'Fail' : 'Incomplete'}</span><div className="muted small">{r.variance.toLocaleString('en-US')} gal of ±{r.allowed.toLocaleString('en-US')}</div></> : '—'}</td>; })}</tr>;
            })}</tbody>
          </table></div>
          <TieOut items={[{ label: relFail.length ? `${relFail.length} tank-month(s) fail: investigate for a leak and report within the state's deadline` : 'Every tank passes release detection', ok: !relFail.length, detail: <Link to="/fuel/tanks">Tank readings</Link> }]} />
        </section>
      )}
      {tab === 'documents' && (
        <div className="stack">
          <section className="panel" aria-labelledby="fr-h">
            <div className="panel-head"><h2 id="fr-h">Financial responsibility</h2></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Site</th><th scope="col">Status</th><th scope="col">Proof</th></tr></thead>
              <tbody>{fr.map((x) => <tr key={x.storeId}><td>{code(x.storeId)}</td><td><span className={'pill ' + (x.ok ? 'ok' : 'bad')}>{x.ok ? 'In force' : 'Missing'}</span></td><td className="small">{x.detail}</td></tr>)}</tbody>
            </table></div>
          </section>
          <section className="panel" aria-labelledby="ul-h">
            <div className="panel-head"><h2 id="ul-h">Permits, filings and test reports</h2><Link to="/compliance/vault?tag=ust" className="small">Document vault</Link></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Item</th><th scope="col">Site</th><th scope="col">Date</th><th scope="col">Documents</th></tr></thead>
              <tbody>
                {licenses.map((l) => <tr key={l.id}><td><Link to="/compliance/licenses">{LICENSE_LABEL[l.kind]}: {l.name}</Link><div className="muted small">{l.issuer} · {l.number}</div></td><td>{code(l.storeId)}</td><td>Expires {shortDate(l.expiresOn)}</td><td><DocList items={l.attachments} say={say} /></td></tr>)}
                {fees.map((i) => <tr key={i.id}><td><Link to="/compliance/calendar">{i.title}</Link><div className="muted small">{i.agency}</div></td><td>All sites</td><td>{i.recurrence.every}</td><td>—</td></tr>)}
                {records.filter((r) => r.attachments.length).map((r) => <tr key={r.id}><td>{UST_LABEL[r.kind]}</td><td>{code(r.storeId)}</td><td>{shortDate(r.date)}</td><td><DocList items={r.attachments} say={say} /></td></tr>)}
              </tbody>
            </table></div>
            <p className="panel-pad muted small">Test reports attach to each test on the first tab. Permits and the quarterly UST fee report live under Compliance.</p>
          </section>
        </div>
      )}
      {toast}
      <Help k="controlsUst" />
    </>
  );
}

// ── Security & backups ───────────────────────────────────────────────────
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SecurityPage() {
  const { state, books, user, version } = useBooks();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{ backup: BackupFile; preview: BackupPreview; name: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  const log = useMemo(() => exportLog(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const access = useMemo(() => accessReview(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = lastBackup(state);
  const today = todayInChicago();
  const name = (id: ID) => state.users.find((u) => u.id === id)?.name ?? id;
  const corp = bankStoreId(state);
  const flagged = access.filter((a) => a.flags.length);
  const exportsByUser = access.reduce((a, r) => a + r.exports, 0);
  return (
    <>
      <PageHead eyebrow="Controls" title="Security & backups" lede="What protects the books today, what has to wait for the hosted back end, a working backup and restore for this device, the export log and a review of who can see what.">
        <ExportButtons name="access-review" header={['User', 'Role', 'Active', 'Stores', 'Approvals', 'Last activity', 'Actions', 'Exports', 'Flags']} rows={access.map((a) => [a.user.name, ROLE_LABEL[a.user.role], a.user.active ? 'Yes' : 'No', a.stores.join(' '), a.approvals, a.lastActivity?.slice(0, 10) ?? '', a.actions, a.exports, a.flags.join('; ')])} print={false} />
      </PageHead>
      <section className="figures" aria-label="Security" style={{ marginBottom: 20 }}>
        <Figure label="Last backup" value={last ? `${daysBetween(last.at.slice(0, 10), today)} days ago` : 'Never'} note={last ? `${shortDate(last.at.slice(0, 10))} by ${name(last.userId)}` : 'Download one below'} />
        <Figure label="Exports logged" value={log.length} note="Every CSV, Excel, binder and backup" />
        <Figure label="Users" value={state.users.filter((u) => u.active).length} note={`${flagged.length} with something to review`} />
        <Figure label="Hosted back end" value="Not yet" note="2FA, encryption at rest, daily backups" />
      </section>
      <Errors errors={errors} />
      <div className="grid-2" style={{ marginBottom: 20 }}>
        <section className="panel" aria-labelledby="hb-h">
          <div className="panel-head"><h2 id="hb-h">Needs the hosted back end</h2></div>
          <ul className="inbox">{HOSTED_ITEMS.map((h) => <li key={h.item} style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 4 }}><div className="actions"><b>{h.item}</b><span className="pill warn">Requires hosted back end</span></div><span className="small muted">{h.plan}</span></li>)}</ul>
        </section>
        <section className="panel" aria-labelledby="ip-h">
          <div className="panel-head"><h2 id="ip-h">In place on this device</h2></div>
          <ul className="inbox">{IN_PLACE.map((h) => <li key={h.item} style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 4 }}><div className="actions"><b>{h.item}</b><span className="pill ok">In place</span></div><span className="small muted">{h.how}</span></li>)}</ul>
        </section>
      </div>
      <section className="panel" aria-labelledby="bk-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="bk-h">Backup and restore</h2></div>
        <div className="panel-pad">
          <p className="small" style={{ marginTop: 0 }}>The backup is the whole of the books as one JSON file: every transaction, subledger, setting and the audit log. Keep it somewhere other than this device. Restoring replaces everything here with the file; only the CFO can restore, after a preview and typing {RESTORE_WORD}.</p>
          <div className="actions">
            {can(user, 'export') && <button className="btn primary" onClick={() => { setErrors([]); try { const b = exportBackup(books, user); download(b.fileName, b.json); say(`Backup downloaded: ${b.fileName}. The export is logged.`); } catch (e) { setErrors(errText(e)); } }}>Download backup</button>}
            {can(user, 'backup.restore') && <><label htmlFor="bk-file" className="btn">Restore from a file…</label><input id="bk-file" type="file" accept=".json,application/json" className="sr-only" onChange={async (e) => {
              const fl = e.target.files?.[0];
              e.target.value = '';
              if (!fl) return;
              setErrors([]);
              const r = parseBackup(await fl.text(), books.state);
              if (!r.ok) { setErrors(r.errors); setPending(null); return; }
              setPending({ backup: r.backup, preview: r.preview, name: fl.name });
              setConfirm('');
            }} /></>}
          </div>
          {!can(user, 'backup.restore') && <p className="muted small">Only the CFO can restore a backup.</p>}
        </div>
        {pending && (
          <div className="panel-pad" style={{ borderTop: '1px solid var(--rule)' }}>
            <h3 style={{ marginBottom: 6 }}>Preview: {pending.name}</h3>
            <p className="small">Exported {pending.preview.exportedAt.slice(0, 10)} by {pending.preview.exportedBy} · {pending.preview.company} · schema {pending.preview.schema}</p>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Records</th><th scope="col" className="num">On this device</th><th scope="col" className="num">In the backup</th><th scope="col" className="num">Change</th></tr></thead>
              <tbody>{pending.preview.rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{r.current.toLocaleString('en-US')}</td><td className="num">{r.backup.toLocaleString('en-US')}</td><td className="num">{r.backup - r.current === 0 ? '—' : (r.backup - r.current).toLocaleString('en-US')}</td></tr>)}</tbody>
            </table></div>
            <div className="actions" style={{ marginTop: 12, alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 220 }}><label htmlFor="bk-confirm">Type {RESTORE_WORD} to confirm</label><input id="bk-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
              <button className="btn danger" onClick={() => { setErrors([]); try { restoreBackup(books, user, pending.backup, confirm); setPending(null); say('Books restored from the backup. The restore is in the audit log.'); } catch (e) { setErrors(errText(e)); } }}>Replace the books with this backup</button>
              <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
      <section className="panel" aria-labelledby="el-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="el-h">Export log</h2><Link to="/setup/audit" className="small">Full audit log</Link></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th></tr></thead>
          <tbody>{log.slice(0, 50).map((a) => <tr key={a.id}><td>{shortDate(a.at.slice(0, 10))} {a.at.slice(11, 16)}</td><td>{name(a.userId)}</td><td>{a.objectId}</td></tr>)}
            {!log.length && <tr><td colSpan={3} className="muted">Nothing exported yet.</td></tr>}</tbody>
        </table></div>
        <TieOut items={[{ label: exportsByUser === log.length ? 'Exports by user add to the log' : 'Exports by user differ from the log', ok: exportsByUser === log.length, detail: `${log.length}` }]} />
      </section>
      <section className="panel" aria-labelledby="ar-h">
        <div className="panel-head"><h2 id="ar-h">Access review by user</h2><Link to="/setup/users" className="small">Users & roles</Link></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">User</th><th scope="col">Stores they see</th><th scope="col">Approvals</th><th scope="col">Last activity</th><th scope="col">Review</th></tr></thead>
          <tbody>{access.map((a) => (
            <tr key={a.user.id}><td><b>{a.user.name}</b><div className="muted small">{ROLE_LABEL[a.user.role]}{a.user.active ? '' : ' · inactive'} · {a.permissions.length} permissions</div></td>
              <td className="small">{a.stores.length === state.stores.filter((s) => !s.deleted).length ? 'All stores' : a.stores.join(', ') || 'None'}{a.stores.includes(state.stores.find((s) => s.id === corp)?.code ?? '') ? ' (incl. bank)' : ''}</td>
              <td className="small">{a.approvals}</td><td>{a.lastActivity ? shortDate(a.lastActivity.slice(0, 10)) : '—'}<div className="muted small">{a.actions} actions · {a.exports} exports</div></td>
              <td>{a.flags.length ? a.flags.map((f) => <div key={f}><span className="pill warn">{f}</span></div>) : <span className="pill ok">Nothing to review</span>}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      {toast}
      <Help k="controlsSecurity" />
    </>
  );
}

