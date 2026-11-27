import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, PartyOptions, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import { AttachButton, DocList, openDoc } from '../components/docs';
import {
  EXPIRY_LABEL, KIND_LABEL, LICENSE_LABEL, NOTICE_STATUS_LABEL, POLICY_LABEL, STATUS_LABEL, attachToCompliance, canSee, complianceOf, expiryStatus, linkDoc,
  occurrences, openNotices, renewLicense, saveComplianceItem, saveLicense, saveNotice, searchVault, unlinkDoc, updateDocMeta, updateOccurrence, uploadToVault, vaultIndex,
  type ExpiryStatus, type OccurrenceRow,
} from '../../core/compliance';
import { addDays, daysBetween, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { bankStoreId } from '../../core/bank';
import { prepaidsOf } from '../../core/prepaids';
import { needsDocument } from '../inbox';
import type { Attachment, ComplianceKind, ComplianceStatus, DocLinkKind, ID, LicenseKind, NoticeStatus, RecurrenceEvery, TaxNotice } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const STATUS_PILL: Record<ComplianceStatus, string> = { not_started: '', in_prep: 'warn', filed: 'ok', paid: 'ok', accepted: 'ok' };
const EXP_PILL: Record<ExpiryStatus, string> = { expired: 'bad', expiring: 'warn', current: 'ok' };

function useNames() {
  const { state } = useBooks();
  return {
    store: (id?: ID) => (id ? state.stores.find((s) => s.id === id)?.code ?? '' : 'Company'),
    entity: (id?: ID) => (id ? state.entities.find((e) => e.id === id)?.code ?? '' : ''),
    party: (id?: ID) => (id ? state.parties.find((p) => p.id === id)?.name ?? '' : ''),
  };
}

// ── Compliance calendar ──────────────────────────────────────────────────
export function CalendarPage() {
  const { state, user, visible, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const n = useNames();
  const today = todayInChicago();
  const show = sp.get('show') ?? '90';
  const rows = useMemo(() => occurrences(state, { from: addDays(today, -120), to: addDays(today, 366), today, visible }), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null);
  const overdue = rows.filter((r) => r.overdue);
  const soon = rows.filter((r) => !r.done && !r.overdue && r.daysLeft <= 30);
  const doneYtd = rows.filter((r) => r.done && r.dueDate.startsWith(today.slice(0, 4)));
  const nextUp = rows.find((r) => !r.done && !r.overdue);
  const list = show === 'open' ? rows.filter((r) => !r.done && r.daysLeft <= 30) : show === 'year' ? rows : rows.filter((r) => r.daysLeft <= 90);
  const filedLike = rows.filter((r) => r.occ && ['filed', 'paid', 'accepted'].includes(r.occ.status));
  const unsupported = filedLike.filter((r) => !r.occ!.confirmation && !r.occ!.attachments.length);
  const paidTx = rows.filter((r) => r.occ?.txnId);
  const txTotal = (id: ID) => { const t = state.transactions.find((x) => x.id === id && !x.deleted); return t ? t.lines.filter((l) => !l.system).reduce((a, l) => a + l.debit, 0) : NaN; };
  const paidMismatch = paidTx.filter((r) => txTotal(r.occ!.txnId!) !== r.occ!.paidAmount);
  const edit = can(user, 'compliance.edit');
  const set = (k: string, v: string) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }); };
  return (
    <>
      <PageHead eyebrow="Compliance" title="Compliance calendar" lede="Every return, payment and annual filing with its due date, status and confirmation. Items due within 30 days and anything overdue reach the inbox.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('compliance-calendar', ['Due', 'Obligation', 'Kind', 'Agency', 'Form', 'Covers', 'Store', 'Status', 'Filed', 'Paid on', 'Paid', 'Confirmation'], list.map((r) => [r.dueDate, r.item.title, KIND_LABEL[r.item.kind], r.item.agency, r.item.form ?? '', r.covers, n.store(r.item.storeId), STATUS_LABEL[r.status], r.occ?.filedOn ?? '', r.occ?.paidOn ?? '', r.occ?.paidAmount ? csvMoney(r.occ.paidAmount) : '', r.occ?.confirmation ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Compliance" style={{ marginBottom: 20 }}>
        <Figure label="Overdue" value={<span className={overdue.length ? 'neg' : undefined}>{overdue.length}</span>} note={overdue.length ? overdue.map((r) => r.item.title).join(', ') : 'Nothing overdue'} />
        <Figure label="Due in 30 days" value={soon.length} note={soon.length ? soon.map((r) => `${r.item.title} ${shortDate(r.dueDate)}`).join('; ') : 'Nothing due soon'} />
        <Figure label="Next due" value={nextUp ? shortDate(nextUp.dueDate) : '—'} note={nextUp ? `${nextUp.item.title}${nextUp.covers ? ` (${nextUp.covers})` : ''}` : 'Calendar is clear'} />
        <Figure label={`Done in ${today.slice(0, 4)}`} value={doneYtd.length} note="Filed, paid or accepted" />
      </section>
      <section className="panel" aria-labelledby="cal-h">
        <div className="panel-head"><h2 id="cal-h">Filings and payments</h2>
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={show === '90'} onClick={() => set('show', '')}>Next 90 days</button>
            <button aria-pressed={show === 'year'} onClick={() => set('show', 'year')}>Next 12 months</button>
            <button aria-pressed={show === 'open'} onClick={() => set('show', 'open')}>Overdue & due in 30 days</button>
          </div>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Due</th><th scope="col">Obligation</th><th scope="col">Covers</th><th scope="col">Store</th><th scope="col">Status</th><th scope="col">Record</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.map((r) => {
            const key = r.item.id + r.dueDate;
            return [
              <tr key={key}>
                <td>{shortDate(r.dueDate)}<div className="muted small">{r.done ? '' : r.overdue ? `${-r.daysLeft} days late` : `in ${r.daysLeft} days`}</div></td>
                <td><b>{r.item.title}</b><div className="muted small">{KIND_LABEL[r.item.kind]} · {r.item.agency}{r.item.form ? ` · ${r.item.form}` : ''}</div></td>
                <td>{r.covers || '—'}</td>
                <td>{r.item.storeId ? n.store(r.item.storeId) : n.entity(r.item.entityId) || 'Company'}</td>
                <td><span className={'pill ' + (r.overdue ? 'bad' : r.done ? 'ok' : STATUS_PILL[r.status])}>{r.overdue ? `Overdue · ${STATUS_LABEL[r.status]}` : STATUS_LABEL[r.status]}</span>{r.item.needsPayment && r.occ?.status === 'filed' && !r.occ.paidOn && <div className="muted small">Filed; payment not recorded</div>}</td>
                <td className="small">{r.occ?.filedOn && <div>Filed {shortDate(r.occ.filedOn)}</div>}{r.occ?.paidOn && <div>Paid <Money c={r.occ.paidAmount ?? 0} dollar /> {shortDate(r.occ.paidOn)}{r.occ.txnId && <> · <Link to={`/books/transactions/${r.occ.txnId}`}>{state.transactions.find((t) => t.id === r.occ!.txnId)?.ref}</Link></>}</div>}{r.occ?.confirmation && <div className="muted">#{r.occ.confirmation}</div>}{!!r.occ?.attachments.length && <DocList items={r.occ.attachments} say={say} />}</td>
                <td>{edit && <button className="btn sm" aria-expanded={open === key} aria-label={`Update ${r.item.title} due ${r.dueDate}`} onClick={() => setOpen(open === key ? null : key)}>Update</button>}</td>
              </tr>,
              open === key && <tr key={key + 'f'}><td colSpan={7}><OccurrenceForm row={r} onDone={(m) => { setOpen(null); say(m); }} say={say} /></td></tr>,
            ];
          })}</tbody>
        </table></div>
        {!list.length && <p className="panel-pad muted">Nothing overdue or due in the next 30 days.</p>}
        <TieOut items={[
          { label: unsupported.length ? `${unsupported.length} filed item(s) have no confirmation or document` : 'Every filed or paid item has a confirmation or document', ok: !unsupported.length },
          { label: paidMismatch.length ? `${paidMismatch.length} paid amount(s) differ from their payment in the books` : `Paid amounts agree with their payments in the books (${paidTx.length} linked)`, ok: !paidMismatch.length },
        ]} />
      </section>
      {edit && <NewObligation onSaved={(m) => say(m)} />}
      {toast}
      <Help k="complianceCalendar" />
    </>
  );
}

function OccurrenceForm({ row, onDone, say }: { row: OccurrenceRow; onDone: (m: string) => void; say: (m: string) => void }) {
  const { books, user, state } = useBooks();
  const today = todayInChicago();
  const o = row.occ;
  const [status, setStatus] = useState<ComplianceStatus>(o?.status && o.status !== 'not_started' ? o.status : row.item.needsPayment ? 'paid' : 'filed');
  const [filedOn, setFiled] = useState(o?.filedOn ?? today);
  const [paidOn, setPaidOn] = useState(o?.paidOn ?? (row.item.needsPayment ? today : ''));
  const [paid, setPaid] = useState(o?.paidAmount ? formatMoney(o.paidAmount) : '');
  const [conf, setConf] = useState(o?.confirmation ?? '');
  const [txn, setTxn] = useState(o?.txnId ? state.transactions.find((t) => t.id === o.txnId)?.ref ?? '' : '');
  const [note, setNote] = useState(o?.note ?? '');
  const [att, setAtt] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const id = row.item.id + row.dueDate;
  const payFields = status === 'paid' || row.item.needsPayment;
  return (
    <div className="panel-pad" style={{ background: 'var(--panel-2)' }}>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor={`os-${id}`}>Status</label><select id={`os-${id}`} value={status} onChange={(e) => setStatus(e.target.value as ComplianceStatus)}>{(Object.keys(STATUS_LABEL) as ComplianceStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
        <div className="field"><label htmlFor={`of-${id}`}>Filed on</label><input id={`of-${id}`} type="date" value={filedOn} onChange={(e) => setFiled(e.target.value)} /></div>
        {payFields && <div className="field"><label htmlFor={`op-${id}`}>Paid on</label><input id={`op-${id}`} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>}
        {payFields && <div className="field"><label htmlFor={`oa-${id}`}>Amount paid</label><input id={`oa-${id}`} className="num" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></div>}
        <div className="field"><label htmlFor={`oc-${id}`}>Confirmation #</label><input id={`oc-${id}`} value={conf} onChange={(e) => setConf(e.target.value)} /></div>
        {payFields && <div className="field"><label htmlFor={`ot-${id}`}>Payment TX-ref</label><input id={`ot-${id}`} value={txn} placeholder="TX-000123" onChange={(e) => setTxn(e.target.value)} /><span className="hint">Optional: the payment in the books</span></div>}
        <div className="field"><label htmlFor={`on-${id}`}>Note</label><input id={`on-${id}`} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => {
          setErrors([]);
          try {
            const t = txn.trim() ? books.getTransaction(txn.trim().toUpperCase()) : undefined;
            if (txn.trim() && !t) { setErrors([`No transaction ${txn.trim()}. Check the reference or leave it blank.`]); return; }
            const ship = status === 'filed' || status === 'paid' || status === 'accepted';
            updateOccurrence(books, user, row.item.id, row.dueDate, {
              status, filedOn: ship ? filedOn : undefined,
              paidOn: payFields && paidOn && (status === 'paid' || paid.trim()) ? paidOn : undefined, paidAmount: payFields && paid.trim() ? parseMoney(paid) ?? NaN : undefined,
              confirmation: conf, txnId: t?.id, note, attachments: att,
            });
            onDone(`${row.item.title}${row.covers ? ` (${row.covers})` : ''}: ${STATUS_LABEL[status]}.`);
          } catch (e) { setErrors(errList(e)); }
        }}>Save</button>
        <AttachButton books={books} userId={user.id} label="Attach confirmation" say={say} onFile={(a) => { setAtt((x) => [...x, a]); say(`${a.name} will be saved with this filing.`); }} />
        {att.length > 0 && <span className="muted small">{att.map((a) => a.name).join(', ')}</span>}
      </div>
    </div>
  );
}

function NewObligation({ onSaved }: { onSaved: (m: string) => void }) {
  const { books, user, state, stores } = useBooks();
  const [d, setD] = useState({ title: '', kind: 'sales_tax' as ComplianceKind, agency: '', form: '', every: 'monthly' as RecurrenceEvery, firstDue: '', covers: '1', storeId: '', needsPayment: true });
  const [errors, setErrors] = useState<string[]>([]);
  const up = (k: keyof typeof d, v: string | boolean) => setD({ ...d, [k]: v });
  return (
    <section className="panel panel-pad" aria-labelledby="no-h" style={{ marginTop: 20 }}>
      <h2 id="no-h" style={{ marginBottom: 8 }}>Add an obligation</h2>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor="no-t">Title</label><input id="no-t" value={d.title} onChange={(e) => up('title', e.target.value)} /></div>
        <div className="field"><label htmlFor="no-k">Kind</label><select id="no-k" value={d.kind} onChange={(e) => up('kind', e.target.value)}>{(Object.keys(KIND_LABEL) as ComplianceKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="no-a">Agency</label><input id="no-a" value={d.agency} onChange={(e) => up('agency', e.target.value)} /></div>
        <div className="field"><label htmlFor="no-f">Form</label><input id="no-f" value={d.form} onChange={(e) => up('form', e.target.value)} /></div>
        <div className="field"><label htmlFor="no-e">Repeats</label><select id="no-e" value={d.every} onChange={(e) => up('every', e.target.value)}><option value="once">Once</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Every year</option></select></div>
        <div className="field"><label htmlFor="no-d">First due date</label><input id="no-d" type="date" value={d.firstDue} onChange={(e) => up('firstDue', e.target.value)} /></div>
        <div className="field"><label htmlFor="no-c">Covers the period ending</label><select id="no-c" value={d.covers} onChange={(e) => up('covers', e.target.value)}><option value="">—</option><option value="0">The due month</option><option value="1">1 month before</option><option value="2">2 months before</option><option value="3">3 months before</option></select></div>
        <div className="field"><label htmlFor="no-s">Store</label><select id="no-s" value={d.storeId} onChange={(e) => up('storeId', e.target.value)}><option value="">Company-wide</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
        <label className="check"><input type="checkbox" checked={d.needsPayment} onChange={(e) => up('needsPayment', e.target.checked)} /> Needs a payment</label>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
        setErrors([]);
        try {
          const it = saveComplianceItem(books, user, { title: d.title, kind: d.kind, agency: d.agency, form: d.form, storeId: d.storeId || undefined, needsPayment: d.needsPayment, active: true, recurrence: { every: d.every, firstDue: d.firstDue, coversMonthsBefore: d.covers === '' ? undefined : Number(d.covers) } });
          setD({ ...d, title: '', agency: '', form: '', firstDue: '' });
          onSaved(`Added ${it.title} to the calendar.`);
        } catch (e) { setErrors(errList(e)); }
      }}>Add to calendar</button><span className="muted small">{state.stores.length ? '' : ''}Later due dates keep the first due date's day of the month.</span></div>
    </section>
  );
}

// ── Licenses & permits ───────────────────────────────────────────────────
export function LicensesPage() {
  const { state, books, user, visible, stores, lines } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const n = useNames();
  const today = todayInChicago();
  const store = sp.get('store') ?? '';
  const show = sp.get('show') ?? '';
  const all = complianceOf(state).licenses.filter((l) => visible.has(l.storeId)).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const rows = all.filter((l) => (!store || l.storeId === store) && (!show || expiryStatus(l.expiresOn, today) !== 'current'));
  const [renew, setRenew] = useState<string | null>(null);
  const [rn, setRn] = useState({ expiresOn: '', renewedOn: today });
  const [errors, setErrors] = useState<string[]>([]);
  const expiring = all.filter((l) => expiryStatus(l.expiresOn, today) === 'expiring');
  const expired = all.filter((l) => expiryStatus(l.expiresOn, today) === 'expired');
  const fees12 = all.filter((l) => daysBetween(today, l.expiresOn) <= 365).reduce((a, l) => a + (l.renewalFee ?? 0), 0);
  // Required permits by what each operating store does: beer sales (4100 this year), a kitchen, fuel tanks, plus tobacco and a business license.
  const beerStores = new Set(lines.filter((f) => f.l.accountId === 'acct_sales_beer' && f.date.startsWith(today.slice(0, 4))).map((f) => f.l.storeId));
  const required: { storeId: ID; kind: LicenseKind }[] = [];
  for (const s of stores.filter((x) => x.kind === 'operating')) {
    const kinds: LicenseKind[] = ['tobacco', 'ust', 'business'];
    if (beerStores.has(s.id)) kinds.push('beer');
    if (s.hasKitchen) kinds.push('food_service');
    for (const k of kinds) required.push({ storeId: s.id, kind: k });
  }
  const gaps = required.filter((r) => !all.some((l) => l.storeId === r.storeId && l.kind === r.kind && l.expiresOn >= today));
  const set = (k: string, v: string) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }); };
  const edit = can(user, 'compliance.edit');
  return (
    <>
      <PageHead eyebrow="Compliance" title="Licenses & permits" lede="Beer, tobacco, food service, UST and business licenses for each store, with expiry dates and the documents. Anything expiring within 30 days reaches the inbox.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('licenses', ['Store', 'License', 'Kind', 'Issuer', 'Number', 'Expires', 'Status', 'Renewal fee'], rows.map((l) => [n.store(l.storeId), l.name, LICENSE_LABEL[l.kind], l.issuer, l.number, l.expiresOn, EXPIRY_LABEL[expiryStatus(l.expiresOn, today)], l.renewalFee ? csvMoney(l.renewalFee) : '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Licenses" style={{ marginBottom: 20 }}>
        <Figure label="On file" value={all.length} note={`${new Set(all.map((l) => l.storeId)).size} stores`} />
        <Figure label="Expiring in 30 days" value={<span className={expiring.length ? 'neg' : undefined}>{expiring.length}</span>} note={expiring.map((l) => `${l.name} ${shortDate(l.expiresOn)}`).join('; ') || 'None'} />
        <Figure label="Expired" value={<span className={expired.length ? 'neg' : undefined}>{expired.length}</span>} note={expired.length ? expired.map((l) => l.name).join(', ') : 'None'} />
        <Figure label="Renewal fees, next 12 months" value={<Money c={fees12} whole dollar />} />
      </section>
      <section className="panel" aria-labelledby="lic-h">
        <div className="panel-head"><h2 id="lic-h">Licenses and permits</h2></div>
        <div className="filters">
          <div className="field"><label htmlFor="lic-store">Store</label><select id="lic-store" value={store} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
          <div className="field"><label htmlFor="lic-show">Show</label><select id="lic-show" value={show} onChange={(e) => set('show', e.target.value)}><option value="">All</option><option value="expiring">Expiring or expired</option></select></div>
        </div>
        <Errors errors={errors} />
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col">License</th><th scope="col">Issuer</th><th scope="col">Number</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Documents</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((l) => {
            const st = expiryStatus(l.expiresOn, today);
            return [
              <tr key={l.id}><td>{n.store(l.storeId)}</td><td><b>{l.name}</b><div className="muted small">{LICENSE_LABEL[l.kind]}{l.history.length ? ` · renewed ${l.history.length}×` : ''}</div></td><td>{l.issuer}</td><td>{l.number}</td><td>{shortDate(l.expiresOn)}</td>
                <td><span className={'pill ' + EXP_PILL[st]}>{EXPIRY_LABEL[st]}{st !== 'current' ? ` · ${st === 'expired' ? `${-daysBetween(today, l.expiresOn)} days ago` : `${daysBetween(today, l.expiresOn)} days`}` : ''}</span></td>
                <td><DocList items={l.attachments} say={say} />{edit && <AttachButton books={books} userId={user.id} label="Attach" say={say} onFile={(a) => { attachToCompliance(books, user, { kind: 'license', id: l.id }, a); say(`Attached ${a.name}.`); }} />}</td>
                <td>{edit && <button className="btn sm" aria-label={`Renew ${l.name}`} onClick={() => { setRenew(renew === l.id ? null : l.id); setRn({ expiresOn: addDays(l.expiresOn, 365), renewedOn: today }); }}>Renew</button>}</td></tr>,
              renew === l.id && <tr key={l.id + 'r'}><td colSpan={8}><div className="form-grid">
                <div className="field"><label htmlFor="rn-e">New expiry</label><input id="rn-e" type="date" value={rn.expiresOn} onChange={(e) => setRn({ ...rn, expiresOn: e.target.value })} /></div>
                <div className="field"><label htmlFor="rn-r">Renewed on</label><input id="rn-r" type="date" value={rn.renewedOn} onChange={(e) => setRn({ ...rn, renewedOn: e.target.value })} /></div>
                <div className="actions" style={{ alignSelf: 'end' }}><button className="btn primary" onClick={() => { setErrors([]); try { renewLicense(books, user, l.id, rn); setRenew(null); say(`Renewed ${l.name} to ${shortDate(rn.expiresOn)}.`); } catch (e) { setErrors(errList(e)); } }}>Save renewal</button></div>
              </div></td></tr>,
            ];
          })}</tbody>
        </table></div>
        <TieOut items={[{ label: gaps.length ? `${gaps.length} required permit(s) missing or expired` : 'Every operating store holds the permits its activity needs', ok: !gaps.length, detail: gaps.length ? gaps.map((g) => `${n.store(g.storeId)} ${LICENSE_LABEL[g.kind]}`).join(', ') : 'Tobacco, UST and business everywhere; beer where 4100 has sales this year; food service where there is a kitchen' }]} />
      </section>
      {edit && <NewLicense onSaved={say} />}
      {toast}
      <Help k="licenses" />
    </>
  );
}

function NewLicense({ onSaved }: { onSaved: (m: string) => void }) {
  const { books, user, stores } = useBooks();
  const [d, setD] = useState({ storeId: stores[0]?.id ?? '', kind: 'beer' as LicenseKind, name: '', issuer: '', number: '', expiresOn: '', fee: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const up = (k: keyof typeof d, v: string) => setD({ ...d, [k]: v });
  return (
    <section className="panel panel-pad" aria-labelledby="nl-h" style={{ marginTop: 20 }}>
      <h2 id="nl-h" style={{ marginBottom: 8 }}>Add a license or permit</h2>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor="nl-s">Store</label><select id="nl-s" value={d.storeId} onChange={(e) => up('storeId', e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
        <div className="field"><label htmlFor="nl-k">Kind</label><select id="nl-k" value={d.kind} onChange={(e) => up('kind', e.target.value)}>{(Object.keys(LICENSE_LABEL) as LicenseKind[]).map((k) => <option key={k} value={k}>{LICENSE_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="nl-n">Name</label><input id="nl-n" value={d.name} onChange={(e) => up('name', e.target.value)} /></div>
        <div className="field"><label htmlFor="nl-i">Issuer</label><input id="nl-i" value={d.issuer} onChange={(e) => up('issuer', e.target.value)} /></div>
        <div className="field"><label htmlFor="nl-no">Number</label><input id="nl-no" value={d.number} onChange={(e) => up('number', e.target.value)} /></div>
        <div className="field"><label htmlFor="nl-e">Expires</label><input id="nl-e" type="date" value={d.expiresOn} onChange={(e) => up('expiresOn', e.target.value)} /></div>
        <div className="field"><label htmlFor="nl-f">Renewal fee</label><input id="nl-f" className="num" inputMode="decimal" value={d.fee} onChange={(e) => up('fee', e.target.value)} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setErrors([]); try { const l = saveLicense(books, user, { ...d, renewalFee: d.fee.trim() ? parseMoney(d.fee) ?? undefined : undefined }); setD({ ...d, name: '', number: '', expiresOn: '', fee: '' }); onSaved(`Added ${l.name}.`); } catch (e) { setErrors(errList(e)); } }}>Add license</button></div>
    </section>
  );
}

// ── Insurance & leases ───────────────────────────────────────────────────
export function InsurancePage() {
  const { state, books, user, visible } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const n = useNames();
  const today = todayInChicago();
  const tab = sp.get('tab') === 'leases' ? 'leases' : 'policies';
  const c = complianceOf(state);
  const policies = c.policies.filter((p) => p.storeIds.some((s) => visible.has(s))).sort((a, b) => a.expires.localeCompare(b.expires));
  const leases = c.leases.filter((l) => visible.has(l.storeId)).sort((a, b) => a.end.localeCompare(b.end));
  const premiums = policies.reduce((a, p) => a + p.premium, 0);
  const soonPol = policies.filter((p) => expiryStatus(p.expires, today, 60) !== 'current');
  const rentOut = leases.filter((l) => l.side === 'we_rent').reduce((a, l) => a + l.monthlyRent, 0);
  const rentIn = leases.filter((l) => l.side === 'we_let').reduce((a, l) => a + l.monthlyRent, 0);
  const leaseSoon = leases.filter((l) => daysBetween(today, l.end) <= 365);
  const prepaids = prepaidsOf(state);
  const linked = policies.filter((p) => p.prepaidId);
  const prepaidOff = linked.filter((p) => prepaids.find((x) => x.id === p.prepaidId)?.amount !== p.premium);
  const templates = state.intercompany?.rentTemplates ?? [];
  const weRent = leases.filter((l) => l.side === 'we_rent' && l.partyId);
  const rentOff = weRent.filter((l) => templates.filter((t) => t.active && t.storeId === l.storeId && t.partyId === l.partyId).reduce((a, t) => a + t.amount, 0) !== l.monthlyRent);
  const schedules = state.receivables?.rent ?? [];
  const weLet = leases.filter((l) => l.side === 'we_let' && l.partyId);
  const letOff = weLet.filter((l) => schedules.filter((s) => s.active && s.tenantId === l.partyId).reduce((a, s) => a + s.amount, 0) !== l.monthlyRent);
  const edit = can(user, 'compliance.edit');
  const setTab = (t: string) => { const x = new URLSearchParams(sp); if (t === 'leases') x.set('tab', t); else x.delete('tab'); setSp(x, { replace: true }); };
  return (
    <>
      <PageHead eyebrow="Compliance" title="Insurance & leases" lede="Every policy (carrier, terms, limits, expiry, documents) and every lease, whether we rent the premises or let them to a tenant.">
        {can(user, 'export') && <button className="btn" onClick={() => tab === 'policies'
          ? exportCsv('insurance-policies', ['Kind', 'Carrier', 'Policy #', 'Stores', 'Effective', 'Expires', 'Premium', 'Deductible', 'Limit'], policies.map((p) => [POLICY_LABEL[p.kind], p.carrier, p.policyNo, p.storeIds.map((s) => n.store(s)).join(' '), p.effective, p.expires, csvMoney(p.premium), p.deductible ? csvMoney(p.deductible) : '', p.limit ? csvMoney(p.limit) : '']))
          : exportCsv('leases', ['Side', 'Counterparty', 'Store', 'Premises', 'Start', 'End', 'Monthly rent', 'Escalation', 'Renewal options', 'Notice days'], leases.map((l) => [l.side === 'we_rent' ? 'We rent' : 'We let', l.counterparty, n.store(l.storeId), l.premises, l.start, l.end, csvMoney(l.monthlyRent), l.escalation ?? '', l.renewalOptions ?? '', l.noticeDays ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Insurance and leases" style={{ marginBottom: 20 }}>
        <Figure label="Annual premiums" value={<Money c={premiums} whole dollar />} note={`${policies.length} policies`} />
        <Figure label="Policies expiring in 60 days" value={soonPol.length} note={soonPol.map((p) => `${POLICY_LABEL[p.kind]} ${shortDate(p.expires)}`).join('; ') || 'None'} />
        <Figure label="Rent we pay a month" value={<Money c={rentOut} whole dollar />} note={`Rent we collect ${formatMoney(rentIn, { dollarSign: true, whole: true })} a month`} />
        <Figure label="Leases ending within a year" value={leaseSoon.length} note={leaseSoon.map((l) => `${l.premises} ${shortDate(l.end)}`).join('; ') || 'None'} />
      </section>
      <div className="seg" role="group" aria-label="Show" style={{ marginBottom: 16 }}>
        <button aria-pressed={tab === 'policies'} onClick={() => setTab('policies')}>Insurance policies</button>
        <button aria-pressed={tab === 'leases'} onClick={() => setTab('leases')}>Leases</button>
      </div>
      {tab === 'policies' ? (
        <section className="panel" aria-labelledby="pol-h">
          <div className="panel-head"><h2 id="pol-h">Insurance policies</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Policy</th><th scope="col">Stores</th><th scope="col">Term</th><th scope="col" className="num">Premium</th><th scope="col" className="num">Deductible</th><th scope="col" className="num">Limit</th><th scope="col">Status</th><th scope="col">Documents</th></tr></thead>
            <tbody>{policies.map((p) => { const st = expiryStatus(p.expires, today, 60); return (
              <tr key={p.id}><td><b>{POLICY_LABEL[p.kind]}</b><div className="muted small">{p.carrier} · {p.policyNo}{p.prepaidId ? ' · prepaid, amortized monthly' : ''}</div>{p.notes && <div className="muted small">{p.notes}</div>}</td>
                <td>{p.storeIds.map((s) => n.store(s)).join(', ')}</td><td>{shortDate(p.effective)} – {shortDate(p.expires)}</td>
                <td className="num"><Money c={p.premium} /></td><td className="num">{p.deductible ? <Money c={p.deductible} /> : '—'}</td><td className="num">{p.limit ? <Money c={p.limit} whole /> : '—'}</td>
                <td><span className={'pill ' + EXP_PILL[st]}>{st === 'current' ? 'In force' : st === 'expiring' ? `Renew · ${daysBetween(today, p.expires)} days` : 'Lapsed'}</span></td>
                <td><DocList items={p.attachments} say={say} />{edit && <AttachButton books={books} userId={user.id} label="Attach" say={say} onFile={(a) => { attachToCompliance(books, user, { kind: 'policy', id: p.id }, a); say(`Attached ${a.name}.`); }} />}</td></tr>
            ); })}</tbody>
          </table></div>
          <TieOut items={[{ label: prepaidOff.length ? `${prepaidOff.length} prepaid polic(ies) differ from their prepaid schedule` : `Prepaid policies agree with their prepaid schedules (${linked.length})`, ok: !prepaidOff.length, detail: <Link to="/assets/prepaids">Prepaids</Link> }]} />
        </section>
      ) : (
        <section className="panel" aria-labelledby="lse-h">
          <div className="panel-head"><h2 id="lse-h">Leases</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Premises</th><th scope="col">Side</th><th scope="col">Counterparty</th><th scope="col">Term</th><th scope="col" className="num">Monthly rent</th><th scope="col">Terms</th><th scope="col">Documents</th></tr></thead>
            <tbody>{leases.map((l) => (
              <tr key={l.id}><td><b>{l.premises}</b><div className="muted small">{n.store(l.storeId)}</div></td><td>{l.side === 'we_rent' ? 'We rent' : 'We let'}</td>
                <td>{l.partyId ? <Link to={`/intercompany/parties/${l.partyId}`}>{l.counterparty}</Link> : l.counterparty}</td><td>{shortDate(l.start)} – {shortDate(l.end)}</td><td className="num"><Money c={l.monthlyRent} /></td>
                <td className="small">{[l.escalation, l.renewalOptions, l.noticeDays ? `${l.noticeDays} days' notice` : ''].filter(Boolean).join(' · ') || '—'}</td>
                <td><DocList items={l.attachments} say={say} />{edit && <AttachButton books={books} userId={user.id} label="Attach" say={say} onFile={(a) => { attachToCompliance(books, user, { kind: 'lease', id: l.id }, a); say(`Attached ${a.name}.`); }} />}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: rentOff.length ? `${rentOff.length} lease(s) we rent differ from the rent pass-through` : 'Leases we rent from related parties equal their rent pass-throughs', ok: !rentOff.length, detail: <Link to="/intercompany/rent">Rent pass-throughs</Link> },
            { label: letOff.length ? `${letOff.length} tenant lease(s) differ from the rent schedule` : 'Tenant leases equal the tenant rent schedules', ok: !letOff.length, detail: <Link to="/receivables/rent">Tenant rent</Link> },
          ]} />
        </section>
      )}
      {toast}
      <Help k="insurance" />
    </>
  );
}

// ── Notices ──────────────────────────────────────────────────────────────
export function NoticesPage() {
  const { state, books, user, visible } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const n = useNames();
  const today = todayInChicago();
  const all = complianceOf(state).notices.filter((x) => canSee(state, visible, x.storeId)).sort((a, b) => (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0) || a.deadline.localeCompare(b.deadline));
  const open = openNotices(state, visible);
  const [editing, setEditing] = useState<string | null>(null);
  const closedYtd = all.filter((x) => x.status === 'closed' && x.updatedAt.startsWith(today.slice(0, 4)));
  const disputed = open.reduce((a, x) => a + (x.amount ?? 0), 0);
  const badClosed = all.filter((x) => x.status === 'closed' && !x.outcome);
  const badResp = all.filter((x) => (x.status === 'responded' || x.status === 'closed') && !x.respondedOn);
  const edit = can(user, 'compliance.edit');
  return (
    <>
      <PageHead eyebrow="Compliance" title="Notices" lede="Letters from the IRS and the state: what each says, the response deadline, what we sent and how it ended.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('tax-notices', ['Agency', 'Notice', 'Entity', 'Period', 'Received', 'Deadline', 'Amount', 'Status', 'Response', 'Responded', 'Outcome'], all.map((x) => [x.agency, x.noticeType, n.entity(x.entityId), x.taxPeriod ?? '', x.received, x.deadline, x.amount ? csvMoney(x.amount) : '', NOTICE_STATUS_LABEL[x.status], x.response ?? '', x.respondedOn ?? '', x.outcome ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Notices" style={{ marginBottom: 20 }}>
        <Figure label="Open" value={<span className={open.length ? 'neg' : undefined}>{open.length}</span>} note={open.map((x) => x.agency).join(', ') || 'No letters waiting'} />
        <Figure label="Next deadline" value={open[0] ? shortDate(open[0].deadline) : '—'} note={open[0] ? `${open[0].noticeType} · ${daysBetween(today, open[0].deadline)} days` : 'Nothing due'} />
        <Figure label="Amount in question" value={<Money c={disputed} dollar />} note="On open notices" />
        <Figure label={`Closed in ${today.slice(0, 4)}`} value={closedYtd.length} />
      </section>
      <section className="panel" aria-labelledby="nt-h">
        <div className="panel-head"><h2 id="nt-h">Notices</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Notice</th><th scope="col">Received</th><th scope="col">Deadline</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Response & outcome</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{all.map((x) => [
            <tr key={x.id}><td><b>{x.agency} · {x.noticeType}</b><div className="muted small">{[n.entity(x.entityId), x.taxPeriod].filter(Boolean).join(' · ')}</div><div className="small">{x.summary}</div><DocList items={x.attachments} say={say} /></td>
              <td>{shortDate(x.received)}</td><td>{shortDate(x.deadline)}{x.status !== 'closed' && <div className={'small ' + (x.deadline < today ? 'neg' : 'muted')}>{x.deadline < today ? 'Past the deadline' : `${daysBetween(today, x.deadline)} days left`}</div>}</td>
              <td className="num">{x.amount !== undefined ? <Money c={x.amount} /> : '—'}</td>
              <td><span className={'pill ' + (x.status === 'closed' ? 'ok' : x.deadline < today ? 'bad' : 'warn')}>{NOTICE_STATUS_LABEL[x.status]}</span></td>
              <td className="small">{x.response && <div>Sent {x.respondedOn ? shortDate(x.respondedOn) : ''}: {x.response}</div>}{x.outcome && <div><b>Outcome:</b> {x.outcome}</div>}{!x.response && !x.outcome && <span className="muted">No response yet</span>}</td>
              <td>{edit && <button className="btn sm" aria-expanded={editing === x.id} aria-label={`Update ${x.noticeType}`} onClick={() => setEditing(editing === x.id ? null : x.id)}>Update</button>}{edit && <AttachButton books={books} userId={user.id} label="Attach" say={say} onFile={(a) => { attachToCompliance(books, user, { kind: 'notice', id: x.id }, a); say(`Attached ${a.name}.`); }} />}</td></tr>,
            editing === x.id && <tr key={x.id + 'e'}><td colSpan={7}><NoticeForm notice={x} onDone={(m) => { setEditing(null); say(m); }} /></td></tr>,
          ])}</tbody>
        </table></div>
        <TieOut items={[
          { label: badClosed.length ? `${badClosed.length} closed notice(s) have no outcome` : 'Every closed notice records its outcome', ok: !badClosed.length },
          { label: badResp.length ? `${badResp.length} notice(s) marked responded have no response date` : 'Every response has its date', ok: !badResp.length },
        ]} />
      </section>
      {edit && <section className="panel panel-pad" aria-labelledby="nn-h" style={{ marginTop: 20 }}><h2 id="nn-h" style={{ marginBottom: 8 }}>Record a new notice</h2><NoticeForm onDone={say} /></section>}
      {toast}
      <Help k="notices" />
    </>
  );
}

function NoticeForm({ notice, onDone }: { notice?: TaxNotice; onDone: (m: string) => void }) {
  const { books, user, state } = useBooks();
  const today = todayInChicago();
  const p = notice ? 'ne-' + notice.id : 'nn';
  const [d, setD] = useState({
    agency: notice?.agency ?? 'IRS', noticeType: notice?.noticeType ?? '', received: notice?.received ?? today, deadline: notice?.deadline ?? addDays(today, 30), amount: notice?.amount ? formatMoney(notice.amount) : '',
    summary: notice?.summary ?? '', status: notice?.status ?? 'open' as NoticeStatus, response: notice?.response ?? '', respondedOn: notice?.respondedOn ?? '', outcome: notice?.outcome ?? '', entityId: notice?.entityId ?? state.entities.find((e) => e.isHub)?.id ?? '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const up = (k: keyof typeof d, v: string) => setD({ ...d, [k]: v });
  return (
    <div>
      <Errors errors={errors} />
      <div className="form-grid">
        {!notice && <>
          <div className="field"><label htmlFor={`${p}-a`}>Agency</label><input id={`${p}-a`} value={d.agency} onChange={(e) => up('agency', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${p}-t`}>Notice type or number</label><input id={`${p}-t`} value={d.noticeType} onChange={(e) => up('noticeType', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${p}-en`}>Entity</label><select id={`${p}-en`} value={d.entityId} onChange={(e) => up('entityId', e.target.value)}>{state.entities.map((e) => <option key={e.id} value={e.id}>{e.code}</option>)}</select></div>
          <div className="field"><label htmlFor={`${p}-r`}>Received</label><input id={`${p}-r`} type="date" value={d.received} onChange={(e) => up('received', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${p}-d`}>Respond by</label><input id={`${p}-d`} type="date" value={d.deadline} onChange={(e) => up('deadline', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${p}-m`}>Amount on the notice</label><input id={`${p}-m`} className="num" inputMode="decimal" value={d.amount} onChange={(e) => up('amount', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor={`${p}-s`}>What it says</label><input id={`${p}-s`} value={d.summary} onChange={(e) => up('summary', e.target.value)} /></div>
        </>}
        <div className="field"><label htmlFor={`${p}-st`}>Status</label><select id={`${p}-st`} value={d.status} onChange={(e) => up('status', e.target.value)}>{(Object.keys(NOTICE_STATUS_LABEL) as NoticeStatus[]).map((s) => <option key={s} value={s}>{NOTICE_STATUS_LABEL[s]}</option>)}</select></div>
        <div className="field"><label htmlFor={`${p}-ro`}>Responded on</label><input id={`${p}-ro`} type="date" value={d.respondedOn} onChange={(e) => up('respondedOn', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor={`${p}-rs`}>What we sent</label><input id={`${p}-rs`} value={d.response} onChange={(e) => up('response', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor={`${p}-o`}>Outcome</label><input id={`${p}-o`} value={d.outcome} onChange={(e) => up('outcome', e.target.value)} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
        setErrors([]);
        try {
          const entity = state.entities.find((e) => e.id === d.entityId);
          const storeId = notice?.storeId ?? state.stores.find((s) => s.entityId === entity?.id)?.id ?? bankStoreId(state);
          const x = saveNotice(books, user, {
            ...(notice ?? {}), id: notice?.id, agency: d.agency, noticeType: d.noticeType, entityId: d.entityId || undefined, storeId, taxPeriod: notice?.taxPeriod, received: d.received, deadline: d.deadline,
            amount: d.amount.trim() ? parseMoney(d.amount) ?? NaN : undefined, summary: d.summary, status: d.status, response: d.response, respondedOn: d.respondedOn || undefined, outcome: d.outcome,
          });
          onDone(`${x.agency} ${x.noticeType}: ${NOTICE_STATUS_LABEL[x.status]}.`);
        } catch (e) { setErrors(errList(e)); }
      }}>{notice ? 'Save' : 'Record notice'}</button></div>
    </div>
  );
}

// ── Document vault ───────────────────────────────────────────────────────
export function VaultPage() {
  const { state, books, user, visible, stores, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const n = useNames();
  const today = todayInChicago();
  const entries = useMemo(() => vaultIndex(state, visible), [state, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = { text: sp.get('q') ?? '', docType: sp.get('type') ?? '', storeId: sp.get('store') ?? '', month: sp.get('month') ?? '', tag: sp.get('tag') ?? '' };
  const docParam = sp.get('doc');
  const rows = docParam ? entries.filter((e) => e.id === docParam) : searchVault(state, entries, q);
  const types = [...new Set(entries.map((e) => e.docType))].sort();
  const tags = [...new Set(entries.flatMap((e) => e.tags))].sort();
  const months = [...new Set(entries.flatMap((e) => e.months))].sort().reverse();
  const unlinked = entries.filter((e) => e.unlinked);
  const noDoc = state.transactions.filter((t) => t.lines.some((l) => visible.has(l.storeId)) && needsDocument(t, state, today));
  const set = (k: string, v: string) => { const x = new URLSearchParams(sp); x.delete('doc'); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }); };
  // Tie-out: every attachment on a record the viewer can see is in the index.
  const raw = new Set<string>();
  const seeAny = (ids: ID[]) => ids.some((s) => visible.has(s));
  for (const t of state.transactions) if (!t.deleted && seeAny(t.lines.filter((l) => !l.system).map((l) => l.storeId))) for (const a of t.attachments) raw.add(a.id);
  for (const b of state.payables?.bills ?? []) if (seeAny([b.storeId, ...b.lines.map((l) => l.storeId)])) for (const a of [...b.attachments, ...(b.payment?.attachments ?? [])]) raw.add(a.id);
  for (const i of state.fuel?.invoices ?? []) if (!i.deleted && visible.has(i.storeId)) for (const a of i.attachments) raw.add(a.id);
  const ids = new Set(entries.map((e) => e.id));
  const missingFromIndex = [...raw].filter((id) => !ids.has(id)).length;
  const [editing, setEditing] = useState<string | null>(null);
  const [meta, setMeta] = useState({ docType: '', tags: '', linkKind: 'transaction' as DocLinkKind, linkId: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [up, setUp] = useState({ docType: '', tags: '', storeId: '', month: '', partyId: '' });
  const [pending, setPending] = useState<Attachment | null>(null);
  const canUp = can(user, 'docs.upload');
  return (
    <>
      <PageHead eyebrow="Compliance" title="Document vault" lede="One index of every document: attachments on transactions, bills and fuel invoices, compliance and asset records, and files uploaded straight here. Search by name, type, store, month or tag.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('document-vault', ['Name', 'Type', 'Linked to', 'Stores', 'Months', 'Parties', 'Tags', 'Added'], rows.map((e) => [e.name, e.docType, e.sources.map((s) => s.label).join(' | '), e.storeIds.map((s) => n.store(s)).join(' '), e.months.join(' '), e.partyIds.map((p) => n.party(p)).join(' | '), e.tags.join(' '), e.addedAt.slice(0, 10)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Documents" style={{ marginBottom: 20 }}>
        <Figure label="Documents" value={entries.length} note={`${types.length} types`} />
        <Figure label="Uploaded, not linked yet" value={unlinked.length} note={unlinked.map((e) => e.name).join(', ') || 'Everything is linked'} />
        <Figure label="Payments $1,000+ with no document" value={noDoc.length} note="Last 30 days" href="/books/transactions?queue=nodoc" />
        <Figure label="Tags in use" value={tags.length} note={tags.slice(0, 6).join(', ')} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="vlt-h">
          <div className="panel-head"><h2 id="vlt-h">Documents</h2>{docParam && <button className="btn sm" onClick={() => set('q', '')}>Show all documents</button>}</div>
          <div className="filters">
            <div className="field wide"><label htmlFor="v-q">Search</label><input id="v-q" type="search" value={q.text} placeholder="Name, tag, vendor, store…" onChange={(e) => set('q', e.target.value)} /></div>
            <div className="field"><label htmlFor="v-type">Type</label><select id="v-type" value={q.docType} onChange={(e) => set('type', e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="v-store">Store</label><select id="v-store" value={q.storeId} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <div className="field"><label htmlFor="v-month">Month</label><select id="v-month" value={q.month} onChange={(e) => set('month', e.target.value)}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
            <div className="field"><label htmlFor="v-tag">Tag</label><select id="v-tag" value={q.tag} onChange={(e) => set('tag', e.target.value)}><option value="">All tags</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <Errors errors={errors} />
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Linked to</th><th scope="col">Stores · months</th><th scope="col">Tags</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((e) => [
              <tr key={e.id}><td><button className="btn sm ghost" onClick={() => void openDoc(e, say)}>{e.name}</button><div className="muted small">{Math.max(1, Math.round(e.size / 1024))} KB · added {shortDate(e.addedAt.slice(0, 10))}</div>{e.note && <div className="small">{e.note}</div>}</td>
                <td>{e.docType}</td>
                <td className="small">{e.sources.filter((s) => s.kind !== 'upload').map((s) => <div key={s.kind + s.id}><Link to={s.to}>{s.label}</Link></div>)}{e.partyIds.map((p) => <div key={p} className="muted">{n.party(p)}</div>)}{e.unlinked && <span className="pill warn">Not linked</span>}</td>
                <td className="small">{e.storeIds.map((s) => n.store(s)).join(', ')}{e.months.length ? ` · ${e.months.map((m) => periodLabel(m)).join(', ')}` : ''}</td>
                <td>{e.tags.map((t) => <button key={t} className="pill" style={{ marginRight: 4, cursor: 'pointer' }} onClick={() => set('tag', t)}>{t}</button>)}</td>
                <td>{canUp && <button className="btn sm" aria-expanded={editing === e.id} aria-label={`Tag / link ${e.name}`} onClick={() => { setEditing(editing === e.id ? null : e.id); setMeta({ docType: e.docType, tags: e.tags.join(', '), linkKind: 'transaction', linkId: '' }); }}>Tag / link</button>}</td></tr>,
              editing === e.id && <tr key={e.id + 'm'}><td colSpan={6}>
                <div className="form-grid">
                  <div className="field"><label htmlFor="vm-t">Type</label><input id="vm-t" value={meta.docType} onChange={(x) => setMeta({ ...meta, docType: x.target.value })} /></div>
                  <div className="field"><label htmlFor="vm-g">Tags (comma separated)</label><input id="vm-g" value={meta.tags} onChange={(x) => setMeta({ ...meta, tags: x.target.value })} /></div>
                  <div className="actions" style={{ alignSelf: 'end' }}><button className="btn" onClick={() => { setErrors([]); try { updateDocMeta(books, user, e.id, { docType: meta.docType, tags: meta.tags.split(',') }); say('Saved the type and tags.'); } catch (x) { setErrors(errList(x)); } }}>Save details</button></div>
                  <div className="field"><label htmlFor="vm-k">Link to</label><select id="vm-k" value={meta.linkKind} onChange={(x) => setMeta({ ...meta, linkKind: x.target.value as DocLinkKind, linkId: '' })}><option value="transaction">Transaction (TX-ref)</option><option value="party">Vendor or party</option><option value="store">Store</option><option value="month">Month</option></select></div>
                  <div className="field"><label htmlFor="vm-i">{meta.linkKind === 'transaction' ? 'TX-ref' : meta.linkKind === 'month' ? 'Month (YYYY-MM)' : meta.linkKind === 'store' ? 'Store' : 'Party'}</label>
                    {meta.linkKind === 'store' ? <select id="vm-i" value={meta.linkId} onChange={(x) => setMeta({ ...meta, linkId: x.target.value })}><option value="">Pick a store</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select>
                      : meta.linkKind === 'party' ? <select id="vm-i" value={meta.linkId} onChange={(x) => setMeta({ ...meta, linkId: x.target.value })}><option value="">Pick a party</option><PartyOptions /></select>
                      : <input id="vm-i" value={meta.linkId} placeholder={meta.linkKind === 'transaction' ? 'TX-000123' : '2026-11'} onChange={(x) => setMeta({ ...meta, linkId: x.target.value })} />}</div>
                  <div className="actions" style={{ alignSelf: 'end' }}><button className="btn primary" onClick={() => {
                    setErrors([]);
                    try {
                      const id = meta.linkKind === 'transaction' ? books.getTransaction(meta.linkId.trim().toUpperCase())?.id ?? meta.linkId.trim() : meta.linkId.trim();
                      linkDoc(books, user, e.id, { kind: meta.linkKind, id }, entries);
                      say(meta.linkKind === 'transaction' ? 'Linked, and attached to the transaction.' : 'Linked.');
                      setMeta({ ...meta, linkId: '' });
                    } catch (x) { setErrors(errList(x)); }
                  }}>Add link</button></div>
                </div>
                {(complianceOf(state).docs.find((d) => d.id === e.id)?.links ?? []).length > 0 && <p className="small" style={{ marginTop: 8 }}>Vault links: {complianceOf(state).docs.find((d) => d.id === e.id)!.links.map((l) => <span key={l.kind + l.id} style={{ marginRight: 8 }}>{l.kind} {l.kind === 'store' ? n.store(l.id) : l.kind === 'party' ? n.party(l.id) : l.kind === 'transaction' ? state.transactions.find((t) => t.id === l.id)?.ref : l.id} <button className="btn sm ghost" aria-label={`Remove link to ${l.kind} ${l.id}`} onClick={() => { unlinkDoc(books, user, e.id, l); say('Link removed.'); }}>×</button></span>)}</p>}
              </td></tr>,
            ])}</tbody>
          </table></div>
          {!rows.length && <p className="panel-pad muted">No documents match. Clear a filter or search for fewer words.</p>}
          <TieOut items={[{ label: missingFromIndex ? `${missingFromIndex} attachment(s) on records are missing from the index` : 'Every attachment on transactions, bills and fuel invoices is in the index', ok: missingFromIndex === 0, detail: `${raw.size} on records · ${entries.length} in the vault` }]} />
        </section>
        {canUp && (
          <section className="panel panel-pad" aria-labelledby="vu-h">
            <h2 id="vu-h" style={{ marginBottom: 8 }}>Upload to the vault</h2>
            <p className="muted small" style={{ marginBottom: 8 }}>Upload now and link it to a transaction, vendor, store or month later. Files stay on this device until the hosted back end ships.</p>
            <div className="form-grid">
              <div className="field"><label htmlFor="vu-t">Type</label><input id="vu-t" value={up.docType} placeholder="Statement, receipt, permit…" onChange={(e) => setUp({ ...up, docType: e.target.value })} /></div>
              <div className="field"><label htmlFor="vu-g">Tags</label><input id="vu-g" value={up.tags} placeholder="comma separated" onChange={(e) => setUp({ ...up, tags: e.target.value })} /></div>
              <div className="field"><label htmlFor="vu-s">Store</label><select id="vu-s" value={up.storeId} onChange={(e) => setUp({ ...up, storeId: e.target.value })}><option value="">None yet</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
              <div className="field"><label htmlFor="vu-m">Month</label><input id="vu-m" value={up.month} placeholder="YYYY-MM" onChange={(e) => setUp({ ...up, month: e.target.value })} /></div>
              <div className="field"><label htmlFor="vu-p">Vendor or party</label><select id="vu-p" value={up.partyId} onChange={(e) => setUp({ ...up, partyId: e.target.value })}><option value="">None yet</option><PartyOptions /></select></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <AttachButton books={books} userId={user.id} label={pending ? `Chosen: ${pending.name}` : 'Choose a file'} say={say} onFile={setPending} />
              <button className="btn primary" disabled={!pending} onClick={() => {
                setErrors([]);
                try { uploadToVault(books, user, pending!, { docType: up.docType, tags: up.tags.split(','), storeId: up.storeId || undefined, month: up.month.trim() || undefined, partyId: up.partyId || undefined }); say(`Added ${pending!.name} to the vault.`); setPending(null); } catch (e) { setErrors(errList(e)); }
              }}>Add to vault</button>
            </div>
          </section>
        )}
      </div>
      {toast}
      <Help k="vault" />
    </>
  );
}

