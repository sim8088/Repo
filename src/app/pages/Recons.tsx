import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { Pill, keepFile, openAttachment, useParam, userName } from '../components/glkit';
import { RECON_STATUS_LABEL, SUPPORT_LABEL, lastClosedPeriod, prepareRecon, reconList, reviewRecon, setManualSupport, type ReconRow, type ReconStatus } from '../../core/recons';
import { accountDetail, trialBalance } from '../../core/reports';
import { normalSign } from '../../core/ledger';
import { ValidationError } from '../../core/books';
import { can } from '../../core/permissions';
import { formatMoney, parseMoney } from '../../core/money';
import { periodLabel, periodsBetween, todayInChicago, lastDayOfPeriod, shortDate } from '../../core/dates';
import { DEMO_START } from '../../data/seed';
import type { Attachment } from '../../core/types';

const TONE: Record<ReconStatus, 'ok' | 'warn' | 'bad' | undefined> = { not_needed: undefined, open: 'bad', prepared: 'warn', reviewed: 'ok', stale: 'bad' };
const errText = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);

function usePeriods(): string[] {
  const today = todayInChicago();
  return periodsBetween(DEMO_START.slice(0, 7), today.slice(0, 7)).reverse();
}

export function ReconsPage() {
  const { state, allLines, user, visible, version } = useBooks();
  const today = todayInChicago();
  const [period, setPeriod] = useParam('period', lastClosedPeriod(today));
  const [all, setAll] = useParam('all', '');
  const periods = usePeriods();
  const rows = useMemo(() => reconList(state, period, { lines: allLines }), [state, period, allLines, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const asOf = lastDayOfPeriod(period);
  const tb = useMemo(() => trialBalance(state, { asOf, lines: allLines }), [state, asOf, allLines]);
  const count = (s: ReconStatus) => rows.filter((r) => r.status === s).length;
  const diffs = rows.filter((r) => r.difference);
  const shown = all ? rows : rows.filter((r) => r.status !== 'not_needed');
  const glTies = rows.every((r) => normalSign(r.account) * (tb.rows.find((x) => x.account.id === r.account.id)?.net ?? 0) === r.gl);
  const diffTies = rows.every((r) => r.difference === null || r.difference === r.gl - (r.support.amount ?? 0));
  if (!can(user, 'view.reports') || !visible.has('st_corp')) return <PageHead title="Account reconciliations" lede="Your role doesn't include the general ledger. Ask the CFO for access." />;
  return (
    <>
      <PageHead eyebrow="Books" title="Account reconciliations" lede={`Every balance-sheet account at ${shortDate(asOf)}: GL against its support, the difference, and two sign-offs (a reviewer who isn't the preparer). A sign-off lapses if the GL changes after it.`}>
        <ExportButtons name={`account-recs-${period}`} sheet={`Recs ${period}`} header={['Number', 'Account', 'Support from', 'GL', 'Support', 'Difference', 'Status', 'Prepared by', 'Reviewed by', 'Note']}
          rows={shown.map((r) => [r.account.number, r.account.name, SUPPORT_LABEL[r.support.kind], csvMoney(r.gl), r.support.amount === null ? '' : csvMoney(r.support.amount), r.difference === null ? '' : csvMoney(r.difference), RECON_STATUS_LABEL[r.status], userName(state.users, r.recon?.prepared?.by), userName(state.users, r.recon?.reviewed?.by), r.recon?.prepared?.note ?? ''])} />
      </PageHead>
      <section className="figures" aria-label="Reconciliations" style={{ marginBottom: 20 }}>
        <Figure label="To prepare" value={count('open')} note={`of ${rows.length - count('not_needed')} accounts with a balance or activity`} />
        <Figure label="Awaiting review" value={count('prepared')} />
        <Figure label="Signed off" value={count('reviewed')} />
        <Figure label="Invalidated" value={count('stale')} note="GL changed after sign-off" />
        <Figure label="Differences" value={diffs.length} note={<Money c={diffs.reduce((a, r) => a + Math.abs(r.difference!), 0)} dollar />} />
      </section>
      <section className="panel" aria-labelledby="rc-h">
        <div className="panel-head"><h2 id="rc-h">{periodLabel(period)}</h2><span className="muted small">{shown.length} accounts</span></div>
        <div className="filters">
          <div className="field"><label htmlFor="rc-period">Month</label><select id="rc-period" value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <label className="check"><input type="checkbox" checked={!!all} onChange={(e) => setAll(e.target.checked ? '1' : '')} /> Show accounts with nothing to reconcile</label>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Account</th><th scope="col">Support from</th><th scope="col" className="num">GL</th><th scope="col" className="num">Support</th><th scope="col" className="num">Difference</th><th scope="col">Status</th><th scope="col">Prepared</th><th scope="col">Reviewed</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.account.id}>
                  <td><Link to={`/books/recons/${r.account.id}?period=${period}`}>{r.account.number} · {r.account.name}</Link></td>
                  <td className="small">{SUPPORT_LABEL[r.support.kind]}</td>
                  <td className="num"><Money c={r.gl} /></td>
                  <td className="num">{r.support.amount === null ? <span className="muted">needed</span> : <Money c={r.support.amount} />}</td>
                  <td className="num">{r.difference === null ? '' : <Money c={r.difference} className={r.difference ? 'neg' : undefined} />}</td>
                  <td><Pill tone={TONE[r.status]}>{RECON_STATUS_LABEL[r.status]}</Pill></td>
                  <td className="small">{userName(state.users, r.recon?.prepared?.by)}</td>
                  <td className="small">{userName(state.users, r.recon?.reviewed?.by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: glTies ? 'GL column ties to the trial balance' : 'GL column differs from the trial balance', ok: glTies },
          { label: diffTies ? 'Each difference = GL − support' : 'A difference doesn\'t compute', ok: diffTies },
        ]} />
      </section>
      <Help k="recons" />
    </>
  );
}

export function ReconDetailPage() {
  const { id } = useParams();
  const { state, books, user, allLines, version } = useBooks();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const [period, setPeriod] = useParam('period', lastClosedPeriod(today));
  const periods = usePeriods();
  const row: ReconRow | undefined = useMemo(() => reconList(state, period, { lines: allLines }).find((r) => r.account.id === id), [state, period, id, allLines, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [signNote, setSignNote] = useState('');
  const [att, setAtt] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  if (!row) return <PageHead title="Not a reconciled account" lede={<Link to="/books/recons">All account reconciliations</Link>} />;
  const a = row.account;
  const asOf = row.asOf;
  const gld = accountDetail(state, a.id, { from: `${period}-01`, to: asOf, lines: allLines });
  const detailSum = row.support.detail.reduce((x, d) => x + d.amount, 0);
  const run = (fn: () => void, msg: string) => { setErrors([]); try { fn(); say(msg); setSignNote(''); } catch (e) { setErrors(errText(e)); } };
  const r = row.recon;
  const history = state.audit.filter((x) => x.objectType === 'recon' && r && x.objectId === r.id);
  const canPrep = can(user, 'bank.reconcile');
  const canReview = can(user, 'approve') && r?.prepared && r.prepared.by !== user.id && row.status === 'prepared';
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) { const x = await keepFile(books, user.id, f); if (typeof x === 'string') say(x); else setAtt((p) => [...p, x]); }
  };
  return (
    <>
      <PageHead eyebrow={`Account reconciliation · ${periodLabel(period)}`} title={`${a.number} · ${a.name}`} lede={`Support: ${SUPPORT_LABEL[row.support.kind]}.`}>
        <Link className="btn" to={`/books/recons?period=${period}`}>All accounts</Link>
        <Link className="btn" to={`/books/accounts/${a.id}?from=${period}-01&to=${asOf}`}>GL detail</Link>
        <ExportButtons name={`rec-${a.number}-${period}`} sheet={`${a.number} ${period}`} header={['Item', 'Amount']} rows={[['GL balance', csvMoney(row.gl)], ...row.support.detail.map((d) => [d.label, csvMoney(d.amount)]), ['Support', row.support.amount === null ? '' : csvMoney(row.support.amount)], ['Difference', row.difference === null ? '' : csvMoney(row.difference)]]} />
      </PageHead>
      <section className="figures" aria-label="Reconciliation" style={{ marginBottom: 20 }}>
        <Figure label={`GL at ${shortDate(asOf)}`} value={<Money c={row.gl} dollar />} note={`${row.activity} lines in the month`} />
        <Figure label="Support" value={row.support.amount === null ? 'Needed' : <Money c={row.support.amount} dollar />} note={SUPPORT_LABEL[row.support.kind]} href={row.support.to} />
        <Figure label="Difference" value={row.difference === null ? '—' : <Money c={row.difference} dollar />} />
        <Figure label="Status" value={RECON_STATUS_LABEL[row.status]} note={r?.prepared ? `Prepared by ${userName(state.users, r.prepared.by)}${r.reviewed ? `, reviewed by ${userName(state.users, r.reviewed.by)}` : ''}` : undefined} />
      </section>
      <div className="filters" style={{ padding: 0, marginBottom: 12 }}>
        <div className="field"><label htmlFor="rd-period">Month</label><select id="rd-period" value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
      </div>
      <Errors errors={errors} />
      {row.status === 'stale' && <p className="note warn" style={{ marginBottom: 12 }}>The GL is {formatMoney(row.gl, { dollarSign: true })} now, but {formatMoney(r!.prepared!.gl, { dollarSign: true })} when it was signed. Someone posted to this account in {period} after the sign-off: look at the GL detail, then prepare it again.</p>}
      <section className="panel" aria-labelledby="rd-sup">
        <div className="panel-head"><h2 id="rd-sup">Support</h2>{row.support.to && <Link to={row.support.to}>Open the subledger</Link>}</div>
        {row.support.note && <p className="panel-pad muted small" style={{ paddingBottom: 0 }}>{row.support.note}</p>}
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {row.support.detail.map((d) => <tr key={d.label}><td>{d.label}</td><td className="num"><Money c={d.amount} /></td></tr>)}
              <tr className="total"><td>Support</td><td className="num">{row.support.amount === null ? '—' : <Money c={row.support.amount} />}</td></tr>
              <tr><td>GL balance</td><td className="num"><Money c={row.gl} /></td></tr>
              <tr className="total"><td>Difference (GL − support)</td><td className="num">{row.difference === null ? '—' : <Money c={row.difference} />}</td></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: row.support.amount === null ? 'Support not in yet' : detailSum === row.support.amount ? 'Support detail adds to the support balance' : 'Support detail doesn\'t add up', ok: row.support.amount !== null && (row.support.detail.length === 0 || detailSum === row.support.amount) },
          { label: gld.closing === row.gl ? 'GL ties to the account detail' : 'GL differs from the account detail', ok: gld.closing === row.gl },
          { label: row.difference === 0 ? 'No difference' : row.difference === null ? 'Difference unknown' : 'Difference to explain', ok: row.difference === 0 },
        ]} />
      </section>
      {row.support.kind === 'manual' && canPrep && (
        <section className="panel panel-pad" aria-labelledby="rd-man" style={{ marginTop: 16 }}>
          <h2 id="rd-man" style={{ marginTop: 0 }}>Enter the support balance</h2>
          {r?.manual && <p className="small muted">Now: {formatMoney(r.manual.amount, { dollarSign: true })} · {r.manual.note} · {r.manual.attachments.map((x) => <button key={x.id} className="btn sm ghost" onClick={() => void openAttachment(x, say)}>{x.name}</button>)}</p>}
          <div className="form-grid">
            <div className="field"><label htmlFor="rd-amt">Balance per support</label><input id="rd-amt" className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="rd-note">What it is</label><input id="rd-note" value={note} placeholder="e.g. Loan statement 31 Oct" onChange={(e) => setNote(e.target.value)} /></div>
            <div className="field"><span className="seg-label">Document</span><label className="btn sm" style={{ width: 'fit-content' }}>{att.length ? att.map((x) => x.name).join(', ') : 'Attach file'}<input type="file" className="sr-only" accept="image/*,.pdf,.csv,.xlsx" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => run(() => { const v = parseMoney(amount); if (v === null) throw new ValidationError(['Enter the support balance as an amount like 18,400.00.']); setManualSupport(books, user, a.id, period, { amount: v, note, attachments: att }); setAtt([]); setAmount(''); setNote(''); }, 'Support saved.')}>Save support</button></div>
        </section>
      )}
      <section className="panel panel-pad" aria-labelledby="rd-sign" style={{ marginTop: 16 }}>
        <h2 id="rd-sign" style={{ marginTop: 0 }}>Sign-off</h2>
        <p className="small">{r?.prepared ? <>Prepared by <b>{userName(state.users, r.prepared.by)}</b> on {shortDate(r.prepared.at.slice(0, 10))} at GL {formatMoney(r.prepared.gl, { dollarSign: true })}, difference {formatMoney(r.prepared.difference, { dollarSign: true })}{r.prepared.note ? ` — ${r.prepared.note}` : ''}.</> : 'Not prepared yet.'}{' '}
          {r?.reviewed ? <>Reviewed by <b>{userName(state.users, r.reviewed.by)}</b> on {shortDate(r.reviewed.at.slice(0, 10))}.</> : ''}</p>
        <div className="actions" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 320 }}><label htmlFor="rd-sn">{row.difference ? 'Explain the difference' : 'Note (optional)'}</label><input id="rd-sn" value={signNote} onChange={(e) => setSignNote(e.target.value)} /></div>
          {canPrep && <button className="btn primary" onClick={() => run(() => prepareRecon(books, user, a.id, period, signNote), 'Prepared. It now waits for a reviewer.')}>{r?.prepared ? 'Prepare again' : 'Sign as preparer'}</button>}
          {canReview && <button className="btn primary" onClick={() => run(() => reviewRecon(books, user, a.id, period, signNote), 'Reviewed and signed off.')}>Sign as reviewer</button>}
        </div>
        {r?.prepared && r.prepared.by === user.id && row.status === 'prepared' && <p className="muted small">You prepared it, so someone else reviews it.</p>}
      </section>
      {history.length > 0 && (
        <section className="panel" aria-labelledby="rd-hist" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2 id="rd-hist">History</h2></div>
          <ul className="inbox">{history.map((h) => <li key={h.id} style={{ gridTemplateColumns: 'minmax(0,1fr)' }}><span><b>{userName(state.users, h.userId)}</b> · {h.summary}</span><span className="muted small">{h.at.slice(0, 16).replace('T', ' ')}{h.reason ? ` · ${h.reason}` : ''}</span></li>)}</ul>
        </section>
      )}
      {toast}
      <Help k="reconDetail" />
    </>
  );
}
