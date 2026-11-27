import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { Help, Money, PageHead, useToast } from '../components/ui';
import { periodLabel, periodOf, todayInChicago, periodsBetween, lastDayOfPeriod } from '../../core/dates';
import { can } from '../../core/permissions';
import { pnl, uncategorized } from '../../core/reports';
import { lockMonth } from '../../core/close';
import { ValidationError } from '../../core/books';

export function Periods() {
  const { state, books, user, lines, stores } = useBooks();
  const [toast, say] = useToast();
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [gate, setGate] = useState<{ p: string; msg: string } | null>(null);
  const current = periodOf(todayInChicago());
  const periods = useMemo(() => {
    const ps = lines.map((f) => f.period).filter((p) => p >= '2000');
    if (!ps.length) return [current];
    const min = ps.reduce((a, b) => (a < b ? a : b));
    return periodsBetween(min, current).reverse();
  }, [lines, current]);
  const uncat = useMemo(() => uncategorized(state, lines), [state, lines]);
  const userName = (id?: string) => state.users.find((u) => u.id === id)?.name ?? '';

  return (
    <>
      <PageHead eyebrow="Close" title="Periods" lede="Lock a month once it is reconciled. Locked months refuse every change until unlocked with a reason." />
      <section className="panel">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col">Status</th><th scope="col" className="num">Transactions</th><th scope="col" className="num">Uncategorized</th><th scope="col" className="num">Net profit</th><th scope="col">Locked by</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {periods.map((p) => {
                const per = state.periods[p];
                const locked = per?.status === 'locked';
                const n = new Set(lines.filter((f) => f.period === p).map((f) => f.t.id)).size;
                const u = uncat.filter((f) => f.period === p).length;
                const ni = pnl(state, { from: p, to: p, storeIds: stores.map((s) => s.id), lines }).netIncome.total;
                const isFuture = p >= current;
                return (
                  <tr key={p}>
                    <td><Link to={`/reports/pnl?from=${p}&to=${p}`}>{periodLabel(p)}</Link></td>
                    <td>{locked ? <span className="pill">Locked</span> : isFuture ? <span className="pill ok">Current</span> : <span className="pill warn">Open</span>}{per?.unlockReason && !locked && <span className="muted small"> · unlocked: {per.unlockReason}</span>}</td>
                    <td className="num"><Link to={`/books/transactions?from=${p}-01&to=${lastDayOfPeriod(p)}`}>{n.toLocaleString('en-US')}</Link></td>
                    <td className="num">{u ? <Link className="neg" to="/books/transactions?queue=uncat">{u}</Link> : '0'}</td>
                    <td className="num"><Money c={ni} signed /></td>
                    <td>{locked ? `${userName(per.lockedBy)} · ${per.lockedAt ? new Date(per.lockedAt).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) : ''}` : ''}</td>
                    <td>
                      {!locked && can(user, 'period.lock') && !isFuture && (
                        <button className="btn sm" title={u ? 'Categorize everything first' : undefined} onClick={() => {
                          if (u && !confirm(`${u} line(s) in ${periodLabel(p)} are still uncategorized. Lock anyway?`)) return;
                          try { lockMonth(books, user, p); say(`${periodLabel(p)} locked.`); } catch (e) { setGate({ p, msg: e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message }); }
                        }}>Lock</button>
                      )}
                      {locked && can(user, 'period.unlock') && <button className="btn sm ghost" onClick={() => { setUnlocking(p); setReason(''); }}>Unlock</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {gate && (
          <div className="panel-pad" style={{ borderTop: '1px solid var(--rule)' }} role="alert">
            <b>{periodLabel(gate.p)} can't be locked yet.</b> {gate.msg} <Link to={`/close?month=${gate.p}`}>Open the month-end checklist</Link>. <button className="btn sm ghost" onClick={() => setGate(null)}>Dismiss</button>
          </div>
        )}
        {unlocking && (
          <div className="panel-pad" style={{ borderTop: '1px solid var(--rule)' }} role="region" aria-label={`Unlock ${periodLabel(unlocking)}`}>
            <div className="field" style={{ maxWidth: 520 }}><label htmlFor="unlock-reason">Why unlock {periodLabel(unlocking)}?</label><input id="unlock-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Late Entergy bill for HM11" /></div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn primary" disabled={!reason.trim()} onClick={() => { books.unlockPeriod(user, unlocking, reason); say(`${periodLabel(unlocking)} unlocked. Lock it again when done.`); setUnlocking(null); }}>Unlock month</button>
              <button className="btn ghost" onClick={() => setUnlocking(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>Lock goes through the <Link to="/close">month-end checklist</Link>: a month locks once every other step is done. The CFO can override from the checklist with a reason.</p>
      {toast}
      <Help k="periods" />
    </>
  );
}
