import { useMemo, useRef, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Empty, Help, Money, PageHead, csvMoney, useExport, useIsPhone, useToast } from '../components/ui';
import { txnTotal, findDuplicates } from '../../core/duplicates';
import { matchIndex } from '../../core/bank';
import { parseMoney, formatMoney } from '../../core/money';
import { shortDate, periodOf } from '../../core/dates';
import { categoryLabel, categoryLines, signedAmount, storeLabel } from '../txnview';
import { suggest } from '../../core/rules';
import { uncategorized } from '../../core/reports';
import { can } from '../../core/permissions';
import { DOC_THRESHOLD, DOC_WINDOW_DAYS, needsDocument } from '../inbox';
import type { Transaction } from '../../core/types';

const ROW = 46;
const COLS = '34px 104px 96px minmax(180px, 2.4fr) minmax(120px, 1.4fr) 100px 120px 40px';

export function Transactions() {
  const [sp, setSp] = useSearchParams();
  const queue = sp.get('queue') ?? '';
  const title = queue === 'uncat' ? 'Uncategorized' : queue === 'dup' ? 'Possible duplicates' : queue === 'nodoc' ? 'Missing documents' : 'Transactions';
  return (
    <>
      <PageHead eyebrow="Books" title={title} lede={queue === 'uncat' ? 'Bank lines that still need a category. Accept a suggestion or choose one; the rule learns from you.' : queue === 'dup' ? 'Same amount and payee within three days. Delete the extra one or mark the pair as fine.' : queue === 'nodoc' ? `Payments of ${formatMoney(DOC_THRESHOLD, { dollarSign: true, whole: true })} or more in the last ${DOC_WINDOW_DAYS} days with no invoice or notice attached. Payroll is excluded until the Gusto import ships.` : undefined}>
        <Link className="btn primary" to="/books/new">New entry</Link>
      </PageHead>
      <div className="seg" role="group" aria-label="Queue" style={{ marginBottom: 16 }}>
        {[['', 'All'], ['uncat', 'Uncategorized'], ['dup', 'Duplicates'], ['nodoc', 'Missing documents']].map(([k, l]) => (
          <button key={k} aria-pressed={queue === k} onClick={() => { const n = new URLSearchParams(sp); if (k) n.set('queue', k); else n.delete('queue'); setSp(n); }}>{l}</button>
        ))}
      </div>
      {queue === 'uncat' ? <UncatQueue /> : queue === 'dup' ? <DupQueue /> : <TxnList />}
      <Help k="transactions" />
    </>
  );
}

function TxnList() {
  const { state, books, user, stores, visible } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const acc = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const q = sp.get('q') ?? '';
  const store = sp.get('store') ?? '';
  const account = sp.get('account') ?? '';
  const party = sp.get('party') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const showDeleted = sp.get('deleted') === '1';
  const queue = sp.get('queue') ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const amt = /\d/.test(needle) && /[.$,]/.test(needle) ? parseMoney(needle) : null;
    const fromD = from.length === 7 ? from + '-01' : from;
    const toD = to.length === 7 ? to + '-31' : to;
    const out: Transaction[] = [];
    for (let i = state.transactions.length - 1; i >= 0; i--) {
      const t = state.transactions[i];
      if (!!t.deleted !== showDeleted) continue;
      const users = t.lines.filter((l) => !l.system);
      if (!users.some((l) => visible.has(l.storeId))) continue;
      if (store && !users.some((l) => l.storeId === store)) continue;
      if (account && !t.lines.some((l) => l.accountId === account && (!store || l.storeId === store))) continue;
      if (party && t.partyId !== party && !t.lines.some((l) => l.partyId === party)) continue;
      if (fromD && t.date < fromD) continue;
      if (toD && t.date > toD) continue;
      if (queue === 'nodoc' && !needsDocument(t, state)) continue;
      if (needle) {
        if (amt !== null) {
          const a = Math.abs(amt);
          if (txnTotal(t) !== a && !t.lines.some((l) => l.debit === a || l.credit === a)) continue;
        } else {
          const pn = t.partyId ? state.parties.find((p) => p.id === t.partyId)?.name ?? '' : '';
          const hay = `${t.ref} ${t.description} ${t.memo ?? ''} ${t.checkNo ?? ''} ${t.docNo ?? ''} ${t.tags.join(' ')} ${pn}`.toLowerCase();
          if (!hay.includes(needle)) continue;
        }
      }
      out.push(t);
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref));
  }, [state, q, store, account, party, from, to, showDeleted, visible, queue]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [q, store, account, party, from, to, showDeleted, queue]);
  const [bulkAcct, setBulkAcct] = useState('');
  const [bulkStore, setBulkStore] = useState('');
  const total = rows.reduce((a, t) => a + signedAmount(t, acc), 0);

  const applyBulk = () => {
    let done = 0;
    let skipped = 0;
    for (const id of selected) {
      const t = books.getTransaction(id)!;
      const cat = categoryLines(t, acc);
      if (cat.length !== 1 || books.isLocked(periodOf(t.date))) { skipped++; continue; }
      try {
        books.categorizeLine(user, t.id, cat[0].id, bulkAcct || cat[0].accountId, bulkStore || cat[0].storeId, { learn: false });
        done++;
      } catch { skipped++; }
    }
    setSelected(new Set());
    say(`Updated ${done} transaction${done === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} (split, journal or locked month)` : ''}.`);
  };

  // simple windowing
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const height = Math.min(rows.length * ROW + ROW, 640);
  const first = Math.max(0, Math.floor(scroll / ROW) - 8);
  const last = Math.min(rows.length, first + Math.ceil(height / ROW) + 16);
  const canEdit = can(user, 'txn.edit');
  const phone = useIsPhone();
  const [shown, setShown] = useState(100);

  return (
    <section className="panel" aria-label="Transaction list">
      <div className="filters">
        <div className="field wide"><label htmlFor="f-q">Search</label><input id="f-q" type="search" value={q} placeholder="Description, TX-ref, check #, $ amount" onChange={(e) => set('q', e.target.value)} /></div>
        <div className="field"><label htmlFor="f-store">Store</label>
          <select id="f-store" value={store} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
        <div className="field wide"><label htmlFor="f-acct">Account</label>
          <select id="f-acct" value={account} onChange={(e) => set('account', e.target.value)}><option value="">All accounts</option><AccountOptions /></select></div>
        <div className="field"><label htmlFor="f-from">From</label><input id="f-from" type="date" value={from.length === 7 ? from + '-01' : from} onChange={(e) => set('from', e.target.value)} /></div>
        <div className="field"><label htmlFor="f-to">To</label><input id="f-to" type="date" value={to.length === 7 ? to + '-' + new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 0)).getUTCDate() : to} onChange={(e) => set('to', e.target.value)} /></div>
        <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={showDeleted} onChange={(e) => set('deleted', e.target.checked ? '1' : '')} /> Show deleted</label>
        <div className="actions" style={{ marginLeft: 'auto' }}>
          {party && <button className="btn sm" onClick={() => set('party', '')}>Clear party: {state.parties.find((p) => p.id === party)?.name}</button>}
          {can(user, 'export') && <button className="btn sm" onClick={() => exportCsv('transactions', ['Date', 'Ref', 'Description', 'Category', 'Stores', 'Amount', 'Check', 'Doc', 'Attachments'], rows.map((t) => [t.date, t.ref, t.description, categoryLabel(t, acc), storeLabel(t, state), csvMoney(signedAmount(t, acc)), t.checkNo ?? '', t.docNo ?? '', t.attachments.length]))}>Export CSV</button>}
        </div>
      </div>
      {selected.size > 0 && canEdit && (
        <div className="filters" style={{ background: 'var(--panel-2)' }} aria-label="Bulk edit">
          <b style={{ alignSelf: 'center' }}>{selected.size} selected</b>
          <div className="field wide"><label htmlFor="b-acct">Move category to</label><select id="b-acct" value={bulkAcct} onChange={(e) => setBulkAcct(e.target.value)}><option value="">Keep category</option><AccountOptions /></select></div>
          <div className="field"><label htmlFor="b-store">Move to store</label><select id="b-store" value={bulkStore} onChange={(e) => setBulkStore(e.target.value)}><option value="">Keep store</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
          <button className="btn primary" disabled={!bulkAcct && !bulkStore} onClick={applyBulk}>Apply</button>
          <button className="btn ghost" onClick={() => setSelected(new Set())}>Cancel</button>
        </div>
      )}
      {phone ? (
        <>
          <ul className="cards" aria-label="Transactions">
            {rows.length === 0 && <li className="panel-pad muted">No transactions match these filters. Clear a filter or widen the dates.</li>}
            {rows.slice(0, shown).map((t) => (
              <li key={t.id}><Link to={`/books/transactions/${t.id}`}>
                <span className="c-desc">{t.description}</span>
                <span className="c-amt"><Money c={signedAmount(t, acc)} /></span>
                <span className="c-meta">{shortDate(t.date)} · {t.ref} · {storeLabel(t, state)} · {categoryLabel(t, acc)}{t.attachments.length ? ' · 📎' : ''}{t.deleted ? ' · deleted' : ''}</span>
              </Link></li>
            ))}
          </ul>
          {rows.length > shown && <div className="panel-pad"><button className="btn" onClick={() => setShown(shown + 100)}>Show 100 more</button></div>}
        </>
      ) : (
      <div className="table-wrap"><div role="table" aria-label="Transactions" aria-rowcount={rows.length + 1} style={{ minWidth: 860 }}>
        <div role="rowgroup">
          <div role="row" className="vrow vhead" style={{ gridTemplateColumns: COLS, height: ROW }}>
            <span role="columnheader">{canEdit && <input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />}</span>
            <span role="columnheader">Date</span><span role="columnheader">Ref</span><span role="columnheader">Description</span><span role="columnheader">Category</span><span role="columnheader">Store</span><span role="columnheader" className="num">Amount</span><span role="columnheader"><span className="sr-only">Documents</span></span>
          </div>
        </div>
        <div role="rowgroup" ref={box} className="vlist" style={{ height: Math.max(height - ROW, ROW) }} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} tabIndex={0} aria-label="Transaction rows, scrollable">
          {rows.length === 0 && <div role="row" className="vrow" style={{ height: ROW, gridTemplateColumns: '1fr' }}><span role="cell" className="muted">No transactions match these filters. Clear a filter or widen the dates.</span></div>}
          <div style={{ height: rows.length * ROW, position: 'relative' }}>
            {rows.slice(first, last).map((t, i) => {
              const amt = signedAmount(t, acc);
              const cat = categoryLabel(t, acc);
              return (
                <div role="row" aria-rowindex={first + i + 2} key={t.id} className="vrow" style={{ gridTemplateColumns: COLS, height: ROW, position: 'absolute', top: (first + i) * ROW, left: 0, right: 0 }}>
                  <span role="cell">{canEdit && <input type="checkbox" aria-label={`Select ${t.ref}`} checked={selected.has(t.id)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(t.id); else n.delete(t.id); setSelected(n); }} />}</span>
                  <span role="cell">{shortDate(t.date)}</span>
                  <span role="cell"><Link to={`/books/transactions/${t.id}`}>{t.ref}</Link></span>
                  <span role="cell" title={t.description}><Link to={`/books/transactions/${t.id}`}>{t.description}</Link>{t.deleted && <span className="pill bad"> deleted</span>}</span>
                  <span role="cell" title={cat} className={cat.startsWith('Uncategorized') ? 'neg' : undefined}>{cat}</span>
                  <span role="cell">{storeLabel(t, state)}</span>
                  <span role="cell" className="num"><Money c={amt} /></span>
                  <span role="cell" title={t.attachments.length ? `${t.attachments.length} document(s)` : 'No document'}>{t.attachments.length ? <span aria-label={`${t.attachments.length} documents`}>📎</span> : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div></div>
      )}
      <div className="tieout">
        <span><b>{rows.length.toLocaleString('en-US')}</b> transactions</span>
        <span>Net of bank side <b><Money c={total} /></b></span>
        <span className="muted">Positive is money in, (parentheses) money out.</span>
      </div>
      {toast}
    </section>
  );
}

function UncatQueue() {
  const { state, books, user, lines, stores } = useBooks();
  const [toast, say] = useToast();
  const items = useMemo(() => uncategorized(state, lines).sort((a, b) => b.date.localeCompare(a.date)), [state, lines]);
  const [choice, setChoice] = useState<Record<string, { acct: string; store: string }>>({});
  const canEdit = can(user, 'txn.edit');
  if (!items.length) return <div className="note"><Empty>All pumps clear: nothing to categorize. New bank lines that no rule recognises will land here.</Empty></div>;
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="num">Amount</th><th scope="col">Suggestion</th><th scope="col">Category</th><th scope="col">Store</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>
            {items.map((f) => {
              const m = suggest(state, f.t.description);
              const isIncome = f.l.credit > 0;
              const c = choice[f.l.id] ?? { acct: m?.rule.accountId ?? '', store: m?.rule.storeId ?? f.l.storeId };
              const setC = (patch: Partial<typeof c>) => setChoice({ ...choice, [f.l.id]: { ...c, ...patch } });
              const locked = books.isLocked(periodOf(f.date));
              return (
                <tr key={f.l.id}>
                  <td className="num" style={{ textAlign: 'left' }}>{shortDate(f.date)}</td>
                  <td><Link to={`/books/transactions/${f.t.id}`}>{f.t.description}</Link></td>
                  <td className="num"><Money c={isIncome ? f.l.credit : -f.l.debit} /></td>
                  <td>{m ? <span>{state.accounts.find((a) => a.id === m.rule.accountId)?.name} · {state.stores.find((s) => s.id === m.rule.storeId)?.code} <span className={'pill ' + (m.confidence >= 0.75 ? 'ok' : 'warn')} title={`Rule "${m.rule.contains}": ${m.rule.hits} accepted, ${m.rule.overrides} changed`}>{Math.round(m.confidence * 100)}%</span></span> : <span className="muted">No rule yet</span>}</td>
                  <td style={{ minWidth: 200 }}><label className="sr-only" htmlFor={'ua' + f.l.id}>Category for {f.t.description}</label>
                    <select id={'ua' + f.l.id} value={c.acct} onChange={(e) => setC({ acct: e.target.value })}><option value="">Choose…</option><AccountOptions filter={(a) => a.subtype !== 'uncategorized'} /></select></td>
                  <td style={{ minWidth: 110 }}><label className="sr-only" htmlFor={'us' + f.l.id}>Store for {f.t.description}</label>
                    <select id={'us' + f.l.id} value={c.store} onChange={(e) => setC({ store: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></td>
                  <td>{canEdit && <button className="btn sm primary" disabled={!c.acct || locked} title={locked ? 'Month is locked' : undefined} onClick={() => {
                    try { books.categorizeLine(user, f.t.id, f.l.id, c.acct, c.store); say(`${f.t.ref} categorized. Rule updated.`); } catch (e) { say((e as Error).message); }
                  }}>{m && c.acct === m.rule.accountId && c.store === m.rule.storeId ? 'Accept' : 'Save'}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {toast}
    </section>
  );
}

function DupQueue() {
  const { state, books, user, visible } = useBooks();
  const [toast, say] = useToast();
  const acc = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const pairs = useMemo(() => findDuplicates(state.transactions.filter((t) => t.lines.some((l) => visible.has(l.storeId))), new Set(state.dismissedDuplicates), 3, matchIndex(state)), [state.transactions, state.dismissedDuplicates, visible]);
  if (!pairs.length) return <div className="note">No possible duplicates. Anything with the same amount and payee within three days will show here.</div>;
  return (
    <div className="stack">
      {pairs.map(({ a, b, days }) => (
        <section className="panel" key={a.id + b.id} aria-label={`Possible duplicate ${a.ref} and ${b.ref}`}>
          <div className="panel-head"><h2>{formatMoney(txnTotal(a), { dollarSign: true })} · {days === 0 ? 'same day' : `${days} day${days === 1 ? '' : 's'} apart`}</h2>
            {can(user, 'txn.edit') && <button className="btn sm" onClick={() => { books.dismissDuplicate(user, a.id, b.id); say('Marked as not a duplicate.'); }}>Not a duplicate</button>}</div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Ref</th><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Category</th><th scope="col">Store</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{[a, b].map((t) => (
              <tr key={t.id}><td><Link to={`/books/transactions/${t.id}`}>{t.ref}</Link></td><td>{shortDate(t.date)}</td><td>{t.description}</td><td>{categoryLabel(t, acc)}</td><td>{storeLabel(t, state)}</td>
                <td>{can(user, 'txn.delete') && <button className="btn sm danger" onClick={() => { try { books.deleteTransaction(user, t.id, `Duplicate of ${(t === a ? b : a).ref}`); say(`${t.ref} deleted. Restore it from "Show deleted" if needed.`); } catch (e) { say((e as Error).message); } }}>Delete this one</button>}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
      {toast}
    </div>
  );
}
