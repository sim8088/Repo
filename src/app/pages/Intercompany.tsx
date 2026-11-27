import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  AGING_LABELS, IC_PARTY_TYPES, MOVE_LABEL, PARTY_TYPE_LABEL, counterpartyLedger, drawsYtd, eliminations, generateRent, icState, icSummary,
  nextRentRun, ownerDraws, partyAccountTotals, partyAccounts, recordPartyMovement, rentDescription, rentDue, saveRentTemplate, setPartyLimit,
  type PartyLedger, type PartyMoveKind,
} from '../../core/intercompany';
import { bankStoreId } from '../../core/bank';
import { addDays, lastDayOfPeriod, periodLabel, periodOf, periodsBetween, shortDate, todayInChicago } from '../../core/dates';
import { RENT_INCOME, arState } from '../../core/receivables';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { SYS } from '../../core/ledger';
import { fiscalYearStart } from '../../core/reports';
import type { ID, RentTemplate } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const owes = (c: number) => (c > 0 ? 'Owes us' : c < 0 ? 'We owe' : 'Settled');

/** Corporate-level screens: the shared bank and the hub's books. */
function useCorpAccess() {
  const { state, user, visible } = useBooks();
  return visible.has(bankStoreId(state)) && can(user, 'view.reports');
}
const NoAccess = ({ title }: { title: string }) => <PageHead eyebrow="Intercompany" title={title} lede="Your role doesn't include Corporate's intercompany books. Ask the CFO for access." />;

function BalanceCell({ c }: { c: number }) {
  return <><Money c={Math.abs(c)} /> <span className="muted small">{c === 0 ? '' : c > 0 ? 'owed to us' : 'we owe'}</span></>;
}

// ── Party list ───────────────────────────────────────────────────────────
export function IntercompanyPage() {
  const { state, user, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const ok = useCorpAccess();
  const today = todayInChicago();
  const type = sp.get('type') ?? '';
  const sum = useMemo(() => icSummary(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => partyAccountTotals(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <NoAccess title="Related parties" />;
  const rows = sum.parties.filter((p) => !type || state.parties.find((x) => x.id === p.id)?.type === type);
  const owedToUs = sum.parties.filter((p) => p.balance > 0).reduce((a, p) => a + p.balance, 0);
  const weOwe = sum.parties.filter((p) => p.balance < 0).reduce((a, p) => a - p.balance, 0);
  const over = [...sum.parties, ...sum.entities].filter((p) => p.overLimit);
  const accts = partyAccounts(state);
  const ledgerPart = sum.parties.reduce((a, p) => a + p.movements.filter((m) => !m.memoOnly && m.accountId && accts.has(m.accountId)).reduce((x, m) => x + m.out - m.in, 0), 0);
  const glParties = totals.reduce((a, t) => a + t.parties, 0);
  const untagged = totals.reduce((a, t) => a + t.untagged, 0);
  const entNet = sum.entities.reduce((a, e) => a + e.balance, 0);
  const types = [...new Set(sum.parties.map((p) => state.parties.find((x) => x.id === p.id)!.type))];
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  return (
    <>
      <PageHead eyebrow="Intercompany" title="Related parties" lede="A running due-to / due-from ledger with every related company, owner, tenant and lender, plus each store entity's position with Corporate.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('related-parties', ['Party', 'Type', 'Money out', 'Money in', 'Balance (+ owed to us)', 'Limit', 'Last activity'], rows.map((p) => [p.name, p.typeLabel, csvMoney(p.totalOut), csvMoney(p.totalIn), csvMoney(p.balance), p.limit !== undefined ? csvMoney(p.limit) : '', p.lastDate ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Positions" style={{ marginBottom: 20 }}>
        <Figure label="Owed to us" value={<Money c={owedToUs} whole dollar />} note={`${sum.parties.filter((p) => p.balance > 0).length} parties: loans, bills paid for them, rent due`} />
        <Figure label="We owe" value={<Money c={weOwe} whole dollar />} note="Mortgage pass-throughs not yet reimbursed, bills they paid for us" />
        <Figure label="Net related-party position" value={<Money c={owedToUs - weOwe} whole dollar signed />} note={owedToUs >= weOwe ? 'Net owed to us' : 'Net owed by us'} />
        <Figure label="Over their limit" value={over.length} note={over.length ? over.map((p) => p.name).join(', ') : 'Everyone is inside their limit'} href={over[0] ? `/intercompany/parties/${over[0].id}` : undefined} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="pl-h">
          <div className="panel-head"><h2 id="pl-h">Parties</h2><span className="muted small">As of {shortDate(today)}</span></div>
          <div className="filters">
            <div className="field"><label htmlFor="ic-type">Type</label><select id="ic-type" value={type} onChange={(e) => set('type', e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{PARTY_TYPE_LABEL[t]}</option>)}</select></div>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Party</th><th scope="col">Type</th><th scope="col" className="num">Money out</th><th scope="col" className="num">Money in</th><th scope="col" className="num">Balance</th><th scope="col" className="num">Limit</th><th scope="col">Last activity</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/intercompany/parties/${p.id}`}>{p.name}</Link></td><td>{p.typeLabel}</td>
                <td className="num"><Money c={p.totalOut} /></td><td className="num"><Money c={p.totalIn} /></td>
                <td className="num"><BalanceCell c={p.balance} /></td>
                <td className="num">{p.limit !== undefined ? <><Money c={p.limit} whole />{p.overLimit && <> <span className="pill bad">Over</span></>}</> : <span className="muted">–</span>}</td>
                <td>{p.lastDate ? shortDate(p.lastDate) : <span className="muted">No activity</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: ledgerPart === glParties ? 'Party ledgers tie to the party accounts in the ledger' : 'Party ledgers do not tie to the ledger', ok: ledgerPart === glParties, detail: <>{totals.map((t) => state.accounts.find((a) => a.id === t.accountId)?.number).join(', ')} · <Money c={glParties} dollar /> net</> },
            { label: untagged === 0 ? 'Every line on those accounts names a party' : 'Some lines on party accounts have no party', ok: untagged === 0, detail: untagged ? <>Untagged <Money c={untagged} dollar /> — open the account and add the party</> : undefined },
          ]} />
        </section>

        <section className="panel" aria-labelledby="en-h">
          <div className="panel-head"><h2 id="en-h">Store entities with Corporate</h2><Link className="btn sm" to="/intercompany/eliminations">Elimination view</Link></div>
          <p className="panel-pad muted small" style={{ paddingBottom: 0 }}>Built from the due-to / due-from lines the ledger adds whenever Corporate's shared account pays for, or collects for, a store.</p>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Entity</th><th scope="col" className="num">Corporate paid for it</th><th scope="col" className="num">Corporate collected for it</th><th scope="col" className="num">Balance</th></tr></thead>
            <tbody>{sum.entities.map((e) => (
              <tr key={e.id}><td><Link to={`/intercompany/parties/${e.id}`}>{e.name}</Link></td><td className="num"><Money c={e.totalOut} /></td><td className="num"><Money c={e.totalIn} /></td>
                <td className="num"><Money c={Math.abs(e.balance)} /> <span className="muted small">{e.balance > 0 ? 'owes Corporate' : e.balance < 0 ? 'Corporate owes' : ''}</span></td></tr>
            ))}<tr className="total"><td>Net, Corporate's books</td><td /><td /><td className="num"><Money c={entNet} /></td></tr></tbody>
          </table></div>
        </section>

        {can(user, 'txn.create') && <MovementForm />}
      </div>
      <Help k="intercompany" />
    </>
  );
}

function MovementForm() {
  const { state, books, user, stores } = useBooks();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const parties = state.parties.filter((p) => !p.deleted && IC_PARTY_TYPES.includes(p.type) && p.type !== 'tenant').sort((a, b) => a.name.localeCompare(b.name));
  const [partyId, setParty] = useState(parties[0]?.id ?? '');
  const [kind, setKind] = useState<PartyMoveKind>('paid_bill');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [checkNo, setCheck] = useState('');
  const [memo, setMemo] = useState('');
  const [exp, setExp] = useState('');
  const [store, setStore] = useState(stores[0]?.id ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [last, setLast] = useState<{ id: string; ref: string } | null>(null);
  const needsPayee = kind === 'paid_bill' || kind === 'they_paid_for_us';
  const post = () => {
    setErrors([]);
    const cents = parseMoney(amount);
    try {
      const t = recordPartyMovement(books, user, { partyId, kind, date, amount: cents ?? NaN, payee, checkNo: checkNo || undefined, memo, expenseAccountId: exp || undefined, storeId: kind === 'they_paid_for_us' ? store : undefined });
      setLast({ id: t.id, ref: t.ref });
      setAmount(''); setPayee(''); setCheck(''); setMemo('');
      say(`Posted ${t.ref}.`);
    } catch (e) { setErrors(errList(e)); }
  };
  return (
    <section className="panel panel-pad" aria-labelledby="mv-h">
      <h2 id="mv-h" style={{ marginBottom: 4 }}>Record a movement</h2>
      <p className="muted small" style={{ marginBottom: 12 }}>Paying another business's bill from the shared account posts to that party's receivable (1920), never to store expenses.</p>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor="mv-p">Party</label><select id="mv-p" value={partyId} onChange={(e) => setParty(e.target.value)}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="field"><label htmlFor="mv-k">What happened</label><select id="mv-k" value={kind} onChange={(e) => setKind(e.target.value as PartyMoveKind)}>{(Object.keys(MOVE_LABEL) as PartyMoveKind[]).map((k) => <option key={k} value={k}>{MOVE_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="mv-d">Date</label><input id="mv-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="mv-a">Amount</label><input id="mv-a" className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        {needsPayee && <div className="field"><label htmlFor="mv-pay">Whose bill (vendor paid)</label><input id="mv-pay" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. Propane supplier" /></div>}
        {kind !== 'they_paid_for_us' && kind !== 'repayment' && <div className="field"><label htmlFor="mv-c">Check # (if a check)</label><input id="mv-c" value={checkNo} onChange={(e) => setCheck(e.target.value)} /></div>}
        {kind === 'they_paid_for_us' && <>
          <div className="field"><label htmlFor="mv-e">Expense it covered</label><select id="mv-e" value={exp} onChange={(e) => setExp(e.target.value)}><option value="">Choose…</option><AccountOptions filter={(a) => a.type === 'expense' || a.type === 'cogs'} /></select></div>
          <div className="field"><label htmlFor="mv-s">Store</label><select id="mv-s" value={store} onChange={(e) => setStore(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
        </>}
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="mv-m">Memo</label><input id="mv-m" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={post}>Post movement</button>
        {last && <Link to={`/books/transactions/${last.id}`}>Open {last.ref}</Link>}
      </div>
      {toast}
    </section>
  );
}

// ── Statement per party ─────────────────────────────────────────────────
export function PartyStatementPage() {
  const { id = '' } = useParams();
  const { state, books, user, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ok = useCorpAccess();
  const today = todayInChicago();
  const from = sp.get('from') ?? fiscalYearStart(today, state.settings.fiscalYearStartMonth);
  const to = sp.get('to') ?? today;
  const known = state.parties.some((p) => p.id === id) || state.entities.some((e) => e.id === id);
  const led = useMemo(() => (known ? counterpartyLedger(state, id, { from, to }) : null), [state, id, from, to, known, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [limit, setLimit] = useState('');
  if (!ok) return <NoAccess title="Party statement" />;
  if (!led) return <><PageHead title="Party not found" lede="The link may be wrong." /><Link to="/intercompany/parties">Back to related parties</Link></>;
  const party = state.parties.find((p) => p.id === id);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const closing = led.opening + led.totalOut - led.totalIn;
  // Independent check straight from the transactions.
  const check = independentBalance(state, led, to);
  const draws = party?.type === 'owner' ? ownerDraws(state, { from, to }).rows.filter((r) => r.ownerId === id) : [];
  const csv = () => exportCsv(`statement-${led.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${to}`, ['Date', 'Ref', 'Description', 'Money out', 'Money in', 'Balance (+ owed to us)'],
    [[from, '', 'Opening balance', '', '', csvMoney(led.opening)], ...led.movements.map((m) => [m.date, m.ref ?? '', m.description + (m.memoOnly ? ' (scheduled)' : ''), m.out ? csvMoney(m.out) : '', m.in ? csvMoney(m.in) : '', csvMoney(m.balance)])]);
  return (
    <>
      <PageHead eyebrow={`Intercompany · ${led.typeLabel}`} title={led.name} lede={<>Statement {shortDate(from)} – {shortDate(to)} · {state.settings.companyName}. {party?.notes}</>}>
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
        {can(user, 'export') && <button className="btn" onClick={csv}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Statement summary" style={{ marginBottom: 20 }}>
        <Figure label="Balance" value={<Money c={Math.abs(led.balance)} whole dollar />} note={owes(led.balance)} />
        <Figure label="Money out in period" value={<Money c={led.totalOut} whole dollar />} note={led.kind === 'entity' ? 'Corporate paid for the entity' : 'Loans, bills paid for them, rent due'} />
        <Figure label="Money in in period" value={<Money c={led.totalIn} whole dollar />} note="Repayments, reimbursements, bills they paid" />
        <Figure label="Limit" value={led.limit !== undefined ? <Money c={led.limit} whole dollar /> : '—'} note={led.overLimit ? <span className="neg">Over by {formatMoney(Math.abs(led.balance) - led.limit!, { dollarSign: true })}</span> : led.limit !== undefined ? 'Inside the limit' : 'No limit set'} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="st-h">
          <div className="panel-head"><h2 id="st-h">Statement</h2></div>
          <div className="filters">
            <div className="field"><label htmlFor="st-from">From</label><input id="st-from" type="date" value={from} onChange={(e) => set('from', e.target.value)} /></div>
            <div className="field"><label htmlFor="st-to">To</label><input id="st-to" type="date" value={to} onChange={(e) => set('to', e.target.value)} /></div>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Ref</th><th scope="col">Description</th><th scope="col" className="num">Money out</th><th scope="col" className="num">Money in</th><th scope="col" className="num">Balance</th></tr></thead>
            <tbody>
              <tr className="sub"><td>{shortDate(from)}</td><td /><td>Opening balance</td><td /><td /><td className="num"><Money c={led.opening} /></td></tr>
              {led.movements.map((m, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{shortDate(m.date)}</td>
                  <td>{m.txnId ? <Link to={`/books/transactions/${m.txnId}`}>{m.ref}</Link> : <span className="muted small">scheduled</span>}</td>
                  <td className="trunc" title={m.description}>{m.description}</td>
                  <td className="num">{m.out ? <Money c={m.out} /> : ''}</td><td className="num">{m.in ? <Money c={m.in} /> : ''}</td><td className="num"><Money c={m.balance} /></td>
                </tr>
              ))}
              <tr className="total"><td colSpan={3}>Closing balance {led.balance > 0 ? '(owed to us)' : led.balance < 0 ? '(we owe)' : ''}</td><td className="num"><Money c={led.totalOut} /></td><td className="num"><Money c={led.totalIn} /></td><td className="num"><Money c={led.balance} /></td></tr>
            </tbody>
          </table></div>
          <TieOut items={[
            { label: closing === led.balance ? 'Opening + money out − money in = closing' : 'Statement does not add up', ok: closing === led.balance },
            { label: check.ok ? check.label : `Off from ${check.source} by ${formatMoney(Math.abs(check.value - led.balance), { dollarSign: true })}`, ok: check.ok, detail: check.source },
          ]} />
        </section>
        <div className="grid-2">
          <section className="panel" aria-labelledby="ag-h">
            <div className="panel-head"><h2 id="ag-h">Aging of the balance</h2><span className="muted small">Oldest items settled first</span></div>
            <table className="t"><tbody>
              {AGING_LABELS.map((l, i) => <tr key={l}><td>{l}</td><td className="num"><Money c={led.aging[i]} /></td></tr>)}
              <tr className="total"><td>Balance</td><td className="num"><Money c={led.aging.reduce((a, b) => a + b, 0)} /></td></tr>
            </tbody></table>
            <TieOut items={[{ label: led.aging.reduce((a, b) => a + b, 0) === led.balance ? 'Aging adds to the balance' : 'Aging does not add up', ok: led.aging.reduce((a, b) => a + b, 0) === led.balance }]} />
          </section>
          <section className="panel panel-pad no-print" aria-labelledby="lim-h">
            <h2 id="lim-h" style={{ marginBottom: 8 }}>Limit</h2>
            <p className="muted small">The inbox alerts when the balance either way goes above the limit.</p>
            {can(user, 'setup.edit') ? (
              <div className="actions" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ width: 180 }}><label htmlFor="lim-v">Limit in dollars</label><input id="lim-v" className="num" inputMode="decimal" value={limit} placeholder={led.limit !== undefined ? formatMoney(led.limit) : 'No limit'} onChange={(e) => setLimit(e.target.value)} /></div>
                <button className="btn sm" onClick={() => { try { const v = limit.trim() ? parseMoney(limit) : null; if (limit.trim() && v === null) throw new ValidationError(['Enter the limit in dollars, e.g. 10,000.']); setPartyLimit(books, user, id, v); setLimit(''); say(v === null ? 'Limit removed.' : 'Limit saved.'); } catch (e) { say(errList(e).join(' ')); } }}>{limit.trim() ? 'Save limit' : 'Remove limit'}</button>
              </div>
            ) : <p className="muted">Your role can't change limits.</p>}
          </section>
        </div>
        {party?.type === 'owner' && (
          <section className="panel" aria-labelledby="od-h">
            <div className="panel-head"><h2 id="od-h">Withdrawals in the period</h2><Link className="btn sm" to="/intercompany/draws">All owner draws</Link></div>
            {draws.length === 0 ? <p className="panel-pad muted">No withdrawals in this period.</p> : (
              <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Date</th><th scope="col">Ref</th><th scope="col">Description</th><th scope="col">Booked as</th><th scope="col" className="num">Amount</th></tr></thead>
                <tbody>{draws.map((r) => <tr key={r.l.id}><td>{shortDate(r.t.date)}</td><td><Link to={`/books/transactions/${r.t.id}`}>{r.t.ref}</Link></td><td>{r.t.description}</td><td>{r.via === 'draw' ? 'Equity draw' : 'Expense (policy)'}</td><td className="num"><Money c={r.amount} /></td></tr>)}
                  <tr className="total"><td colSpan={4}>Total</td><td className="num"><Money c={draws.reduce((a, r) => a + r.amount, 0)} /></td></tr></tbody></table></div>
            )}
          </section>
        )}
      </div>
      {toast}
      <Help k="partyStatement" />
    </>
  );
}

/** Recompute the closing balance from the transactions, independently of the ledger builder. */
function independentBalance(state: ReturnType<typeof useBooks>['state'], led: PartyLedger, to: string): { ok: boolean; value: number; label: string; source: string } {
  if (led.kind === 'entity') {
    // The entity's own books: its due-to/due-from lines against Corporate, sign flipped.
    const hub = state.entities.find((e) => e.isHub)?.id;
    const entOf = new Map(state.stores.map((s) => [s.id, s.entityId]));
    let v = 0;
    for (const t of state.transactions) if (!t.deleted && t.date <= to) for (const l of t.lines) if (l.system && entOf.get(l.storeId) === led.id && l.counterEntityId === hub) v -= l.debit - l.credit;
    return { ok: v === led.balance, value: v, label: "Agrees with the entity's own books", source: "the entity's due-to / due-from lines" };
  }
  const accts = partyAccounts(state);
  let v = 0;
  for (const t of state.transactions) if (!t.deleted && t.date <= to) for (const l of t.lines) if (accts.has(l.accountId) && !l.system && (l.partyId ?? t.partyId) === led.id) v += l.debit - l.credit;
  const party = state.parties.find((p) => p.id === led.id);
  if (party?.type === 'tenant') {
    // Rent due per the schedule, less rent received per the ledger, plus any party-account lines.
    let due = 0;
    for (const s of arState(state).rent) {
      if (s.tenantId !== led.id || !s.active) continue;
      for (const p of periodsBetween(s.startPeriod, s.endPeriod && s.endPeriod < periodOf(to) ? s.endPeriod : periodOf(to))) if (`${p}-${String(s.dueDay).padStart(2, '0')}` <= to) due += s.amount;
    }
    let rec = 0;
    for (const t of state.transactions) if (!t.deleted && t.date <= to && t.partyId === led.id) for (const l of t.lines) if (l.accountId === RENT_INCOME) rec += l.credit - l.debit;
    const value = v + due - rec;
    return { ok: value === led.balance, value, label: 'Agrees with rent due less rent received', source: 'the rent schedule and rent deposits' };
  }
  return { ok: v === led.balance, value: v, label: 'Agrees with the party accounts in the ledger', source: 'lines on 1910 / 1920 / 2400 and loan accounts' };
}

// ── Owner draws ──────────────────────────────────────────────────────────
export function DrawsPage() {
  const { state, user, version } = useBooks();
  const exportCsv = useExport();
  const ok = useCorpAccess();
  const today = todayInChicago();
  const d = useMemo(() => drawsYtd(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <NoAccess title="Owner draws" />;
  const owners = state.parties.filter((p) => p.type === 'owner' && !p.deleted);
  const policy = state.settings.ownerWithdrawalPolicy;
  const expAcct = state.accounts.find((a) => a.id === (state.settings.ownerWithdrawalExpenseAccountId ?? 'acct_misc'));
  const byOwnerSum = [...d.byOwner.values()].reduce((a, b) => a + b, 0);
  const drawAccts = new Set(state.accounts.filter((a) => a.subtype === 'draws').map((a) => a.id));
  const fy = fiscalYearStart(today, state.settings.fiscalYearStartMonth);
  let drawGl = 0;
  for (const t of state.transactions) if (!t.deleted && t.date >= fy && t.date <= today) for (const l of t.lines) if (drawAccts.has(l.accountId)) drawGl += l.debit - l.credit;
  const drawRows = d.rows.filter((r) => r.via === 'draw').reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <PageHead eyebrow="Intercompany" title="Owner draws" lede={<>Owner withdrawals year to date, wherever they were booked. Current policy: <b>{policy === 'draw' ? 'equity draws (3100)' : `expense on Corporate · ${expAcct?.name ?? 'Miscellaneous'}`}</b>; change it in <Link to="/setup/settings">Settings</Link>.</>}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`owner-draws-ytd-${today}`, ['Date', 'Ref', 'Owner', 'Description', 'Booked as', 'Amount'], d.rows.map((r) => [r.t.date, r.t.ref, state.parties.find((p) => p.id === r.ownerId)?.name ?? 'Not named', r.t.description, r.via === 'draw' ? 'Equity draw' : 'Expense', csvMoney(r.amount)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Draws" style={{ marginBottom: 20 }}>
        <Figure label={`Year to date (from ${shortDate(fy)})`} value={<Money c={d.total} whole dollar />} note={`${d.rows.length} withdrawal${d.rows.length === 1 ? '' : 's'}`} />
        {owners.map((o) => <Figure key={o.id} label={o.name} value={<Money c={d.byOwner.get(o.id) ?? 0} whole dollar />} href={`/intercompany/parties/${o.id}`} note="Year to date" />)}
        <Figure label="Booked as expense" value={<Money c={d.rows.filter((r) => r.via === 'expense').reduce((a, r) => a + r.amount, 0)} whole dollar />} note="Under the expense policy; equity draws are the rest" />
      </section>
      <section className="panel" aria-labelledby="dr-h">
        <div className="panel-head"><h2 id="dr-h">Withdrawals</h2></div>
        {d.rows.length === 0 ? <p className="panel-pad muted">No owner withdrawals this year.</p> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Ref</th><th scope="col">Owner</th><th scope="col">Description</th><th scope="col">Booked as</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.l.id}><td>{shortDate(r.t.date)}</td><td><Link to={`/books/transactions/${r.t.id}`}>{r.t.ref}</Link></td><td>{state.parties.find((p) => p.id === r.ownerId)?.name ?? <span className="neg">Not named</span>}</td>
                <td className="trunc" title={r.t.description}>{r.t.description}</td><td>{r.via === 'draw' ? 'Equity draw (3100)' : `Expense (${expAcct?.number})`}</td><td className="num"><Money c={r.amount} /></td></tr>
            ))}<tr className="total"><td colSpan={5}>Total year to date</td><td className="num"><Money c={d.total} /></td></tr></tbody>
          </table></div>
        )}
        <TieOut items={[
          { label: byOwnerSum === d.total ? 'Owners add to the total' : 'Owners do not add to the total', ok: byOwnerSum === d.total },
          { label: drawRows === drawGl ? 'Equity draws tie to the draws account' : 'Equity draws do not tie to the draws account', ok: drawRows === drawGl, detail: <><Money c={drawGl} dollar /> on 3100 this year</> },
        ]} />
      </section>
      <Help k="draws" />
    </>
  );
}

// ── Elimination view ─────────────────────────────────────────────────────
export function EliminationsPage() {
  const { state, user, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const ok = useCorpAccess();
  const asOf = sp.get('asOf') ?? todayInChicago();
  const e = useMemo(() => eliminations(state, asOf), [state, asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <NoAccess title="Elimination view" />;
  const ent = (id: string) => state.entities.find((x) => x.id === id)?.code ?? id;
  const groups: [string, string[]][] = [['Assets', ['asset']], ['Liabilities', ['liability']], ['Equity', ['equity']]];
  const sumOf = (types: string[], k: 'combined' | 'elimination' | 'consolidated') => e.rows.filter((r) => types.includes(r.account.type)).reduce((a, r) => a + r[k], 0);
  const assets = sumOf(['asset'], 'consolidated');
  const le = sumOf(['liability', 'equity'], 'consolidated') + e.netIncome;
  return (
    <>
      <PageHead eyebrow="Intercompany" title="Elimination view" lede="The group as one company: the automatic due-to / due-from between the store entities and Corporate is netted out. Balances with related parties outside the group (Dhunna, SKD, Cheers…) stay, because they are real.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`consolidated-${asOf}`, ['Account', 'Name', 'All entities', 'Elimination', 'Consolidated'], e.rows.map((r) => [r.account.number, r.account.name, csvMoney(r.combined), csvMoney(r.elimination), csvMoney(r.consolidated)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Intercompany" style={{ marginBottom: 20 }}>
        <Figure label="Due from related entities (1900)" value={<Money c={e.dueFrom} whole dollar />} href={`/books/accounts/${SYS.dueFrom}`} />
        <Figure label="Due to related entities (2900)" value={<Money c={e.dueTo} whole dollar />} href={`/books/accounts/${SYS.dueTo}`} />
        <Figure label="Difference" value={<Money c={e.dueFrom - e.dueTo} dollar />} note={e.dueFrom === e.dueTo ? 'The two sides net to zero' : 'Should be zero'} />
        <Figure label="Entity pairs checked" value={e.pairs.length} note={`${e.pairs.filter((p) => p.net === 0).length} agree to the cent`} />
      </section>
      <div className="filters" style={{ marginBottom: 12 }}>
        <div className="field"><label htmlFor="el-d">As of</label><input id="el-d" type="date" value={asOf} onChange={(ev) => { const n = new URLSearchParams(sp); n.set('asOf', ev.target.value); setSp(n, { replace: true }); }} /></div>
      </div>
      <div className="stack">
        <section className="panel" aria-labelledby="pr-h">
          <div className="panel-head"><h2 id="pr-h">Each pair agrees</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Entity</th><th scope="col">With</th><th scope="col" className="num">On its books</th><th scope="col" className="num">On the other's books</th><th scope="col" className="num">Net</th></tr></thead>
            <tbody>{e.pairs.map((p) => (
              <tr key={p.a + p.b}><td>{ent(p.a)}</td><td>{ent(p.b)}</td><td className="num"><Money c={p.aSide} /></td><td className="num"><Money c={p.bSide} /></td><td className={'num ' + (p.net === 0 ? 'pos' : 'neg')}><Money c={p.net} /></td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="cb-h">
          <div className="panel-head"><h2 id="cb-h">Consolidated balance sheet</h2><span className="muted small">{shortDate(asOf)}</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Account</th><th scope="col" className="num">All entities</th><th scope="col" className="num">Elimination</th><th scope="col" className="num">Consolidated</th></tr></thead>
            <tbody>
              {groups.map(([g, types]) => (
                <GroupRows key={g} title={g} rows={e.rows.filter((r) => types.includes(r.account.type))} totals={[sumOf(types, 'combined'), sumOf(types, 'elimination'), sumOf(types, 'consolidated')]} />
              ))}
              <tr className="sub"><td>Profit this year (in equity)</td><td className="num"><Money c={e.netIncome} /></td><td className="num"><Money c={0} /></td><td className="num"><Money c={e.netIncome} /></td></tr>
              <tr className="total"><td>Liabilities + equity</td><td /><td /><td className="num"><Money c={le} /></td></tr>
            </tbody>
          </table></div>
          <TieOut items={[
            { label: e.dueFrom === e.dueTo ? 'Due-from and due-to net to zero' : 'Due-from and due-to do not net', ok: e.dueFrom === e.dueTo, detail: <><Money c={e.dueFrom} dollar /> each side</> },
            { label: e.pairs.every((p) => p.net === 0) ? 'Every entity pair agrees' : 'An entity pair disagrees', ok: e.pairs.every((p) => p.net === 0) },
            { label: e.eliminationNet === 0 ? 'Eliminations net to zero' : 'Eliminations do not net', ok: e.eliminationNet === 0 },
            { label: assets === le ? 'Consolidated assets = liabilities + equity' : 'Consolidated balance sheet is off', ok: assets === le, detail: assets !== le ? <>by <Money c={assets - le} dollar /></> : undefined },
          ]} />
        </section>
      </div>
      <Help k="eliminations" />
    </>
  );
}

function GroupRows({ title, rows, totals }: { title: string; rows: ReturnType<typeof eliminations>['rows']; totals: number[] }) {
  return (
    <>
      <tr className="section"><td colSpan={4}>{title}</td></tr>
      {rows.map((r) => (
        <tr key={r.account.id} className="indent"><td><Link to={`/books/accounts/${r.account.id}`}>{r.account.number} · {r.account.name}</Link></td><td className="num"><Money c={r.combined} /></td><td className="num">{r.elimination ? <Money c={r.elimination} /> : ''}</td><td className="num"><Money c={r.consolidated} /></td></tr>
      ))}
      <tr className="sub"><td>Total {title.toLowerCase()}</td>{totals.map((t, i) => <td key={i} className="num"><Money c={t} /></td>)}</tr>
    </>
  );
}

// ── Rent pass-through templates ──────────────────────────────────────────
export function RentTemplatesPage() {
  const { state, books, user, stores } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ok = useCorpAccess();
  const today = todayInChicago();
  const templates = icState(state).rentTemplates;
  const due = rentDue(state, today);
  const nextMonth = periodOf(addDays(lastDayOfPeriod(periodOf(today)), 1));
  const periods = [...new Set([...due.map((d) => d.period), periodOf(today), nextMonth])].sort();
  const [period, setPeriod] = useState(due[0]?.period ?? nextMonth);
  const [errors, setErrors] = useState<string[]>([]);
  const blank = (): RentTemplate => ({ id: '', storeId: stores.find((s) => s.kind === 'operating')?.id ?? '', partyId: state.parties.find((p) => p.type === 'related_company')?.id ?? '', amount: 0, dayOfMonth: 1, expenseAccountId: 'acct_rent', payableAccountId: 'acct_due_related', startPeriod: nextMonth, active: true, generated: {} });
  const [draft, setDraft] = useState<RentTemplate>(blank);
  const [amt, setAmt] = useState('');
  if (!ok) return <NoAccess title="Rent pass-throughs" />;
  const active = templates.filter((t) => t.active);
  const monthly = active.reduce((a, t) => a + t.amount, 0);
  const next = active.map((t) => nextRentRun(state, t, today)).filter(Boolean).sort()[0] as string | undefined;
  const generatedPeriods = [...new Set(templates.flatMap((t) => Object.keys(t.generated)))].sort().reverse();
  const txn = (id?: ID) => (id ? state.transactions.find((x) => x.id === id && !x.deleted) : undefined);
  const amountOf = (id?: ID) => txn(id)?.lines.reduce((a, l) => a + l.debit, 0) ?? 0;
  const canGen = can(user, 'journal.create');
  const store = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  return (
    <>
      <PageHead eyebrow="Intercompany" title="Rent pass-throughs" lede="A related party pays the store's mortgage, so each month the store books rent and Corporate owes the party. These templates generate those entries.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('rent-pass-throughs', ['Period', 'Store', 'Party', 'Amount', 'Ref'], generatedPeriods.flatMap((p) => templates.filter((t) => t.generated[p]).map((t) => [p, store(t.storeId), state.parties.find((x) => x.id === t.partyId)?.name ?? '', csvMoney(amountOf(t.generated[p])), txn(t.generated[p])?.ref ?? 'deleted'])))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Templates" style={{ marginBottom: 20 }}>
        <Figure label="Each month" value={<Money c={monthly} whole dollar />} note={`${active.length} active template${active.length === 1 ? '' : 's'}`} />
        <Figure label="Due to generate now" value={due.length} note={due.length ? `${due.map((d) => d.period).filter((v, i, a) => a.indexOf(v) === i).join(', ')}` : 'Everything due is generated'} />
        <Figure label="Next run" value={next ? shortDate(next) : '—'} />
        <Figure label="Months generated" value={generatedPeriods.length} note={generatedPeriods[0] ? `Latest ${periodLabel(generatedPeriods[0])}` : undefined} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="rt-h">
          <div className="panel-head"><h2 id="rt-h">Templates</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col">Paid by</th><th scope="col" className="num">Monthly</th><th scope="col">Posts on</th><th scope="col">From</th><th scope="col">Next run</th><th scope="col">Status</th></tr></thead>
            <tbody>{templates.map((t) => (
              <tr key={t.id}><td>{store(t.storeId)}</td><td><Link to={`/intercompany/parties/${t.partyId}`}>{state.parties.find((p) => p.id === t.partyId)?.name}</Link></td><td className="num"><Money c={t.amount} /></td>
                <td>Day {t.dayOfMonth}</td><td>{periodLabel(t.startPeriod)}</td><td>{nextRentRun(state, t, today) ? shortDate(nextRentRun(state, t, today)!) : '—'}</td>
                <td>{can(user, 'setup.edit') ? <button className="btn sm ghost" onClick={() => { try { saveRentTemplate(books, user, { ...t, active: !t.active }); say(t.active ? 'Paused.' : 'Resumed.'); } catch (e) { say(errList(e).join(' ')); } }} aria-label={`${t.active ? 'Pause' : 'Resume'} ${rentDescription(state, t)}`}>{t.active ? 'Pause' : 'Resume'}</button> : null} <span className={'pill ' + (t.active ? 'ok' : '')}>{t.active ? 'Active' : 'Paused'}</span></td></tr>
            ))}</tbody>
          </table></div>
          {canGen && (
            <div className="panel-pad actions" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 200 }}><label htmlFor="rt-p">Month to generate</label><select id="rt-p" value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
              <button className="btn primary" onClick={() => { try { const out = generateRent(books, user, period); say(out.length ? `Generated ${out.length} entr${out.length === 1 ? 'y' : 'ies'} for ${periodLabel(period)}.` : `Nothing to generate: ${periodLabel(period)} is already done.`); } catch (e) { say(errList(e).join(' ')); } }}>Generate {periodLabel(period)}</button>
              <span className="muted small">Generating twice never duplicates: a month already generated is skipped.</span>
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="rh-h">
          <div className="panel-head"><h2 id="rh-h">Generated entries</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th>{templates.map((t) => <th key={t.id} scope="col" className="num">{store(t.storeId)}</th>)}<th scope="col" className="num">Total</th></tr></thead>
            <tbody>{generatedPeriods.map((p) => (
              <tr key={p}><td>{periodLabel(p)}</td>{templates.map((t) => <td key={t.id} className="num">{txn(t.generated[p]) ? <Link to={`/books/transactions/${t.generated[p]}`}><Money c={amountOf(t.generated[p])} /></Link> : <span className="muted">–</span>}</td>)}
                <td className="num"><Money c={templates.reduce((a, t) => a + amountOf(t.generated[p]), 0)} /></td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={generatedPeriods.slice(0, 3).map((p) => {
            const want = templates.filter((t) => t.active && t.startPeriod <= p && (!t.endPeriod || t.endPeriod >= p)).reduce((a, t) => a + t.amount, 0);
            const got = templates.reduce((a, t) => a + amountOf(t.generated[p]), 0);
            return { label: `${periodLabel(p)}: ${got === want ? 'entries match the templates' : 'entries differ from the templates'}`, ok: got === want, detail: <Money c={got} dollar /> };
          })} />
        </section>
        {can(user, 'setup.edit') && (
          <section className="panel panel-pad" aria-labelledby="ra-h">
            <h2 id="ra-h" style={{ marginBottom: 8 }}>Add a template</h2>
            <Errors errors={errors} />
            <div className="form-grid">
              <div className="field"><label htmlFor="ra-s">Store</label><select id="ra-s" value={draft.storeId} onChange={(e) => setDraft({ ...draft, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-p">Paid by</label><select id="ra-p" value={draft.partyId} onChange={(e) => setDraft({ ...draft, partyId: e.target.value })}>{state.parties.filter((p) => p.type === 'related_company' && !p.deleted).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-a">Monthly amount</label><input id="ra-a" className="num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-d">Day of month</label><input id="ra-d" type="number" min={1} max={28} value={draft.dayOfMonth} onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })} /></div>
              <div className="field"><label htmlFor="ra-f">First month</label><input id="ra-f" type="month" value={draft.startPeriod} onChange={(e) => setDraft({ ...draft, startPeriod: e.target.value })} /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setErrors([]); try { saveRentTemplate(books, user, { ...draft, id: books.nextId('rt'), amount: parseMoney(amt) ?? 0 }); setDraft(blank()); setAmt(''); say('Template added.'); } catch (e) { setErrors(errList(e)); } }}>Add template</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="rentTemplates" />
    </>
  );
}
