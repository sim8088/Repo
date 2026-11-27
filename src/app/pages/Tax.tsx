import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { OccurrenceForm } from './Compliance';
import {
  ADJ_LABEL, CLASS_FORM, CLASS_LABEL_TAX, DISCLAIMER, INVENTORY_LABEL, LEVER_LABEL, M1_LABEL, RATE_NOTES, adjustments, bookDepTie, bookToTax, bookVsTax, bookReceipts,
  distributionCapacity, estimates, k1Allocation, m2, macrsTable, maskEin, methodsPanel, midQuarterTest, planning, profileOf, ratesOf, recordEstimatePayment, returnUnits,
  reviewAdjustment, salesTaxPeriod, salesTaxPeriods, salesTaxTie, salesTaxWorksheet, saveAdjustment, saveAssetTax, saveEstimatePlan, saveMethodChange, saveTaxProfile,
  saveTaxRates, setLever, setOwnerStart, setPriorIncome, setReceipts, slMidMonthTable, taxCalendar, taxDistributions, taxNotices, taxOf, priorIncomeOf, ownerStartOf,
  type AdjRow, type EstimateStatus,
} from '../../core/tax';
import { cpaPackage, cpaPackageZip } from '../../core/taxPackage';
import { CLASS_LABEL, assetsOf } from '../../core/assets';
import { ownerDraws } from '../../core/intercompany';
import { ledgerDeptSales } from '../../core/inside';
import { statement } from '../../core/statements';
import { NOTICE_STATUS_LABEL, complianceOf } from '../../core/compliance';
import { addDays, lastDayOfPeriod, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney, type Cents } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { bankStoreId } from '../../core/bank';
import type { AdjKind, EntityTaxProfile, ID, InventoryMethod, LeverKey, M1Line, MethodChange, TaxMethod, TaxRates } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const $ = (c: Cents) => formatMoney(c, { dollarSign: true });
const pctBps = (b: number) => `${(b / 100).toFixed(b % 100 ? 2 : 0)}%`;

/** Tax screens read company-wide data: they need reports access and Corporate's books. */
function useTax() {
  const { state, user, visible } = useBooks();
  const [sp, setSp] = useSearchParams();
  const today = todayInChicago();
  const year = Number(sp.get('year')) || Number(today.slice(0, 4));
  const asOf = `${year}-12-31` < today ? `${year}-12-31` : today;
  const ok = can(user, 'view.reports') && visible.has(bankStoreId(state));
  const set = (k: string, v: string) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }); };
  return { today, year, asOf, ok, sp, set, edit: can(user, 'tax.edit') };
}

function NoAccess({ title }: { title: string }) {
  return <PageHead eyebrow="Tax" title={title} lede="Your role doesn't include the tax working papers. They cover company-wide books." />;
}

function Disclaimer() {
  return <p className="muted small" style={{ margin: '0 0 16px' }}>{DISCLAIMER}</p>;
}

function YearSelect({ year, onChange }: { year: number; onChange: (y: string) => void }) {
  const now = Number(todayInChicago().slice(0, 4));
  return (
    <div className="field"><label htmlFor="tax-year">Tax year</label>
      <select id="tax-year" value={year} onChange={(e) => onChange(String(e.target.value) === String(now) ? '' : e.target.value)}>{[now, now - 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
    </div>
  );
}

function ReturnSelect({ value, onChange }: { value: ID; onChange: (v: ID) => void }) {
  const { state } = useBooks();
  return (
    <div className="field"><label htmlFor="tax-ret">Return</label>
      <select id="tax-ret" value={value} onChange={(e) => onChange(e.target.value)}>{returnUnits(state).map((u) => <option key={u.entity.id} value={u.entity.id}>{u.entity.code} · {u.form}</option>)}</select>
    </div>
  );
}

function useReturn(sp: URLSearchParams) {
  const { state } = useBooks();
  const units = returnUnits(state);
  const id = sp.get('entity') && units.some((u) => u.entity.id === sp.get('entity')) ? sp.get('entity')! : units[0]?.entity.id ?? '';
  return id;
}

const moneyInput = (s: string): Cents | null => (s.trim() === '' ? 0 : parseMoney(s));

// ── Entity map ───────────────────────────────────────────────────────────
export function TaxEntitiesPage() {
  const { state, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const units = useMemo(() => returnUnits(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState<ID | null>(null);
  if (!t.ok) return <NoAccess title="Entity map" />;
  const party = (id: ID) => state.parties.find((p) => p.id === id)?.name ?? id;
  const ents = state.entities.filter((e) => !e.deleted);
  const owners = new Set(ents.flatMap((e) => profileOf(state, e.id).owners.map((o) => o.partyId)));
  const filing = units.filter((u) => u.entity.taxClass !== 'disregarded' || !profileOf(state, u.entity.id).parentEntityId);
  const set100 = filing.filter((u) => profileOf(state, u.entity.id).owners.reduce((a, o) => a + o.pctBps, 0) === 10_000);
  const docs = complianceOf(state).docs;
  const rows = ents.map((e) => {
    const p = profileOf(state, e.id);
    const files = units.find((u) => u.members.includes(e.id))!;
    return { e, p, files };
  });
  // Owner draws should go to someone who owns the return they came from.
  const draws = ownerDraws(state, { from: `${t.year}-01-01`, to: t.asOf }).rows;
  const strays = draws.filter((r) => { const u = units.find((x) => x.storeIds.includes(r.l.storeId)); return !r.ownerId || !u || !profileOf(state, u.entity.id).owners.some((o) => o.partyId === r.ownerId); });
  return (
    <>
      <PageHead eyebrow="Tax" title="Entity map" lede="Every entity's tax classification, EIN, owners and %, state registrations, fiscal year, preparer and where last year's return is kept. Disregarded entities roll into the return that carries them.">
        <ExportButtons name="tax-entity-map" header={['Entity', 'Name', 'Classification', 'EIN', 'Files on', 'Owners', 'States', 'FY end', 'Preparer', 'Method', 'Prior returns']} rows={rows.map(({ e, p, files }) => [e.code, e.name, CLASS_FORM[e.taxClass], maskEin(e.ein), files.entity.code, p.owners.map((o) => `${party(o.partyId)} ${pctBps(o.pctBps)}`).join('; '), p.states.map((s) => `${s.state} ${s.kind}`).join('; '), String(p.fiscalYearEndMonth), p.preparer ?? '', p.method, p.priorReturns.map((r) => `${r.year}: ${r.location}`).join('; ')])} />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Entity map" style={{ marginBottom: 20 }}>
        <Figure label="Returns to file" value={filing.length} note={filing.map((u) => `${u.entity.code} ${u.form}`).join(' · ')} />
        <Figure label="Entities" value={ents.length} note={`${ents.filter((e) => e.taxClass === 'disregarded').length} disregarded`} />
        <Figure label="Owners" value={owners.size} note={[...owners].map(party).join(', ') || 'None entered'} />
        <Figure label="Ownership set" value={`${set100.length} of ${filing.length}`} note="Returns whose owners add to 100%" />
      </section>
      <section className="panel" aria-labelledby="em-h">
        <div className="panel-head"><h2 id="em-h">Entities</h2><Link className="btn sm" to="/setup/entities">Classification &amp; EIN in Setup</Link></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Entity</th><th scope="col">Classification</th><th scope="col">EIN</th><th scope="col">Files on</th><th scope="col">Owners</th><th scope="col">States</th><th scope="col">FY · method</th><th scope="col">Preparer · prior returns</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map(({ e, p, files }) => [
            <tr key={e.id}>
              <td><b>{e.code}</b><div className="muted small">{e.name}</div></td>
              <td>{CLASS_LABEL_TAX[e.taxClass]}<div className="muted small">{CLASS_FORM[e.taxClass]}</div></td>
              <td className="num">{maskEin(e.ein)}</td>
              <td>{files.entity.id === e.id ? <span className="pill ok">Own return</span> : <>{files.entity.code}<div className="muted small">{files.form}</div></>}</td>
              <td>{p.owners.length ? p.owners.map((o) => <div key={o.partyId}>{party(o.partyId)} <span className="muted">{pctBps(o.pctBps)}</span></div>) : <span className="muted">{e.taxClass === 'disregarded' ? `Owned by ${files.entity.code}` : 'Not entered'}</span>}</td>
              <td className="small">{p.states.length ? p.states.map((s, i) => <div key={i}>{s.state} {s.kind}<span className="muted"> #{s.accountNo}</span></div>) : <span className="muted">None</span>}</td>
              <td className="small">FY ends month {p.fiscalYearEndMonth}<div className="muted">{p.method === 'cash' ? 'Cash' : 'Accrual'} · {INVENTORY_LABEL[p.inventoryMethod]}</div></td>
              <td className="small">{p.preparer ?? <span className="muted">—</span>}{p.priorReturns.map((r) => <div key={r.year} className="muted">{r.year}: {r.docId ? <Link to={`/compliance/vault?q=${encodeURIComponent(docs.find((d) => d.id === r.docId)?.attachment?.name ?? '')}`}>{docs.find((d) => d.id === r.docId)?.attachment?.name ?? 'Vault document'}</Link> : r.location}</div>)}</td>
              <td>{t.edit && <button className="btn sm" aria-expanded={editing === e.id} aria-label={`Edit tax profile for ${e.code}`} onClick={() => setEditing(editing === e.id ? null : e.id)}>Edit</button>}</td>
            </tr>,
            editing === e.id && <tr key={e.id + 'f'}><td colSpan={9}><ProfileForm entityId={e.id} onDone={(m) => { setEditing(null); say(m); }} /></td></tr>,
          ])}</tbody>
        </table></div>
        <TieOut items={[
          { label: set100.length === filing.length ? 'Every return\'s ownership adds to 100%' : `${filing.length - set100.length} return(s) have ownership that doesn't add to 100%`, ok: set100.length === filing.length },
          { label: 'Every disregarded entity rolls into a return that files', ok: ents.filter((e) => e.taxClass === 'disregarded').every((e) => units.some((u) => u.members.includes(e.id) && u.entity.taxClass !== 'disregarded')) },
          { label: strays.length ? `${strays.length} owner draw(s) went to someone who doesn't own that return` : `Owner draws this year (${draws.length}) all went to owners of the return they came from`, ok: !strays.length },
        ]} />
      </section>
      {toast}
      <Help k="taxEntities" />
    </>
  );
}

function ProfileForm({ entityId, onDone }: { entityId: ID; onDone: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const p0 = profileOf(state, entityId);
  const e = state.entities.find((x) => x.id === entityId)!;
  const ownerParties = state.parties.filter((p) => p.type === 'owner' && !p.deleted);
  const [owners, setOwners] = useState(p0.owners.map((o) => ({ partyId: o.partyId, pct: String(o.pctBps / 100) })));
  const [parent, setParent] = useState(p0.parentEntityId ?? '');
  const [statesText, setStates] = useState(p0.states.map((s) => `${s.state} | ${s.kind} | ${s.accountNo}`).join('\n'));
  const [preparer, setPreparer] = useState(p0.preparer ?? '');
  const [fy, setFy] = useState(String(p0.fiscalYearEndMonth));
  const [method, setMethod] = useState<TaxMethod>(p0.method);
  const [inv, setInv] = useState<InventoryMethod>(p0.inventoryMethod);
  const [prior, setPrior] = useState(p0.priorReturns.map((r) => `${r.year} | ${r.docId ?? ''} | ${r.location}`).join('\n'));
  const [errors, setErrors] = useState<string[]>([]);
  const id = entityId;
  return (
    <div className="panel-pad" style={{ background: 'var(--panel-2)' }}>
      <Errors errors={errors} />
      <div className="form-grid">
        {owners.map((o, i) => (
          <div key={i} className="field"><label htmlFor={`po-${id}-${i}`}>Owner {i + 1}</label>
            <select id={`po-${id}-${i}`} value={o.partyId} onChange={(x) => setOwners(owners.map((y, j) => (j === i ? { ...y, partyId: x.target.value } : y)))}><option value="">Remove</option>{ownerParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <label htmlFor={`pp-${id}-${i}`} className="sr-only">Owner {i + 1} percent</label>
            <input id={`pp-${id}-${i}`} className="num" inputMode="decimal" value={o.pct} onChange={(x) => setOwners(owners.map((y, j) => (j === i ? { ...y, pct: x.target.value } : y)))} />
            <span className="hint">% owned</span>
          </div>
        ))}
        <div className="field"><span className="seg-label">Owners</span><button type="button" className="btn sm" onClick={() => setOwners([...owners, { partyId: ownerParties[0]?.id ?? '', pct: '' }])}>Add an owner</button></div>
        {e.taxClass === 'disregarded' && <div className="field"><label htmlFor={`pa-${id}`}>Files on (parent)</label><select id={`pa-${id}`} value={parent} onChange={(x) => setParent(x.target.value)}><option value="">Its own owner</option>{state.entities.filter((x) => x.id !== id && !x.deleted).map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></div>}
        <div className="field"><label htmlFor={`pf-${id}`}>Fiscal year ends (month)</label><input id={`pf-${id}`} className="num" inputMode="numeric" value={fy} onChange={(x) => setFy(x.target.value)} /></div>
        <div className="field"><label htmlFor={`pm-${id}`}>Overall method</label><select id={`pm-${id}`} value={method} onChange={(x) => setMethod(x.target.value as TaxMethod)}><option value="accrual">Accrual</option><option value="cash">Cash</option></select></div>
        <div className="field"><label htmlFor={`pi-${id}`}>Inventory method</label><select id={`pi-${id}`} value={inv} onChange={(x) => setInv(x.target.value as InventoryMethod)}>{(Object.keys(INVENTORY_LABEL) as InventoryMethod[]).map((k) => <option key={k} value={k}>{INVENTORY_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor={`pr-${id}`}>Preparer</label><input id={`pr-${id}`} value={preparer} onChange={(x) => setPreparer(x.target.value)} /></div>
        <div className="field"><label htmlFor={`ps-${id}`}>State registrations</label><textarea id={`ps-${id}`} rows={3} value={statesText} onChange={(x) => setStates(x.target.value)} /><span className="hint">One per line: state | kind | account #</span></div>
        <div className="field"><label htmlFor={`px-${id}`}>Prior returns</label><textarea id={`px-${id}`} rows={3} value={prior} onChange={(x) => setPrior(x.target.value)} /><span className="hint">One per line: year | vault document id (optional) | where it is kept</span></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => {
          setErrors([]);
          const p: EntityTaxProfile = {
            ...p0, entityId, parentEntityId: parent || undefined, preparer, fiscalYearEndMonth: Number(fy), method, inventoryMethod: inv,
            owners: owners.filter((o) => o.partyId).map((o) => ({ partyId: o.partyId, pctBps: Math.round(Number(o.pct) * 100) })),
            states: statesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [state, kind = '', accountNo = ''] = l.split('|').map((x) => x.trim()); return { state, kind, accountNo }; }),
            priorReturns: prior.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [y, doc = '', location = ''] = l.split('|').map((x) => x.trim()); return { year: Number(y), docId: doc || undefined, location }; }),
          };
          if (e.taxClass !== 'disregarded') delete p.parentEntityId;
          try { saveTaxProfile(books, user, p); onDone(`Saved the tax profile for ${e.code}.`); } catch (x) { setErrors(errList(x)); }
        }}>Save profile</button>
      </div>
    </div>
  );
}

// ── Calendar & returns ───────────────────────────────────────────────────
export function TaxCalendarPage() {
  const { state, visible, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const show = t.sp.get('show') ?? '';
  const rows = useMemo(() => taxCalendar(state, { from: addDays(t.today, -120), to: addDays(t.today, 400), today: t.today, visible }), [state, visible, t.today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t.ok) return <NoAccess title="Calendar & returns" />;
  const overdue = rows.filter((r) => r.overdue);
  const returns30 = rows.filter((r) => r.isReturn && !r.done && r.daysLeft >= 0 && r.daysLeft <= 30);
  const est14 = rows.filter((r) => r.estimate && !r.done && r.daysLeft <= 14);
  const doneYear = rows.filter((r) => r.done && r.dueDate.startsWith(t.today.slice(0, 4)));
  const notices = taxNotices(state, visible);
  const openNotices = notices.filter((n) => n.status !== 'closed');
  const list = show === 'open' ? rows.filter((r) => !r.done && r.daysLeft <= 30) : rows.filter((r) => r.daysLeft <= 120 || !r.done);
  const filed = rows.filter((r) => r.occ?.occ && ['filed', 'paid', 'accepted'].includes(r.occ.occ.status));
  const unsupported = filed.filter((r) => !r.occ!.occ!.confirmation && !r.occ!.occ!.attachments.length);
  const pays = taxOf(state).payments.filter((p) => p.txnId);
  const txTotal = (id: ID) => { const x = state.transactions.find((y) => y.id === id && !y.deleted); return x ? x.lines.filter((l) => !l.system).reduce((a, l) => a + l.debit, 0) : NaN; };
  const payMismatch = pays.filter((p) => txTotal(p.txnId!) !== p.amount);
  return (
    <>
      <PageHead eyebrow="Tax" title="Calendar & returns" lede="Every tax return and payment: income (1065 / 1120-S / 1120), state income and franchise, payroll, sales tax, excise, property tax, 1099s, W-2s, annual reports, and each estimate installment. The compliance calendar holds the filings; this view adds the estimates and links each kind to its tracker.">
        <ExportButtons name="tax-calendar" header={['Due', 'Obligation', 'Kind', 'Agency', 'Covers', 'Status', 'Confirmation']} rows={list.map((r) => [r.dueDate, r.title, r.kindLabel, r.agency, r.covers, r.status, r.occ?.occ?.confirmation ?? r.estimate?.inst.payments.map((p) => p.confirmation ?? '').join(' ') ?? ''])} />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Tax calendar" style={{ marginBottom: 20 }}>
        <Figure label="Overdue" value={<span className={overdue.length ? 'neg' : undefined}>{overdue.length}</span>} note={overdue.length ? overdue.map((r) => r.title).join(', ') : 'Nothing overdue'} />
        <Figure label="Returns due in 30 days" value={returns30.length} note={returns30.map((r) => `${r.title} ${shortDate(r.dueDate)}`).join('; ') || 'None'} />
        <Figure label="Estimates due in 14 days" value={est14.length} note={est14.map((r) => `${r.title} ${shortDate(r.dueDate)}`).join('; ') || 'None'} href="/tax/estimates" />
        <Figure label={`Done in ${t.today.slice(0, 4)}`} value={doneYear.length} note="Filed, paid or accepted" />
        <Figure label="Tax notices open" value={openNotices.length} href="/compliance/notices" />
      </section>
      <section className="panel" aria-labelledby="tc-h">
        <div className="panel-head"><h2 id="tc-h">Returns and payments</h2>
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={show !== 'open'} onClick={() => t.set('show', '')}>Everything open + last 120 days</button>
            <button aria-pressed={show === 'open'} onClick={() => t.set('show', 'open')}>Overdue &amp; due in 30 days</button>
          </div>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Due</th><th scope="col">Obligation</th><th scope="col">Covers</th><th scope="col">Status</th><th scope="col">Record</th><th scope="col">Detail</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.map((r) => [
            <tr key={r.key}>
              <td>{shortDate(r.dueDate)}<div className="muted small">{r.done ? '' : r.overdue ? `${-r.daysLeft} days late` : `in ${r.daysLeft} days`}</div></td>
              <td><b>{r.title}</b><div className="muted small">{r.kindLabel} · {r.agency}</div></td>
              <td>{r.covers || '—'}</td>
              <td><span className={'pill ' + (r.overdue ? 'bad' : r.done ? 'ok' : r.daysLeft <= 30 ? 'warn' : '')}>{r.overdue ? `Overdue · ${r.status}` : r.status}</span></td>
              <td className="small">{r.occ?.occ?.filedOn && <div>Filed {shortDate(r.occ.occ.filedOn)}</div>}{r.occ?.occ?.paidOn && <div>Paid <Money c={r.occ.occ.paidAmount ?? 0} dollar /></div>}{r.occ?.occ?.confirmation && <div className="muted">#{r.occ.occ.confirmation}</div>}
                {r.estimate?.inst.payments.map((p) => <div key={p.id}>Paid <Money c={p.amount} dollar /> {shortDate(p.date)}{p.txnId ? <> · <Link to={`/books/transactions/${p.txnId}`}>{state.transactions.find((x) => x.id === p.txnId)?.ref}</Link></> : ' (owner)'}</div>)}</td>
              <td className="small">{r.link ? <Link to={r.link.to}>{r.link.label}</Link> : '—'}</td>
              <td>{t.edit && r.occ && <button className="btn sm" aria-expanded={open === r.key} aria-label={`Update ${r.title} due ${r.dueDate}`} onClick={() => setOpen(open === r.key ? null : r.key)}>Update</button>}{t.edit && r.estimate && !r.done && <Link className="btn sm" to="/tax/estimates">Pay</Link>}</td>
            </tr>,
            open === r.key && r.occ && <tr key={r.key + 'f'}><td colSpan={7}><OccurrenceForm row={r.occ} onDone={(m) => { setOpen(null); say(m); }} say={say} /></td></tr>,
          ])}</tbody>
        </table></div>
        {!list.length && <p className="panel-pad muted">Nothing overdue or due in the next 30 days.</p>}
        <TieOut items={[
          { label: unsupported.length ? `${unsupported.length} filed item(s) have no confirmation or document` : 'Every filed or paid return has a confirmation or document', ok: !unsupported.length },
          { label: payMismatch.length ? `${payMismatch.length} estimate payment(s) differ from their entry in the books` : `Estimate payments made by an entity agree with the books (${pays.length} posted)`, ok: !payMismatch.length },
        ]} />
      </section>
      <section className="panel" aria-labelledby="tn-h" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2 id="tn-h">Tax notices</h2><Link className="btn sm" to="/compliance/notices">Open the notices tracker</Link></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Received</th><th scope="col">Agency · notice</th><th scope="col">Period</th><th scope="col" className="num">Amount</th><th scope="col">Answer by</th><th scope="col">Status</th></tr></thead>
          <tbody>{notices.map((n) => <tr key={n.id}><td>{shortDate(n.received)}</td><td><b>{n.agency}</b><div className="muted small">{n.noticeType}</div></td><td>{n.taxPeriod ?? '—'}</td><td className="num">{n.amount ? <Money c={n.amount} /> : '—'}</td><td>{shortDate(n.deadline)}</td><td><span className={'pill ' + (n.status === 'closed' ? 'ok' : 'warn')}>{NOTICE_STATUS_LABEL[n.status]}</span></td></tr>)}</tbody>
        </table></div>
      </section>
      {toast}
      <Help k="taxCalendar" />
    </>
  );
}

// ── Sales tax ────────────────────────────────────────────────────────────
export function SalesTaxPage() {
  const { state, visible, version } = useBooks();
  const t = useTax();
  const periods = useMemo(() => salesTaxPeriods(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const period = t.sp.get('period') && periods.includes(t.sp.get('period')!) ? t.sp.get('period')! : periods.find((p) => lastDayOfPeriod(p) < t.today) ?? periods[0] ?? t.today.slice(0, 7);
  const p = useMemo(() => salesTaxPeriod(state, period, { today: t.today, visible }), [state, period, t.today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => periods.slice(0, 12).map((x) => salesTaxPeriod(state, x, { today: t.today, visible })), [state, periods, t.today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tie = useMemo(() => salesTaxTie(state, t.today, visible), [state, t.today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t.ok) return <NoAccess title="Sales tax" />;
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const rates = ratesOf(state);
  const ws = salesTaxWorksheet(state, p);
  // Independent: taxable department sales on the POS close, straight from the ledger.
  const dept = ledgerDeptSales(state, { storeIds: p.rows.map((r) => r.storeId), from: `${period}-01`, to: lastDayOfPeriod(period), posOnly: true });
  const deptTaxable = [...dept].filter(([k]) => rates.taxableDeptIds.includes(k.split('|')[1])).reduce((a, [, v]) => a + v, 0) + (rates.fuelTaxable ? p.total.fuelSales : 0);
  const occ = p.occurrence?.occ;
  return (
    <>
      <PageHead eyebrow="Tax" title="Sales tax" lede={`Taxable sales by store from the POS close (inside store and kitchen; fuel is ${rates.fuelTaxable ? 'included' : 'excluded'}) against tax collected (2200 credits) and tax remitted (2200 debits). Any difference is flagged; the worksheet below is what goes on the return.`}>
        <div className="field"><label htmlFor="st-p">Month</label><select id="st-p" value={period} onChange={(e) => t.set('period', e.target.value)}>{periods.map((x) => <option key={x} value={x}>{periodLabel(x)}</option>)}</select></div>
        <ExportButtons name={`sales-tax-worksheet-${period}`} header={ws[0].map(String)} rows={ws.slice(1)} sheet="Worksheet" />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Sales tax" style={{ marginBottom: 20 }}>
        <Figure label="Taxable sales" value={<Money c={p.total.taxableSales} whole dollar />} note={`${periodLabel(period)} · fuel ${$(p.total.fuelSales)} excluded`} />
        <Figure label={`Tax at ${pctBps(p.rateBps)}`} value={<Money c={p.total.expectedTax} dollar />} note="Rate in the tax tables (verify with your CPA)" />
        <Figure label="Collected (2200)" value={<Money c={p.total.collected} dollar />} note={p.total.variance ? `${$(p.total.variance)} vs the rate` : 'Agrees with the rate'} />
        <Figure label="Remitted" value={<Money c={p.total.remitted} dollar />} note={`Return due ${shortDate(p.dueDate)}${occ ? ` · ${occ.status}` : ''}`} href="/tax/calendar" />
        <Figure label="Not remitted" value={<span className={p.remitFlag ? 'neg' : undefined}><Money c={p.total.unremitted} dollar /></span>} note={p.settled ? (p.remitFlag ? 'Collected ≠ remitted' : 'Collected = remitted') : 'Return not due yet'} />
      </section>
      {p.flags.length > 0 && <div className={'note ' + (p.remitFlag ? 'err' : 'warn')} role="status" style={{ marginBottom: 16 }}><b>Look into these before filing.</b><ul>{p.flags.map((f) => <li key={f}>{f}</li>)}</ul></div>}
      <section className="panel" aria-labelledby="ws-h">
        <div className="panel-head"><h2 id="ws-h">Filing worksheet · {periodLabel(period)}</h2><span className="muted small">Return due {shortDate(p.dueDate)}</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col" className="num">POS sales</th><th scope="col" className="num">Fuel</th><th scope="col" className="num">Other non-taxable</th><th scope="col" className="num">Taxable sales</th><th scope="col" className="num">Tax at rate</th><th scope="col" className="num">Collected</th><th scope="col" className="num">Outside POS</th><th scope="col" className="num">Variance</th><th scope="col" className="num">Remitted</th><th scope="col" className="num">Not remitted</th></tr></thead>
          <tbody>{[...p.rows, { ...p.total, storeId: '' }].map((r) => (
            <tr key={r.storeId || 'total'} style={r.storeId ? undefined : { fontWeight: 600 }}>
              <td>{r.storeId ? code(r.storeId) : 'Total'}</td><td className="num"><Money c={r.posSales} /></td><td className="num"><Money c={r.fuelSales} /></td><td className="num"><Money c={r.nonTaxable} /></td>
              <td className="num"><Money c={r.taxableSales} /></td><td className="num"><Money c={r.expectedTax} /></td><td className="num"><Money c={r.collected} /></td><td className="num"><Money c={r.collectedOther} /></td>
              <td className={'num' + (Math.abs(r.variance) >= state.settings.materialityCents ? ' neg' : '')}><Money c={r.variance} /></td><td className="num"><Money c={r.remitted} /></td><td className={'num' + (p.settled && Math.abs(r.unremitted) >= state.settings.materialityCents ? ' neg' : '')}><Money c={r.unremitted} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="panel-pad small">
          <dl className="kv">
            <dt>Tax due on the return</dt><dd><Money c={p.total.collected} dollar /> (tax collected per the books)</dd>
            <dt>Already remitted for {periodLabel(period)}</dt><dd><Money c={p.total.remitted} dollar /></dd>
            <dt>Return status</dt><dd>{occ ? `${occ.status}${occ.confirmation ? ` #${occ.confirmation}` : ''}` : 'Not started'} · <Link to="/compliance/calendar">Update on the calendar</Link></dd>
          </dl>
        </div>
        <TieOut items={[
          { label: tie.ok ? 'Tax collected less remitted ties to 2200 Sales tax payable' : 'Collected less remitted does not tie to 2200', ok: tie.ok, detail: <>{$(tie.collected)} − {$(tie.remitted)} = {$(tie.ledger)}</> },
          { label: deptTaxable === p.total.taxableSales ? 'Taxable sales tie to the taxable departments on the POS close' : 'Taxable sales do not tie to the department sales in the ledger', ok: deptTaxable === p.total.taxableSales, detail: <Money c={deptTaxable} dollar /> },
          { label: p.varianceFlag ? 'Tax collected differs from the rate × taxable sales (see the flags)' : 'Tax collected agrees with the rate × taxable sales', ok: !p.varianceFlag },
          { label: !p.settled ? 'Return not due yet: nothing expected to be remitted' : p.remitFlag ? 'Collected ≠ remitted for this month' : 'Collected = remitted for this month', ok: !p.remitFlag },
        ]} />
      </section>
      <section className="panel" aria-labelledby="stm-h" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2 id="stm-h">Month by month</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Month</th><th scope="col" className="num">Taxable sales</th><th scope="col" className="num">Tax at rate</th><th scope="col" className="num">Collected</th><th scope="col" className="num">Remitted</th><th scope="col">Return due</th><th scope="col">Check</th></tr></thead>
          <tbody>{all.map((x) => <tr key={x.period}><td><Link to={`/tax/sales-tax?period=${x.period}`}>{periodLabel(x.period)}</Link></td><td className="num"><Money c={x.total.taxableSales} /></td><td className="num"><Money c={x.total.expectedTax} /></td><td className="num"><Money c={x.total.collected} /></td><td className="num"><Money c={x.total.remitted} /></td><td>{shortDate(x.dueDate)}</td>
            <td><span className={'pill ' + (x.remitFlag ? 'bad' : x.varianceFlag ? 'warn' : x.settled ? 'ok' : '')}>{x.remitFlag ? 'Collected ≠ remitted' : x.varianceFlag ? 'Rate variance' : x.settled ? 'Ties' : 'Not due yet'}</span></td></tr>)}</tbody>
        </table></div>
      </section>
      <Help k="taxSalesTax" />
    </>
  );
}

// ── Book-to-tax ──────────────────────────────────────────────────────────
export function BookToTaxPage() {
  const { state, books, user, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const entity = useReturn(t.sp);
  const r = useMemo(() => (entity ? bookToTax(state, entity, t.year, t.asOf) : null), [state, entity, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMemo(() => (entity ? m2(state, entity, t.year, t.asOf) : null), [state, entity, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null);
  const [prior, setPrior] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  if (!t.ok || !r || !m) return <NoAccess title="Book-to-tax" />;
  const reviewed = r.adjustments.filter((a) => a.reviewed).length;
  const pi = priorIncomeOf(state, r.unit.entity.id, t.year);
  const isS = r.unit.entity.taxClass === 's_corp_1120s';
  const rows = r.adjustments.map((a) => [a.label, a.basis, csvMoney(a.amount), M1_LABEL[a.m1Line], a.source ?? '', a.workpaper, a.reviewed ? 'yes' : 'no']);
  return (
    <>
      <PageHead eyebrow="Tax" title="Book-to-tax" lede="Year-end trial balance → tax adjustments → taxable income for each return. Each adjustment has a workpaper with its source; the Schedule M-1 and M-2 layouts below are the CPA's support.">
        <ReturnSelect value={entity} onChange={(v) => t.set('entity', v)} />
        <YearSelect year={t.year} onChange={(v) => t.set('year', v)} />
        <ExportButtons name={`book-to-tax-${r.unit.entity.code}-${t.year}`} header={['Adjustment', 'Basis', 'Amount', 'M-1 line', 'Source', 'Workpaper', 'Reviewed']} rows={[['Net income per books', `Ledger ${csvMoney(r.ytdBook)} + before these books ${csvMoney(r.priorIncome)}`, csvMoney(r.bookIncome), 'Line 1', '/reports/trial-balance', '', ''], ...rows, ['Taxable income', '', csvMoney(r.taxableIncome), 'Line 8', '', '', '']]} sheet="Book-to-tax" />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Book-to-tax" style={{ marginBottom: 20 }}>
        <Figure label="Book income" value={<Money c={r.bookIncome} whole dollar />} note={`${r.unit.entity.code} ${r.unit.form} · through ${shortDate(r.asOf)}`} />
        <Figure label="Adjustments" value={<Money c={r.totalAdjustments} whole dollar />} note={`${r.adjustments.length} items`} />
        <Figure label="Taxable income" value={<Money c={r.taxableIncome} whole dollar />} note="M-1 line 8" />
        <Figure label="Workpapers reviewed" value={`${reviewed} of ${r.adjustments.length}`} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="bt-h">
          <div className="panel-head"><h2 id="bt-h">Trial balance to taxable income</h2><Link className="btn sm" to={`/reports/trial-balance?entity=${r.unit.entity.id}`}>Trial balance</Link></div>
          <Errors errors={errors} />
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Item</th><th scope="col">Basis</th><th scope="col" className="num">Amount</th><th scope="col">M-1 line</th><th scope="col">Workpaper</th><th scope="col">Reviewed</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              <tr><td><b>Net income per books, these books</b><div className="muted small">{r.unit.members.map((x) => state.entities.find((e) => e.id === x)?.code).join(' + ')}</div></td><td className="small">Trial balance net income, {r.year} to date</td><td className="num"><Money c={r.ytdBook} /></td><td>Line 1</td><td colSpan={3} /></tr>
              <tr><td><b>Book income before these books</b></td><td className="small">{pi?.note ?? 'From the prior system, entered'}</td><td className="num"><Money c={r.priorIncome} /></td><td>Line 1</td>
                <td colSpan={2}>{prior !== null && <div className="field"><label htmlFor="bt-prior">Amount</label><input id="bt-prior" className="num" inputMode="decimal" value={prior} onChange={(e) => setPrior(e.target.value)} /></div>}</td>
                <td>{t.edit && (prior === null ? <button className="btn sm" onClick={() => setPrior(formatMoney(r.priorIncome))}>Edit</button> : <button className="btn sm primary" onClick={() => {
                  setErrors([]);
                  const v = moneyInput(prior);
                  if (v === null) { setErrors(['Enter the amount like 186,000.00 (negative in parentheses or with a minus).']); return; }
                  try { setPriorIncome(books, user, { entityId: r.unit.entity.id, year: t.year, priorIncome: v, note: pi?.note }); setPrior(null); say('Saved.'); } catch (e) { setErrors(errList(e)); }
                }}>Save</button>)}</td></tr>
              {r.adjustments.map((a) => [
                <tr key={a.key}>
                  <td><b>{a.label}</b><div className="muted small">{a.mode === 'auto' ? 'From the books' : 'Manual'}</div></td>
                  <td className="small">{a.basis}{a.txns.length > 0 && <div>{a.txns.slice(0, 4).map((x) => <Link key={x.id} to={`/books/transactions/${x.id}`} style={{ marginRight: 6 }}>{x.ref}</Link>)}{a.txns.length > 4 && <span className="muted">+{a.txns.length - 4}</span>}</div>}</td>
                  <td className="num"><Money c={a.amount} /></td>
                  <td className="small">{M1_LABEL[a.m1Line].replace(/ \(line (\d)\)/, ' · line $1')}</td>
                  <td className="small">{a.workpaper || <span className="muted">No workpaper yet</span>}{a.source && <div><Link to={a.source}>Source</Link></div>}</td>
                  <td>{a.reviewed ? <span className="pill ok">Reviewed</span> : <span className="pill">Not yet</span>}</td>
                  <td>{t.edit && <><button className="btn sm" aria-expanded={open === a.key} aria-label={`Edit workpaper: ${a.label}`} onClick={() => setOpen(open === a.key ? null : a.key)}>Workpaper</button>{!a.reviewed && <button className="btn sm" aria-label={`Review ${a.label}`} onClick={() => { setErrors([]); try { reviewAdjustment(books, user, r.unit.entity.id, t.year, a.mode === 'auto' ? a.kind : a.key); say('Signed off.'); } catch (e) { setErrors(errList(e)); } }}>Review</button>}</>}</td>
                </tr>,
                open === a.key && <tr key={a.key + 'f'}><td colSpan={7}><WorkpaperForm row={a} entityId={r.unit.entity.id} year={t.year} onDone={(msg) => { setOpen(null); say(msg); }} /></td></tr>,
              ])}
              <tr style={{ fontWeight: 600 }}><td>Taxable income</td><td className="small">Book income + adjustments</td><td className="num"><Money c={r.taxableIncome} /></td><td>Line 8</td><td colSpan={3} /></tr>
            </tbody>
          </table></div>
          <TieOut items={[
            { label: r.tbBalanced ? 'Each member\'s trial balance balances' : 'A member trial balance does not balance', ok: r.tbBalanced },
            { label: r.tbNetIncome === r.ytdBook ? 'Book income ties to the trial balance net income' : 'Book income does not tie to the trial balance', ok: r.tbNetIncome === r.ytdBook, detail: <Money c={r.tbNetIncome} dollar /> },
            { label: r.depTie.ok ? 'Book depreciation in these books ties to the asset register (6400)' : 'Book depreciation does not tie to the register: post the missing months', ok: r.depTie.ok, detail: <>{$(r.depTie.register)} vs {$(r.depTie.ledger)}</> },
            { label: r.m1Ties ? 'M-1 reconciles book income to taxable income' : 'M-1 does not reconcile', ok: r.m1Ties, detail: <Money c={r.m1.line8} dollar /> },
          ]} />
        </section>
        {t.edit && <NewAdjustment entityId={r.unit.entity.id} year={t.year} onSaved={say} />}
        <div className="grid-2">
          <section className="panel" aria-labelledby="m1-h">
            <div className="panel-head"><h2 id="m1-h">Schedule M-1</h2><span className="muted small">{r.unit.form}</span></div>
            <div className="table-wrap"><table className="t">
              <tbody>
                {([
                  ['1', 'Net income (loss) per books', r.m1.bookIncome], ['2', 'Income on the return not recorded on books', r.m1.line2],
                  ['3a', 'Expenses on books not deducted: depreciation', r.m1.line3a], ['3b', 'Travel and entertainment (meals disallowed)', r.m1.line3b], ['3c', 'Other (penalties, owner items, …)', r.m1.line3c],
                  ['4', 'Add lines 1 through 3', r.m1.line4], ['5', 'Income on books not on the return', r.m1.line5], ['6a', 'Deductions not charged against book income: depreciation', r.m1.line6a],
                  ['6b', 'Other deductions', r.m1.line6 - r.m1.line6a], ['7', 'Add lines 5 and 6', r.m1.line7], ['8', `Income (loss) — ${isS ? 'Schedule K, line 18' : 'Analysis of net income'}`, r.m1.line8],
                ] as [string, string, Cents][]).map(([n, label, v]) => <tr key={n} style={['4', '8'].includes(n) ? { fontWeight: 600 } : undefined}><th scope="row" className="num">{n}</th><td>{label}</td><td className="num"><Money c={v} /></td></tr>)}
              </tbody>
            </table></div>
          </section>
          <section className="panel" aria-labelledby="m2-h">
            <div className="panel-head"><h2 id="m2-h">Schedule M-2</h2><span className="muted small">{m.kind === 'aaa' ? 'Accumulated adjustments account' : m.kind === 'capital' ? "Partners' capital accounts" : 'Retained earnings'}</span></div>
            <div className="table-wrap"><table className="t">
              <tbody>
                {([
                  ['Balance at the beginning of the year', m.beginning], ...(m.kind === 'capital' ? [['Capital contributed', m.contributions]] : []), ['Ordinary income (taxable)', m.income],
                  ['Non-deductible expenses', -m.nondeductible], ['Distributions', -m.distributions], ['Balance at the end of the period', m.ending],
                ] as [string, Cents][]).map(([label, v], i, a) => <tr key={label} style={i === a.length - 1 ? { fontWeight: 600 } : undefined}><td>{label}</td><td className="num"><Money c={v} /></td></tr>)}
              </tbody>
            </table></div>
            <p className="panel-pad muted small">Beginning balances come from Owners &amp; K-1. <Link to={`/tax/owners?entity=${r.unit.entity.id}`}>Owner roll-forward</Link></p>
          </section>
        </div>
      </div>
      {toast}
      <Help k="taxBookToTax" />
    </>
  );
}

function WorkpaperForm({ row, entityId, year, onDone }: { row: AdjRow; entityId: ID; year: number; onDone: (m: string) => void }) {
  const { books, user } = useBooks();
  const [wp, setWp] = useState(row.workpaper);
  const [pct, setPct] = useState(row.record?.pctBps !== undefined ? String(row.record.pctBps / 100) : '');
  const [amount, setAmount] = useState(row.mode === 'manual' ? formatMoney(row.amount) : '');
  const [errors, setErrors] = useState<string[]>([]);
  const id = row.key;
  return (
    <div className="panel-pad" style={{ background: 'var(--panel-2)' }}>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor={`wp-${id}`}>Workpaper</label><textarea id={`wp-${id}`} rows={3} value={wp} onChange={(e) => setWp(e.target.value)} /><span className="hint">What it is, where the number comes from, and the authority.</span></div>
        {row.kind === 'meals' && row.mode === 'auto' && <div className="field"><label htmlFor={`wpp-${id}`}>Not deductible (%)</label><input id={`wpp-${id}`} className="num" inputMode="decimal" value={pct} placeholder="50" onChange={(e) => setPct(e.target.value)} /></div>}
        {row.mode === 'manual' && <div className="field"><label htmlFor={`wpa-${id}`}>Amount (+ raises taxable income)</label><input id={`wpa-${id}`} className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>}
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
        setErrors([]);
        try {
          const amt = row.mode === 'manual' ? moneyInput(amount) : undefined;
          if (amt === null) { setErrors(['Enter the amount like 1,250.00.']); return; }
          saveAdjustment(books, user, { id: row.mode === 'manual' ? row.key : undefined, entityId, year, kind: row.kind, mode: row.mode, label: row.label, amount: amt, pctBps: pct.trim() ? Math.round(Number(pct) * 100) : undefined, m1Line: row.mode === 'manual' ? row.m1Line : undefined, workpaper: wp, source: row.source });
          onDone('Workpaper saved. It needs a fresh review.');
        } catch (e) { setErrors(errList(e)); }
      }}>Save workpaper</button></div>
    </div>
  );
}

function NewAdjustment({ entityId, year, onSaved }: { entityId: ID; year: number; onSaved: (m: string) => void }) {
  const { books, user } = useBooks();
  const [d, setD] = useState({ label: '', kind: 'other' as AdjKind, amount: '', m1: 'expense_not_deducted' as M1Line, workpaper: '', source: '' });
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <section className="panel panel-pad" aria-labelledby="na-h">
      <h2 id="na-h" style={{ marginBottom: 8 }}>Add a manual adjustment</h2>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor="na-l">Description</label><input id="na-l" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></div>
        <div className="field"><label htmlFor="na-k">Kind</label><select id="na-k" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as AdjKind })}>{(Object.keys(ADJ_LABEL) as AdjKind[]).map((k) => <option key={k} value={k}>{ADJ_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="na-a">Amount (+ raises taxable income)</label><input id="na-a" className="num" inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></div>
        <div className="field"><label htmlFor="na-m">M-1 line</label><select id="na-m" value={d.m1} onChange={(e) => setD({ ...d, m1: e.target.value as M1Line })}>{(Object.keys(M1_LABEL) as M1Line[]).map((k) => <option key={k} value={k}>{M1_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="na-s">Source (TX-ref or page)</label><input id="na-s" value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="na-w">Workpaper</label><textarea id="na-w" rows={2} value={d.workpaper} onChange={(e) => setD({ ...d, workpaper: e.target.value })} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
        setErrors([]);
        const amt = parseMoney(d.amount);
        try {
          saveAdjustment(books, user, { entityId, year, kind: d.kind, mode: 'manual', label: d.label, amount: amt ?? NaN, m1Line: d.m1, workpaper: d.workpaper, source: d.source });
          setD({ ...d, label: '', amount: '', workpaper: '', source: '' });
          onSaved('Adjustment added.');
        } catch (e) { setErrors(errList(e)); }
      }}>Add adjustment</button></div>
    </section>
  );
}

// ── Tax depreciation ─────────────────────────────────────────────────────
export function TaxDepreciationPage() {
  const { state, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const [edit, setEdit] = useState<ID | null>(null);
  const [tbl, setTbl] = useState('5:half_year:1');
  const rows = useMemo(() => bookVsTax(state, { year: t.year, asOf: t.asOf }), [state, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const units = useMemo(() => returnUnits(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t.ok) return <NoAccess title="Tax depreciation" />;
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const book = rows.reduce((a, r) => a + r.book, 0), tax = rows.reduce((a, r) => a + r.tax.total, 0);
  const tie = bookDepTie(state, t.year, t.asOf);
  const m1Dep = units.reduce((a, u) => a + (adjustments(state, u.entity.id, t.year, t.asOf).find((x) => x.kind === 'depreciation')?.amount ?? 0), 0);
  const mq = units.map((u) => ({ u, mq: midQuarterTest(state, u.entity.id, t.year) })).filter((x) => x.mq.total);
  const costSeg = rows.filter((r) => r.setup.costSeg);
  const [ty, tc, tq] = tbl.split(':');
  const table = tc === 'mid_month' ? slMidMonthTable(Number(ty), Number(tq)) : macrsTable(Number(ty), tc as 'half_year' | 'mid_quarter', Number(tq));
  return (
    <>
      <PageHead eyebrow="Tax" title="Tax depreciation" lede="Each Phase 9 asset's tax schedule beside its book schedule: MACRS class and life, convention, §179 and bonus elections, QIP. The book − tax difference feeds the M-1. Canopies, USTs and site work are cost-segregation candidates with shorter lives.">
        <YearSelect year={t.year} onChange={(v) => t.set('year', v)} />
        <ExportButtons name={`tax-depreciation-${t.year}`} header={['Tag', 'Asset', 'Store', 'In service', 'Cost', 'Recovery years', 'Convention', '§179', 'Bonus %', 'Book (year)', 'Tax (year)', 'Book − tax', 'Book accumulated', 'Tax accumulated', 'Flags']} rows={rows.map((r) => [r.a.tag, r.a.name, code(r.a.storeId), r.a.inService, csvMoney(r.a.cost), r.setup.method === 'none' ? 'none' : r.setup.years, r.convention ?? '', csvMoney(r.setup.section179), r.setup.bonusPct, csvMoney(r.book), csvMoney(r.tax.total), csvMoney(r.difference), csvMoney(r.bookAccum), csvMoney(r.taxAccum), r.flags.join(' | ')])} sheet="Book vs tax" />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Tax depreciation" style={{ marginBottom: 20 }}>
        <Figure label={`Book depreciation ${t.year}`} value={<Money c={book} whole dollar />} note="Register, through the last closed month" href="/assets/depreciation" />
        <Figure label={`Tax depreciation ${t.year}`} value={<Money c={tax} whole dollar />} note={`§179 ${$(rows.reduce((a, r) => a + r.tax.section179, 0))} · bonus ${$(rows.reduce((a, r) => a + r.tax.bonus, 0))}`} />
        <Figure label="Book − tax (to the M-1)" value={<Money c={book - tax} whole dollar />} href="/tax/book-to-tax" />
        <Figure label="Mid-quarter test" value={mq.some((x) => x.mq.applies) ? 'Applies' : 'Half-year'} note={mq.map((x) => `${x.u.entity.code}: ${(x.mq.share * 100).toFixed(0)}% in Q4`).join(' · ') || `Nothing placed in ${t.year}`} />
        <Figure label="Cost-seg candidates" value={costSeg.length} note={costSeg.map((r) => `${code(r.a.storeId)} ${CLASS_LABEL[r.a.class].toLowerCase()}`).join(', ') || 'None'} />
      </section>
      <section className="panel" aria-labelledby="td-h">
        <div className="panel-head"><h2 id="td-h">Book and tax side by side · {t.year}</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Asset</th><th scope="col">Tax setup</th><th scope="col" className="num">Cost</th><th scope="col" className="num">§179</th><th scope="col" className="num">Bonus</th><th scope="col" className="num">Book</th><th scope="col" className="num">Tax</th><th scope="col" className="num">Book − tax</th><th scope="col" className="num">Book accum.</th><th scope="col" className="num">Tax accum.</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((r) => [
            <tr key={r.a.id}>
              <td><Link to={`/assets?id=${r.a.id}`}>{r.a.tag}</Link> {r.a.name}<div className="muted small">{code(r.a.storeId)} · in service {shortDate(r.a.inService)}</div>{r.flags.map((f) => <div key={f} className="small" style={{ color: 'var(--warn-ink)' }}>{f}</div>)}</td>
              <td className="small">{r.setup.method === 'none' ? 'Not depreciated' : `${r.setup.years}-year ${r.setup.method === 'macrs' ? 'MACRS' : 'SL'}`}{r.setup.qip && ' · QIP'}<div className="muted">{r.convention ? r.convention.replace('_', '-') : ''}{r.setup.defaulted ? ' · class default' : ''}</div></td>
              <td className="num"><Money c={r.a.cost} /></td><td className="num"><Money c={r.tax.section179} /></td><td className="num"><Money c={r.tax.bonus} /></td>
              <td className="num"><Money c={r.book} /></td><td className="num"><Money c={r.tax.total} /></td><td className="num"><Money c={r.difference} signed /></td><td className="num"><Money c={r.bookAccum} /></td><td className="num"><Money c={r.taxAccum} /></td>
              <td>{t.edit && <button className="btn sm" aria-expanded={edit === r.a.id} aria-label={`Edit tax elections for ${r.a.tag}`} onClick={() => setEdit(edit === r.a.id ? null : r.a.id)}>Elections</button>}</td>
            </tr>,
            edit === r.a.id && <tr key={r.a.id + 'f'}><td colSpan={11}><ElectionsForm assetId={r.a.id} onDone={(m) => { setEdit(null); say(m); }} /></td></tr>,
          ])}</tbody>
        </table></div>
        <TieOut items={[
          { label: tie.ok ? 'Book depreciation in these books ties to the register and to 6400' : 'Book depreciation does not tie to 6400: post the missing months', ok: tie.ok, detail: <>{$(tie.register)} vs {$(tie.ledger)}</> },
          { label: m1Dep === book - tax ? 'Book − tax ties to the M-1 depreciation adjustments' : 'Book − tax does not tie to the M-1', ok: m1Dep === book - tax, detail: <Money c={m1Dep} dollar /> },
        ]} />
      </section>
      <section className="panel" aria-labelledby="mt-h" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2 id="mt-h">MACRS percentage tables</h2>
          <div className="field"><label htmlFor="mt-s">Table</label><select id="mt-s" value={tbl} onChange={(e) => setTbl(e.target.value)}>
            {[5, 7, 15].flatMap((y) => [<option key={`${y}h`} value={`${y}:half_year:1`}>{y}-year, half-year</option>, ...[1, 2, 3, 4].map((q) => <option key={`${y}q${q}`} value={`${y}:mid_quarter:${q}`}>{y}-year, mid-quarter Q{q}</option>)])}
            {[1, 4, 7, 10, 12].map((mo) => <option key={`39m${mo}`} value={`39:mid_month:${mo}`}>39-year, mid-month (month {mo})</option>)}
          </select></div>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Recovery year</th>{table.map((_, i) => (tc !== 'mid_month' || i < 3 || i > table.length - 3) && <th key={i} scope="col" className="num">{i + 1}</th>)}</tr></thead>
          <tbody><tr><th scope="row">Percent</th>{table.map((v, i) => (tc !== 'mid_month' || i < 3 || i > table.length - 3) && <td key={i} className="num">{v.toFixed(tc === 'mid_month' ? 3 : 2)}</td>)}</tr></tbody>
        </table></div>
        <p className="panel-pad muted small">200% declining balance for 5- and 7-year property, 150% for 15-year, switching to straight line; built the way IRS Pub 946 builds its tables and tested against them. 39-year real property is straight line, mid-month{tc === 'mid_month' ? ' (years 4–38 are 2.564%)' : ''}.</p>
      </section>
      {toast}
      <Help k="taxDepreciation" />
    </>
  );
}

function ElectionsForm({ assetId, onDone }: { assetId: ID; onDone: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const a = assetsOf(state).assets.find((x) => x.id === assetId)!;
  const tx = a.tax;
  const [d, setD] = useState({ method: tx?.method === 'none' ? 'none' : tx?.method === 'straight_line' ? 'straight_line' : 'macrs', years: tx?.recoveryYears ? String(tx.recoveryYears) : '', convention: tx?.convention ?? '', s179: tx?.section179 ? formatMoney(tx.section179) : '', bonus: tx?.bonusPct !== undefined ? String(tx.bonusPct) : '', qip: !!tx?.qip, costSeg: !!tx?.costSegFlag, notes: tx?.notes ?? '' });
  const [errors, setErrors] = useState<string[]>([]);
  const id = assetId;
  return (
    <div className="panel-pad" style={{ background: 'var(--panel-2)' }}>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor={`el-m-${id}`}>Method</label><select id={`el-m-${id}`} value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}><option value="macrs">MACRS (GDS)</option><option value="straight_line">Straight line</option><option value="none">Not depreciated</option></select></div>
        <div className="field"><label htmlFor={`el-y-${id}`}>Recovery period</label><select id={`el-y-${id}`} value={d.years} onChange={(e) => setD({ ...d, years: e.target.value })}><option value="">Class default ({ratesOf(state).macrsYears[a.class]}-year)</option>{[3, 5, 7, 10, 15, 20, 27.5, 39].map((y) => <option key={y} value={y}>{y}-year</option>)}</select></div>
        <div className="field"><label htmlFor={`el-c-${id}`}>Convention</label><select id={`el-c-${id}`} value={d.convention} onChange={(e) => setD({ ...d, convention: e.target.value })}><option value="">Automatic (40% test)</option><option value="half_year">Half-year</option><option value="mid_quarter">Mid-quarter</option><option value="mid_month">Mid-month</option></select></div>
        <div className="field"><label htmlFor={`el-s-${id}`}>§179 amount</label><input id={`el-s-${id}`} className="num" inputMode="decimal" value={d.s179} onChange={(e) => setD({ ...d, s179: e.target.value })} /></div>
        <div className="field"><label htmlFor={`el-b-${id}`}>Bonus %</label><input id={`el-b-${id}`} className="num" inputMode="numeric" value={d.bonus} placeholder="0" onChange={(e) => setD({ ...d, bonus: e.target.value })} /></div>
        <label className="check"><input type="checkbox" checked={d.qip} onChange={(e) => setD({ ...d, qip: e.target.checked })} /> Qualified improvement property</label>
        <label className="check"><input type="checkbox" checked={d.costSeg} onChange={(e) => setD({ ...d, costSeg: e.target.checked })} /> Cost-segregation candidate</label>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor={`el-n-${id}`}>Notes</label><input id={`el-n-${id}`} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
        setErrors([]);
        const s179 = moneyInput(d.s179);
        if (s179 === null) { setErrors(['Enter the §179 amount like 20,000.00, or leave it blank.']); return; }
        try {
          saveAssetTax(books, user, a.id, {
            method: d.method as 'macrs' | 'straight_line' | 'none', recoveryYears: d.years ? Number(d.years) : undefined, convention: (d.convention || undefined) as 'half_year' | 'mid_quarter' | 'mid_month' | undefined,
            section179: s179 || undefined, bonusPct: d.bonus.trim() ? Number(d.bonus) : undefined, qip: d.qip || undefined, costSegFlag: d.costSeg || undefined, notes: d.notes,
          });
          onDone(`Saved the tax elections for ${a.tag}.`);
        } catch (e) { setErrors(errList(e)); }
      }}>Save elections</button></div>
    </div>
  );
}

// ── Accounting methods ───────────────────────────────────────────────────
export function TaxMethodsPage() {
  const { state, books, user, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const panel = useMemo(() => methodsPanel(state, t.year), [state, t.year, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rc, setRc] = useState({ entityId: 'ent_corp', year: String(t.year - 1), receipts: '' });
  const [mc, setMc] = useState({ entityId: returnUnits(state)[0]?.entity.id ?? '', description: '', year: String(t.year), status: 'considering' as MethodChange['status'], dcn: '', filedOn: '', adj481: '' });
  const [errors, setErrors] = useState<string[]>([]);
  if (!t.ok) return <NoAccess title="Accounting methods" />;
  const changes = taxOf(state).methodChanges;
  const booksNow = bookReceipts(state, t.year);
  const pnlSales = statement(state, { basis: 'booked', from: `${t.year}-01`, to: t.asOf.slice(0, 7), storeIds: state.stores.map((s) => s.id) }).netSales.total;
  const ent = (id: ID) => state.entities.find((e) => e.id === id)?.code ?? id;
  return (
    <>
      <PageHead eyebrow="Tax" title="Accounting methods" lede="Inventory method and UNICAP, cash vs accrual eligibility under the gross-receipts test (the 3-year average against a configurable threshold), and the Form 3115 method changes being considered or filed.">
        <YearSelect year={t.year} onChange={(v) => t.set('year', v)} />
        <ExportButtons name={`accounting-methods-${t.year}`} header={['Return', 'Method', 'Inventory', 'Cash allowed', 'UNICAP', 'Note']} rows={panel.rows.map((r) => [r.entity.code, r.profile.method, INVENTORY_LABEL[r.profile.inventoryMethod], r.cashAllowed ? 'yes' : 'no', r.unicap, r.cashNote])} />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Methods" style={{ marginBottom: 20 }}>
        <Figure label="3-year average receipts" value={<Money c={panel.test.average} whole dollar />} note={`${panel.test.year - 3}–${panel.test.year - 1}, every entity aggregated`} />
        <Figure label="Threshold" value={<Money c={panel.test.threshold} whole dollar />} note="§448(c), indexed (verify with your CPA)" href="/tax/planning" />
        <Figure label="Small business" value={<span className={panel.test.passes ? 'pos' : 'neg'}>{panel.test.passes ? 'Yes' : 'No'}</span>} note={panel.test.passes ? 'Cash method, UNICAP and inventory exceptions available' : 'Accrual and UNICAP required'} />
        <Figure label="Form 3115 open" value={changes.filter((c) => c.status === 'considering' || c.status === 'filed').length} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel" aria-labelledby="gr-h">
          <div className="panel-head"><h2 id="gr-h">Gross-receipts test · {t.year}</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Year</th><th scope="col" className="num">Entered (before these books)</th><th scope="col" className="num">In these books</th><th scope="col" className="num">Gross receipts</th></tr></thead>
            <tbody>{panel.test.rows.map((r) => <tr key={r.year}><td>{r.year}</td><td className="num"><Money c={r.entered} /></td><td className="num"><Money c={r.books} /></td><td className="num"><Money c={r.total} /></td></tr>)}
              <tr style={{ fontWeight: 600 }}><td>Average</td><td colSpan={2} /><td className="num"><Money c={panel.test.average} /></td></tr>
              <tr><td>{t.year} so far</td><td /><td className="num"><Money c={booksNow} /></td><td className="muted small">Not in the test</td></tr></tbody>
          </table></div>
          {t.edit && <div className="panel-pad">
            <div className="form-grid">
              <div className="field"><label htmlFor="gr-e">Entity</label><select id="gr-e" value={rc.entityId} onChange={(e) => setRc({ ...rc, entityId: e.target.value })}>{state.entities.filter((e) => !e.deleted).map((e) => <option key={e.id} value={e.id}>{e.code}</option>)}</select></div>
              <div className="field"><label htmlFor="gr-y">Year</label><input id="gr-y" className="num" inputMode="numeric" value={rc.year} onChange={(e) => setRc({ ...rc, year: e.target.value })} /></div>
              <div className="field"><label htmlFor="gr-r">Gross receipts</label><input id="gr-r" className="num" inputMode="decimal" value={rc.receipts} onChange={(e) => setRc({ ...rc, receipts: e.target.value })} /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => {
              setErrors([]);
              const v = parseMoney(rc.receipts);
              if (v === null) { setErrors(['Enter the receipts like 12,400,000.00.']); return; }
              try { setReceipts(books, user, { entityId: rc.entityId, year: Number(rc.year), receipts: v }); say('Receipts saved.'); setRc({ ...rc, receipts: '' }); } catch (e) { setErrors(errList(e)); }
            }}>Save receipts</button><span className="muted small">From the prior returns (gross receipts less returns and allowances).</span></div>
          </div>}
          <TieOut items={[
            { label: booksNow === pnlSales ? `${t.year} receipts in the books tie to net sales on the P&L` : 'Receipts do not tie to the P&L', ok: booksNow === pnlSales, detail: <Money c={pnlSales} dollar /> },
            { label: panel.test.missing.length ? `No receipts for ${panel.test.missing.join(', ')}: enter them from the prior returns` : 'Every test year has receipts', ok: !panel.test.missing.length },
          ]} />
        </section>
        <section className="panel" aria-labelledby="mr-h">
          <div className="panel-head"><h2 id="mr-h">Methods by return</h2><Link className="btn sm" to="/tax">Change in the entity map</Link></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Return</th><th scope="col">Overall method</th><th scope="col">Cash vs accrual</th><th scope="col">Inventory</th><th scope="col">UNICAP (§263A)</th></tr></thead>
            <tbody>{panel.rows.map((r) => <tr key={r.entity.id}><td><b>{r.entity.code}</b><div className="muted small">{CLASS_FORM[r.entity.taxClass]}</div></td><td>{r.profile.method === 'cash' ? 'Cash' : 'Accrual'}</td><td className="small"><span className={'pill ' + (r.cashAllowed ? 'ok' : 'warn')}>{r.cashAllowed ? 'Cash allowed' : 'Accrual required'}</span><div>{r.cashNote}</div></td><td className="small">{INVENTORY_LABEL[r.profile.inventoryMethod]}<div className="muted">{r.inventoryNote}</div></td><td className="small">{r.unicap}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="f3-h">
          <div className="panel-head"><h2 id="f3-h">Form 3115 changes</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Return</th><th scope="col">Year</th><th scope="col">Change</th><th scope="col">DCN</th><th scope="col">Status</th><th scope="col">Filed</th><th scope="col" className="num">§481(a)</th></tr></thead>
            <tbody>{changes.map((c) => <tr key={c.id}><td>{ent(c.entityId)}</td><td>{c.year}</td><td>{c.description}{c.notes && <div className="muted small">{c.notes}</div>}</td><td>{c.dcn ?? '—'}</td><td><span className={'pill ' + (c.status === 'accepted' ? 'ok' : c.status === 'filed' ? 'warn' : '')}>{c.status}</span></td><td>{c.filedOn ? shortDate(c.filedOn) : '—'}</td><td className="num">{c.adj481 !== undefined ? <Money c={c.adj481} /> : '—'}</td></tr>)}</tbody>
          </table></div>
          {!changes.length && <p className="panel-pad muted">No method changes tracked.</p>}
          {t.edit && <div className="panel-pad">
            <div className="form-grid">
              <div className="field"><label htmlFor="f3-e">Return</label><select id="f3-e" value={mc.entityId} onChange={(e) => setMc({ ...mc, entityId: e.target.value })}>{returnUnits(state).map((u) => <option key={u.entity.id} value={u.entity.id}>{u.entity.code}</option>)}</select></div>
              <div className="field"><label htmlFor="f3-d">Change</label><input id="f3-d" value={mc.description} onChange={(e) => setMc({ ...mc, description: e.target.value })} /></div>
              <div className="field"><label htmlFor="f3-y">Year of change</label><input id="f3-y" className="num" inputMode="numeric" value={mc.year} onChange={(e) => setMc({ ...mc, year: e.target.value })} /></div>
              <div className="field"><label htmlFor="f3-s">Status</label><select id="f3-s" value={mc.status} onChange={(e) => setMc({ ...mc, status: e.target.value as MethodChange['status'] })}><option value="considering">Considering</option><option value="filed">Filed</option><option value="accepted">Accepted</option><option value="dropped">Dropped</option></select></div>
              <div className="field"><label htmlFor="f3-n">DCN</label><input id="f3-n" value={mc.dcn} onChange={(e) => setMc({ ...mc, dcn: e.target.value })} /></div>
              <div className="field"><label htmlFor="f3-f">Filed on</label><input id="f3-f" type="date" value={mc.filedOn} onChange={(e) => setMc({ ...mc, filedOn: e.target.value })} /></div>
              <div className="field"><label htmlFor="f3-a">§481(a) adjustment</label><input id="f3-a" className="num" inputMode="decimal" value={mc.adj481} onChange={(e) => setMc({ ...mc, adj481: e.target.value })} /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => {
              setErrors([]);
              const adj = mc.adj481.trim() ? parseMoney(mc.adj481) : undefined;
              if (adj === null) { setErrors(['Enter the §481(a) adjustment like (4,200.00), or leave it blank.']); return; }
              try { saveMethodChange(books, user, { entityId: mc.entityId, description: mc.description, year: Number(mc.year), status: mc.status, dcn: mc.dcn, filedOn: mc.filedOn || undefined, adj481: adj }); say('Method change saved.'); setMc({ ...mc, description: '', dcn: '', filedOn: '', adj481: '' }); } catch (e) { setErrors(errList(e)); }
            }}>Add change</button></div>
          </div>}
        </section>
      </div>
      {toast}
      <Help k="taxMethods" />
    </>
  );
}

// ── Estimated taxes ──────────────────────────────────────────────────────
export function TaxEstimatesPage() {
  const { state, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const list = useMemo(() => estimates(state, t.today, t.year), [state, t.today, t.year, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t.ok) return <NoAccess title="Estimated taxes" />;
  const inst = list.flatMap((s) => s.installments.map((i) => ({ s, i })));
  const soon = inst.filter((x) => !x.i.done && x.i.daysLeft <= 14);
  const next = inst.filter((x) => !x.i.done).sort((a, b) => a.i.dueDate.localeCompare(b.i.dueDate))[0];
  const posted = taxOf(state).payments.filter((p) => p.txnId);
  const txAmt = (id: ID) => state.transactions.find((x) => x.id === id && !x.deleted)?.lines.filter((l) => !l.system).reduce((a, l) => a + l.debit, 0);
  const bad = posted.filter((p) => txAmt(p.txnId!) !== p.amount);
  return (
    <>
      <PageHead eyebrow="Tax" title="Estimated taxes" lede="Quarterly estimates per owner and entity from this year's results annualized, against the prior-year safe harbor (100%, or 110% above the AGI threshold). Recording a payment an entity makes posts it through the ledger.">
        <YearSelect year={t.year} onChange={(v) => t.set('year', v)} />
        <ExportButtons name={`estimated-taxes-${t.year}`} header={['Payer', 'Jurisdiction', 'Quarter', 'Due', 'Required', 'Paid', 'Short', 'Method']} rows={inst.map(({ s, i }) => [s.payerName, s.plan.jurisdiction, i.quarter, i.dueDate, csvMoney(i.required), csvMoney(i.paid), csvMoney(i.short), s.method === 'safe_harbor' ? `${s.safeHarborPct}% of prior year` : '90% of this year'])} />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Estimates" style={{ marginBottom: 20 }}>
        <Figure label="Due within 14 days" value={<span className={soon.length ? 'neg' : undefined}>{soon.length}</span>} note={soon.map((x) => `${x.s.payerName} Q${x.i.quarter} ${$(x.i.short)} ${shortDate(x.i.dueDate)}`).join('; ') || 'Nothing due'} />
        <Figure label={`Required for ${t.year}`} value={<Money c={list.reduce((a, s) => a + s.required, 0)} whole dollar />} note={`${list.length} payers`} />
        <Figure label="Paid so far" value={<Money c={list.reduce((a, s) => a + s.paid, 0)} whole dollar />} />
        <Figure label="Next due" value={next ? shortDate(next.i.dueDate) : '—'} note={next ? `${next.s.payerName} ${next.s.plan.jurisdiction} Q${next.i.quarter}` : 'All paid'} />
      </section>
      <div className="stack">
        {list.map((s) => <EstimateCard key={s.plan.id} s={s} onSay={say} />)}
        {!list.length && <p className="muted">No estimate plans for {t.year}.</p>}
      </div>
      <TieOut items={[
        { label: bad.length ? `${bad.length} entity payment(s) differ from their entry in the books` : `Payments made by an entity agree with their entries in the books (${posted.length})`, ok: !bad.length },
        { label: 'Each plan\'s four installments add to its required amount', ok: list.every((s) => s.installments.reduce((a, i) => a + i.required, 0) === s.required) },
      ]} />
      {toast}
      <Help k="taxEstimates" />
    </>
  );
}

function EstimateCard({ s, onSay }: { s: EstimateStatus; onSay: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const t = useTax();
  const first = s.installments.find((i) => !i.done);
  const [pay, setPay] = useState({ quarter: String(first?.quarter ?? 1), date: t.today, amount: first ? formatMoney(first.short) : '', paidBy: s.plan.payer === 'entity' ? 'entity' : 'owner', entityId: s.plan.entityId ?? 'ent_corp', confirmation: '' });
  const [sh, setSh] = useState({ prior: formatMoney(s.plan.priorYearTax), high: s.plan.highIncome });
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const id = s.plan.id;
  return (
    <section className="panel" aria-labelledby={`es-${id}`}>
      <div className="panel-head"><h2 id={`es-${id}`}>{s.payerName} · {s.plan.jurisdiction === 'federal' ? 'Federal' : 'State'} {s.plan.year}</h2><span className="muted small">{s.plan.payer === 'owner' ? `Share of ${s.plan.entityIds.map((e) => state.entities.find((x) => x.id === e)?.code).join(' + ')}` : 'Entity-level'}</span></div>
      <div className="panel-pad">
        <dl className="kv">
          <dt>Projected income</dt><dd><Money c={s.projectedIncome} dollar /> × {pctBps(s.rateBps)} = <Money c={s.projectedTax} dollar /></dd>
          <dt>This-year basis</dt><dd><Money c={s.currentYearBasis} dollar /> {s.plan.payer === 'owner' ? '(90%)' : '(100%)'}</dd>
          <dt>Safe harbor</dt><dd><Money c={s.safeHarbor} dollar /> ({s.safeHarborPct}% of last year's <Money c={s.plan.priorYearTax} dollar />)</dd>
          <dt>Required</dt><dd><b><Money c={s.required} dollar /></b> · {s.method === 'safe_harbor' ? 'safe harbor is lower' : 'this year is lower'}</dd>
          {s.plan.note && <><dt>Note</dt><dd>{s.plan.note}</dd></>}
        </dl>
      </div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Quarter</th><th scope="col">Due</th><th scope="col" className="num">Required</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Short</th><th scope="col">Payments</th><th scope="col">Status</th></tr></thead>
        <tbody>{s.installments.map((i) => <tr key={i.quarter}><td>Q{i.quarter}</td><td>{shortDate(i.dueDate)}</td><td className="num"><Money c={i.required} /></td><td className="num"><Money c={i.paid} /></td><td className="num"><Money c={i.short} /></td>
          <td className="small">{i.payments.map((p) => <div key={p.id}>{shortDate(p.date)} <Money c={p.amount} dollar /> {p.txnId ? <Link to={`/books/transactions/${p.txnId}`}>{state.transactions.find((x) => x.id === p.txnId)?.ref}</Link> : p.paidBy === 'entity' ? '(before these books)' : '(paid personally)'}{p.confirmation && <span className="muted"> #{p.confirmation}</span>}</div>)}</td>
          <td><span className={'pill ' + (i.done ? 'ok' : i.overdue ? 'bad' : i.daysLeft <= 14 ? 'warn' : '')}>{i.done ? 'Paid' : i.overdue ? 'Overdue' : i.daysLeft <= 14 ? `Due in ${i.daysLeft} days` : 'Upcoming'}</span></td></tr>)}</tbody>
      </table></div>
      {t.edit && <div className="panel-pad">
        <Errors errors={errors} />
        <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Record a payment'}</button>
        {open && <>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field"><label htmlFor={`ep-q-${id}`}>Quarter</label><select id={`ep-q-${id}`} value={pay.quarter} onChange={(e) => setPay({ ...pay, quarter: e.target.value })}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</select></div>
            <div className="field"><label htmlFor={`ep-d-${id}`}>Paid on</label><input id={`ep-d-${id}`} type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ep-a-${id}`}>Amount</label><input id={`ep-a-${id}`} className="num" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ep-b-${id}`}>Paid by</label><select id={`ep-b-${id}`} value={pay.paidBy} onChange={(e) => setPay({ ...pay, paidBy: e.target.value })}>{s.plan.payer === 'owner' && <option value="owner">The owner, personally</option>}<option value="entity">An entity (posts from Trustmark)</option></select></div>
            {pay.paidBy === 'entity' && <div className="field"><label htmlFor={`ep-e-${id}`}>Entity</label><select id={`ep-e-${id}`} value={pay.entityId} onChange={(e) => setPay({ ...pay, entityId: e.target.value })}>{returnUnits(state).map((u) => <option key={u.entity.id} value={u.entity.id}>{u.entity.code}</option>)}</select></div>}
            <div className="field"><label htmlFor={`ep-c-${id}`}>Confirmation #</label><input id={`ep-c-${id}`} value={pay.confirmation} onChange={(e) => setPay({ ...pay, confirmation: e.target.value })} /></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
            setErrors([]);
            const amt = parseMoney(pay.amount);
            try {
              const p = recordEstimatePayment(books, user, { planId: s.plan.id, quarter: Number(pay.quarter), date: pay.date, amount: amt ?? NaN, paidBy: pay.paidBy as 'owner' | 'entity', entityId: pay.paidBy === 'entity' ? pay.entityId : undefined, confirmation: pay.confirmation });
              setOpen(false);
              onSay(p.txnId ? `Payment posted as ${books.state.transactions.find((x) => x.id === p.txnId)?.ref}.` : 'Payment recorded.');
            } catch (e) { setErrors(errList(e)); }
          }}>Record payment</button>{pay.paidBy === 'entity' && <span className="muted small">{s.plan.payer === 'owner' ? 'An owner\'s estimate paid by an entity is a distribution to that owner (owner-withdrawal policy).' : 'Posts to 6250 Income & franchise taxes.'}</span>}</div>
          <div className="form-grid" style={{ marginTop: 16 }}>
            <div className="field"><label htmlFor={`sh-p-${id}`}>Last year's total tax (safe harbor)</label><input id={`sh-p-${id}`} className="num" inputMode="decimal" value={sh.prior} onChange={(e) => setSh({ ...sh, prior: e.target.value })} /></div>
            {s.plan.payer === 'owner' && <label className="check"><input type="checkbox" checked={sh.high} onChange={(e) => setSh({ ...sh, high: e.target.checked })} /> Prior-year AGI over {$(ratesOf(state).safeHarborAgi)} (110%)</label>}
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => {
            setErrors([]);
            const v = parseMoney(sh.prior);
            try { saveEstimatePlan(books, user, { ...s.plan, priorYearTax: v ?? NaN, highIncome: sh.high }); onSay('Safe harbor saved.'); } catch (e) { setErrors(errList(e)); }
          }}>Save safe harbor</button></div>
        </>}
      </div>}
    </section>
  );
}

// ── Owners & K-1 ─────────────────────────────────────────────────────────
export function TaxOwnersPage() {
  const { state, books, user, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const units = useMemo(() => returnUnits(state).filter((u) => u.entity.taxClass !== 'c_corp_1120'), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const k1s = useMemo(() => units.map((u) => k1Allocation(state, u.entity.id, t.year, t.asOf)), [state, units, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const td = useMemo(() => taxDistributions(state, { year: t.year, asOf: t.asOf }), [state, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cap = useMemo(() => distributionCapacity(state, { year: t.year, asOf: t.asOf }), [state, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edit, setEdit] = useState<string | null>(null);
  const [st, setSt] = useState({ basis: '', capital: '', contributions: '' });
  const [errors, setErrors] = useState<string[]>([]);
  if (!t.ok) return <NoAccess title="Owners & K-1" />;
  const allocated = k1s.reduce((a, k) => a + k.taxableIncome, 0);
  const dist = k1s.reduce((a, k) => a + k.rows.reduce((x, r) => x + r.distributions, 0), 0);
  const drawsTotal = ownerDraws(state, { from: `${t.year}-01-01`, to: t.asOf }).rows.filter((r) => r.ownerId && units.some((u) => u.storeIds.includes(r.l.storeId))).reduce((a, r) => a + r.amount, 0);
  const rows = k1s.flatMap((k) => k.rows.map((r) => [k.unit.entity.code, r.name, pctBps(r.pctBps), csvMoney(r.income), csvMoney(r.projected), csvMoney(r.distributions), csvMoney(r.basisStart), csvMoney(r.basisEnd), csvMoney(r.suspendedLoss), csvMoney(r.capitalStart), csvMoney(r.capitalEnd)]));
  return (
    <>
      <PageHead eyebrow="Tax" title="Owners & K-1" lede="Each owner's share of income by ownership %, distributions from the owner draws, and the basis and capital roll-forward per return; then tax distributions (projected taxable income × owner rate) against cash available to pay them.">
        <YearSelect year={t.year} onChange={(v) => t.set('year', v)} />
        <ExportButtons name={`k1-owners-${t.year}`} header={['Return', 'Owner', '%', 'Share of income', 'Projected share', 'Distributions', 'Basis start', 'Basis end', 'Suspended loss', 'Capital start', 'Capital end']} rows={rows} sheet="K-1 support" />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Owners" style={{ marginBottom: 20 }}>
        <Figure label="Income allocated to owners" value={<Money c={allocated} whole dollar />} note={`${t.year} to date, ${k1s.length} returns`} />
        <Figure label="Distributions" value={<Money c={dist} whole dollar />} href="/intercompany/draws" />
        <Figure label="Tax distributions needed" value={<Money c={td.total} whole dollar />} note={`Projected income × ${pctBps(td.rows[0]?.rateBps ?? 0)}`} />
        <Figure label="Distribution capacity" value={<Money c={cap.capacity} whole dollar />} note={cap.covered ? 'Covers the tax still to distribute' : `Short of ${$(cap.taxStillToDistribute)} still to distribute`} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        {k1s.map((k) => (
          <section key={k.unit.entity.id} className="panel" aria-labelledby={`k1-${k.unit.entity.id}`}>
            <div className="panel-head"><h2 id={`k1-${k.unit.entity.id}`}>{k.unit.entity.code} · {k.unit.form}</h2><span className="muted small">Taxable income <Money c={k.taxableIncome} dollar /> · projected <Money c={k.projected} dollar /></span></div>
            {k.disproportionate && <div className="note warn" style={{ margin: '0 16px 12px' }}>Distributions are not in proportion to stock owned ({k.rows.map((r) => `${r.name} ${r.distributionShare === null ? '—' : (r.distributionShare * 100).toFixed(0) + '%'} vs ${pctBps(r.pctBps)}`).join(', ')}). An S corporation has one class of stock: true up or document it with the CPA.</div>}
            {!k.ownersSet && <p className="panel-pad muted">No owners entered. <Link to="/tax">Add them in the entity map.</Link></p>}
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Owner</th><th scope="col" className="num">%</th><th scope="col" className="num">Share of income</th><th scope="col" className="num">Distributions</th><th scope="col" className="num">Non-deductible</th><th scope="col" className="num">Basis start</th><th scope="col" className="num">Basis end</th><th scope="col" className="num">Suspended / excess</th><th scope="col" className="num">Capital start</th><th scope="col" className="num">Capital end</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{k.rows.map((r) => {
                const key = k.unit.entity.id + r.partyId;
                return [
                  <tr key={key}><td>{r.name}</td><td className="num">{pctBps(r.pctBps)}</td><td className="num"><Money c={r.income} /></td><td className="num"><Money c={r.distributions} /></td><td className="num"><Money c={r.nondeductible} /></td><td className="num"><Money c={r.basisStart} /></td><td className="num"><Money c={r.basisEnd} /></td>
                    <td className="num">{r.suspendedLoss ? <span className="neg"><Money c={r.suspendedLoss} /> suspended</span> : r.excessDistribution ? <span className="neg"><Money c={r.excessDistribution} /> gain</span> : '—'}</td><td className="num"><Money c={r.capitalStart} /></td><td className="num"><Money c={r.capitalEnd} /></td>
                    <td>{t.edit && <button className="btn sm" aria-expanded={edit === key} aria-label={`Start: beginning basis for ${r.name} in ${k.unit.entity.code}`} onClick={() => { const s0 = ownerStartOf(state, k.unit.entity.id, r.partyId, t.year); setSt({ basis: formatMoney(s0?.basis ?? 0), capital: formatMoney(s0?.capital ?? 0), contributions: formatMoney(s0?.contributions ?? 0) }); setEdit(edit === key ? null : key); }}>Start</button>}</td></tr>,
                  edit === key && <tr key={key + 'f'}><td colSpan={11}><div className="panel-pad" style={{ background: 'var(--panel-2)' }}>
                    <div className="form-grid">
                      <div className="field"><label htmlFor={`ob-b-${key}`}>Beginning basis</label><input id={`ob-b-${key}`} className="num" inputMode="decimal" value={st.basis} onChange={(e) => setSt({ ...st, basis: e.target.value })} /></div>
                      <div className="field"><label htmlFor={`ob-c-${key}`}>Beginning capital (tax basis)</label><input id={`ob-c-${key}`} className="num" inputMode="decimal" value={st.capital} onChange={(e) => setSt({ ...st, capital: e.target.value })} /></div>
                      <div className="field"><label htmlFor={`ob-k-${key}`}>Contributions this year</label><input id={`ob-k-${key}`} className="num" inputMode="decimal" value={st.contributions} onChange={(e) => setSt({ ...st, contributions: e.target.value })} /></div>
                    </div>
                    <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
                      setErrors([]);
                      const [b, c, k2] = [parseMoney(st.basis), parseMoney(st.capital), parseMoney(st.contributions)];
                      try { setOwnerStart(books, user, { entityId: k.unit.entity.id, partyId: r.partyId, year: t.year, basis: b ?? NaN, capital: c ?? NaN, contributions: k2 ?? NaN }); setEdit(null); say('Saved.'); } catch (e) { setErrors(errList(e)); }
                    }}>Save</button><span className="muted small">From last year's K-1.</span></div>
                  </div></td></tr>,
                ];
              })}</tbody>
            </table></div>
            <TieOut items={[
              { label: k.ties ? 'Owner shares add back to the return\'s taxable income' : 'Owner shares do not add to taxable income', ok: k.ties, detail: <Money c={k.rows.reduce((a, r) => a + r.income, 0)} dollar /> },
              { label: 'M-2 ending = the owners\' capital accounts', ok: m2(state, k.unit.entity.id, t.year, t.asOf).ending === k.rows.reduce((a, r) => a + r.capitalEnd, 0) },
            ]} />
          </section>
        ))}
        <section className="panel" aria-labelledby="tdist-h">
          <div className="panel-head"><h2 id="tdist-h">Tax distributions</h2><span className="muted small">SPEC §4.21: projected taxable income × owner rate</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Return</th><th scope="col">Owner</th><th scope="col" className="num">Projected share</th><th scope="col" className="num">Rate</th><th scope="col" className="num">Tax distribution</th><th scope="col" className="num">Distributed</th><th scope="col" className="num">Still to distribute</th></tr></thead>
            <tbody>{td.rows.map((r) => <tr key={r.entityId + r.partyId}><td>{state.entities.find((e) => e.id === r.entityId)?.code}</td><td>{r.name}</td><td className="num"><Money c={r.projectedShare} /></td><td className="num">{pctBps(r.rateBps)}</td><td className="num"><Money c={r.taxDistribution} /></td><td className="num"><Money c={r.paid} /></td><td className="num"><Money c={r.remaining} /></td></tr>)}</tbody>
          </table></div>
          <div className="panel-pad"><dl className="kv">
            <dt>Bank (all bank accounts)</dt><dd><Money c={cap.bank} dollar /></dd>
            <dt>Less floor</dt><dd><Money c={-cap.floor} dollar /></dd>
            <dt>Less entity estimates due in 90 days</dt><dd><Money c={-cap.estimatesDue} dollar /></dd>
            <dt>Distribution capacity</dt><dd><b><Money c={cap.capacity} dollar /></b> vs <Money c={cap.taxStillToDistribute} dollar /> still to distribute · <span className={'pill ' + (cap.covered ? 'ok' : 'warn')}>{cap.covered ? 'Covered' : 'Not covered'}</span></dd>
          </dl><p className="muted small">The full safe-distribution figure (reserve, capex, debt-service cushion) arrives with Phase 13.</p></div>
          <TieOut items={[{ label: dist === drawsTotal ? 'Distributions tie to the owner draws in the books' : 'Distributions do not tie to the owner draws', ok: dist === drawsTotal, detail: <Money c={drawsTotal} dollar /> }]} />
        </section>
      </div>
      {toast}
      <Help k="taxOwners" />
    </>
  );
}

// ── Planning ─────────────────────────────────────────────────────────────
export function TaxPlanningPage() {
  const { state, books, user, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const entity = useReturn(t.sp);
  const p = useMemo(() => (entity ? planning(state, entity, t.year, t.asOf) : null), [state, entity, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  if (!t.ok || !p) return <NoAccess title="Tax planning" />;
  const pr = p.projection;
  return (
    <>
      <PageHead eyebrow="Tax" title="Tax planning" lede="Projected year-end taxable income for each return and the levers that change it: timing of equipment purchases, bonus and §179 elections, retirement contributions, a reasonable owner salary for the S corporation, and a restructuring comparison, each with the tax it would save at the rates in the tables.">
        <ReturnSelect value={entity} onChange={(v) => t.set('entity', v)} />
        <YearSelect year={t.year} onChange={(v) => t.set('year', v)} />
        <ExportButtons name={`tax-planning-${pr.unit.entity.code}-${t.year}`} header={['Lever', 'Amount', 'Deduction', 'Tax saved', 'Note']} rows={p.levers.map((l) => [l.label, csvMoney(l.amount), csvMoney(l.deduction), csvMoney(l.taxSaved), l.note])} />
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="Planning" style={{ marginBottom: 20 }}>
        <Figure label="Projected taxable income" value={<Money c={pr.projected} whole dollar />} note={`${pr.unit.entity.code} · ${pr.monthsElapsed.toFixed(1)} months annualized`} />
        <Figure label="Projected tax" value={<Money c={p.projectedTax} whole dollar />} note={`At ${pctBps(p.rateBps)}`} />
        <Figure label="Saved by the levers" value={<Money c={p.totalSaved} whole dollar />} note="Restructuring note not counted" />
        <Figure label="After the levers" value={<Money c={p.afterLevers} whole dollar />} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel" aria-labelledby="pj-h">
          <div className="panel-head"><h2 id="pj-h">Projection</h2></div>
          <div className="panel-pad"><dl className="kv">
            <dt>Taxable income to date</dt><dd><Money c={pr.ytdTaxable} dollar /> <Link to={`/tax/book-to-tax?entity=${pr.unit.entity.id}`}>Book-to-tax</Link></dd>
            <dt>Before depreciation, to date</dt><dd><Money c={pr.beforeDepreciation} dollar /></dd>
            <dt>Annualized ({pr.monthsElapsed.toFixed(1)} of 12 months)</dt><dd><Money c={pr.annualized} dollar /></dd>
            <dt>Less the year's tax depreciation</dt><dd><Money c={-pr.taxDepreciation} dollar /> <Link to="/tax/depreciation">Tax depreciation</Link></dd>
            <dt>Projected taxable income</dt><dd><b><Money c={pr.projected} dollar /></b></dd>
          </dl></div>
          <TieOut items={[{ label: 'Projection = annualized income before depreciation − tax depreciation', ok: pr.projected === pr.annualized - pr.taxDepreciation }]} />
        </section>
        <section className="panel" aria-labelledby="lv-h">
          <div className="panel-head"><h2 id="lv-h">Levers</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Lever</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Deduction</th><th scope="col" className="num">Tax saved</th><th scope="col">How it works</th></tr></thead>
            <tbody>{p.levers.map((l) => {
              const editable = t.edit && ['equipment', 'retirement', 'salary'].includes(l.key);
              const v = amounts[l.key] ?? formatMoney(l.amount);
              return (
                <tr key={l.key}><td><b>{l.label}</b></td>
                  <td className="num">{editable ? <div className="field"><label htmlFor={`lv-${l.key}`} className="sr-only">{LEVER_LABEL[l.key]} amount</label><input id={`lv-${l.key}`} className="num" inputMode="decimal" value={v} style={{ maxWidth: 140 }} onChange={(e) => setAmounts({ ...amounts, [l.key]: e.target.value })} onBlur={() => {
                    setErrors([]);
                    const n = parseMoney(v);
                    if (n === null) { setErrors(['Enter the amount like 50,000.00.']); return; }
                    if (n === l.amount) return;
                    try { setLever(books, user, pr.unit.entity.id, t.year, l.key as LeverKey, n); setAmounts({}); say('Lever saved.'); } catch (e) { setErrors(errList(e)); }
                  }} /></div> : <Money c={l.amount} />}</td>
                  <td className="num"><Money c={l.deduction} /></td><td className="num">{l.info ? <span className="muted"><Money c={l.taxSaved} /></span> : <Money c={l.taxSaved} signed />}</td><td className="small">{l.note}</td></tr>
              );
            })}</tbody>
          </table></div>
          <TieOut items={[{ label: 'Saved = the sum of the levers (restructuring is information only)', ok: p.totalSaved === p.levers.filter((l) => !l.info).reduce((a, l) => a + l.taxSaved, 0), detail: <Money c={p.totalSaved} dollar /> }]} />
        </section>
        <RatesPanel onSay={say} />
      </div>
      {toast}
      <Help k="taxPlanning" />
    </>
  );
}

function RatesPanel({ onSay }: { onSay: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const t = useTax();
  const r = ratesOf(state);
  type Key = 'ownerFederalBps' | 'ownerStateBps' | 'cCorpBps' | 'pteBps' | 'ficaBps' | 'salesTaxBps' | 'mealsDisallowBps' | 'bonusPct' | 'grossReceiptsThreshold' | 'section179Limit' | 'section179Phaseout' | 'safeHarborAgi';
  const pctKeys: Key[] = ['ownerFederalBps', 'ownerStateBps', 'cCorpBps', 'pteBps', 'ficaBps', 'salesTaxBps', 'mealsDisallowBps'];
  const moneyKeys: Key[] = ['grossReceiptsThreshold', 'section179Limit', 'section179Phaseout', 'safeHarborAgi'];
  const LABEL: Record<Key, string> = {
    ownerFederalBps: 'Owner federal rate', ownerStateBps: 'Owner state rate', cCorpBps: 'C corporation rate', pteBps: 'Pass-through entity tax rate', ficaBps: 'FICA (both halves)', salesTaxBps: 'Sales tax rate',
    mealsDisallowBps: 'Meals not deductible', bonusPct: 'Bonus depreciation', grossReceiptsThreshold: 'Gross-receipts threshold', section179Limit: '§179 limit', section179Phaseout: '§179 phase-out starts', safeHarborAgi: 'Safe harbor 110% above AGI',
  };
  const init = () => Object.fromEntries([...pctKeys.map((k) => [k, String((r[k] as number) / 100)]), ['bonusPct', String(r.bonusPct)], ...moneyKeys.map((k) => [k, formatMoney(r[k] as number)])]) as Record<Key, string>;
  const [d, setD] = useState<Record<Key, string>>(init);
  const [errors, setErrors] = useState<string[]>([]);
  const show = (k: Key): ReactNode => (moneyKeys.includes(k) ? $(r[k] as number) : k === 'bonusPct' ? `${r.bonusPct}%` : pctBps(r[k] as number));
  return (
    <section className="panel" aria-labelledby="rt-h">
      <div className="panel-head"><h2 id="rt-h">Tax tables</h2><span className="pill warn">Verify with your CPA</span></div>
      <Errors errors={errors} />
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Rate or threshold</th><th scope="col" className="num">Now</th><th scope="col">Default and source</th>{t.edit && <th scope="col">Change</th>}</tr></thead>
        <tbody>{([...pctKeys, 'bonusPct', ...moneyKeys] as Key[]).map((k) => <tr key={k}><td>{LABEL[k]}</td><td className="num">{show(k)}</td><td className="small muted">{RATE_NOTES[k as keyof TaxRates] ?? ''}</td>
          {t.edit && <td><label htmlFor={`rt-${k}`} className="sr-only">{LABEL[k]}</label><input id={`rt-${k}`} className="num" inputMode="decimal" value={d[k]} style={{ maxWidth: 160 }} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></td>}</tr>)}
          <tr><td>MACRS lives by class</td><td className="small" colSpan={t.edit ? 3 : 2}>{Object.entries(r.macrsYears).map(([c, y]) => `${CLASS_LABEL[c as keyof typeof CLASS_LABEL]} ${y || '—'}`).join(' · ')}</td></tr>
        </tbody>
      </table></div>
      {t.edit && <div className="panel-pad"><button className="btn" onClick={() => {
        setErrors([]);
        const out: Partial<TaxRates> = {};
        for (const k of pctKeys) { const n = Number(d[k]); if (!Number.isFinite(n)) { setErrors([`${LABEL[k]}: enter a percentage.`]); return; } (out as Record<string, number>)[k] = Math.round(n * 100); }
        out.bonusPct = Number(d.bonusPct);
        for (const k of moneyKeys) { const n = parseMoney(d[k]); if (n === null) { setErrors([`${LABEL[k]}: enter an amount.`]); return; } (out as Record<string, number>)[k] = n; }
        try { saveTaxRates(books, user, out); onSay('Tax tables saved.'); } catch (e) { setErrors(errList(e)); }
      }}>Save tables</button></div>}
    </section>
  );
}

// ── CPA package ──────────────────────────────────────────────────────────
export function CpaPackagePage() {
  const { state, books, user, version } = useBooks();
  const t = useTax();
  const [toast, say] = useToast();
  const pk = useMemo(() => cpaPackage(state, { year: t.year, asOf: t.asOf }), [state, t.year, t.asOf, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t.ok) return <NoAccess title="CPA package" />;
  const units = returnUnits(state);
  const tbFiles = pk.files.filter((f) => f.name.startsWith('01-'));
  const tbOk = tbFiles.every((f) => { const tot = f.csv.split('\n').find((l) => l.startsWith(',Total'))?.split(','); return tot && tot[2] === tot[3]; });
  const download = () => {
    try {
      const data = cpaPackageZip(state, user, { year: t.year, asOf: t.asOf });
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url; a.download = `cpa-package-${t.year}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      books.logExport(user, `cpa-package-${t.year}.zip`);
      say(`Downloaded cpa-package-${t.year}.zip (${pk.files.length + 2} files).`);
    } catch (e) { say((e as Error).message); }
  };
  return (
    <>
      <PageHead eyebrow="Tax" title="CPA package" lede="The year-end export for the outside accountant (SPEC §12): trial balances per entity, the fixed asset schedule book and tax, loan schedules, payroll summaries, the 1099 list, owner draws, intercompany balances, inventory and the tax workpapers, as one ZIP with a printable index.">
        <YearSelect year={t.year} onChange={(v) => t.set('year', v)} />
        {can(user, 'export') && <button className="btn primary" onClick={download}>Download ZIP</button>}
        <button className="btn" onClick={() => window.print()}>Print index</button>
      </PageHead>
      <Disclaimer />
      <section className="figures" aria-label="CPA package" style={{ marginBottom: 20 }}>
        <Figure label="Files" value={pk.files.length + 2} note="Schedules + index (HTML and CSV)" />
        <Figure label="Rows" value={pk.files.reduce((a, f) => a + f.rows, 0).toLocaleString('en-US')} />
        <Figure label="Figures through" value={shortDate(t.asOf)} note={t.asOf < `${t.year}-12-31` ? 'Year still open: re-export after the close' : 'Full year'} />
        <Figure label="Returns" value={units.length} note={units.map((u) => `${u.entity.code} ${u.form}`).join(' · ')} />
      </section>
      <section className="panel" aria-labelledby="cp-h">
        <div className="panel-head"><h2 id="cp-h">Index · {state.settings.companyName} {t.year}</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col" className="num">#</th><th scope="col">File</th><th scope="col">Contents</th><th scope="col" className="num">Rows</th><th scope="col">On screen</th></tr></thead>
          <tbody>{pk.files.map((f, i) => <tr key={f.name}><td className="num">{i + 1}</td><td className="small">{f.name}</td><td>{f.title}</td><td className="num">{f.rows}</td><td className="small"><Link to={screenFor(f.name)}>Open</Link></td></tr>)}</tbody>
        </table></div>
        <TieOut items={[
          { label: tbOk ? 'Every entity\'s trial balance in the package balances' : 'A trial balance in the package does not balance', ok: tbOk },
          { label: `Workpapers for every return (${units.map((u) => u.entity.code).join(', ')})`, ok: units.every((u) => pk.files.find((f) => f.name === '09-tax-workpapers.csv')?.csv.includes(`\n${u.entity.code},`)) },
          { label: `A trial balance for every entity (${tbFiles.length})`, ok: tbFiles.length === state.entities.filter((e) => !e.deleted).length },
        ]} />
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>Every download is logged in the audit log. {DISCLAIMER}</p>
      {toast}
      <Help k="taxCpa" />
    </>
  );
}

function screenFor(name: string): string {
  const m: [string, string][] = [['00-', '/tax'], ['01-', '/reports/trial-balance'], ['02-', '/tax/depreciation'], ['03-', '/assets/loans'], ['04-', '/people/taxes'], ['05-', '/payables/1099'], ['06-', '/intercompany/draws'], ['07-', '/intercompany/parties'], ['08-', '/inside/inventory'], ['09-', '/tax/book-to-tax'], ['10-', '/tax/sales-tax'], ['11-', '/tax/estimates'], ['12-', '/tax/owners']];
  return m.find(([p]) => name.startsWith(p))?.[1] ?? '/tax';
}
