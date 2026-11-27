import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Errors, Help, Money, PageHead, PartyOptions } from '../components/ui';
import { allocate, formatMoney, parseMoney } from '../../core/money';
import { todayInChicago } from '../../core/dates';
import { validateDraft, type DraftLine, type TxnDraft } from '../../core/ledger';
import { ValidationError } from '../../core/books';
import { suggest } from '../../core/rules';
import { can } from '../../core/permissions';
import { createJournal } from '../../core/journals';
import type { Transaction, ID } from '../../core/types';

type Mode = 'money_out' | 'money_in' | 'transfer' | 'journal';
const BS = new Set(['asset', 'liability', 'equity']);
interface CatRow { key: number; accountId: ID; storeId: ID; amount: string; memo: string; }
interface JRow { key: number; accountId: ID; storeId: ID; debit: string; credit: string; memo: string; partyId: ID; }

const MONEY = new Set(['bank', 'cash', 'clearing']);
let K = 1;

function fromTxn(t: Transaction | undefined, moneyIds: Set<string>) {
  if (!t) return null;
  const user = t.lines.filter((l) => !l.system);
  const money = user.filter((l) => moneyIds.has(l.accountId));
  const simple = (t.kind === 'money_out' || t.kind === 'money_in' || t.kind === 'transfer') && money.length === 1 && user.length >= 2 && user.filter((l) => !moneyIds.has(l.accountId)).every((l) => (t.kind === 'money_in' ? l.credit > 0 : l.debit > 0));
  return { simple, money: money[0], cats: user.filter((l) => l !== money[0]), user };
}

export function TransactionForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { state, books, user, stores } = useBooks();
  const nav = useNavigate();
  const editing = id ? books.getTransaction(id) : undefined;
  const moneyIds = useMemo(() => new Set(state.accounts.filter((a) => MONEY.has(a.subtype)).map((a) => a.id)), [state.accounts]);
  const parsed = fromTxn(editing, moneyIds);
  const corp = stores.find((s) => s.kind === 'corporate')?.id ?? stores[0]?.id ?? '';
  const defStore = stores.find((s) => s.kind === 'operating')?.id ?? corp;

  const initialMode: Mode = editing ? (parsed?.simple ? (editing.kind as Mode) : 'journal') : ((sp.get('kind') as Mode) || 'money_out');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [date, setDate] = useState(editing?.date ?? todayInChicago());
  const [description, setDescription] = useState(editing?.description ?? '');
  const [partyId, setPartyId] = useState(editing?.partyId ?? '');
  const [checkNo, setCheckNo] = useState(editing?.checkNo ?? '');
  const [docNo, setDocNo] = useState(editing?.docNo ?? '');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [tags, setTags] = useState(editing?.tags.join(', ') ?? '');
  const [moneyAcct, setMoneyAcct] = useState(parsed?.simple ? parsed.money.accountId : (can(user, 'view.all_stores') ? 'acct_trustmark' : 'acct_cash_registers'));
  const [moneyStore, setMoneyStore] = useState(parsed?.simple ? parsed.money.storeId : can(user, 'view.all_stores') ? corp : defStore);
  const [cats, setCats] = useState<CatRow[]>(() => parsed?.simple
    ? parsed.cats.map((l) => ({ key: K++, accountId: l.accountId, storeId: l.storeId, amount: ((l.debit || l.credit) / 100).toFixed(2), memo: l.memo ?? '' }))
    : [{ key: K++, accountId: '', storeId: defStore, amount: '', memo: '' }]);
  const [jrows, setJrows] = useState<JRow[]>(() => parsed && !parsed.simple
    ? parsed.user.map((l) => ({ key: K++, accountId: l.accountId, storeId: l.storeId, debit: l.debit ? (l.debit / 100).toFixed(2) : '', credit: l.credit ? (l.credit / 100).toFixed(2) : '', memo: l.memo ?? '', partyId: l.partyId ?? '' }))
    : [{ key: K++, accountId: '', storeId: defStore, debit: '', credit: '', memo: '', partyId: '' }, { key: K++, accountId: '', storeId: defStore, debit: '', credit: '', memo: '', partyId: '' }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [split, setSplit] = useState<{ open: boolean; accountId: ID; total: string; pct: Record<ID, string> }>({ open: false, accountId: '', total: '', pct: {} });

  const cents = (s: string) => (s.trim() ? parseMoney(s) : 0);

  const draft: TxnDraft = useMemo(() => {
    const base = { date, kind: mode, description, memo, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), partyId, checkNo, docNo } as TxnDraft;
    if (mode === 'journal') {
      return { ...base, lines: jrows.filter((r) => r.accountId || r.debit || r.credit).map<DraftLine>((r) => ({ id: undefined, accountId: r.accountId, storeId: r.storeId, debit: cents(r.debit) ?? NaN, credit: cents(r.credit) ?? NaN, memo: r.memo, partyId: r.partyId || undefined })) };
    }
    const out = mode === 'money_out' || mode === 'transfer';
    const lines: DraftLine[] = [];
    let total = 0;
    for (const r of cats) {
      if (!r.accountId && !r.amount) continue;
      const v = cents(r.amount);
      if (v === null) { lines.push({ accountId: r.accountId, storeId: r.storeId, debit: NaN, credit: 0 }); continue; }
      total += v;
      const pos = v >= 0;
      lines.push({ accountId: r.accountId, storeId: r.storeId, debit: out === pos ? Math.abs(v) : 0, credit: out === pos ? 0 : Math.abs(v), memo: r.memo, partyId: partyId || undefined });
    }
    lines.unshift({ accountId: moneyAcct, storeId: moneyStore, debit: out ? (total < 0 ? -total : 0) : Math.max(total, 0), credit: out ? Math.max(total, 0) : (total < 0 ? -total : 0) });
    return { ...base, lines };
  }, [mode, date, description, memo, tags, partyId, checkNo, docNo, jrows, cats, moneyAcct, moneyStore]);

  const dr = draft.lines.reduce((a, l) => a + (Number.isFinite(l.debit) ? l.debit : 0), 0);
  const crT = draft.lines.reduce((a, l) => a + (Number.isFinite(l.credit) ? l.credit : 0), 0);
  const ruleHint = !editing && description.length > 3 ? suggest(state, description) : null;

  const save = () => {
    const errs = validateDraft(state, draft);
    if (cats.some((r) => r.amount && cents(r.amount) === null) || jrows.some((r) => (r.debit && cents(r.debit) === null) || (r.credit && cents(r.credit) === null))) errs.unshift('One of the amounts is not a number. Use digits like 1,284.36.');
    if (errs.length) { setErrors([...new Set(errs)]); return; }
    try {
      // Phase 10: new journal entries go through the JE suite (memo required, approval over the limit).
      if (!editing && mode === 'journal') {
        const je = createJournal(books, user, { date: draft.date, description: draft.description, memo: draft.memo ?? '', partyId: draft.partyId, lines: draft.lines });
        nav(`/books/journals/${je.id}`);
        return;
      }
      const t = editing ? books.updateTransaction(user, editing.id, draft, 'Edited in form') : books.createTransaction(user, draft);
      nav(`/books/transactions/${t.id}`);
    } catch (e) {
      setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]);
    }
  };

  const onParty = (v: string) => {
    setPartyId(v);
    const p = state.parties.find((x) => x.id === v);
    if (p?.type === 'owner' && mode !== 'journal' && cats.length === 1 && !cats[0].accountId) {
      const acct = state.settings.ownerWithdrawalPolicy === 'draw' ? 'acct_owner_draws' : state.settings.ownerWithdrawalExpenseAccountId ?? 'acct_misc';
      setCats([{ ...cats[0], accountId: acct, storeId: corp, memo: 'Owner withdrawal' }]);
      return;
    }
    if (p?.defaultAccountId && mode !== 'journal' && cats.length === 1 && !cats[0].accountId) {
      setCats([{ ...cats[0], accountId: p.defaultAccountId, storeId: p.defaultStoreId ?? cats[0].storeId }]);
    }
  };

  const applySplit = () => {
    const total = cents(split.total);
    const ids = stores.map((s) => s.id).filter((s) => Number(split.pct[s] || 0) > 0);
    if (!total || !split.accountId || !ids.length) { setErrors(['To split, choose an account, a total and at least one store percentage.']); return; }
    const parts = allocate(total, ids.map((s) => Number(split.pct[s])));
    const rows = ids.map((s, i) => ({ key: K++, accountId: split.accountId, storeId: s, amount: (parts[i] / 100).toFixed(2), memo: `${split.pct[s]}% split` }));
    setCats([...cats.filter((r) => r.accountId || r.amount), ...rows]);
    setSplit({ open: false, accountId: '', total: '', pct: {} });
    setErrors([]);
  };

  const pctSum = Object.values(split.pct).reduce((a, v) => a + (Number(v) || 0), 0);
  const kindLabel = mode === 'money_out' ? 'Money out' : mode === 'money_in' ? 'Money in' : mode === 'transfer' ? 'Transfer' : 'Journal entry';
  const catFilter = (a: { subtype: string; type: string; id: string }) => (mode === 'transfer' ? BS.has(a.type) && a.id !== moneyAcct : !MONEY.has(a.subtype));

  return (
    <>
      <PageHead eyebrow="Books" title={editing ? `Edit ${editing.ref}` : 'New entry'} lede={editing ? 'Changes are logged with the before and after.' : 'Every entry is double-entry underneath. Money out and in fill the bank side for you.'}>
        <Link className="btn" to={editing ? `/books/transactions/${editing.id}` : '/books/transactions'}>Cancel</Link>
      </PageHead>
      <div className="stack">
        {!editing && (
          <div className="seg" role="group" aria-label="Entry type">
            {(['money_out', 'money_in', 'transfer', 'journal'] as Mode[]).filter((m) => m !== 'journal' || can(user, 'journal.create')).map((m) => (
              <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'money_out' ? 'Money out' : m === 'money_in' ? 'Money in' : m === 'transfer' ? 'Transfer' : 'Journal entry'}</button>
            ))}
          </div>
        )}
        <Errors errors={errors} />
        <section className="panel panel-pad" aria-label={kindLabel}>
          <div className="form-grid">
            <div className="field"><label htmlFor="date">Date</label><input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="desc">Description</label><input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. ACH DEBIT ENTERGY MS HM11" /></div>
            <div className="field"><label htmlFor="party">{mode === 'money_in' ? 'Received from' : 'Payee / party'}</label><select id="party" value={partyId} onChange={(e) => onParty(e.target.value)}><option value="">None</option><PartyOptions /></select></div>
            <div className="field"><label htmlFor="check">Check #</label><input id="check" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} inputMode="numeric" /></div>
            <div className="field"><label htmlFor="doc">Invoice / doc #</label><input id="doc" value={docNo} onChange={(e) => setDocNo(e.target.value)} /></div>
          </div>
          {ruleHint && mode !== 'journal' && (
            <p className="small" style={{ marginTop: 10 }}>
              Rule “{ruleHint.rule.contains}” suggests <b>{state.accounts.find((a) => a.id === ruleHint.rule.accountId)?.name}</b> for <b>{state.stores.find((s) => s.id === ruleHint.rule.storeId)?.code}</b> ({Math.round(ruleHint.confidence * 100)}% confident).{' '}
              <button className="btn ghost sm" onClick={() => setCats([{ ...cats[0], accountId: ruleHint.rule.accountId, storeId: ruleHint.rule.storeId }, ...cats.slice(1)])}>Use it</button>
            </p>
          )}
        </section>

        {mode !== 'journal' ? (
          <section className="panel" aria-labelledby="cats-h">
            <div className="panel-head"><h2 id="cats-h">{mode === 'money_out' ? 'Paid from and what it was for' : mode === 'transfer' ? 'Moved from and to (never touches the P&L)' : 'Deposited to and where it came from'}</h2></div>
            <div className="panel-pad stack">
              <div className="form-grid">
                <div className="field"><label htmlFor="macct">{mode === 'money_out' ? 'Paid from' : mode === 'transfer' ? 'Moved from' : 'Deposited to'}</label>
                  <select id="macct" value={moneyAcct} onChange={(e) => setMoneyAcct(e.target.value)}><AccountOptions filter={(a) => (mode === 'transfer' ? BS.has(a.type) : MONEY.has(a.subtype))} /></select></div>
                <div className="field"><label htmlFor="mstore">Held by</label>
                  <select id="mstore" value={moneyStore} onChange={(e) => setMoneyStore(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>
                  <span className="hint">The shared Trustmark account belongs to Corporate.</span></div>
              </div>
              <div className="lines-grid">
                {cats.map((r, i) => (
                  <div className="line-row" key={r.key}>
                    <div className="field acct"><label htmlFor={'ca' + r.key}>{mode === 'transfer' ? `Moved to ${i + 1}` : `Category ${i + 1}`}</label><select id={'ca' + r.key} value={r.accountId} onChange={(e) => setCats(cats.map((x) => (x.key === r.key ? { ...x, accountId: e.target.value } : x)))}><option value="">Choose…</option><AccountOptions filter={catFilter} /></select></div>
                    <div className="field"><label htmlFor={'cs' + r.key}>Store</label><select id={'cs' + r.key} value={r.storeId} onChange={(e) => setCats(cats.map((x) => (x.key === r.key ? { ...x, storeId: e.target.value } : x)))}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
                    <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor={'cm' + r.key}>Amount</label><input id={'cm' + r.key} className="num" inputMode="decimal" value={r.amount} placeholder="0.00" onChange={(e) => setCats(cats.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))} /></div>
                    <div className="field memo"><label htmlFor={'cn' + r.key}>Line memo</label><input id={'cn' + r.key} value={r.memo} onChange={(e) => setCats(cats.map((x) => (x.key === r.key ? { ...x, memo: e.target.value } : x)))} /></div>
                    <button className="btn ghost rm" aria-label={`Remove category ${i + 1}`} disabled={cats.length === 1} onClick={() => setCats(cats.filter((x) => x.key !== r.key))}>✕</button>
                  </div>
                ))}
              </div>
              <div className="actions">
                <button className="btn sm" onClick={() => setCats([...cats, { key: K++, accountId: '', storeId: cats.at(-1)?.storeId ?? defStore, amount: '', memo: '' }])}>Add a category line</button>
                <button className="btn sm" aria-expanded={split.open} onClick={() => setSplit({ ...split, open: !split.open })}>Split across stores by %</button>
                <span style={{ marginLeft: 'auto' }}>Total <b><Money c={mode === 'money_in' ? dr : crT} dollar /></b></span>
              </div>
              {split.open && (
                <div className="panel panel-pad" style={{ background: 'var(--panel-2)' }}>
                  <div className="form-grid">
                    <div className="field"><label htmlFor="sp-acct">Account</label><select id="sp-acct" value={split.accountId} onChange={(e) => setSplit({ ...split, accountId: e.target.value })}><option value="">Choose…</option><AccountOptions filter={(a) => !MONEY.has(a.subtype)} /></select></div>
                    <div className="field"><label htmlFor="sp-total">Total to split</label><input id="sp-total" className="num" inputMode="decimal" value={split.total} onChange={(e) => setSplit({ ...split, total: e.target.value })} /></div>
                    {stores.filter((s) => s.kind !== 'leased_out').map((s) => (
                      <div className="field" key={s.id}><label htmlFor={'sp-' + s.id}>{s.code} %</label><input id={'sp-' + s.id} className="num" inputMode="decimal" value={split.pct[s.id] ?? ''} onChange={(e) => setSplit({ ...split, pct: { ...split.pct, [s.id]: e.target.value } })} /></div>
                    ))}
                  </div>
                  <div className="actions" style={{ marginTop: 12 }}>
                    <button className="btn sm" onClick={() => { const ops = stores.filter((s) => s.kind === 'operating'); setSplit({ ...split, pct: Object.fromEntries(ops.map((s) => [s.id, (100 / ops.length).toFixed(2)])) }); }}>Even across operating stores</button>
                    <span className={Math.abs(pctSum - 100) < 0.01 ? 'pos' : 'muted'}>Shares add to {pctSum.toFixed(2)}%{Math.abs(pctSum - 100) >= 0.01 && ' (they are scaled to 100%)'}</span>
                    <button className="btn sm primary" onClick={applySplit}>Add split lines</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="panel" aria-labelledby="j-h">
            <div className="panel-head"><h2 id="j-h">Lines</h2><span className={dr === crT ? 'pos' : 'neg'}>Debits <Money c={dr} /> · Credits <Money c={crT} /> {dr === crT ? '· balanced' : `· off by ${formatMoney(Math.abs(dr - crT), { dollarSign: true })}`}</span></div>
            {!editing && <p className="panel-pad small muted" style={{ paddingBottom: 0 }}>A memo is required. Over {formatMoney(state.settings.jeApprovalLimitCents, { dollarSign: true })} the entry waits for approval. Templates, recurring and reversing entries: <Link to="/books/journals/new">Journal entries</Link>.</p>}
            <div className="panel-pad lines-grid">
              {jrows.map((r, i) => (
                <div className="line-row" key={r.key}>
                  <div className="field acct"><label htmlFor={'ja' + r.key}>Account {i + 1}</label><select id={'ja' + r.key} value={r.accountId} onChange={(e) => setJrows(jrows.map((x) => (x.key === r.key ? { ...x, accountId: e.target.value } : x)))}><option value="">Choose…</option><AccountOptions /></select></div>
                  <div className="field"><label htmlFor={'js' + r.key}>Store</label><select id={'js' + r.key} value={r.storeId} onChange={(e) => setJrows(jrows.map((x) => (x.key === r.key ? { ...x, storeId: e.target.value } : x)))}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
                  <div className="field"><label htmlFor={'jd' + r.key}>Debit</label><input id={'jd' + r.key} className="num" inputMode="decimal" value={r.debit} onChange={(e) => setJrows(jrows.map((x) => (x.key === r.key ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x)))} /></div>
                  <div className="field"><label htmlFor={'jc' + r.key}>Credit</label><input id={'jc' + r.key} className="num" inputMode="decimal" value={r.credit} onChange={(e) => setJrows(jrows.map((x) => (x.key === r.key ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x)))} /></div>
                  <div className="field memo"><label htmlFor={'jm' + r.key}>Line memo</label><input id={'jm' + r.key} value={r.memo} onChange={(e) => setJrows(jrows.map((x) => (x.key === r.key ? { ...x, memo: e.target.value } : x)))} /></div>
                  <button className="btn ghost rm" aria-label={`Remove line ${i + 1}`} disabled={jrows.length <= 2} onClick={() => setJrows(jrows.filter((x) => x.key !== r.key))}>✕</button>
                </div>
              ))}
              <div className="actions">
                <button className="btn sm" onClick={() => setJrows([...jrows, { key: K++, accountId: '', storeId: jrows.at(-1)?.storeId ?? defStore, debit: dr > crT ? ((dr - crT) / 100).toFixed(2) : '', credit: crT > dr ? ((crT - dr) / 100).toFixed(2) : '', memo: '', partyId: '' }])}>Add a line{dr !== crT && ' for the difference'}</button>
              </div>
            </div>
          </section>
        )}

        <section className="panel panel-pad" aria-label="Notes">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="memo">Memo</label><textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Why this entry exists, for whoever reads it next" /></div>
            <div className="field"><label htmlFor="tags">Tags</label><input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated" /></div>
          </div>
        </section>
        <div className="actions">
          <button className="btn primary" onClick={save} disabled={mode === 'journal' && dr !== crT}>{editing ? 'Save changes' : `Post ${kindLabel.toLowerCase()}`}</button>
          <span className="muted small">Attach the invoice or receipt on the next screen.</span>
        </div>
      </div>
      <Help k="txnForm" />
    </>
  );
}
