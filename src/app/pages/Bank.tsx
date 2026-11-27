import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Empty, Errors, Figure, Help, Money, PageHead, PartyOptions, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  DEPOSIT_SOURCE_LABEL, autoMatch, bookLines, candidates, checksRegister, commitImport, createFromBankLine, excludeBankLine, isMatched,
  matchBankLine, matchIndex, previewImport, reconcileStatus, reconciledThrough, saveReconciliation, setDepositSource, suggestFor,
  unmatchBankLine, undoReconciliation, voidCheck, type CheckStatus, type ImportPreview, bankStoreId,
} from '../../core/bank';
import { parseBankFile, type ParsedFile } from '../../core/bankio';
import { balanceAsOf } from '../../core/reports';
import { addDays, lastDayOfPeriod, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import type { BankLine, DepositSource, ID } from '../../core/types';

const errText = (e: unknown) => (e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message);
const SOURCES = Object.keys(DEPOSIT_SOURCE_LABEL) as DepositSource[];

function useBankAccount() {
  const { state } = useBooks();
  const [sp, setSp] = useSearchParams();
  const banks = state.accounts.filter((a) => a.subtype === 'bank' && a.active);
  const id = sp.get('account') ?? banks[0]?.id ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  return { banks, id, sp, set };
}

export function BankPage() {
  const { state, user, visible, version } = useBooks();
  const { banks, id, sp, set } = useBankAccount();
  const tab = sp.get('tab') ?? 'match';
  const today = todayInChicago();
  const idx = useMemo(() => matchIndex(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state.bank.lines.filter((b) => b.accountId === id);
  const unmatched = mine.filter((b) => !b.excluded && !isMatched(b, idx));
  const thru = reconciledThrough(state, id);
  const lastLine = mine.map((b) => b.date).sort().at(-1);
  const feedStatus = lastLine ? reconcileStatus(state, id, lastLine) : null;
  if (!visible.has(bankStoreId(state)) || !can(user, 'view.reports')) return <PageHead title="Bank" lede="Your role doesn't include the company bank accounts. Ask the CFO for access." />;
  const acct = state.accounts.find((a) => a.id === id);

  return (
    <>
      <PageHead eyebrow="Bank & cash" title="Bank feed & reconciliation" lede={<>Match every bank line to the books, then reconcile to the statement. {thru ? <>Reconciled through <b>{shortDate(thru)}</b>.</> : 'Not reconciled yet.'}</>}>
        {banks.length > 1 && (
          <div className="field" style={{ width: 220 }}><label htmlFor="bk-acct">Account</label><select id="bk-acct" value={id} onChange={(e) => set('account', e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        )}
      </PageHead>
      <section className="figures" aria-label="Balances" style={{ marginBottom: 20 }}>
        <Figure label="Balance per books today" value={<Money c={balanceAsOf(state, id, today)} whole dollar />} href={`/books/accounts/${id}`} note={acct?.floorCents !== undefined ? `Floor ${formatMoney(acct.floorCents, { dollarSign: true, whole: true })}` : undefined} />
        <Figure label={`Balance per bank ${lastLine ? shortDate(lastLine) : ''}`} value={feedStatus?.feedBalance != null ? <Money c={feedStatus.feedBalance} whole dollar /> : '—'} note="Statement opening plus every imported line" />
        <Figure label="Unmatched bank lines" value={unmatched.length} note={unmatched.length ? `${formatMoney(unmatched.reduce((a, b) => a + Math.abs(b.amount), 0), { dollarSign: true, whole: true })} gross` : 'All matched'} />
        <Figure label="Reconciled through" value={thru ? shortDate(thru) : '—'} note={`${state.bank.reconciliations.filter((r) => r.accountId === id).length} reconciliations on file`} />
      </section>
      <div className="seg" role="group" aria-label="View" style={{ marginBottom: 16 }}>
        {[['match', `To match (${unmatched.length})`], ['reconcile', 'Reconcile'], ['lines', 'All bank lines'], ['import', 'Import']].map(([k, l]) => (
          <button key={k} aria-pressed={tab === k} onClick={() => set('tab', k)}>{l}</button>
        ))}
      </div>
      {tab === 'match' && <MatchTab accountId={id} lines={unmatched} />}
      {tab === 'reconcile' && <ReconcileTab accountId={id} />}
      {tab === 'lines' && <LinesTab accountId={id} />}
      {tab === 'import' && <ImportTab accountId={id} />}
      <Help k="bank" />
    </>
  );
}

function MatchTab({ accountId, lines }: { accountId: ID; lines: BankLine[] }) {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const canRec = can(user, 'bank.reconcile');
  const idx = matchIndex(state);
  const bl = bookLines(state, accountId);
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="panel" aria-label="Bank lines to match">
      <div className="panel-head">
        <h2>To match</h2>
        {canRec && lines.length > 0 && <button className="btn primary sm" onClick={() => { const n = autoMatch(books, user, lines.map((l) => l.id)); say(n ? `Matched ${n} line${n === 1 ? '' : 's'}. ${lines.length - n} left for you.` : 'Nothing could be matched automatically. The rest need a person.'); }}>Auto-match</button>}
      </div>
      {sorted.length === 0 && <div className="panel-pad"><Empty>All pumps clear: every bank line is matched. Import the next statement from the Import tab.</Empty></div>}
      <ul className="inbox">
        {sorted.map((b) => {
          const c = candidates(state, b, idx, bl).slice(0, 3);
          return (
            <li key={b.id} style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline' }}>
                <span className="muted small" style={{ minWidth: 92 }}>{shortDate(b.date)}</span>
                <b style={{ flex: 1, minWidth: 160 }}>{b.description}</b>
                <span className={'num ' + (b.amount < 0 ? '' : 'pos')} style={{ fontWeight: 600 }}><Money c={b.amount} /></span>
              </div>
              {canRec && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {c.map((x) => (
                    <button key={x.line.l.id} className="btn sm" onClick={() => { try { matchBankLine(books, user, b.id, [x.line.l.id]); say(`Matched to ${x.line.t.ref}.`); } catch (e) { say(errText(e)); } }}
                      title={`${x.line.t.ref} · ${x.line.t.description} · ${shortDate(x.line.t.date)}`}>
                      Match {x.line.t.ref} · {x.why}
                    </button>
                  ))}
                  <button className="btn sm ghost" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>{c.length ? 'Something else…' : 'Book it or find it…'}</button>
                </div>
              )}
              {open === b.id && <Resolve line={b} onDone={(m) => { setOpen(null); say(m); }} />}
            </li>
          );
        })}
      </ul>
      {toast}
    </section>
  );
}

/** Resolve one bank line: book it from the feed, match several ledger lines, or exclude it. */
function Resolve({ line, onDone }: { line: BankLine; onDone: (msg: string) => void }) {
  const { state, books, user, stores } = useBooks();
  const s = suggestFor(state, line);
  const [mode, setMode] = useState<'book' | 'find' | 'exclude'>('book');
  const [acct, setAcct] = useState(s?.rule.accountId ?? '');
  const [store, setStore] = useState(s?.rule.storeId ?? bankStoreId(state));
  const [party, setParty] = useState(s?.rule.partyId ?? '');
  const [source, setSource] = useState<DepositSource | ''>(line.source ?? '');
  const [desc, setDesc] = useState(line.description);
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<Set<ID>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const idx = matchIndex(state);
  const near = bookLines(state, line.accountId).filter((x) => !idx.has(x.l.id) && x.t.date >= addDays(line.date, -14) && x.t.date <= addDays(line.date, 5)).sort((a, b) => a.t.date.localeCompare(b.t.date));
  const pickedSum = near.filter((x) => picked.has(x.l.id)).reduce((a, x) => a + x.amount, 0);
  const run = (fn: () => string) => { try { onDone(fn()); } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); } };
  const fid = (k: string) => `${k}-${line.id}`;
  return (
    <div className="panel panel-pad" style={{ background: 'var(--panel-2)' }}>
      <div className="seg" role="group" aria-label="How to resolve" style={{ marginBottom: 12 }}>
        <button aria-pressed={mode === 'book'} onClick={() => setMode('book')}>Book it</button>
        <button aria-pressed={mode === 'find'} onClick={() => setMode('find')}>Find in books</button>
        <button aria-pressed={mode === 'exclude'} onClick={() => setMode('exclude')}>Exclude</button>
      </div>
      <Errors errors={errors} />
      {mode === 'book' && (
        <>
          {s && <p className="small">Rule “{s.rule.contains}” suggests this ({Math.round(s.confidence * 100)}% confident).</p>}
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor={fid('d')}>Description</label><input id={fid('d')} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            <div className="field"><label htmlFor={fid('a')}>Category</label><select id={fid('a')} value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">Choose…</option><AccountOptions filter={(a) => a.subtype !== 'bank' && a.subtype !== 'uncategorized'} /></select></div>
            <div className="field"><label htmlFor={fid('s')}>Store</label><select id={fid('s')} value={store} onChange={(e) => setStore(e.target.value)}>{stores.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></div>
            <div className="field"><label htmlFor={fid('p')}>Party</label><select id={fid('p')} value={party} onChange={(e) => setParty(e.target.value)}><option value="">None</option><PartyOptions /></select></div>
            {line.amount > 0 && <div className="field"><label htmlFor={fid('src')}>Deposit source</label><select id={fid('src')} value={source} onChange={(e) => setSource(e.target.value as DepositSource)}><option value="">Choose…</option>{SOURCES.map((x) => <option key={x} value={x}>{DEPOSIT_SOURCE_LABEL[x]}</option>)}</select></div>}
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn primary sm" disabled={!acct} onClick={() => run(() => { const t = createFromBankLine(books, user, line.id, { accountId: acct, storeId: store, partyId: party || undefined, source: source || undefined, description: desc }); return `Booked ${t.ref} and matched it. The rule learned from this.`; })}>Book &amp; match</button>
            <span className="muted small">Posts {line.amount < 0 ? 'money out' : 'money in'} of {formatMoney(Math.abs(line.amount), { dollarSign: true })} dated {shortDate(line.date)}.</span>
          </div>
        </>
      )}
      {mode === 'find' && (
        <>
          <p className="small">Unmatched entries on this account from two weeks before to five days after. Tick the ones that make up this line.</p>
          {near.length === 0 ? <p className="muted">Nothing unmatched nearby. Book it instead.</p> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col"><span className="sr-only">Pick</span></th><th scope="col">Date</th><th scope="col">Ref</th><th scope="col">Description</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>{near.map((x) => (
                <tr key={x.l.id}><td><input type="checkbox" aria-label={`Pick ${x.t.ref}`} checked={picked.has(x.l.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(x.l.id); else n.delete(x.l.id); setPicked(n); }} /></td>
                  <td>{shortDate(x.t.date)}</td><td><Link to={`/books/transactions/${x.t.id}`}>{x.t.ref}</Link></td><td className="trunc" title={x.t.description}>{x.t.description}</td><td className="num"><Money c={x.amount} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="actions" style={{ marginTop: 12 }}>
            <span className={pickedSum === line.amount ? 'pos' : 'muted'}>Picked <Money c={pickedSum} /> of <Money c={line.amount} />{pickedSum !== line.amount && picked.size > 0 && ` · ${formatMoney(line.amount - pickedSum, { dollarSign: true })} to go`}</span>
            <button className="btn primary sm" disabled={pickedSum !== line.amount || !picked.size} onClick={() => run(() => { matchBankLine(books, user, line.id, [...picked]); return `Matched to ${picked.size} entr${picked.size === 1 ? 'y' : 'ies'}.`; })}>Match</button>
          </div>
        </>
      )}
      {mode === 'exclude' && (
        <>
          <div className="field" style={{ maxWidth: 520 }}><label htmlFor={fid('x')}>Why leave this out of the books?</label><input id={fid('x')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pending item the bank reversed next day" /></div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn sm" disabled={!reason.trim()} onClick={() => run(() => { excludeBankLine(books, user, line.id, reason); return 'Excluded. It stays visible under All bank lines.'; })}>Exclude line</button></div>
        </>
      )}
    </div>
  );
}

function ReconcileTab({ accountId }: { accountId: ID }) {
  const { state, books, user, version } = useBooks();
  const [toast, say] = useToast();
  const thru = reconciledThrough(state, accountId);
  const lastLine = state.bank.lines.filter((b) => b.accountId === accountId).map((b) => b.date).sort().at(-1) ?? todayInChicago();
  const nextEnd = thru ? lastDayOfPeriod(addDays(thru, 1).slice(0, 7)) : lastDayOfPeriod(lastLine.slice(0, 7));
  const [date, setDate] = useState(nextEnd > lastLine ? lastLine : nextEnd);
  const st = useMemo(() => reconcileStatus(state, accountId, date), [state, accountId, date, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [stmt, setStmt] = useState('');
  const stmtC = stmt.trim() ? parseMoney(stmt) : st.feedBalance;
  const diff = stmtC === null ? null : stmtC - st.expectedStatement;
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);
  const recs = state.bank.reconciliations.filter((r) => r.accountId === accountId).sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  const userName = (id: string) => state.users.find((u) => u.id === id)?.name ?? id;
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="rec-h">
        <div className="panel-head"><h2 id="rec-h">Reconcile to the statement</h2>{thru && <span className="muted small">Last reconciled {shortDate(thru)}</span>}</div>
        <div className="filters">
          <div className="field"><label htmlFor="rc-date">Statement date</label><input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="rc-bal">Statement ending balance</label><input id="rc-bal" className="num" inputMode="decimal" value={stmt} placeholder={st.feedBalance !== null ? (st.feedBalance / 100).toFixed(2) : '0.00'} onChange={(e) => setStmt(e.target.value)} /><span className="hint">Type it from the statement. Blank uses the imported lines.</span></div>
        </div>
        <div className="table-wrap"><table className="t">
          <tbody>
            <tr className="sub"><td>Balance per books {shortDate(date)}</td><td className="num"><Money c={st.bookBalance} /></td></tr>
            <tr className="section"><td colSpan={2}>Less: in the books, not yet at the bank ({st.bookOnly.length})</td></tr>
            {st.bookOnly.map((x) => <tr key={x.lineId} className="indent"><td>{shortDate(x.date)} · <Link to={`/books/transactions/${x.txnId}`}>{x.ref}</Link> · {x.description}</td><td className="num"><Money c={-x.amount} /></td></tr>)}
            <tr className="sub"><td>Total outstanding</td><td className="num"><Money c={-sum(st.bookOnly)} /></td></tr>
            <tr className="section"><td colSpan={2}>Add: at the bank, not yet in the books ({st.bankOnly.length})</td></tr>
            {st.bankOnly.map((x) => <tr key={x.bankLineId} className="indent"><td>{shortDate(x.date)} · {x.description}</td><td className="num"><Money c={x.amount} /></td></tr>)}
            <tr className="sub"><td>Total bank-only</td><td className="num"><Money c={sum(st.bankOnly)} /></td></tr>
            <tr className="total"><td>Statement balance should be</td><td className="num"><Money c={st.expectedStatement} /></td></tr>
            <tr><td>Statement balance {stmt.trim() ? 'entered' : 'per imported lines'}</td><td className="num">{stmtC === null ? <span className="neg">Not a number</span> : <Money c={stmtC} />}</td></tr>
          </tbody>
        </table></div>
        <TieOut items={[
          { label: diff === 0 ? 'Difference $0.00 — fully explained' : `Unexplained difference ${diff === null ? '' : formatMoney(diff, { dollarSign: true })}`, ok: diff === 0, detail: diff !== 0 ? 'Import missing lines, match or book bank-only items, or check the balance you typed.' : undefined },
          ...(st.feedBalance !== null && stmtC !== null && stmt.trim() ? [{ label: st.feedBalance === stmtC ? 'Imported lines tie to the statement' : 'Imported lines differ from the statement', ok: st.feedBalance === stmtC, detail: st.feedBalance !== stmtC ? `${formatMoney(stmtC - st.feedBalance, { dollarSign: true })} of bank activity isn't imported` : undefined }] : []),
        ]} />
        {can(user, 'bank.reconcile') && (
          <div className="panel-pad actions">
            <button className="btn primary" disabled={diff !== 0 || stmtC === null || (!!thru && date <= thru)} onClick={() => { try { saveReconciliation(books, user, accountId, date, stmtC!); say(`Reconciled through ${shortDate(date)}.`); } catch (e) { say(errText(e)); } }}>Mark reconciled through {shortDate(date)}</button>
            {thru && date <= thru && <span className="muted small">Already reconciled through {shortDate(thru)}. Pick a later date.</span>}
          </div>
        )}
      </section>
      <section className="panel" aria-labelledby="rh-h">
        <div className="panel-head"><h2 id="rh-h">History</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Through</th><th scope="col" className="num">Statement</th><th scope="col" className="num">Books</th><th scope="col" className="num">Outstanding</th><th scope="col" className="num">Bank-only</th><th scope="col">By</th><th scope="col"><span className="sr-only">Undo</span></th></tr></thead>
          <tbody>{recs.length === 0 ? <tr><Empty colSpan={7}>No reconciliations yet. The first one starts the trail.</Empty></tr> : recs.map((r, i) => (
            <tr key={r.id}><td>{shortDate(r.statementDate)}</td><td className="num"><Money c={r.statementBalance} /></td><td className="num"><Money c={r.bookBalance} /></td><td className="num"><Money c={-r.bookOnly} /></td><td className="num"><Money c={r.bankOnly} /></td><td>{userName(r.by)} · {shortDate(r.at.slice(0, 10))}</td>
              <td>{i === 0 && can(user, 'period.unlock') && (undoing === r.id
                ? <span className="actions"><label className="sr-only" htmlFor="undo-r">Reason</label><input id="undo-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" style={{ width: 180 }} /><button className="btn sm danger" disabled={!reason.trim()} onClick={() => { try { undoReconciliation(books, user, r.id, reason); setUndoing(null); say('Reconciliation undone.'); } catch (e) { say(errText(e)); } }}>Undo</button></span>
                : <button className="btn sm ghost" onClick={() => { setUndoing(r.id); setReason(''); }}>Undo…</button>)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      {toast}
    </div>
  );
}

function LinesTab({ accountId }: { accountId: ID }) {
  const { state, books, user } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const months = [...new Set(state.bank.lines.filter((b) => b.accountId === accountId).map((b) => b.date.slice(0, 7)))].sort().reverse();
  const [month, setMonth] = useState(months[0] ?? '');
  const idx = matchIndex(state);
  const refOf = new Map<ID, { ref: string; id: ID }>();
  for (const t of state.transactions) for (const l of t.lines) refOf.set(l.id, { ref: t.ref, id: t.id });
  const rows = state.bank.lines.filter((b) => b.accountId === accountId && b.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const thru = reconciledThrough(state, accountId);
  return (
    <section className="panel" aria-label="All bank lines">
      <div className="filters">
        <div className="field"><label htmlFor="bl-m">Month</label><select id="bl-m" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
        {can(user, 'export') && <div className="actions" style={{ marginLeft: 'auto' }}><button className="btn sm" onClick={() => exportCsv(`bank-lines-${month}`, ['Date', 'Description', 'Amount', 'Check', 'Source', 'Status', 'Matched to'], rows.map((b) => [b.date, b.description, csvMoney(b.amount), b.checkNo ?? '', b.source ? DEPOSIT_SOURCE_LABEL[b.source] : '', b.excluded ? 'Excluded' : isMatched(b, idx) ? 'Matched' : 'Unmatched', b.matchedLineIds.map((id) => refOf.get(id)?.ref).filter(Boolean).join(' ')]))}>Export CSV</button></div>}
      </div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Matched to</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
        <tbody>{rows.map((b) => {
          const m = isMatched(b, idx);
          const locked = !!thru && b.date <= thru;
          return (
            <tr key={b.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{shortDate(b.date)}</td>
              <td className="trunc" title={b.description}>{b.description}{b.source && <span className="muted small"> · {DEPOSIT_SOURCE_LABEL[b.source]}</span>}</td>
              <td className="num"><Money c={b.amount} /></td>
              <td>{b.excluded ? <span className="pill" title={b.excluded.reason}>Excluded</span> : m ? <span className="pill ok">Matched</span> : <span className="pill warn">Unmatched</span>}{locked && <span className="pill" style={{ marginLeft: 4 }}>Reconciled</span>}</td>
              <td>{b.matchedLineIds.map((id) => refOf.get(id)).filter(Boolean).map((r) => <Link key={r!.id} to={`/books/transactions/${r!.id}`} style={{ marginRight: 6 }}>{r!.ref}</Link>)}</td>
              <td>{can(user, 'bank.reconcile') && !locked && (m ? <button className="btn sm ghost" onClick={() => { try { unmatchBankLine(books, user, b.id); say('Unmatched.'); } catch (e) { say(errText(e)); } }}>Unmatch</button>
                : b.excluded ? <button className="btn sm ghost" onClick={() => { excludeBankLine(books, user, b.id, null); say('Included again.'); }}>Include</button> : null)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <div className="tieout"><span>{rows.length} lines · in <b><Money c={rows.filter((r) => r.amount > 0 && !r.excluded).reduce((a, r) => a + r.amount, 0)} /></b> · out <b><Money c={-rows.filter((r) => r.amount < 0 && !r.excluded).reduce((a, r) => a + r.amount, 0)} /></b></span></div>
      {toast}
    </section>
  );
}

function ImportTab({ accountId }: { accountId: ID }) {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const [file, setFile] = useState<{ name: string; parsed: ParsedFile } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const preview: ImportPreview | null = useMemo(() => (file ? previewImport(state, accountId, file.parsed.lines) : null), [file, state, accountId]);
  const batches = state.bank.batches.filter((b) => b.accountId === accountId).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const userName = (id: string) => state.users.find((u) => u.id === id)?.name ?? id;
  const read = async (f: File | undefined) => {
    setErrors([]);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErrors(['That file is over 10 MB. Download a shorter date range from the bank.']); return; }
    if (/\.pdf$/i.test(f.name)) { setErrors(['PDF statements can\'t be read yet. Download the CSV, OFX or QFX version from Trustmark online banking (Account activity › Download).']); return; }
    const parsed = parseBankFile(f.name, await f.text());
    if (!parsed.lines.length) { setErrors(parsed.problems.length ? parsed.problems : ['No transactions found in that file.']); return; }
    setFile({ name: f.name, parsed });
  };
  return (
    <div className="stack">
      <section className="panel panel-pad" aria-labelledby="imp-h">
        <h2 id="imp-h" style={{ marginBottom: 8 }}>Import a statement</h2>
        <p className="muted">CSV, OFX or QFX from the bank. Importing the same file twice never duplicates a line.</p>
        {can(user, 'bank.import') ? (
          <label className="btn" style={{ margin: '8px 0' }}>Choose file<input type="file" accept=".csv,.ofx,.qfx,.txt,.pdf" className="sr-only" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} /></label>
        ) : <p className="muted">Your role can't import statements.</p>}
        <Errors errors={errors} />
      </section>
      {file && preview && (
        <section className="panel" aria-labelledby="pv-h">
          <div className="panel-head"><h2 id="pv-h">Preview: {file.name}</h2><span className="muted small">{shortDate(preview.from)} – {shortDate(preview.to)}</span></div>
          {file.parsed.problems.length > 0 && <div className="panel-pad"><div className="note warn"><b>{file.parsed.problems.length} row(s) skipped.</b><ul>{file.parsed.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul></div></div>}
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="num">Amount</th><th scope="col">Status</th></tr></thead>
            <tbody>{preview.rows.slice(0, 60).map((r) => (
              <tr key={r.hash}><td>{shortDate(r.date)}</td><td className="trunc" title={r.description}>{r.description}</td><td className="num"><Money c={r.amount} /></td><td>{r.duplicate ? <span className="pill">Already imported</span> : <span className="pill ok">New</span>}</td></tr>
            ))}{preview.rows.length > 60 && <tr><td colSpan={4} className="muted">…and {preview.rows.length - 60} more.</td></tr>}</tbody>
          </table></div>
          <TieOut items={[
            { label: `${preview.added} new, ${preview.skipped} already imported`, ok: true, detail: <>in <Money c={preview.totalIn} dollar /> · out <Money c={preview.totalOut} dollar /></> },
            ...(preview.runningBalanceTies === null ? [] : [{ label: preview.runningBalanceTies ? 'Running balance ties line by line' : 'Running balance breaks', ok: preview.runningBalanceTies, detail: preview.runningBalanceBreaks[0] }]),
            ...(file.parsed.statementBalance !== undefined ? [{ label: 'Statement balance in file', ok: true, detail: <Money c={file.parsed.statementBalance} dollar /> }] : []),
          ]} />
          <div className="panel-pad actions">
            <button className="btn primary" disabled={!preview.added} onClick={() => { try { const r = commitImport(books, user, accountId, { name: file.name, format: file.parsed.format, lines: file.parsed.lines, statementBalance: file.parsed.statementBalance }); setFile(null); say(`Imported ${r.batch.added} lines; auto-matched ${r.matched}.`); } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); } }}>Import {preview.added} new line{preview.added === 1 ? '' : 's'}</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </section>
      )}
      <section className="panel" aria-labelledby="ih-h">
        <div className="panel-head"><h2 id="ih-h">Import history</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">File</th><th scope="col">Dates</th><th scope="col" className="num">Lines</th><th scope="col" className="num">Skipped</th><th scope="col" className="num">In</th><th scope="col" className="num">Out</th><th scope="col">By</th></tr></thead>
          <tbody>{batches.map((b) => (
            <tr key={b.id}><td>{b.fileName}<div className="muted small">batch {b.id}</div></td><td>{b.from && `${shortDate(b.from)} – ${shortDate(b.to)}`}</td><td className="num">{b.added}</td><td className="num">{b.skipped}</td><td className="num"><Money c={b.totalIn} /></td><td className="num"><Money c={b.totalOut} /></td><td>{userName(b.by)} · {shortDate(b.importedAt.slice(0, 10))}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      {toast}
    </div>
  );
}

const CHECK_LABEL: Record<CheckStatus, string> = { outstanding: 'Outstanding', cleared: 'Cleared', stale: 'Stale', void: 'Void', not_in_books: 'Cleared, not in books' };

export function ChecksPage() {
  const { state, books, user, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const exportCsv = useExport();
  const status = sp.get('status') ?? '';
  const today = todayInChicago();
  const all = useMemo(() => checksRegister(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = all.filter((c) => !status || c.status === status);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const count = (s: CheckStatus) => all.filter((c) => c.status === s).length;
  const outstandingTotal = all.filter((c) => c.status === 'outstanding' || c.status === 'stale').reduce((a, c) => a + c.amount, 0);
  return (
    <>
      <PageHead eyebrow="Bank & cash" title="Checks register" lede={`Every check written from the bank, and whether it has cleared. Checks uncleared after ${state.settings.staleCheckDays} days are stale.`}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('checks-register', ['Check', 'Date', 'Payee', 'Amount', 'Status', 'Cleared'], rows.map((c) => [c.checkNo, c.date, c.payee, csvMoney(c.amount), CHECK_LABEL[c.status], c.clearedOn ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" style={{ marginBottom: 20 }} aria-label="Summary">
        <Figure label="Outstanding" value={count('outstanding') + count('stale')} note={<>Totals <Money c={outstandingTotal} dollar /></>} />
        <Figure label="Stale" value={count('stale')} note={`Older than ${state.settings.staleCheckDays} days`} />
        <Figure label="Cleared" value={count('cleared')} />
        <Figure label="Not in books" value={count('not_in_books')} note="Cleared at the bank with no entry" />
      </section>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="ck-s">Status</label><select id="ck-s" value={status} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.value) n.set('status', e.target.value); else n.delete('status'); setSp(n, { replace: true }); }}>
            <option value="">All</option>{(Object.keys(CHECK_LABEL) as CheckStatus[]).map((s) => <option key={s} value={s}>{CHECK_LABEL[s]}</option>)}</select></div>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Check</th><th scope="col">Written</th><th scope="col">Payee</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Cleared</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.checkNo + c.date}>
              <td>{c.txnId ? <Link to={`/books/transactions/${c.txnId}`}>#{c.checkNo}</Link> : `#${c.checkNo}`}{c.hasImage && <span title="Image attached" aria-label="image attached"> 📎</span>}</td>
              <td>{shortDate(c.date)}</td><td className="trunc" title={c.payee}>{c.payee}</td><td className="num"><Money c={c.amount} /></td>
              <td><span className={'pill ' + (c.status === 'cleared' ? 'ok' : c.status === 'stale' || c.status === 'not_in_books' ? 'bad' : c.status === 'outstanding' ? 'warn' : '')}>{CHECK_LABEL[c.status]}</span>{(c.status === 'outstanding' || c.status === 'stale') && <span className="muted small"> · {c.ageDays} days</span>}</td>
              <td>{c.clearedOn ? shortDate(c.clearedOn) : ''}</td>
              <td>{(c.status === 'outstanding' || c.status === 'stale') && c.txnId && can(user, 'txn.delete') && (voiding === c.txnId
                ? <span className="actions"><label className="sr-only" htmlFor="void-r">Reason</label><input id="void-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why void?" style={{ width: 160 }} /><button className="btn sm danger" onClick={() => { try { voidCheck(books, user, c.txnId!, reason); setVoiding(null); say(`Check #${c.checkNo} voided.`); } catch (e) { say(errText(e)); } }}>Void</button></span>
                : <button className="btn sm ghost" onClick={() => { setVoiding(c.txnId!); setReason(''); }}>Void…</button>)}
                {c.status === 'not_in_books' && <Link className="btn sm" to="/bank?tab=match">Book it</Link>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="tieout"><span>{rows.length} checks · <Money c={rows.reduce((a, c) => a + c.amount, 0)} dollar /></span></div>
      </section>
      {toast}
      <Help k="checks" />
    </>
  );
}

export function DepositsPage() {
  const { state, books, user } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const show = sp.get('show') ?? '';
  const months = [...new Set(state.bank.lines.filter((b) => b.amount > 0).map((b) => b.date.slice(0, 7)))].sort().reverse();
  const month = sp.get('month') ?? (show === 'unclassified' ? '' : months[0] ?? '');
  const deps = state.bank.lines.filter((b) => b.amount > 0 && !b.excluded && (!month || b.date.startsWith(month)) && (show !== 'unclassified' || !b.source)).sort((a, b) => b.date.localeCompare(a.date));
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const bySource = new Map<string, number>();
  for (const b of deps) bySource.set(b.source ?? 'unclassified', (bySource.get(b.source ?? 'unclassified') ?? 0) + b.amount);
  const total = deps.reduce((a, b) => a + b.amount, 0);
  const canEdit = can(user, 'bank.reconcile');
  return (
    <>
      <PageHead eyebrow="Bank & cash" title="Deposits" lede="Every deposit gets a source, so you always know what came in from where. Unclassified deposits sit in the inbox." />
      <div className="grid-2 wide-left">
        <section className="panel">
          <div className="filters">
            <div className="field"><label htmlFor="dp-m">Month</label><select id="dp-m" value={month} onChange={(e) => set('month', e.target.value)}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
            <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={show === 'unclassified'} onChange={(e) => set('show', e.target.checked ? 'unclassified' : '')} /> Only unclassified</label>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="num">Amount</th><th scope="col">Source</th></tr></thead>
            <tbody>{deps.length === 0 ? <tr><Empty colSpan={4}>No deposits here. Quiet lane.</Empty></tr> : deps.map((b) => (
              <tr key={b.id}><td style={{ whiteSpace: 'nowrap' }}>{shortDate(b.date)}</td><td className="trunc" title={b.description}>{b.description}</td><td className="num"><Money c={b.amount} /></td>
                <td style={{ minWidth: 200 }}>{canEdit ? <><label className="sr-only" htmlFor={'src' + b.id}>Source for {b.description}</label><select id={'src' + b.id} value={b.source ?? ''} onChange={(e) => { setDepositSource(books, user, b.id, (e.target.value || undefined) as DepositSource | undefined); say('Saved.'); }}><option value="">Unclassified</option>{SOURCES.map((s) => <option key={s} value={s}>{DEPOSIT_SOURCE_LABEL[s]}</option>)}</select></> : (b.source ? DEPOSIT_SOURCE_LABEL[b.source] : 'Unclassified')}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="by-src">
          <div className="panel-head"><h2 id="by-src">By source</h2><span className="muted small">{month ? periodLabel(month) : 'All months'}</span></div>
          <table className="t"><tbody>
            {[...bySource].sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td className={k === 'unclassified' ? 'neg' : undefined}>{k === 'unclassified' ? 'Unclassified' : DEPOSIT_SOURCE_LABEL[k as DepositSource]}</td><td className="num"><Money c={v} /></td></tr>)}
            <tr className="total"><td>Total deposits</td><td className="num"><Money c={total} /></td></tr>
          </tbody></table>
          <TieOut items={[{ label: [...bySource.values()].reduce((a, b) => a + b, 0) === total ? 'Sources add to total deposits' : 'Sources do not add up', ok: [...bySource.values()].reduce((a, b) => a + b, 0) === total }]} />
        </section>
      </div>
      {toast}
      <Help k="deposits" />
    </>
  );
}
