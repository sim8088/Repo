import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  AP, AP_AGING_LABELS, BILL_STATUS_LABEL, JUMP_PCT, METHOD_LABEL, SERVICE_LABEL, STATEMENT_ITEM_LABEL, TEN99_THRESHOLD, addBillAttachment, apAging, apState,
  approveBill, awaitingApproval, billTotal, daysPastDue, dueWithin, extractBill, openBills, pastDue, payBill, paymentCalendar, reconcileStatement, rejectBill,
  saveBill, saveUtilityAccount, saveVendorStatement, scheduleBill, ten99, unscheduledDueSoon, utilityRows, vendorName, voidBill, type Extracted,
} from '../../core/payables';
import { allocate, formatMoney, parseMoney } from '../../core/money';
import { addDays, daysBetween, periodOf, shortDate, todayInChicago } from '../../core/dates';
import { can } from '../../core/permissions';
import { canApproveKind } from '../../core/limits';
import { ValidationError } from '../../core/books';
import { getFile, putFile } from '../../data/storage';
import { bankStoreId } from '../../core/bank';
import type { Attachment, Bill, ID, PayMethod, UtilityAccount, UtilityService } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const METHODS = Object.keys(METHOD_LABEL) as PayMethod[];

function StatusPill({ b, today }: { b: Bill; today: string }) {
  const late = (b.status === 'approved' || b.status === 'scheduled') && b.dueDate < today;
  const cls = b.status === 'paid' ? 'ok' : b.status === 'draft' ? 'warn' : late ? 'bad' : b.status === 'void' ? '' : b.status === 'scheduled' ? 'ok' : 'warn';
  return <span className={'pill ' + cls}>{late ? `${BILL_STATUS_LABEL[b.status]} · ${daysPastDue(b, today)} days late` : BILL_STATUS_LABEL[b.status]}{b.autopay && b.status !== 'paid' ? ' · autopay' : ''}</span>;
}

/** Bills for stores this user can see. */
function useBills() {
  const { state, visible } = useBooks();
  return apState(state).bills.filter((b) => visible.has(b.storeId) || b.lines.some((l) => visible.has(l.storeId)));
}

async function keepFile(books: ReturnType<typeof useBooks>['books'], userId: ID, f: File): Promise<Attachment | string> {
  if (f.size > 15 * 1024 * 1024) return `${f.name} is over 15 MB. Save a smaller PDF or photo.`;
  const id = books.nextId('att');
  const ok = await putFile(id, f);
  if (!ok) return 'This browser is blocking storage, so the file could not be kept. Allow site data and try again.';
  return { id, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, addedAt: new Date().toISOString(), addedBy: userId };
}

function AttachmentList({ items, onSay }: { items: Attachment[]; onSay: (m: string) => void }) {
  const open = async (a: Attachment) => {
    const blob = await getFile(a.id);
    if (!blob) { onSay(`${a.name} isn't on this device. Attachments live where they were uploaded until the hosted back end ships.`); return; }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  if (!items.length) return <p className="muted small">No documents yet.</p>;
  return <ul className="small" style={{ paddingLeft: 18 }}>{items.map((a) => <li key={a.id}><button className="btn sm ghost" onClick={() => void open(a)}>{a.name}</button> <span className="muted">{Math.max(1, Math.round(a.size / 1024))} KB</span></li>)}</ul>;
}

// ── Bills list ───────────────────────────────────────────────────────────
export function BillsPage() {
  const { state, user, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const today = todayInChicago();
  const all = useBills();
  const show = sp.get('status') ?? 'open';
  const vendor = sp.get('vendor') ?? '';
  const q = (sp.get('q') ?? '').toLowerCase();
  const aging = useMemo(() => apAging(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const rows = all.filter((b) => (show === 'all' || (show === 'open' ? b.status === 'approved' || b.status === 'scheduled' : b.status === show))
    && (!vendor || b.vendorId === vendor) && (!q || `${vendorName(state, b.vendorId)} ${b.invoiceNo} ${b.ref}`.toLowerCase().includes(q)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const due7 = dueWithin(state, today, 7);
  const late = pastDue(state, today);
  const waiting = awaitingApproval(state);
  const sum = (bs: Bill[]) => bs.reduce((a, b) => a + billTotal(b), 0);
  const vendors = [...new Set(all.map((b) => b.vendorId))].sort((a, b) => vendorName(state, a).localeCompare(vendorName(state, b)));
  const store = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  return (
    <>
      <PageHead eyebrow="Payables" title="Bills" lede="Every bill from entry to payment. Approval posts the expense against Accounts payable; payment clears it from the bank.">
        {can(user, 'bills.enter') && <Link className="btn primary" to="/payables/inbox">New bill</Link>}
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('bills', ['Ref', 'Vendor', 'Store', 'Invoice', 'Bill date', 'Due', 'Amount', 'Status', 'Autopay', 'Paid on', 'Check'], rows.map((b) => [b.ref, vendorName(state, b.vendorId), store(b.storeId), b.invoiceNo, b.billDate, b.dueDate, csvMoney(billTotal(b)), BILL_STATUS_LABEL[b.status], b.autopay ? 'yes' : 'no', b.payment?.date ?? '', b.payment?.checkNo ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Payables" style={{ marginBottom: 20 }}>
        <Figure label="Open payables" value={<Money c={aging.total} whole dollar />} href="/payables/aging" note={`${openBills(state, today).length} approved bills not yet paid`} />
        <Figure label="Due in the next 7 days" value={<Money c={sum(due7)} whole dollar />} href="/payables/calendar" note={`${due7.length} bill${due7.length === 1 ? '' : 's'}`} />
        <Figure label="Past due" value={<Money c={sum(late)} whole dollar className={late.length ? 'neg' : undefined} />} note={late.length ? late.map((b) => vendorName(state, b.vendorId)).filter((v, i, a) => a.indexOf(v) === i).join(', ') : 'Nothing late'} />
        <Figure label="Awaiting approval" value={waiting.length} href="/approvals" note={<Money c={sum(waiting)} dollar />} />
      </section>
      <section className="panel" aria-labelledby="bl-h">
        <div className="panel-head"><h2 id="bl-h">Bills</h2><span className="muted small">{rows.length} shown</span></div>
        <div className="filters">
          <div className="seg" role="group" aria-label="Status">
            {[['open', 'Open'], ['draft', 'Awaiting approval'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All']].map(([k, l]) => <button key={k} aria-pressed={show === k} onClick={() => set('status', k)}>{l}</button>)}
          </div>
          <div className="field"><label htmlFor="bl-v">Vendor</label><select id="bl-v" value={vendor} onChange={(e) => set('vendor', e.target.value)}><option value="">All vendors</option>{vendors.map((v) => <option key={v} value={v}>{vendorName(state, v)}</option>)}</select></div>
          <div className="field wide"><label htmlFor="bl-q">Search</label><input id="bl-q" value={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="Vendor, invoice # or BILL-…" /></div>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Bill</th><th scope="col">Vendor</th><th scope="col">Store</th><th scope="col">Invoice</th><th scope="col">Due</th><th scope="col" className="num">Amount</th><th scope="col">Status</th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="muted">No bills here.</td></tr> : rows.map((b) => (
            <tr key={b.id}><td><Link to={`/payables/bills/${b.id}`}>{b.ref}</Link>{b.attachments.length > 0 && <span aria-label="document attached" title="Document attached"> 📎</span>}</td><td className="trunc" title={vendorName(state, b.vendorId)}>{vendorName(state, b.vendorId)}</td><td>{store(b.storeId)}{b.lines.some((l) => l.storeId !== b.storeId) && <span className="muted small"> · split</span>}</td>
              <td>{b.invoiceNo}</td><td style={{ whiteSpace: 'nowrap' }}>{shortDate(b.dueDate)}</td><td className="num"><Money c={billTotal(b)} /></td><td><StatusPill b={b} today={today} /></td></tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[
          { label: aging.ties ? 'Open bills tie to 2000 Accounts payable' : 'Open bills do not tie to Accounts payable', ok: aging.ties, detail: <><Money c={aging.total} dollar /> open · ledger <Money c={aging.glBalance} dollar />{aging.unlinked ? <> · <Money c={aging.unlinked} dollar /> entered by hand</> : null}</> },
          { label: `${rows.length} bills · ${formatMoney(sum(rows), { dollarSign: true })}`, ok: true },
        ]} />
      </section>
      <Help k="bills" />
    </>
  );
}

// ── One bill ─────────────────────────────────────────────────────────────
export function BillDetailPage() {
  const { id = '' } = useParams();
  const { state, books, user, visible } = useBooks();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const b = apState(state).bills.find((x) => x.id === id || x.ref === id);
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'pay' | 'schedule' | 'void' | 'reject' | null>(null);
  const [payDate, setPayDate] = useState(today);
  const [method, setMethod] = useState<PayMethod>(b?.scheduled?.method ?? (b?.autopay ? 'autopay' : 'check'));
  const [checkNo, setCheckNo] = useState('');
  const [conf, setConf] = useState('');
  const [confFile, setConfFile] = useState<Attachment | null>(null);
  const [schedDate, setSchedDate] = useState(b ? (b.dueDate > today ? addDays(b.dueDate, -1) : addDays(today, 1)) : today);
  if (!b || !(visible.has(b.storeId) || b.lines.some((l) => visible.has(l.storeId)))) return <><PageHead title="Bill not found" lede="It may be for a store you can't see, or the link is wrong." /><Link to="/payables/bills">Back to bills</Link></>;
  const total = billTotal(b);
  const run = (fn: () => string) => { setErrors([]); try { say(fn()); setMode(null); } catch (e) { setErrors(errList(e)); } };
  const store = (sid: ID) => state.stores.find((s) => s.id === sid);
  const acct = (aid: ID) => state.accounts.find((a) => a.id === aid);
  const txn = (tid?: ID) => (tid ? state.transactions.find((t) => t.id === tid) : undefined);
  const accrual = txn(b.approved?.txnId);
  const payment = txn(b.payment?.txnId);
  const accrualAp = accrual?.lines.filter((l) => l.accountId === AP).reduce((a, l) => a + l.credit - l.debit, 0) ?? 0;
  const history = state.audit.filter((a) => a.objectId === b.id).reverse();
  const userName = (uid: string) => state.users.find((u) => u.id === uid)?.name ?? uid;
  const ua = b.utilityAccountId ? apState(state).utilities.find((u) => u.id === b.utilityAccountId) : undefined;
  const canPay = can(user, 'bills.pay');
  const open = b.status === 'approved' || b.status === 'scheduled';
  const upload = async (f: File | undefined, target: 'bill' | 'payment') => {
    if (!f) return;
    const r = await keepFile(books, user.id, f);
    if (typeof r === 'string') { say(r); return; }
    if (target === 'payment') { setConfFile(r); say(`${f.name} will be attached to the payment.`); return; }
    try { addBillAttachment(books, user, b.id, r); say(`Attached ${f.name}.`); } catch (e) { say(errList(e).join(' ')); }
  };
  return (
    <>
      <PageHead eyebrow={`Payables · ${b.ref}`} title={`${vendorName(state, b.vendorId)} · ${b.invoiceNo}`} lede={<>{store(b.storeId)?.code} · billed {shortDate(b.billDate)} · due {shortDate(b.dueDate)}{ua ? <> · utility account {ua.accountNo}</> : null}{b.memo ? <> · {b.memo}</> : null}</>}>
        <Link className="btn" to="/payables/bills">All bills</Link>
      </PageHead>
      <section className="figures" aria-label="Bill" style={{ marginBottom: 20 }}>
        <Figure label="Amount" value={<Money c={total} dollar />} note={`${b.lines.length} line${b.lines.length === 1 ? '' : 's'}`} />
        <Figure label="Status" value={BILL_STATUS_LABEL[b.status]} note={b.scheduled && b.status === 'scheduled' ? `${METHOD_LABEL[b.scheduled.method]} on ${shortDate(b.scheduled.date)}` : b.payment ? `${METHOD_LABEL[b.payment.method]} on ${shortDate(b.payment.date)}` : b.voided ? b.voided.reason : undefined} />
        <Figure label={b.status === 'paid' ? 'Paid' : daysBetween(today, b.dueDate) < 0 ? 'Past due' : 'Due in'} value={b.status === 'paid' ? shortDate(b.payment!.date) : `${Math.abs(daysBetween(today, b.dueDate))} days`} note={b.disconnectNotice ? <span className="neg">Disconnect notice on this bill</span> : b.autopay ? 'On autopay' : undefined} />
        <Figure label="Documents" value={b.attachments.length + (b.payment?.attachments.length ?? 0)} note={b.attachments.length ? 'Invoice attached' : 'Attach the invoice'} />
      </section>
      <Errors errors={errors} />
      <div className="grid-2 wide-left">
        <div className="stack">
          <section className="panel" aria-labelledby="ln-h">
            <div className="panel-head"><h2 id="ln-h">Lines</h2></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Category</th><th scope="col">Store</th><th scope="col">Memo</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>{b.lines.map((l) => <tr key={l.id}><td>{acct(l.accountId)?.number} · {acct(l.accountId)?.name}</td><td>{store(l.storeId)?.code}</td><td>{l.memo}</td><td className="num"><Money c={l.amount} /></td></tr>)}
                <tr className="total"><td colSpan={3}>Total</td><td className="num"><Money c={total} /></td></tr></tbody>
            </table></div>
            <TieOut items={[
              ...(accrual ? [{ label: accrualAp === total ? `Posted ${accrual.ref}: Accounts payable credited the bill total` : `${accrual.ref} doesn't match the bill`, ok: accrualAp === total && !accrual.deleted }] : [{ label: b.status === 'draft' ? 'Not posted yet: posts on approval' : 'Nothing posted', ok: true }]),
              ...(payment ? [{ label: `Paid by ${payment.ref}`, ok: !payment.deleted, detail: b.payment?.checkNo ? `check #${b.payment.checkNo}` : b.payment?.confirmation }] : []),
            ]} />
          </section>
          <section className="panel panel-pad" aria-labelledby="nx-h">
            <h2 id="nx-h" style={{ marginBottom: 8 }}>{b.status === 'paid' ? 'Payment' : b.status === 'void' ? 'Void' : 'Next step'}</h2>
            {b.status === 'draft' && (canApproveKind(state, user, 'bill') ? (
              <>
                <div className="field" style={{ maxWidth: 520 }}><label htmlFor="bd-note">Approval note (optional)</label><input id="bd-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button className="btn primary" onClick={() => run(() => { const t = approveBill(books, user, b.id, note); return `Approved. Posted ${t.ref} to Accounts payable.`; })}>Approve bill</button>
                  {can(user, 'approve') && <button className="btn ghost" onClick={() => setMode(mode === 'reject' ? null : 'reject')} aria-expanded={mode === 'reject'}>Reject…</button>}
                </div>
                {mode === 'reject' && <div className="actions" style={{ marginTop: 10, alignItems: 'flex-end' }}><div className="field" style={{ width: 320 }}><label htmlFor="bd-rr">Why reject?</label><input id="bd-rr" value={reason} onChange={(e) => setReason(e.target.value)} /></div><button className="btn danger sm" onClick={() => run(() => { rejectBill(books, user, b.id, reason); return 'Rejected.'; })}>Reject bill</button></div>}
              </>
            ) : <p className="muted">Waiting for approval by the owner or the CFO. Your role can't approve bills.</p>)}
            {open && canPay && (
              <>
                <div className="seg" role="group" aria-label="Action" style={{ marginBottom: 12 }}>
                  <button aria-pressed={mode === 'pay'} onClick={() => setMode('pay')}>Record payment</button>
                  <button aria-pressed={mode === 'schedule'} onClick={() => setMode('schedule')}>{b.status === 'scheduled' ? 'Reschedule' : 'Schedule'}</button>
                  <button aria-pressed={mode === 'void'} onClick={() => setMode('void')}>Void</button>
                </div>
                {mode === 'pay' && (
                  <div className="form-grid">
                    <div className="field"><label htmlFor="bp-d">Payment date</label><input id="bp-d" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
                    <div className="field"><label htmlFor="bp-m">Method</label><select id="bp-m" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
                    {method === 'check' && <div className="field"><label htmlFor="bp-c">Check #</label><input id="bp-c" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} /></div>}
                    {method !== 'check' && <div className="field"><label htmlFor="bp-x">Confirmation #</label><input id="bp-x" value={conf} onChange={(e) => setConf(e.target.value)} /></div>}
                    <div className="field"><span className="small muted">Confirmation document</span><label className="btn sm" style={{ width: 'fit-content' }}>{confFile ? confFile.name : 'Attach file'}<input type="file" className="sr-only" accept="image/*,.pdf" onChange={(e) => { void upload(e.target.files?.[0], 'payment'); e.target.value = ''; }} /></label></div>
                    <div className="actions" style={{ gridColumn: '1 / -1' }}>
                      <button className="btn primary" onClick={() => run(() => { const t = payBill(books, user, b.id, { date: payDate, method, checkNo, confirmation: conf, attachments: confFile ? [confFile] : [] }); return `Paid. Posted ${t.ref}: Accounts payable → ${method === 'cash' ? 'cash at HQ' : 'Trustmark'}.`; })}>Record payment of {formatMoney(total, { dollarSign: true })}</button>
                    </div>
                  </div>
                )}
                {mode === 'schedule' && (
                  <div className="actions" style={{ alignItems: 'flex-end' }}>
                    <div className="field" style={{ width: 170 }}><label htmlFor="bs-d">Pay on</label><input id="bs-d" type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} /></div>
                    <div className="field" style={{ width: 170 }}><label htmlFor="bs-m">Method</label><select id="bs-m" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
                    <button className="btn primary sm" onClick={() => run(() => { scheduleBill(books, user, b.id, { date: schedDate, method }); return `Scheduled for ${shortDate(schedDate)}. It is in the cash forecast.`; })}>Schedule payment</button>
                    {b.status === 'scheduled' && <button className="btn ghost sm" onClick={() => run(() => { scheduleBill(books, user, b.id, null); return 'Unscheduled.'; })}>Unschedule</button>}
                  </div>
                )}
                {mode === 'void' && (
                  <div className="actions" style={{ alignItems: 'flex-end' }}>
                    <div className="field" style={{ width: 320 }}><label htmlFor="bv-r">Why void?</label><input id="bv-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice; vendor sent a corrected bill" /></div>
                    <button className="btn danger sm" onClick={() => run(() => { voidBill(books, user, b.id, reason); return 'Voided. The accrual entry was reversed.'; })}>Void bill</button>
                  </div>
                )}
              </>
            )}
            {open && !canPay && <p className="muted">Approved. The bookkeeper or CFO schedules and records the payment.</p>}
            {b.payment && <dl className="kv"><dt>Paid</dt><dd>{shortDate(b.payment.date)} by {METHOD_LABEL[b.payment.method].toLowerCase()}{b.payment.checkNo && <> · check #{b.payment.checkNo}</>}</dd>{b.payment.confirmation && <><dt>Confirmation</dt><dd>{b.payment.confirmation}</dd></>}<dt>Entry</dt><dd>{payment ? <Link to={`/books/transactions/${payment.id}`}>{payment.ref}</Link> : '—'}</dd><dt>By</dt><dd>{userName(b.payment.by)}</dd></dl>}
            {b.payment && <AttachmentList items={b.payment.attachments} onSay={say} />}
            {b.status === 'void' && <p>Voided by {userName(b.voided!.by)}: {b.voided!.reason}</p>}
          </section>
        </div>
        <div className="stack">
          <section className="panel panel-pad" aria-labelledby="dc-h">
            <h2 id="dc-h" style={{ marginBottom: 8 }}>Invoice & documents</h2>
            <AttachmentList items={b.attachments} onSay={say} />
            {can(user, 'bills.enter') && <label className="btn sm" style={{ marginTop: 8 }}>Attach invoice<input type="file" className="sr-only" accept="image/*,.pdf" onChange={(e) => { void upload(e.target.files?.[0], 'bill'); e.target.value = ''; }} /></label>}
          </section>
          <section className="panel panel-pad" aria-labelledby="hs-h">
            <h2 id="hs-h" style={{ marginBottom: 8 }}>History</h2>
            <dl className="kv">
              <dt>Entered</dt><dd>{userName(b.createdBy)} · {shortDate(b.createdAt.slice(0, 10))}{b.source === 'inbox' ? ' · from the bills inbox' : ''}</dd>
              {b.approved && <><dt>Approved</dt><dd>{userName(b.approved.by)} · {shortDate(b.approved.at.slice(0, 10))}{accrual && <> · <Link to={`/books/transactions/${accrual.id}`}>{accrual.ref}</Link></>}</dd></>}
              {b.scheduled && <><dt>Scheduled</dt><dd>{shortDate(b.scheduled.date)} · {METHOD_LABEL[b.scheduled.method]}</dd></>}
            </dl>
            {history.length > 0 && <ul className="small muted" style={{ paddingLeft: 18, marginTop: 8 }}>{history.slice(0, 8).map((h) => <li key={h.id}>{shortDate(h.at.slice(0, 10))} · {userName(h.userId)} · {h.summary}</li>)}</ul>}
          </section>
        </div>
      </div>
      {toast}
      <Help k="billDetail" />
    </>
  );
}

// ── Bills inbox ──────────────────────────────────────────────────────────
interface FormLine { accountId: ID; storeId: ID; amount: string; memo: string }

export function BillsInboxPage() {
  const { state, books, user, stores } = useBooks();
  const nav = useNavigate();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [att, setAtt] = useState<Attachment | null>(null);
  const [found, setFound] = useState<Extracted | null>(null);
  const [vendorId, setVendor] = useState('');
  const [storeId, setStore] = useState(stores[0]?.id ?? '');
  const [utilityId, setUtility] = useState('');
  const [invoiceNo, setInvoice] = useState('');
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const [autopay, setAutopay] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<FormLine[]>([{ accountId: '', storeId: stores[0]?.id ?? '', amount: '', memo: '' }]);
  const [errors, setErrors] = useState<string[]>([]);
  if (!can(user, 'bills.enter')) return <PageHead eyebrow="Payables" title="Bills inbox" lede="Your role can't enter bills. Ask the bookkeeper." />;
  const vendors = state.parties.filter((p) => !p.deleted && p.type !== 'owner' && p.type !== 'tenant').sort((a, b) => a.name.localeCompare(b.name));
  const utilities = apState(state).utilities.filter((u) => u.active && (!vendorId || u.vendorId === vendorId));
  const recent = apState(state).bills.filter((b) => b.source === 'inbox').slice(-5).reverse();
  const pickVendor = (id: string) => {
    setVendor(id);
    const v = state.parties.find((p) => p.id === id);
    if (v?.defaultAccountId) setLines((ls) => ls.map((l) => (l.accountId ? l : { ...l, accountId: v.defaultAccountId! })));
  };
  const read = () => {
    const x = extractBill(state, text, file?.name ?? '');
    setFound(x);
    if (x.vendorId) pickVendor(x.vendorId);
    if (x.storeId) { setStore(x.storeId); setLines((ls) => ls.map((l, i) => (i === 0 ? { ...l, storeId: x.storeId! } : l))); }
    if (x.utilityAccountId) { setUtility(x.utilityAccountId); setAutopay(!!apState(state).utilities.find((u) => u.id === x.utilityAccountId)?.autopay); }
    if (x.invoiceNo) setInvoice(x.invoiceNo);
    if (x.billDate) setBillDate(x.billDate);
    if (x.dueDate) setDueDate(x.dueDate);
    if (x.amount) setLines((ls) => ls.map((l, i) => (i === 0 ? { ...l, amount: formatMoney(x.amount!) } : l)));
    setDisconnect(x.disconnect);
  };
  const total = lines.reduce((a, l) => a + (parseMoney(l.amount) ?? 0), 0);
  const setLine = (i: number, p: Partial<FormLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const splitEven = () => {
    const ops = stores.filter((s) => s.kind === 'operating' && (!s.openedOn || s.openedOn <= billDate));
    if (!ops.length || !total) return;
    const parts = allocate(total, ops.map(() => 1));
    setLines(ops.map((s, i) => ({ accountId: lines[0].accountId, storeId: s.id, amount: formatMoney(parts[i]), memo: lines[0].memo })));
  };
  const save = () => {
    setErrors([]);
    const bad = lines.findIndex((l) => parseMoney(l.amount) === null);
    if (bad >= 0) { setErrors([`Line ${bad + 1}: enter the amount, like 412.30.`]); return; }
    try {
      const b = saveBill(books, user, {
        vendorId, storeId, invoiceNo, billDate, dueDate, autopay, memo, disconnectNotice: disconnect, utilityAccountId: utilityId || undefined,
        lines: lines.map((l) => ({ accountId: l.accountId, storeId: l.storeId, amount: parseMoney(l.amount)!, memo: l.memo })), attachments: att ? [att] : [], source: text || file ? 'inbox' : 'manual',
      });
      say(`Saved ${b.ref}. It is waiting for approval.`);
      nav(`/payables/bills/${b.id}`);
    } catch (e) { setErrors(errList(e)); }
  };
  return (
    <>
      <PageHead eyebrow="Payables" title="Bills inbox" lede="Upload the photo or PDF, or paste the email. We pull out what the text shows; you check it and save the bill for approval." />
      <section className="figures" aria-label="Inbox" style={{ marginBottom: 20 }}>
        <Figure label="Awaiting approval" value={awaitingApproval(state).length} href="/approvals" />
        <Figure label="Entered this month" value={apState(state).bills.filter((b) => b.createdAt.slice(0, 7) === periodOf(today)).length} note="All sources" />
        <Figure label="From the inbox" value={apState(state).bills.filter((b) => b.source === 'inbox').length} note="Bills entered from a file or email" />
      </section>
      <div className="grid-2">
        <section className="panel panel-pad" aria-labelledby="up-h">
          <h2 id="up-h" style={{ marginBottom: 8 }}>1. The bill</h2>
          <div className="note warn" style={{ marginBottom: 12 }}><b>No OCR yet.</b> There's no text-recognition service, so a photo or PDF is kept with the bill but only its file name is read. Paste the email text to pull out amounts, dates and the invoice number.</div>
          <label className="btn" style={{ marginBottom: 12 }}>{file ? `File: ${file.name}` : 'Upload photo or PDF'}<input type="file" className="sr-only" accept="image/*,.pdf" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setFile(f); const r = await keepFile(books, user.id, f); if (typeof r === 'string') say(r); else setAtt(r); }} /></label>
          <div className="field"><label htmlFor="bi-t">Or paste the email text</label><textarea id="bi-t" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'e.g. Invoice # 4471 dated 11/20/2026\nAmount due: $1,240.00\nDue date: 12/05/2026'} /></div>
          <div className="actions" style={{ marginTop: 10 }}><button className="btn primary" disabled={!text.trim() && !file} onClick={read}>Read it</button></div>
          {found && (
            <div className="note" style={{ marginTop: 12 }} role="status">
              {found.found.length ? <><b>Found:</b><ul>{found.found.map((f) => <li key={f}>{f}</li>)}</ul></> : <b>Nothing recognisable. Fill in the form by hand.</b>}
              <span className="small muted">Check every field before saving.</span>
            </div>
          )}
        </section>
        <section className="panel panel-pad" aria-labelledby="bf-h">
          <h2 id="bf-h" style={{ marginBottom: 8 }}>2. Check and save</h2>
          <Errors errors={errors} />
          <div className="form-grid">
            <div className="field"><label htmlFor="bf-v">Vendor</label><select id="bf-v" value={vendorId} onChange={(e) => pickVendor(e.target.value)}><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div className="field"><label htmlFor="bf-s">Bill is for</label><select id="bf-s" value={storeId} onChange={(e) => setStore(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
            <div className="field"><label htmlFor="bf-i">Invoice #</label><input id="bf-i" value={invoiceNo} onChange={(e) => setInvoice(e.target.value)} /></div>
            <div className="field"><label htmlFor="bf-u">Utility account</label><select id="bf-u" value={utilityId} onChange={(e) => setUtility(e.target.value)}><option value="">Not a utility</option>{utilities.map((u) => <option key={u.id} value={u.id}>{vendorName(state, u.vendorId)} · {u.accountNo}</option>)}</select></div>
            <div className="field"><label htmlFor="bf-bd">Bill date</label><input id="bf-bd" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="bf-dd">Due date</label><input id="bf-dd" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <h3 style={{ margin: '14px 0 6px' }}>Categories</h3>
          {lines.map((l, i) => (
            <div key={i} className="form-grid" style={{ marginBottom: 8 }}>
              <div className="field"><label htmlFor={`bl-a${i}`}>Category {i + 1}</label><select id={`bl-a${i}`} value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value })}><option value="">Choose…</option><AccountOptions filter={(a) => a.subtype !== 'bank' && a.subtype !== 'cash' && a.id !== AP} /></select></div>
              <div className="field"><label htmlFor={`bl-s${i}`}>Store {i + 1}</label><select id={`bl-s${i}`} value={l.storeId} onChange={(e) => setLine(i, { storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
              <div className="field"><label htmlFor={`bl-m${i}`}>Amount {i + 1}</label><input id={`bl-m${i}`} className="num" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="0.00" /></div>
              {lines.length > 1 && <div className="field"><span className="sr-only">Remove</span><button className="btn sm ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>Remove</button></div>}
            </div>
          ))}
          <div className="actions" style={{ marginBottom: 12 }}>
            <button className="btn sm" onClick={() => setLines([...lines, { accountId: lines[0]?.accountId ?? '', storeId: stores[0]?.id ?? '', amount: '', memo: '' }])}>Add line</button>
            <button className="btn sm ghost" disabled={!total} onClick={splitEven}>Split evenly across operating stores</button>
            <span className="small">Total <b><Money c={total} dollar /></b></span>
          </div>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="bf-memo">Memo</label><input id="bf-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
          </div>
          <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} /> Paid by autopay</label>
          <label className="check"><input type="checkbox" checked={disconnect} onChange={(e) => setDisconnect(e.target.checked)} /> Bill carries a disconnect notice</label>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={save}>Save for approval</button><span className="muted small">Nothing posts until the bill is approved.</span></div>
        </section>
      </div>
      {recent.length > 0 && (
        <section className="panel" aria-labelledby="rc-h" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2 id="rc-h">Recently from the inbox</h2></div>
          <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Bill</th><th scope="col">Vendor</th><th scope="col" className="num">Amount</th><th scope="col">Status</th></tr></thead>
            <tbody>{recent.map((b) => <tr key={b.id}><td><Link to={`/payables/bills/${b.id}`}>{b.ref}</Link></td><td>{vendorName(state, b.vendorId)}</td><td className="num"><Money c={billTotal(b)} /></td><td><StatusPill b={b} today={today} /></td></tr>)}</tbody></table></div>
        </section>
      )}
      {toast}
      <Help k="billsInbox" />
    </>
  );
}

// ── AP aging ─────────────────────────────────────────────────────────────
export function ApAgingPage() {
  const { state, user, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const asOf = sp.get('asOf') ?? todayInChicago();
  const a = useMemo(() => apAging(state, asOf), [state, asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const corp = useBooks().visible.has(bankStoreId(state));
  if (!corp) return <PageHead eyebrow="Payables" title="AP aging" lede="Your role doesn't include company-wide payables." />;
  return (
    <>
      <PageHead eyebrow="Payables" title="AP aging" lede="What we owe vendors, by days past due.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`ap-aging-${asOf}`, ['Vendor', ...AP_AGING_LABELS, 'Total'], [...a.rows.map((r) => [r.name, ...r.buckets.map(csvMoney), csvMoney(r.total)]), ['Total', ...a.buckets.map(csvMoney), csvMoney(a.total)]])}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Aging" style={{ marginBottom: 20 }}>
        <Figure label="Accounts payable" value={<Money c={a.total} whole dollar />} href={`/books/accounts/${AP}`} note={`${a.rows.length} vendors`} />
        <Figure label="Current" value={<Money c={a.buckets[0]} whole dollar />} note="Not yet due" />
        <Figure label="Past due" value={<Money c={a.total - a.buckets[0]} whole dollar className={a.total - a.buckets[0] ? 'neg' : undefined} />} note="1 day or more" />
        <Figure label="Over 30 days late" value={<Money c={a.buckets[2] + a.buckets[3] + a.buckets[4]} whole dollar />} />
      </section>
      <section className="panel" aria-labelledby="ag-h">
        <div className="panel-head"><h2 id="ag-h">By vendor</h2></div>
        <div className="filters"><div className="field"><label htmlFor="ag-d">As of</label><input id="ag-d" type="date" value={asOf} onChange={(e) => { const n = new URLSearchParams(sp); n.set('asOf', e.target.value); setSp(n, { replace: true }); }} /></div></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Vendor</th>{AP_AGING_LABELS.map((l) => <th key={l} scope="col" className="num">{l}</th>)}<th scope="col" className="num">Total</th></tr></thead>
          <tbody>{a.rows.length === 0 ? <tr><td colSpan={7} className="muted">Nothing owed.</td></tr> : a.rows.map((r) => (
            <tr key={r.vendorId}><td><Link to={`/payables/bills?vendor=${r.vendorId}`}>{r.name}</Link> <span className="muted small">{r.bills.length} bill{r.bills.length === 1 ? '' : 's'}</span></td>{r.buckets.map((v, i) => <td key={i} className={'num' + (i > 0 && v ? ' neg' : '')}>{v ? <Money c={v} /> : ''}</td>)}<td className="num"><Money c={r.total} /></td></tr>
          ))}<tr className="total"><td>Total</td>{a.buckets.map((v, i) => <td key={i} className="num"><Money c={v} /></td>)}<td className="num"><Money c={a.total} /></td></tr></tbody>
        </table></div>
        <TieOut items={[
          { label: a.ties ? 'Ties to 2000 Accounts payable in the ledger' : `Off from the ledger by ${formatMoney(a.glBalance - a.total - a.unlinked, { dollarSign: true })}`, ok: a.ties, detail: <>Ledger <Money c={a.glBalance} dollar />{a.unlinked ? <> · includes <Money c={a.unlinked} dollar /> entered on 2000 without a bill ({a.unlinkedTxns.map((t) => t.ref).join(', ')})</> : null}</> },
          { label: a.buckets.reduce((x, y) => x + y, 0) === a.total ? 'Buckets add to the total' : 'Buckets do not add up', ok: a.buckets.reduce((x, y) => x + y, 0) === a.total },
        ]} />
      </section>
      <Help k="apAging" />
    </>
  );
}

// ── Payment calendar ─────────────────────────────────────────────────────
export function PaymentCalendarPage() {
  const { state, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const today = todayInChicago();
  const cal = useMemo(() => paymentCalendar(state, 'acct_trustmark', today, 35), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible.has(bankStoreId(state))) return <PageHead eyebrow="Payables" title="Payment calendar" lede="Your role doesn't include the company bank account." />;
  const days = cal.days.filter((d) => d.bills.length || d.belowFloor);
  const low = cal.days.reduce((m, d) => (d.projected < m.projected ? d : m), cal.days[0]);
  const next7 = cal.days.slice(0, 7).reduce((a, d) => a + d.out, 0);
  const unsched = unscheduledDueSoon(state, today, 7);
  return (
    <>
      <PageHead eyebrow="Payables" title="Payment calendar" lede="Bills by the day the money goes out, against the projected Trustmark balance.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`payment-calendar-${today}`, ['Date', 'Vendor', 'Invoice', 'Bill', 'Amount', 'Projected balance'], days.flatMap((d) => d.bills.map((b) => [d.date, vendorName(state, b.vendorId), b.invoiceNo, b.ref, csvMoney(billTotal(b)), csvMoney(d.projected)])))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Calendar" style={{ marginBottom: 20 }}>
        <Figure label="Going out in 7 days" value={<Money c={next7} whole dollar />} note={unsched.length ? <span className="neg">{unsched.length} due soon with no payment scheduled</span> : 'Everything due is scheduled'} />
        <Figure label="Next 35 days" value={<Money c={cal.calendarBills} whole dollar />} note={`${cal.days.reduce((a, d) => a + d.bills.length, 0)} bills`} />
        <Figure label="Lowest projected balance" value={<Money c={low.projected} whole dollar className={low.projected < cal.floor ? 'neg' : undefined} />} href="/cash/forecast" note={`${shortDate(low.date)} · floor ${formatMoney(cal.floor, { dollarSign: true, whole: true })}`} />
        <Figure label="Awaiting approval" value={cal.awaiting.length} href="/approvals" note={<>Not in the projection · <Money c={cal.awaiting.reduce((a, b) => a + billTotal(b), 0)} dollar /></>} />
      </section>
      <section className="panel" aria-labelledby="pc-h">
        <div className="panel-head"><h2 id="pc-h">Next 35 days</h2><span className="muted small">Opening {formatMoney(cal.opening, { dollarSign: true, whole: true })} per books today</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Date</th><th scope="col">Bills</th><th scope="col" className="num">Going out</th><th scope="col" className="num">Projected balance</th></tr></thead>
          <tbody>{days.length === 0 ? <tr><td colSpan={4} className="muted">No bills in the next 35 days.</td></tr> : days.map((d) => (
            <tr key={d.date}>
              <td style={{ whiteSpace: 'nowrap' }}>{new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</td>
              <td>{d.bills.map((b) => <div key={b.id}><Link to={`/payables/bills/${b.id}`}>{vendorName(state, b.vendorId)} {b.invoiceNo}</Link> <span className="muted small"><Money c={billTotal(b)} />{b.status === 'approved' && !b.autopay ? ' · not scheduled' : b.scheduled ? ` · ${METHOD_LABEL[b.scheduled.method].toLowerCase()}` : ''}{b.dueDate < today ? ' · past due' : ''}</span></div>)}</td>
              <td className="num"><Money c={d.out} /></td>
              <td className={'num' + (d.belowFloor ? ' neg' : '')}><Money c={d.projected} />{d.belowFloor && <span className="small"> below floor</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[
          { label: cal.forecastBills === cal.calendarBills ? 'Every bill here is in the cash forecast' : 'The forecast and the calendar disagree', ok: cal.forecastBills === cal.calendarBills, detail: <Money c={cal.calendarBills} dollar /> },
          { label: cal.days.some((d) => d.belowFloor) ? 'Projected balance dips below the floor' : 'Projected balance stays above the floor', ok: !cal.days.some((d) => d.belowFloor) },
        ]} />
      </section>
      {cal.awaiting.length > 0 && (
        <section className="panel" aria-labelledby="aw-h" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2 id="aw-h">Awaiting approval</h2><Link className="btn sm" to="/approvals">Approvals</Link></div>
          <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Bill</th><th scope="col">Vendor</th><th scope="col">Due</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>{cal.awaiting.map((b) => <tr key={b.id}><td><Link to={`/payables/bills/${b.id}`}>{b.ref}</Link></td><td>{vendorName(state, b.vendorId)}</td><td>{shortDate(b.dueDate)}</td><td className="num"><Money c={billTotal(b)} /></td></tr>)}</tbody></table></div>
        </section>
      )}
      <Help k="paymentCalendar" />
    </>
  );
}

// ── Utilities ────────────────────────────────────────────────────────────
export function UtilitiesPage() {
  const { state, books, user, stores, visible, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const rows = useMemo(() => utilityRows(state, today), [state, today, version]).filter((r) => visible.has(r.ua.storeId)); // eslint-disable-line react-hooks/exhaustive-deps
  const [errors, setErrors] = useState<string[]>([]);
  const blank = (): UtilityAccount => ({ id: '', vendorId: '', storeId: stores[0]?.id ?? '', service: 'electric', serviceAddress: '', accountNo: '', autopay: false, active: true });
  const [d, setD] = useState<UtilityAccount>(blank);
  const store = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const pd = rows.filter((r) => r.pastDue.length);
  const dc = rows.filter((r) => r.disconnect);
  const jumps = rows.filter((r) => r.jump);
  const billed = apState(state).bills.filter((b) => b.utilityAccountId && b.approved && b.status !== 'void');
  const billedTotal = billed.reduce((a, b) => a + billTotal(b), 0);
  const postedTotal = billed.reduce((a, b) => a + (state.transactions.find((t) => t.id === b.approved!.txnId && !t.deleted)?.lines.reduce((x, l) => x + l.debit, 0) ?? 0) - billTotal(b), 0);
  return (
    <>
      <PageHead eyebrow="Payables" title="Utilities" lede={`Each utility account with its store, account number, autopay and bill history. Flags: past due, disconnect notices, and bills more than ${JUMP_PCT}% above the one before.`}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('utilities', ['Vendor', 'Service', 'Store', 'Account', 'Address', 'Autopay', 'Last bill date', 'Last amount', 'Change %', 'Next due', 'Flags'], rows.map((r) => [vendorName(state, r.ua.vendorId), SERVICE_LABEL[r.ua.service], store(r.ua.storeId), r.ua.accountNo, r.ua.serviceAddress, r.ua.autopay ? 'yes' : 'no', r.last?.date ?? '', r.last ? csvMoney(r.last.amount) : '', r.changePct ?? '', r.nextDue ?? '', [r.pastDue.length ? 'past due' : '', r.disconnect ? 'disconnect notice' : '', r.jump ? 'jump' : ''].filter(Boolean).join('; ')]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Utilities" style={{ marginBottom: 20 }}>
        <Figure label="Accounts" value={rows.length} note={`${rows.filter((r) => r.ua.autopay).length} on autopay`} />
        <Figure label="Past due" value={pd.length} note={pd.length ? pd.map((r) => `${store(r.ua.storeId)} ${SERVICE_LABEL[r.ua.service].toLowerCase()}`).join(', ') : 'Nothing late'} />
        <Figure label="Disconnect notices" value={dc.length} note={dc.length ? <span className="neg">{dc.map((r) => `${store(r.ua.storeId)} ${r.ua.accountNo}`).join(', ')}</span> : 'None'} />
        <Figure label={`Jumps over ${JUMP_PCT}%`} value={jumps.length} note={jumps.length ? jumps.map((r) => `${store(r.ua.storeId)} ${SERVICE_LABEL[r.ua.service].toLowerCase()} +${r.changePct}%`).join(', ') : 'No unusual bills'} />
      </section>
      <section className="panel" aria-labelledby="ut-h">
        <div className="panel-head"><h2 id="ut-h">Accounts</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Account</th><th scope="col">Store</th><th scope="col">Autopay</th><th scope="col">Last bill</th><th scope="col" className="num">Change</th><th scope="col">Next due</th><th scope="col">Flags</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.ua.id}>
              <td><b>{vendorName(state, r.ua.vendorId)}</b><div className="muted small">{SERVICE_LABEL[r.ua.service]} · {r.ua.accountNo} · {r.ua.serviceAddress}</div>
                <details><summary className="small">Amount history ({r.history.length})</summary><ul className="small" style={{ paddingLeft: 18 }}>{r.history.map((h, i) => <li key={i}>{shortDate(h.date)} · <Money c={h.amount} dollar /> · {h.billId ? <Link to={`/payables/bills/${h.billId}`}>{h.status}</Link> : h.txnId ? <Link to={`/books/transactions/${h.txnId}`}>{h.status}</Link> : h.status}</li>)}</ul></details></td>
              <td>{store(r.ua.storeId)}</td><td>{r.ua.autopay ? 'Yes' : 'No'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.last ? <>{shortDate(r.last.date)}<div><Money c={r.last.amount} dollar /></div></> : <span className="muted">None yet</span>}</td>
              <td className={'num' + (r.jump ? ' neg' : '')}>{r.changePct === null ? '–' : `${r.changePct > 0 ? '+' : ''}${r.changePct}%`}</td>
              <td>{r.nextDue ? shortDate(r.nextDue) : '–'}</td>
              <td>{r.pastDue.length > 0 && <span className="pill bad">Past due</span>} {r.disconnect && <span className="pill bad">Disconnect notice</span>} {r.jump && <span className="pill warn">Jump</span>} {!r.pastDue.length && !r.disconnect && !r.jump && <span className="pill ok">OK</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[{ label: postedTotal === 0 ? 'Every approved utility bill is posted at its bill amount' : 'A utility bill and its entry disagree', ok: postedTotal === 0, detail: <>{billed.length} bills · <Money c={billedTotal} dollar /></> }]} />
      </section>
      {can(user, 'setup.edit') && (
        <section className="panel panel-pad" aria-labelledby="ua-h" style={{ marginTop: 16 }}>
          <h2 id="ua-h" style={{ marginBottom: 8 }}>Add a utility account</h2>
          <Errors errors={errors} />
          <div className="form-grid">
            <div className="field"><label htmlFor="ua-v">Utility company</label><select id="ua-v" value={d.vendorId} onChange={(e) => setD({ ...d, vendorId: e.target.value })}><option value="">Choose…</option>{state.parties.filter((p) => p.type === 'vendor' && !p.deleted).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="field"><label htmlFor="ua-sv">Service</label><select id="ua-sv" value={d.service} onChange={(e) => setD({ ...d, service: e.target.value as UtilityService })}>{(Object.keys(SERVICE_LABEL) as UtilityService[]).map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select></div>
            <div className="field"><label htmlFor="ua-s">Store</label><select id="ua-s" value={d.storeId} onChange={(e) => setD({ ...d, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <div className="field"><label htmlFor="ua-n">Account number</label><input id="ua-n" value={d.accountNo} onChange={(e) => setD({ ...d, accountNo: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="ua-a">Service address</label><input id="ua-a" value={d.serviceAddress} onChange={(e) => setD({ ...d, serviceAddress: e.target.value })} /></div>
          </div>
          <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={d.autopay} onChange={(e) => setD({ ...d, autopay: e.target.checked })} /> On autopay</label>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setErrors([]); try { saveUtilityAccount(books, user, { ...d, id: books.nextId('ua') }); setD(blank()); say('Utility account added.'); } catch (e) { setErrors(errList(e)); } }}>Add account</button></div>
        </section>
      )}
      {toast}
      <Help k="utilities" />
    </>
  );
}

// ── Vendor statements ────────────────────────────────────────────────────
export function VendorStatementsPage() {
  const { state, books, user } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const statements = [...apState(state).statements].sort((a, b) => b.date.localeCompare(a.date));
  const sel = statements.find((s) => s.id === sp.get('id')) ?? statements[0];
  const rec = sel ? reconcileStatement(state, sel) : null;
  const [vendorId, setVendor] = useState('');
  const [date, setDate] = useState(todayInChicago());
  const [bal, setBal] = useState('');
  const [linesText, setLinesText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  if (!useBooks().visible.has(bankStoreId(state))) return <PageHead eyebrow="Payables" title="Vendor statements" lede="Your role doesn't include company-wide payables." />;
  const add = () => {
    setErrors([]);
    const lines = linesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [inv, d, amt] = l.split(/[,\t;]+/).map((x) => x.trim());
      return { invoiceNo: inv ?? '', date: d ?? '', amount: parseMoney(amt ?? '') ?? NaN };
    });
    const b = parseMoney(bal);
    try {
      const st = saveVendorStatement(books, user, { vendorId, date, balance: b ?? NaN, lines });
      const n = new URLSearchParams(sp); n.set('id', st.id); setSp(n, { replace: true });
      setBal(''); setLinesText(''); say('Statement recorded.');
    } catch (e) { setErrors(errList(e)); }
  };
  return (
    <>
      <PageHead eyebrow="Payables" title="Vendor statements" lede="A vendor's statement against what our books say we owe them, with every difference explained.">
        {rec && can(user, 'export') && <button className="btn" onClick={() => exportCsv(`vendor-statement-${vendorName(state, rec.statement.vendorId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${rec.statement.date}`, ['Invoice', 'Date', 'Ours', 'Theirs', 'Effect', 'Finding', 'Note'], rec.items.map((i) => [i.invoiceNo, i.date ?? '', i.ours !== undefined ? csvMoney(i.ours) : '', i.theirs !== undefined ? csvMoney(i.theirs) : '', csvMoney(i.effect), STATEMENT_ITEM_LABEL[i.kind], i.note]))}>Export CSV</button>}
      </PageHead>
      {rec ? (
        <>
          <section className="figures" aria-label="Statement" style={{ marginBottom: 20 }}>
            <Figure label="Vendor says" value={<Money c={rec.statement.balance} dollar />} note={`${vendorName(state, rec.statement.vendorId)} · ${shortDate(rec.statement.date)}`} />
            <Figure label="Our AP" value={<Money c={rec.apBalance} dollar />} href={`/payables/bills?vendor=${rec.statement.vendorId}`} note="Open approved bills at that date" />
            <Figure label="Difference" value={<Money c={rec.difference} dollar />} />
            <Figure label="Not explained" value={<Money c={rec.unexplained} dollar className={rec.unexplained ? 'neg' : undefined} />} note={rec.unexplained ? 'Ask the vendor' : 'Every dollar explained'} />
          </section>
          <section className="panel" aria-labelledby="vs-h">
            <div className="panel-head"><h2 id="vs-h">Line by line</h2>
              {statements.length > 1 && <div className="field" style={{ width: 260 }}><label htmlFor="vs-s" className="sr-only">Statement</label><select id="vs-s" value={sel!.id} onChange={(e) => { const n = new URLSearchParams(sp); n.set('id', e.target.value); setSp(n, { replace: true }); }}>{statements.map((s) => <option key={s.id} value={s.id}>{vendorName(state, s.vendorId)} · {s.date}</option>)}</select></div>}
            </div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Invoice</th><th scope="col">Finding</th><th scope="col" className="num">Ours</th><th scope="col" className="num">Vendor's</th><th scope="col" className="num">Difference</th><th scope="col">What to do</th></tr></thead>
              <tbody>{rec.items.map((i, k) => (
                <tr key={k}><td>{i.billId ? <Link to={`/payables/bills/${i.billId}`}>{i.invoiceNo}</Link> : i.invoiceNo}</td><td><span className={'pill ' + (i.kind === 'agreed' ? 'ok' : i.kind === 'in_transit' ? '' : i.kind === 'unexplained' ? 'bad' : 'warn')}>{STATEMENT_ITEM_LABEL[i.kind]}</span></td>
                  <td className="num">{i.ours !== undefined ? <Money c={i.ours} /> : '–'}</td><td className="num">{i.theirs !== undefined ? <Money c={i.theirs} /> : '–'}</td><td className="num"><Money c={i.effect} /></td><td className="small">{i.note}</td></tr>
              ))}<tr className="total"><td colSpan={4}>Statement − our AP</td><td className="num"><Money c={rec.difference} /></td><td /></tr></tbody>
            </table></div>
            <TieOut items={[
              { label: rec.explained === rec.difference ? 'Line findings add up to the difference' : 'Findings do not add to the difference', ok: rec.explained === rec.difference },
              { label: rec.unexplained === 0 ? 'Nothing left unexplained' : `${formatMoney(rec.unexplained, { dollarSign: true })} not explained by any invoice`, ok: rec.unexplained === 0 },
            ]} />
          </section>
        </>
      ) : <p className="muted">No vendor statements recorded yet.</p>}
      {can(user, 'bills.pay') && (
        <section className="panel panel-pad" aria-labelledby="va-h" style={{ marginTop: 16 }}>
          <h2 id="va-h" style={{ marginBottom: 8 }}>Record a statement</h2>
          <Errors errors={errors} />
          <div className="form-grid">
            <div className="field"><label htmlFor="va-v">Vendor</label><select id="va-v" value={vendorId} onChange={(e) => setVendor(e.target.value)}><option value="">Choose…</option>{state.parties.filter((p) => p.type === 'vendor' && !p.deleted).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="field"><label htmlFor="va-d">Statement date</label><input id="va-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="va-b">Balance due per statement</label><input id="va-b" className="num" inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="va-l">Open invoices on the statement, one per line: invoice, date, amount</label><textarea id="va-l" rows={4} value={linesText} onChange={(e) => setLinesText(e.target.value)} placeholder={'IC-2364, 2026-10-15, 482.50'} /></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={add}>Reconcile statement</button></div>
        </section>
      )}
      {toast}
      <Help k="vendorStatements" />
    </>
  );
}

// ── 1099 tracking ────────────────────────────────────────────────────────
export function Ten99Page() {
  const { state, user, lines, version } = useBooks();
  const exportCsv = useExport();
  const today = todayInChicago();
  const year = Number(today.slice(0, 4));
  const rows = useMemo(() => ten99(state, year, today), [state, year, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!useBooks().visible.has(bankStoreId(state))) return <PageHead eyebrow="Payables" title="1099 vendors" lede="Your role doesn't include company-wide payables." />;
  const flagged = rows.filter((r) => r.flagged);
  const total = rows.reduce((a, r) => a + r.paid, 0);
  // Independent check from the flattened ledger lines.
  const ids = new Set(rows.map((r) => r.partyId));
  const money = new Set(state.accounts.filter((a) => a.subtype === 'bank' || a.subtype === 'cash').map((a) => a.id));
  const fromLines = lines.filter((f) => f.t.partyId && ids.has(f.t.partyId) && money.has(f.l.accountId) && f.date >= `${year}-01-01` && f.date <= today).reduce((a, f) => a + f.l.credit - f.l.debit, 0);
  return (
    <>
      <PageHead eyebrow="Payables" title="1099 vendors" lede={`Payments to vendors marked 1099 in ${year}, flagged at ${formatMoney(TEN99_THRESHOLD, { dollarSign: true, whole: true })}. The demo books start in September, so this year's totals are partial.`}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`1099-vendors-${year}`, ['Vendor', 'Payments', 'Paid YTD', 'Needs 1099'], rows.map((r) => [r.name, r.count, csvMoney(r.paid), r.flagged ? 'yes' : 'no']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="1099" style={{ marginBottom: 20 }}>
        <Figure label="1099 vendors" value={rows.length} href="/setup/parties" note="Marked in Vendors & parties" />
        <Figure label={`At ${formatMoney(TEN99_THRESHOLD, { dollarSign: true, whole: true })} or more`} value={flagged.length} note="Need a 1099-NEC in January" />
        <Figure label="Paid to 1099 vendors" value={<Money c={total} whole dollar />} note="Year to date" />
        <Figure label="Under the threshold" value={rows.length - flagged.length} />
      </section>
      <section className="panel" aria-labelledby="t9-h">
        <div className="panel-head"><h2 id="t9-h">Vendors</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Vendor</th><th scope="col" className="num">Payments</th><th scope="col" className="num">Paid year to date</th><th scope="col">Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.partyId}><td><Link to={`/books/transactions?party=${r.partyId}`}>{r.name}</Link></td><td className="num">{r.count}</td><td className="num"><Money c={r.paid} /></td><td>{r.flagged ? <span className="pill warn">File 1099</span> : <span className="pill">Under {formatMoney(TEN99_THRESHOLD, { dollarSign: true, whole: true })}</span>}</td></tr>
          ))}<tr className="total"><td>Total</td><td className="num">{rows.reduce((a, r) => a + r.count, 0)}</td><td className="num"><Money c={total} /></td><td /></tr></tbody>
        </table></div>
        <TieOut items={[{ label: fromLines === total ? 'Ties to bank and cash lines in the ledger' : 'Does not tie to the ledger', ok: fromLines === total, detail: <Money c={fromLines} dollar /> }]} />
      </section>
      <Help k="ten99" />
    </>
  );
}
