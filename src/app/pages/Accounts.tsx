import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import { ACCOUNT_TYPE_LABEL, LOB_LABEL } from '../../core/coa';
import { accountDetail, balanceAsOf, trialBalance } from '../../core/reports';
import { todayInChicago, shortDate, periodOf } from '../../core/dates';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { parseMoney } from '../../core/money';
import type { Account, AccountType, AccountSubtype, LineOfBusiness } from '../../core/types';

const TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];
const SUBTYPES: AccountSubtype[] = ['general', 'bank', 'cash', 'clearing', 'receivable', 'inventory', 'prepaid', 'fixed_asset', 'intercompany', 'payable', 'accrued', 'loan', 'equity', 'draws'];

export function Accounts() {
  const { state, books, user, lines } = useBooks();
  const [toast, say] = useToast();
  const [editing, setEditing] = useState<Account | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const today = todayInChicago();
  const bal = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of state.accounts) m.set(a.id, balanceAsOf(state, a.id, today, lines));
    return m;
  }, [state, lines, today]);
  const list = [...state.accounts].filter((a) => showInactive || a.active).sort((a, b) => a.number.localeCompare(b.number));
  const canEdit = can(user, 'setup.edit');

  const save = () => {
    if (!editing) return;
    try {
      books.saveAccount(user, editing);
      say(`Saved ${editing.number} ${editing.name}.`);
      setEditing(null);
      setErrors([]);
    } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); }
  };

  return (
    <>
      <PageHead eyebrow="Books" title="Chart of accounts" lede="Tailored to fuel and convenience retail. Click an account for its ledger detail.">
        {canEdit && <button className="btn primary" onClick={() => { setErrors([]); setEditing({ id: books.nextId('acct'), number: '', name: '', type: 'expense', subtype: 'general', active: true }); }}>Add account</button>}
      </PageHead>
      {editing && (
        <section className="panel panel-pad" style={{ marginBottom: 20 }} aria-label="Edit account">
          <Errors errors={errors} />
          <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
            <div className="field"><label htmlFor="a-num">Number</label><input id="a-num" value={editing.number} inputMode="numeric" onChange={(e) => setEditing({ ...editing, number: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="a-name">Name</label><input id="a-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="a-type">Type</label><select id="a-type" value={editing.type} disabled={editing.system} onChange={(e) => setEditing({ ...editing, type: e.target.value as AccountType })}>{TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}</select></div>
            <div className="field"><label htmlFor="a-sub">Kind</label><select id="a-sub" value={editing.subtype} disabled={editing.system} onChange={(e) => setEditing({ ...editing, subtype: e.target.value as AccountSubtype })}>{SUBTYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></div>
            <div className="field"><label htmlFor="a-lob">Line of business</label><select id="a-lob" value={editing.lob ?? ''} onChange={(e) => setEditing({ ...editing, lob: (e.target.value || undefined) as LineOfBusiness | undefined })}><option value="">None</option>{Object.entries(LOB_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label htmlFor="a-floor">Floor (alert below)</label><input id="a-floor" className="num" inputMode="decimal" value={editing.floorCents !== undefined ? (editing.floorCents / 100).toFixed(2) : ''} onChange={(e) => { const v = e.target.value.trim() ? parseMoney(e.target.value) : undefined; setEditing({ ...editing, floorCents: v ?? undefined }); }} /><span className="hint">For bank and cash accounts</span></div>
            <label className="check" style={{ alignSelf: 'end', marginBottom: 8 }}><input type="checkbox" checked={editing.active} disabled={editing.system} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
          </div>
          <div className="actions" style={{ marginTop: 14 }}><button className="btn primary" onClick={save}>Save account</button><button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button></div>
        </section>
      )}
      <section className="panel">
        <div className="filters"><label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Number</th><th scope="col">Account</th><th scope="col">Type</th><th scope="col">Line of business</th><th scope="col" className="num">Balance today</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td>{a.number}</td>
                  <td><Link to={`/books/accounts/${a.id}`}>{a.name}</Link>{a.system && <span className="pill" style={{ marginLeft: 6 }}>system</span>}{!a.active && <span className="pill" style={{ marginLeft: 6 }}>inactive</span>}</td>
                  <td>{ACCOUNT_TYPE_LABEL[a.type]}</td>
                  <td>{a.lob ? LOB_LABEL[a.lob] : ''}</td>
                  <td className="num"><Money c={bal.get(a.id) ?? 0} className={a.floorCents !== undefined && (bal.get(a.id) ?? 0) < a.floorCents ? 'neg' : undefined} /></td>
                  <td>{canEdit && <button className="btn sm ghost" onClick={() => { setErrors([]); setEditing({ ...a }); }} aria-label={`Edit ${a.number} ${a.name}`}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {toast}
      <Help k="accounts" />
    </>
  );
}

export function AccountDetailPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { state, lines, stores, user } = useBooks();
  const exportCsv = useExport();
  const today = todayInChicago();
  const from = sp.get('from') ?? periodOf(today) + '-01';
  const to = sp.get('to') ?? today;
  const store = sp.get('store') ?? '';
  const a = state.accounts.find((x) => x.id === id);
  const gl = useMemo(() => (a ? accountDetail(state, a.id, { from, to, storeId: store || undefined, lines }) : null), [state, a, from, to, store, lines]);
  const tbBal = useMemo(() => {
    if (!a || store) return null;
    const tb = trialBalance(state, { asOf: to, lines });
    const row = tb.rows.find((r) => r.account.id === a.id);
    const sign = a.type === 'asset' || a.type === 'expense' || a.type === 'cogs' || a.type === 'contra_revenue' ? 1 : -1;
    return (row?.net ?? 0) * sign;
  }, [state, a, to, store, lines]);
  if (!a || !gl) return <PageHead title="Account not found" />;
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const sum = gl.rows.reduce((x, r) => x + r.change, 0);

  return (
    <>
      <PageHead eyebrow={`${ACCOUNT_TYPE_LABEL[a.type]} · ${a.number}`} title={a.name} lede={a.floorCents !== undefined ? `Floor ${(a.floorCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. Closing balance below that shows in red.` : undefined}>
        <Link className="btn" to="/books/accounts">All accounts</Link>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`gl-${a.number}-${from}-to-${to}`, ['Date', 'Ref', 'Description', 'Store', 'Memo', 'Debit', 'Credit', 'Balance'], gl.rows.map((r) => [r.t.date, r.t.ref, r.t.description, state.stores.find((s) => s.id === r.l.storeId)?.code ?? '', r.l.memo ?? '', csvMoney(r.l.debit), csvMoney(r.l.credit), csvMoney(r.balance)]))}>Export CSV</button>}
        <button className="btn" onClick={() => window.print()}>Print</button>
      </PageHead>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="g-from">From</label><input id="g-from" type="date" value={from} onChange={(e) => set('from', e.target.value)} /></div>
          <div className="field"><label htmlFor="g-to">To</label><input id="g-to" type="date" value={to} onChange={(e) => set('to', e.target.value)} /></div>
          <div className="field"><label htmlFor="g-store">Store</label><select id="g-store" value={store} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Ref</th><th scope="col">Description</th><th scope="col">Store</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th><th scope="col" className="num">Balance</th></tr></thead>
            <tbody>
              <tr className="sub"><td colSpan={6}>Opening balance {shortDate(from)}</td><td className="num"><Money c={gl.opening} /></td></tr>
              {gl.rows.length === 0 && <tr><td colSpan={7} className="muted">No activity in this range.</td></tr>}
              {gl.rows.slice(0, 2000).map((r) => (
                <tr key={r.l.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{shortDate(r.t.date)}</td>
                  <td><Link to={`/books/transactions/${r.t.id}`}>{r.t.ref}</Link></td>
                  <td className="trunc" title={r.t.description + (r.l.memo ? ' · ' + r.l.memo : '')}>{r.t.description}{r.l.memo && <span className="muted"> · {r.l.memo}</span>}</td>
                  <td>{state.stores.find((s) => s.id === r.l.storeId)?.code}</td>
                  <td className="num">{r.l.debit ? <Money c={r.l.debit} /> : ''}</td>
                  <td className="num">{r.l.credit ? <Money c={r.l.credit} /> : ''}</td>
                  <td className="num"><Money c={r.balance} /></td>
                </tr>
              ))}
              {gl.rows.length > 2000 && <tr><td colSpan={7} className="muted">Showing the first 2,000 of {gl.rows.length.toLocaleString('en-US')} lines. Narrow the dates or export for the rest.</td></tr>}
              <tr className="total"><td colSpan={4}>Closing balance {shortDate(to)}</td><td className="num"><Money c={gl.totalDebit} /></td><td className="num"><Money c={gl.totalCredit} /></td><td className="num"><Money c={gl.closing} className={a.floorCents !== undefined && gl.closing < a.floorCents ? 'neg' : undefined} /></td></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: 'Opening + activity = closing', ok: gl.opening + sum === gl.closing },
          ...(tbBal !== null ? [{ label: tbBal === gl.closing ? 'Ties to the trial balance' : 'Differs from the trial balance', ok: tbBal === gl.closing, detail: <Link to={`/reports/trial-balance?asOf=${to}`}>open trial balance</Link> }] : []),
        ]} />
      </section>
      <Help k="accountDetail" />
    </>
  );
}
