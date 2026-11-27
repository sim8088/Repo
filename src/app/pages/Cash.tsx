import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Errors, Figure, Help, Money, PageHead, TieOut, useToast } from '../components/ui';
import {
  PAYOUT_LABEL, STAGES, STAGE_LABEL, bagFlagged, bagOverdue, bagVariances, cashByLocation, depositBags, event, poolBalance,
  posExpectedCash, recordCashStep, recordPayout, reviewBag,
} from '../../core/cash';
import { addDays, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { bankStoreId } from '../../core/bank';
import { blindHidden } from '../../core/controls';
import type { CashBag, CashStage, ID, PayoutKind } from '../../core/types';

const errText = (e: unknown) => (e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message);

export function CashPage() {
  const { state, stores, visible, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const latestBag = state.cash.bags.map((b) => b.businessDate).filter((d) => d <= today).sort().at(-1) ?? today;
  const date = sp.get('date') ?? latestBag;
  const show = sp.get('show') ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const operating = stores.filter((s) => s.kind === 'operating' && (!s.openedOn || s.openedOn <= date));
  const corp = bankStoreId(state);
  const seesHq = visible.has(corp);
  const locations = useMemo(() => cashByLocation(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool = poolBalance(state, today);
  const registers = locations.filter((l) => visible.has(l.storeId)).reduce((a, l) => a + l.registers, 0);
  const myBags = state.cash.bags.filter((b) => visible.has(b.storeId));
  const flagged = myBags.filter((b) => !b.reviewed && bagFlagged(state, b)).sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  const overdue = myBags.filter((b) => bagOverdue(state, b, today));
  const waiting = myBags.filter((b) => event(b, 'hq_receipt') && !event(b, 'deposit')).sort((a, b) => a.businessDate.localeCompare(b.businessDate));

  return (
    <>
      <PageHead eyebrow="Bank & cash" title="Cash chain" lede="Store count → operator pickup → HQ receipt → pooled deposit. Every handoff is recorded with who and when, and every difference posts to Cash over / short." />
      <section className="figures" style={{ marginBottom: 20 }} aria-label="Cash on hand">
        {seesHq && <Figure label="Cash at HQ" value={<Money c={pool} whole dollar />} note={`${waiting.length} bag${waiting.length === 1 ? '' : 's'} received, not deposited`} href="/books/accounts/acct_cash_transit" />}
        <Figure label="In store registers & safes" value={<Money c={registers} whole dollar />} note="Floats plus today's uncollected cash" href="/books/accounts/acct_cash_registers" />
        <Figure label="Variances to review" value={flagged.length} note={`${formatMoney(state.settings.materialityCents, { dollarSign: true })} or more at a handoff`} />
        <Figure label="Overdue deposits" value={overdue.length} note={`Picked up over ${state.settings.depositWithinDays} days ago`} />
      </section>

      {(show === 'flagged' || show === 'overdue') && <ReviewList bags={show === 'flagged' ? flagged : overdue} title={show === 'flagged' ? 'Variances to review' : 'Picked up, not deposited'} onClose={() => set('show', '')} />}

      <section className="panel" aria-labelledby="day-h" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <h2 id="day-h">Business day {shortDate(date)}</h2>
          <div className="actions">
            <button className="btn sm" onClick={() => set('date', addDays(date, -1))} aria-label="Previous day">‹ Previous</button>
            <label className="sr-only" htmlFor="cash-date">Business day</label>
            <input id="cash-date" type="date" value={date} onChange={(e) => set('date', e.target.value)} style={{ width: 160 }} />
            <button className="btn sm" onClick={() => set('date', addDays(date, 1))} aria-label="Next day" disabled={date >= today}>Next ›</button>
          </div>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col" className="num">POS cash</th>{STAGES.map((s) => <th scope="col" key={s}>{STAGE_LABEL[s]}</th>)}</tr></thead>
          <tbody>{operating.map((s) => {
            const bag = state.cash.bags.find((b) => b.storeId === s.id && b.businessDate === date);
            const pos = posExpectedCash(state, s.id, date);
            return (
              <tr key={s.id}>
                <td><b>{s.code}</b> {s.name}</td>
                <td className="num">{pos === null ? <span className="muted">No POS close</span> : <Link to={`/books/transactions?store=${s.id}&from=${date}&to=${date}&q=POS`}><Money c={pos} /></Link>}</td>
                {STAGES.map((st) => <td key={st} style={{ minWidth: 170 }}><StageCell bag={bag} storeId={s.id} date={date} stage={st} expected={pos} onMsg={say} /></td>)}
              </tr>
            );
          })}</tbody>
        </table></div>
        <TieOut items={[{ label: 'Every step posts to the ledger', ok: true, detail: 'count variances, pickups and receipt differences go to Cash over / short at the store' }]} />
      </section>

      {seesHq && <DepositPanel bags={waiting} pool={pool} onMsg={say} />}
      {seesHq && <PayoutPanel onMsg={say} />}

      <section className="panel" aria-labelledby="loc-h" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2 id="loc-h">Cash on hand by location</h2><span className="muted small">as of {shortDate(today)}</span></div>
        <table className="t">
          <thead><tr><th scope="col">Location</th><th scope="col" className="num">Registers & safe</th><th scope="col" className="num">HQ pool</th></tr></thead>
          <tbody>
            {locations.filter((l) => visible.has(l.storeId)).map((l) => {
              const st = state.stores.find((x) => x.id === l.storeId);
              return <tr key={l.storeId}><td>{st?.code} {st?.name}</td><td className="num"><Money c={l.registers} /></td><td className="num"><Money c={l.pool} /></td></tr>;
            })}
            <tr className="total"><td>Total cash on hand</td><td className="num"><Money c={registers} /></td><td className="num"><Money c={seesHq ? pool : 0} /></td></tr>
          </tbody>
        </table>
        <TieOut items={[{ label: 'Ties to the cash accounts in the ledger', ok: true, detail: <><Link to="/books/accounts/acct_cash_registers">1010</Link> and <Link to="/books/accounts/acct_cash_transit">1020</Link></> }]} />
      </section>
      {toast}
      <Help k="cash" />
    </>
  );
}

function StageCell({ bag, storeId, date, stage, expected, onMsg }: { bag?: CashBag; storeId: ID; date: string; stage: CashStage; expected: number | null; onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const e = bag ? event(bag, stage) : undefined;
  const idx = STAGES.indexOf(stage);
  const prev = idx === 0 ? null : bag ? event(bag, STAGES[idx - 1]) : undefined;
  // Phase 14 blind HQ count: the pickup amount stays hidden until HQ records what it counted.
  const blind = stage === 'hq_receipt' && blindHidden(state, bag);
  const prefill = blind ? null : idx === 0 ? expected : prev?.amount ?? null;
  const [amt, setAmt] = useState('');
  const [person, setPerson] = useState(user.name);
  if (e && stage === 'pickup' && blindHidden(state, bag)) return <div><span className="muted small">Sealed bag · amount hidden for the blind HQ count</span><div className="muted small">{e.person} · {shortDate(e.at.slice(0, 10))}</div></div>;
  if (e) {
    const v = bag ? bagVariances(state, bag).find((x) => x.stage === stage) : undefined;
    return (
      <div>
        <Money c={e.amount} />{e.txnId && <Link to={`/books/transactions/${e.txnId}`} className="small" style={{ marginLeft: 6 }}>entry</Link>}
        <div className="muted small">{e.person}{stage !== 'count' ? ` · ${shortDate(e.at.slice(0, 10))}` : ''}</div>
        {v && v.diff !== 0 && <span className={'pill ' + (v.flagged ? 'bad' : '')} title={`Expected ${formatMoney(v.expected)}`}>{v.diff > 0 ? 'Over' : 'Short'} {formatMoney(Math.abs(v.diff), { dollarSign: true })}</span>}
      </div>
    );
  }
  if (stage === 'deposit') return <span className="muted small">{bag && event(bag, 'hq_receipt') ? 'At HQ — deposit below' : '—'}</span>;
  const canDo = stage === 'count' ? can(user, 'cash.count') : can(user, 'cash.handle');
  if (!canDo || (idx > 0 && !prev) || (stage === 'count' && expected === null && !bag)) return <span className="muted small">—</span>;
  const id = `${stage}-${storeId}-${date}`;
  const submit = () => {
    const v = amt.trim() ? parseMoney(amt) : prefill;
    if (v === null) { onMsg(blind ? 'Blind count: enter what you counted. The pickup amount shows once it is recorded.' : 'Enter the amount counted.'); return; }
    try {
      recordCashStep(books, user, { storeId, businessDate: date, stage: stage as Exclude<CashStage, 'deposit'>, amount: v, person, date: stage === 'count' ? date : todayInChicago() < date ? date : todayInChicago() });
      onMsg(`${STAGE_LABEL[stage]} recorded.`);
      setAmt('');
    } catch (err) { onMsg(errText(err)); }
  };
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label className="sr-only" htmlFor={id}>{STAGE_LABEL[stage]} amount</label>
      <input id={id} className="num" inputMode="decimal" value={amt} placeholder={prefill !== null ? (prefill / 100).toFixed(2) : '0.00'} onChange={(ev) => setAmt(ev.target.value)} style={{ minHeight: 32 }} />
      <label className="sr-only" htmlFor={id + '-p'}>Handled by</label>
      <input id={id + '-p'} value={person} onChange={(ev) => setPerson(ev.target.value)} style={{ minHeight: 32 }} />
      <button className="btn sm" onClick={submit}>Record</button>
    </div>
  );
}

function DepositPanel({ bags, pool, onMsg }: { bags: CashBag[]; pool: number; onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const [picked, setPicked] = useState<Set<ID>>(new Set());
  const [date, setDate] = useState(todayInChicago());
  const [amount, setAmount] = useState('');
  const [slip, setSlip] = useState('');
  const [person, setPerson] = useState(user.name);
  const [errors, setErrors] = useState<string[]>([]);
  const sel = bags.filter((b) => picked.has(b.id));
  const selTotal = sel.reduce((a, b) => a + event(b, 'hq_receipt')!.amount, 0);
  const suggested = Math.min(selTotal, pool);
  return (
    <section className="panel" aria-labelledby="dep-h" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h2 id="dep-h">At HQ, waiting to deposit</h2><span className="muted small">Pool <Money c={pool} dollar /></span></div>
      {bags.length === 0 ? <p className="panel-pad muted">Nothing waiting. Received bags show up here until they are deposited.</p> : (
        <>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col"><input type="checkbox" aria-label="Select all bags" checked={picked.size === bags.length} onChange={(e) => setPicked(e.target.checked ? new Set(bags.map((b) => b.id)) : new Set())} /></th><th scope="col">Bag</th><th scope="col">Received</th><th scope="col" className="num">Amount</th><th scope="col">Status</th></tr></thead>
            <tbody>{bags.map((b) => {
              const r = event(b, 'hq_receipt')!;
              const st = state.stores.find((s) => s.id === b.storeId);
              return (
                <tr key={b.id}><td><input type="checkbox" aria-label={`Deposit ${st?.code} ${b.businessDate}`} checked={picked.has(b.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(b.id); else n.delete(b.id); setPicked(n); }} /></td>
                  <td>{st?.code} · {shortDate(b.businessDate)}</td><td>{shortDate(r.at.slice(0, 10))} · {r.person}</td><td className="num"><Money c={r.amount} /></td>
                  <td>{bagOverdue(state, b, todayInChicago()) ? <span className="pill bad">Overdue</span> : <span className="pill">Waiting</span>}</td></tr>
              );
            })}</tbody>
          </table></div>
          {can(user, 'cash.handle') && (
            <div className="panel-pad">
              <Errors errors={errors} />
              <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
                <div className="field"><label htmlFor="dp-date">Deposit date</label><input id="dp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                <div className="field"><label htmlFor="dp-amt">Slip total</label><input id="dp-amt" className="num" inputMode="decimal" value={amount} placeholder={(suggested / 100).toFixed(2)} onChange={(e) => setAmount(e.target.value)} /><span className="hint">Selected bags total <Money c={selTotal} dollar />. Keep some back for payouts if needed.</span></div>
                <div className="field"><label htmlFor="dp-slip">Slip #</label><input id="dp-slip" value={slip} onChange={(e) => setSlip(e.target.value)} /></div>
                <div className="field"><label htmlFor="dp-by">Deposited by</label><input id="dp-by" value={person} onChange={(e) => setPerson(e.target.value)} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn primary" disabled={!sel.length} onClick={() => {
                  const v = amount.trim() ? parseMoney(amount) : suggested;
                  if (v === null) { setErrors(['The slip total is not a number.']); return; }
                  try { const t = depositBags(books, user, { bagIds: [...picked], date, amount: v, person, slipNo: slip || undefined }); setPicked(new Set()); setAmount(''); setSlip(''); setErrors([]); onMsg(`Deposit ${t.ref} recorded. It will match the bank line when it posts.`); }
                  catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); }
                }}>Record deposit of {sel.length} bag{sel.length === 1 ? '' : 's'}</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PayoutPanel({ onMsg }: { onMsg: (m: string) => void }) {
  const { state, books, user, stores } = useBooks();
  const corp = bankStoreId(state);
  const [f, setF] = useState({ date: todayInChicago(), fromStoreId: corp, kind: 'vendor' as PayoutKind, payee: '', amount: '', person: user.name, accountId: '', storeId: stores.find((s) => s.kind === 'operating')?.id ?? corp, toStoreId: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const recent = [...state.cash.payouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const canDo = can(user, 'cash.handle');
  return (
    <section className="panel" aria-labelledby="po-h">
      <div className="panel-head"><h2 id="po-h">Cash paid out</h2></div>
      {canDo && (
        <div className="panel-pad">
          <Errors errors={errors} />
          <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
            <div className="field"><label htmlFor="po-date">Date</label><input id="po-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="po-from">Paid from</label><select id="po-from" value={f.fromStoreId} onChange={(e) => setF({ ...f, fromStoreId: e.target.value })}><option value={corp}>HQ pool</option>{stores.filter((s) => s.kind === 'operating').map((s) => <option key={s.id} value={s.id}>{s.code} registers</option>)}</select></div>
            <div className="field"><label htmlFor="po-kind">For</label><select id="po-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PayoutKind })}>{(Object.keys(PAYOUT_LABEL) as PayoutKind[]).map((k) => <option key={k} value={k}>{PAYOUT_LABEL[k]}</option>)}</select></div>
            <div className="field"><label htmlFor="po-payee">Paid to</label><input id="po-payee" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></div>
            <div className="field"><label htmlFor="po-amt">Amount</label><input id="po-amt" className="num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            {f.kind === 'change' ? (
              <div className="field"><label htmlFor="po-to">Change for</label><select id="po-to" value={f.toStoreId} onChange={(e) => setF({ ...f, toStoreId: e.target.value })}><option value="">Choose…</option>{stores.filter((s) => s.kind === 'operating').map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            ) : f.kind !== 'draw' && (
              <>
                <div className="field"><label htmlFor="po-acct">Category</label><select id="po-acct" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">Choose…</option><AccountOptions filter={(a) => a.type === 'expense' || a.type === 'cogs'} /></select></div>
                <div className="field"><label htmlFor="po-store">Store</label><select id="po-store" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
              </>
            )}
            <div className="field"><label htmlFor="po-by">Handed out by</label><input id="po-by" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} /></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => {
              const v = parseMoney(f.amount);
              try {
                recordPayout(books, user, { date: f.date, fromStoreId: f.fromStoreId, kind: f.kind, payee: f.payee, amount: v ?? NaN, person: f.person, accountId: f.accountId || undefined, storeId: f.storeId, toStoreId: f.toStoreId || undefined });
                setF({ ...f, payee: '', amount: '' }); setErrors([]); onMsg('Payout recorded.');
              } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); }
            }}>Record payout</button>
            <span className="muted small">{f.kind === 'draw' ? `Posts per the owner-withdrawal policy (${state.settings.ownerWithdrawalPolicy === 'draw' ? 'owner draws' : 'Corporate expense'}).` : f.kind === 'change' ? 'Moves cash to the store\'s registers; no expense.' : ''}</span>
          </div>
        </div>
      )}
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Date</th><th scope="col">From</th><th scope="col">For</th><th scope="col">Paid to</th><th scope="col" className="num">Amount</th><th scope="col">By</th></tr></thead>
        <tbody>{recent.length === 0 ? <tr><td colSpan={6} className="muted">No payouts yet.</td></tr> : recent.map((p) => (
          <tr key={p.id}><td>{shortDate(p.date)}</td><td>{p.fromStoreId === corp ? 'HQ pool' : state.stores.find((s) => s.id === p.fromStoreId)?.code}</td><td>{PAYOUT_LABEL[p.kind]}</td><td><Link to={`/books/transactions/${p.txnId}`}>{p.payee}</Link></td><td className="num"><Money c={p.amount} /></td><td>{p.person}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function ReviewList({ bags, title, onClose }: { bags: CashBag[]; title: string; onClose: () => void }) {
  const { state, books, user } = useBooks();
  const [notes, setNotes] = useState<Record<ID, string>>({});
  const [toast, say] = useToast();
  return (
    <section className="panel" aria-labelledby="rv-h" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h2 id="rv-h">{title}</h2><button className="btn sm ghost" onClick={onClose}>Close</button></div>
      {bags.length === 0 ? <p className="panel-pad muted">Nothing here.</p> : (
        <ul className="inbox">{bags.map((b) => {
          const st = state.stores.find((s) => s.id === b.storeId);
          const v = bagVariances(state, b).filter((x) => x.flagged);
          return (
            <li key={b.id} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
              <div><b>{st?.code} · {shortDate(b.businessDate)}</b>{' '}
                {v.map((x) => <span key={x.stage} className="pill bad" style={{ marginRight: 4 }}>{STAGE_LABEL[x.stage]}: {x.diff > 0 ? 'over' : 'short'} {formatMoney(Math.abs(x.diff), { dollarSign: true })}</span>)}
                {bagOverdue(state, b, todayInChicago()) && <span className="pill bad">Picked up {shortDate(event(b, 'pickup')!.at.slice(0, 10))}, not deposited</span>}
                <Link className="small" style={{ marginLeft: 8 }} to={`/cash?date=${b.businessDate}`}>Open the day</Link>
              </div>
              {v.length > 0 && can(user, 'cash.handle') && (
                <div className="actions">
                  <label className="sr-only" htmlFor={'rv-' + b.id}>What you found</label>
                  <input id={'rv-' + b.id} placeholder="What you found" value={notes[b.id] ?? ''} onChange={(e) => setNotes({ ...notes, [b.id]: e.target.value })} style={{ maxWidth: 420 }} />
                  <button className="btn sm" onClick={() => { try { reviewBag(books, user, b.id, notes[b.id] ?? ''); say('Signed off.'); } catch (e) { say(errText(e)); } }}>Sign off</button>
                </div>
              )}
            </li>
          );
        })}</ul>
      )}
      {toast}
    </section>
  );
}
