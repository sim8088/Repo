import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  DEFAULT_INCOME, KIND_LABEL, RENT_INCOME, RENT_STATUS_LABEL, arState, atmIncome, closeReceivable, linkReceipt, receiptCandidates, receivableItems,
  recordReceivableReceipt, recordRentReceipt, rentRoll, saveReceivable, type ItemStatus, type RentStatus,
} from '../../core/receivables';
import { addDays, periodLabel, periodOf, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { bankStoreId } from '../../core/bank';
import type { ID, ReceivableKind } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const PILL: Record<RentStatus, string> = { paid: 'ok', paid_late: 'warn', partial: 'bad', late: 'bad', due: 'warn', upcoming: '' };

function useCorp() {
  const { state, user, visible } = useBooks();
  return visible.has(bankStoreId(state)) && can(user, 'view.reports');
}

// ── Tenant rent ──────────────────────────────────────────────────────────
export function RentRollPage() {
  const { state, books, user, lines, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ok = useCorp();
  const today = todayInChicago();
  const roll = useMemo(() => rentRoll(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tenants = arState(state).rent.filter((s) => s.active);
  const [tenantId, setTenant] = useState(roll.charges.find((c) => c.status === 'late')?.tenantId ?? tenants[0]?.tenantId ?? '');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  if (!ok) return <PageHead eyebrow="Receivables" title="Tenant rent" lede="Your role doesn't include company-wide receivables." />;
  const name = (id: ID) => state.parties.find((p) => p.id === id)?.name.replace(' (tenant)', '') ?? id;
  const store = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const month = periodOf(today);
  const thisMonth = roll.charges.filter((c) => c.period === month);
  const late = roll.charges.filter((c) => c.status === 'late' || c.status === 'partial');
  const receivedTotal = roll.receipts.reduce((a, r) => a + r.amount, 0);
  const applied = roll.charges.reduce((a, c) => a + c.paid, 0);
  const unapplied = [...roll.unapplied.values()].reduce((a, b) => a + b, 0);
  const tenantIds = new Set(tenants.map((t) => t.tenantId));
  const ledgerRent = lines.filter((f) => f.l.accountId === RENT_INCOME && f.t.partyId && tenantIds.has(f.t.partyId) && f.date <= today).reduce((a, f) => a + f.l.credit - f.l.debit, 0);
  const rows = [...roll.charges].sort((a, b) => b.period.localeCompare(a.period) || name(a.tenantId).localeCompare(name(b.tenantId)));
  return (
    <>
      <PageHead eyebrow="Receivables" title="Tenant rent" lede="Each tenant's monthly rent, due vs received. Rent is late once the grace days after the due date have passed.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('rent-roll', ['Tenant', 'Store', 'Month', 'Due', 'Rent', 'Received', 'Status', 'Days late'], rows.map((c) => [name(c.tenantId), store(c.storeId), c.period, c.dueDate, csvMoney(c.amount), csvMoney(c.paid), RENT_STATUS_LABEL[c.status], c.daysLate]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Rent" style={{ marginBottom: 20 }}>
        <Figure label={`${periodLabel(month)} rent due`} value={<Money c={thisMonth.reduce((a, c) => a + c.amount, 0)} whole dollar />} note={`${thisMonth.length} tenants`} />
        <Figure label={`${periodLabel(month)} received`} value={<Money c={thisMonth.reduce((a, c) => a + c.paid, 0)} whole dollar />} />
        <Figure label="Late" value={<Money c={late.reduce((a, c) => a + c.amount - c.paid, 0)} whole dollar className={late.length ? 'neg' : undefined} />} note={late.length ? late.map((c) => `${name(c.tenantId)} ${periodLabel(c.period)}`).join(', ') : 'Nobody is late'} />
        <Figure label="Paid ahead / unapplied" value={<Money c={unapplied} whole dollar />} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="rr-h">
          <div className="panel-head"><h2 id="rr-h">Rent roll</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Tenant</th><th scope="col">Store</th><th scope="col">Month</th><th scope="col">Due</th><th scope="col" className="num">Rent</th><th scope="col" className="num">Received</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.scheduleId + c.period}><td><Link to={`/intercompany/parties/${c.tenantId}`}>{name(c.tenantId)}</Link></td><td>{store(c.storeId)}</td><td>{periodLabel(c.period)}</td><td>{shortDate(c.dueDate)}</td>
                <td className="num"><Money c={c.amount} /></td><td className="num"><Money c={c.paid} /></td>
                <td><span className={'pill ' + PILL[c.status]}>{RENT_STATUS_LABEL[c.status]}{c.daysLate ? ` · ${c.daysLate} days` : ''}</span>{c.paidOn && <span className="muted small"> {shortDate(c.paidOn)}</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: applied + unapplied === receivedTotal ? 'Every rent deposit is applied to a month (or held as paid ahead)' : 'Rent deposits are not fully applied', ok: applied + unapplied === receivedTotal },
            { label: receivedTotal === ledgerRent ? 'Rent received ties to rent income from these tenants' : 'Rent received does not tie to the ledger', ok: receivedTotal === ledgerRent, detail: <><Money c={ledgerRent} dollar /> on 4300</> },
          ]} />
        </section>
        {can(user, 'ar.edit') && (
          <section className="panel panel-pad" aria-labelledby="rp-h">
            <h2 id="rp-h" style={{ marginBottom: 8 }}>Record rent received</h2>
            <Errors errors={errors} />
            <div className="form-grid">
              <div className="field"><label htmlFor="rp-t">Tenant</label><select id="rp-t" value={tenantId} onChange={(e) => setTenant(e.target.value)}>{tenants.map((t) => <option key={t.id} value={t.tenantId}>{name(t.tenantId)} · {store(t.storeId)}</option>)}</select></div>
              <div className="field"><label htmlFor="rp-d">Date received</label><input id="rp-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="field"><label htmlFor="rp-a">Amount</label><input id="rp-a" className="num" inputMode="decimal" value={amount} placeholder={formatMoney(tenants.find((t) => t.tenantId === tenantId)?.amount ?? 0)} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setErrors([]); try { const amt = amount.trim() ? parseMoney(amount) : tenants.find((t) => t.tenantId === tenantId)?.amount ?? null; const t = recordRentReceipt(books, user, { tenantId, date, amount: amt ?? NaN }); setAmount(''); say(`Posted ${t.ref}. Applied to the oldest open month.`); } catch (e) { setErrors(errList(e)); } }}>Record rent</button><span className="muted small">Posts money in to Trustmark and rent income at the tenant's store.</span></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="rentRoll" />
    </>
  );
}

// ── Rebates, ATM, claims, refunds ────────────────────────────────────────
const TABS: [string, string][] = [['rebate', 'Rebates & programs'], ['atm', 'ATM income'], ['insurance', 'Insurance claims'], ['refund', 'Refunds owed to us']];

export function OtherReceivablesPage() {
  const { state, user, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const ok = useCorp();
  const today = todayInChicago();
  const tab = sp.get('tab') ?? 'rebate';
  const all = useMemo(() => receivableItems(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <PageHead eyebrow="Receivables" title="Rebates & other income" lede="Your role doesn't include company-wide receivables." />;
  const open = all.filter((i) => i.outstanding > 0);
  const overdue = all.filter((i) => i.overdue);
  const sum = (xs: ItemStatus[], k: 'received' | 'outstanding') => xs.reduce((a, i) => a + i[k], 0);
  const rebates = all.filter((i) => i.item.kind === 'rebate');
  return (
    <>
      <PageHead eyebrow="Receivables" title="Rebates & other income" lede="Money owed to us outside rent: scan-data rebates and programs, ATM income, insurance claims and refunds.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('receivables', ['Type', 'Payer', 'Description', 'Store', 'Expected by', 'Expected', 'Received', 'Outstanding', 'Status'], all.map((i) => [KIND_LABEL[i.item.kind], i.item.payer, i.item.description, state.stores.find((s) => s.id === i.item.storeId)?.code ?? '', i.item.expectedBy, csvMoney(i.item.expected), csvMoney(i.received), csvMoney(i.outstanding), i.status]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Receivables" style={{ marginBottom: 20 }}>
        <Figure label="Outstanding" value={<Money c={sum(all, 'outstanding')} whole dollar />} note={`${open.length} item${open.length === 1 ? '' : 's'}`} />
        <Figure label="Rebates outstanding" value={<Money c={sum(rebates, 'outstanding')} whole dollar />} note={rebates.filter((i) => i.outstanding).map((i) => i.item.payer).join(', ') || 'None'} />
        <Figure label="Overdue" value={<Money c={sum(overdue, 'outstanding')} whole dollar className={overdue.length ? 'neg' : undefined} />} note={overdue.length ? overdue.map((i) => i.item.payer).join(', ') : 'Nothing overdue'} />
        <Figure label="Received" value={<Money c={sum(all, 'received')} whole dollar />} note="Applied to items so far" />
      </section>
      <div className="seg" role="group" aria-label="Kind" style={{ marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => { const n = new URLSearchParams(sp); n.set('tab', k); setSp(n, { replace: true }); }}>{l}</button>)}
      </div>
      {tab === 'atm' ? <AtmTab /> : <ItemsTab kind={tab as ReceivableKind} items={all.filter((i) => i.item.kind === tab)} />}
      <Help k="otherReceivables" />
    </>
  );
}

function ItemsTab({ kind, items }: { kind: ReceivableKind; items: ItemStatus[] }) {
  const { state, books, user, stores } = useBooks();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const [open, setOpen] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [nw, setNw] = useState({ payer: '', description: '', storeId: bankStoreId(state), expected: '', expectedBy: addDays(today, 30), incomeAccountId: DEFAULT_INCOME[kind] });
  const canEdit = can(user, 'ar.edit');
  const run = (fn: () => string) => { setErrors([]); try { say(fn()); setOpen(null); setAmount(''); setReason(''); } catch (e) { setErrors(errList(e)); } };
  const live = new Set(state.transactions.filter((t) => !t.deleted).map((t) => t.id));
  const banks = new Set(state.accounts.filter((a) => a.subtype === 'bank').map((a) => a.id));
  // Independent check: received = the bank side of the live deposits applied to these items.
  const fromBank = items.reduce((a, i) => a + i.item.receipts.filter((r) => live.has(r.txnId)).reduce((x, r) => x + (state.transactions.find((t) => t.id === r.txnId)?.lines.filter((l) => banks.has(l.accountId)).reduce((y, l) => y + l.debit - l.credit, 0) ?? 0), 0), 0);
  const received = items.reduce((a, i) => a + i.received, 0);
  const expected = items.reduce((a, i) => a + i.item.expected, 0);
  const outstanding = items.reduce((a, i) => a + i.outstanding, 0);
  const closedGap = items.filter((i) => i.item.closed).reduce((a, i) => a + Math.max(0, i.item.expected - i.received), 0);
  const store = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="it-h">
        <div className="panel-head"><h2 id="it-h">{KIND_LABEL[kind]}</h2></div>
        <Errors errors={errors} />
        {items.length === 0 ? <p className="panel-pad muted">Nothing here yet.</p> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">From</th><th scope="col">For</th><th scope="col">Store</th><th scope="col">Expected by</th><th scope="col" className="num">Expected</th><th scope="col" className="num">Received</th><th scope="col" className="num">Outstanding</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{items.map((i) => (
              <Row key={i.item.id} i={i} open={open === i.item.id} onToggle={() => setOpen(open === i.item.id ? null : i.item.id)} canEdit={canEdit} store={store(i.item.storeId)}>
                <div className="actions" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ width: 150 }}><label htmlFor={`rx-d-${i.item.id}`}>Date received</label><input id={`rx-d-${i.item.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div className="field" style={{ width: 130 }}><label htmlFor={`rx-a-${i.item.id}`}>Amount</label><input id={`rx-a-${i.item.id}`} className="num" inputMode="decimal" value={amount} placeholder={formatMoney(i.outstanding)} onChange={(e) => setAmount(e.target.value)} /></div>
                  <button className="btn primary sm" onClick={() => run(() => { const t = recordReceivableReceipt(books, user, i.item.id, { date, amount: amount.trim() ? parseMoney(amount) ?? NaN : i.outstanding }); return `Posted ${t.ref} and applied it.`; })}>Record money received</button>
                  {receiptCandidates(state, i.item).map((t) => <button key={t.id} className="btn sm" onClick={() => run(() => { linkReceipt(books, user, i.item.id, t.id); return `Applied ${t.ref}.`; })}>Apply {t.ref} · {shortDate(t.date)}</button>)}
                  <div className="field" style={{ width: 220 }}><label htmlFor={`rx-c-${i.item.id}`}>Close with reason</label><input id={`rx-c-${i.item.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Claim denied" /></div>
                  <button className="btn sm ghost" onClick={() => run(() => { closeReceivable(books, user, i.item.id, reason); return 'Closed.'; })}>Close</button>
                </div>
              </Row>
            ))}</tbody>
          </table></div>
        )}
        <TieOut items={[
          { label: received + outstanding + closedGap === expected ? 'Expected = received + outstanding' : 'Expected, received and outstanding do not agree', ok: received + outstanding + closedGap === expected, detail: closedGap ? <>incl. <Money c={closedGap} dollar /> closed unpaid</> : undefined },
          { label: fromBank === received ? 'Received ties to the deposits in the books' : 'Received does not tie to the deposits', ok: fromBank === received, detail: <Money c={fromBank} dollar /> },
        ]} />
        {toast}
      </section>
      {canEdit && (
        <section className="panel panel-pad" aria-labelledby="na-h">
          <h2 id="na-h" style={{ marginBottom: 8 }}>Add {KIND_LABEL[kind].toLowerCase()}</h2>
          <div className="form-grid">
            <div className="field"><label htmlFor="na-p">Who owes it</label><input id="na-p" value={nw.payer} onChange={(e) => setNw({ ...nw, payer: e.target.value })} placeholder={kind === 'rebate' ? 'e.g. ITG' : kind === 'insurance' ? 'Insurer' : 'Vendor'} /></div>
            <div className="field"><label htmlFor="na-d">What for</label><input id="na-d" value={nw.description} onChange={(e) => setNw({ ...nw, description: e.target.value })} /></div>
            <div className="field"><label htmlFor="na-s">Store</label><select id="na-s" value={nw.storeId} onChange={(e) => setNw({ ...nw, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <div className="field"><label htmlFor="na-e">Expected</label><input id="na-e" className="num" inputMode="decimal" value={nw.expected} onChange={(e) => setNw({ ...nw, expected: e.target.value })} /></div>
            <div className="field"><label htmlFor="na-b">Expected by</label><input id="na-b" type="date" value={nw.expectedBy} onChange={(e) => setNw({ ...nw, expectedBy: e.target.value })} /></div>
            <div className="field"><label htmlFor="na-i">Posts to</label><select id="na-i" value={nw.incomeAccountId} onChange={(e) => setNw({ ...nw, incomeAccountId: e.target.value })}><AccountOptions filter={(a) => a.type === 'revenue' || a.type === 'expense' || a.type === 'cogs'} /></select></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => run(() => { saveReceivable(books, user, { id: books.nextId('ar'), kind, payer: nw.payer, description: nw.description, storeId: nw.storeId, expected: parseMoney(nw.expected) ?? NaN, expectedBy: nw.expectedBy, incomeAccountId: nw.incomeAccountId, receipts: [], createdAt: books.clock() }); setNw({ ...nw, payer: '', description: '', expected: '' }); return 'Added.'; })}>Add</button></div>
        </section>
      )}
    </div>
  );
}

function Row({ i, open, onToggle, canEdit, store, children }: { i: ItemStatus; open: boolean; onToggle: () => void; canEdit: boolean; store: string; children: ReactNode }) {
  const pill = i.status === 'received' ? 'ok' : i.status === 'overdue' ? 'bad' : i.status === 'closed' ? '' : 'warn';
  return (
    <>
      <tr>
        <td>{i.item.payer}</td><td className="trunc" title={i.item.description}>{i.item.description}</td><td>{store}</td><td>{shortDate(i.item.expectedBy)}</td>
        <td className="num"><Money c={i.item.expected} /></td><td className="num"><Money c={i.received} /></td><td className="num"><Money c={i.outstanding} /></td>
        <td><span className={'pill ' + pill}>{i.status === 'closed' ? `Closed · ${i.item.closed!.reason}` : i.status[0].toUpperCase() + i.status.slice(1)}</span></td>
        <td>{canEdit && i.outstanding > 0 && <button className="btn sm" aria-expanded={open} onClick={onToggle} aria-label={`Receive money for ${i.item.payer} ${i.item.description}`}>Receive</button>}</td>
      </tr>
      {open && <tr><td colSpan={9}>{children}</td></tr>}
    </>
  );
}

function AtmTab() {
  const { state } = useBooks();
  const today = todayInChicago();
  const first = state.transactions.filter((t) => !t.deleted && t.kind !== 'opening').map((t) => t.date).sort()[0] ?? today;
  const rows = atmIncome(state, periodOf(first), periodOf(today));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const ledger = state.transactions.filter((t) => !t.deleted && t.date <= today).reduce((a, t) => a + t.lines.filter((l) => l.accountId === 'acct_atm_income').reduce((x, l) => x + l.credit - l.debit, 0), 0);
  const missing = rows.filter((r) => r.amount === 0 && r.period < periodOf(today));
  return (
    <section className="panel" aria-labelledby="atm-h">
      <div className="panel-head"><h2 id="atm-h">ATM income by month</h2>{missing.length > 0 && <span className="pill bad">{missing.length} month{missing.length === 1 ? '' : 's'} with nothing received</span>}</div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Month</th><th scope="col">Deposits</th><th scope="col" className="num">Received</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.period}><td>{periodLabel(r.period)}</td><td>{r.txns.length ? r.txns.map((t) => <Link key={t.id} to={`/books/transactions/${t.id}`} style={{ marginRight: 8 }}>{t.ref}</Link>) : <span className={r.period < periodOf(today) ? 'neg' : 'muted'}>{r.period < periodOf(today) ? 'Nothing received: ask the ATM operator' : 'Not yet this month'}</span>}</td><td className="num"><Money c={r.amount} /></td></tr>
        ))}<tr className="total"><td colSpan={2}>Total</td><td className="num"><Money c={total} /></td></tr></tbody>
      </table></div>
      <TieOut items={[{ label: total === ledger ? 'Ties to 4310 ATM income' : 'Does not tie to ATM income', ok: total === ledger, detail: <Money c={ledger} dollar /> }]} />
    </section>
  );
}
