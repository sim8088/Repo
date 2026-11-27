import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  FUEL_ACCT, GRADE_LABEL, NOTICE_TYPES, NOTICE_TYPE_LABEL, TANK_GRADES, VENDOR_LABEL, attachToInvoice, checkNotice, clearingLedger, commitComdataImport,
  commitInvoiceImport, commitNoticeImport, craddockReceivable, dashUpcoming, deliveredLines, fiservMonths, fuelOf, invoiceFlags, invoiceGallons,
  ledgerFuelRevenue, liveInvoices, noticeLineDate, noticeNet, payDashInvoicesDue, postDashSettlement, postNotice, previewComdataImport,
  previewInvoiceImport, previewNoticeImport, recordMudflap, removeInvoice, saveInvoice, saveNotice, storeBalance, unpostNotice,
  type InvoiceImportPreview, type NoticeCheck, type NoticeImportPreview, type NoticeLineLike,
} from '../../core/fuel';
import { parseComdataFile, parseInvoiceFile, parseNoticeFile, signedNoticeAmount, type ParsedComdataRow, type ParsedInvoiceRow, type ParsedNoticeLine } from '../../core/fuelio';
import type { FuelInvoice, FuelNotice, FuelVendor, NoticeLineType } from '../../core/fuelTypes';
import { addDays, lastDayOfPeriod, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { putFile, getFile } from '../../data/storage';
import type { ID } from '../../core/types';
import { cpg, dpg, errList, errText, fuelAsOf, gal, useFuelStores } from './Fuel';

function useParams() {
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  return { sp, set };
}

/** File picker + paste box that hands back the text. */
function FileOrPaste({ id, label, onText, placeholder }: { id: string; label: string; onText: (name: string, text: string) => void; placeholder: string }) {
  const [text, setText] = useState('');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="actions">
        <label className="btn">Choose file<input type="file" accept=".csv,.txt,.tsv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onText(f.name, await f.text()); }} /></label>
        <span className="muted small">CSV or tab-separated text. PDFs can't be read yet; paste the lines instead.</span>
      </div>
      <div className="field"><label htmlFor={id}>{label}</label><textarea id={id} rows={5} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} /></div>
      <div className="actions"><button className="btn" disabled={!text.trim()} onClick={() => onText('pasted text', text)}>Read {label.toLowerCase().replace(/^paste (the )?/, '')}</button></div>
    </div>
  );
}

const statusOf = (i: FuelInvoice, f: ReturnType<typeof invoiceFlags> extends Map<ID, infer F> ? F : never) =>
  i.settlement ? 'settled' : f.duplicateOf ? 'duplicate' : f.missingInvoice ? 'missing' : f.onUnpostedNotice ? 'on_notice' : f.unsettledPastDue ? 'past_due' : 'open';

// ── Invoices & BOLs ──────────────────────────────────────────────────────
export function FuelInvoicesPage() {
  const { state, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const { sp, set } = useParams();
  const tab = sp.get('tab') ?? 'list';
  const show = sp.get('show') ?? '';
  const storeSel = sp.get('store') ?? '';
  const fuelStores = useFuelStores();
  const asOf = fuelAsOf(state, fuelStores.map((s) => s.id));
  const today = todayInChicago();
  const flags = useMemo(() => invoiceFlags(state, today), [state, version, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = liveInvoices(state).filter((i) => visible.has(i.storeId)).sort((a, b) => b.deliveredOn.localeCompare(a.deliveredOn) || b.id.localeCompare(a.id));
  const month = asOf.slice(0, 7);
  const thisMonth = all.filter((i) => i.deliveredOn.startsWith(month) && i.invoiceNo && !flags.get(i.id)!.duplicateOf);
  const open = all.filter((i) => !i.settlement && !flags.get(i.id)!.duplicateOf && i.invoiceNo);
  const missing = all.filter((i) => flags.get(i.id)!.missingInvoice);
  const flagged = all.filter((i) => flags.get(i.id)!.duplicateOf || flags.get(i.id)!.outliers.length);
  const rows = all.filter((i) => (!storeSel || i.storeId === storeSel) && (show === 'open' ? open.includes(i) : show === 'missing' ? missing.includes(i) : show === 'flagged' ? flagged.includes(i) : show === 'settled' ? !!i.settlement : true));
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FuelInvoice | null | 'new'>(null);
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const tieTotal = rows.reduce((a, i) => a + i.total, 0);
  const tieLines = rows.reduce((a, i) => a + i.lines.reduce((x, l) => x + l.cost, 0) + i.freight + i.taxes, 0);

  return (
    <>
      <PageHead eyebrow="Fuel" title="Invoices & BOLs" lede="Every delivery with its BOL and invoice: gallons by grade, cost, freight, taxes, due date, and the notice or Dash payment that settled it.">
        {can(user, 'fuel.edit') && <button className="btn primary" onClick={() => { setEditing('new'); set('tab', 'list'); }}>Log a delivery</button>}
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('fuel-invoices', ['Delivered', 'Store', 'Supplier', 'Invoice', 'BOL', 'Grade', 'Gross gal', 'Net gal', 'Cost', 'Freight', 'Taxes', 'Total', 'Due', 'Status', 'Batch'],
          rows.flatMap((i) => i.lines.map((l, k) => [i.deliveredOn, code(i.storeId), VENDOR_LABEL[i.supplier], i.invoiceNo ?? '', i.bolNo, GRADE_LABEL[l.grade], l.grossGallons, l.netGallons, csvMoney(l.cost), k === 0 ? csvMoney(i.freight) : '0.00', k === 0 ? csvMoney(i.taxes) : '0.00', k === 0 ? csvMoney(i.total) : '', i.dueOn, statusOf(i, flags.get(i.id)!), i.batchId])))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Deliveries" style={{ marginBottom: 20 }}>
        <Figure label={`Invoiced · ${periodLabel(month)}`} value={<Money c={thisMonth.reduce((a, i) => a + i.total, 0)} whole dollar />} note={`${thisMonth.length} invoices`} />
        <Figure label="Gallons delivered" value={gal(thisMonth.reduce((a, i) => a + invoiceGallons(i), 0))} note="Net, temperature-corrected" />
        <Figure label="Open, not yet settled" value={<Money c={open.reduce((a, i) => a + i.total, 0)} whole dollar />} note={`${open.length} invoices`} />
        <Figure label="Missing invoices" value={missing.length} note="BOL logged, no invoice yet" />
        <Figure label="Flagged" value={flagged.length} note="Duplicates and price outliers" />
      </section>
      <div className="seg" role="group" aria-label="View" style={{ marginBottom: 16 }}>
        {[['list', 'Deliveries'], ['import', 'Import']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => set('tab', k === 'list' ? '' : k)}>{l}</button>)}
      </div>
      {tab === 'import' ? <InvoiceImport /> : (
        <>
          {editing && <InvoiceForm invoice={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
          <section className="panel">
            <div className="filters">
              <div className="field"><label htmlFor="fi-show">Show</label><select id="fi-show" value={show} onChange={(e) => set('show', e.target.value)}><option value="">All deliveries</option><option value="open">Open (not settled)</option><option value="missing">Missing invoice</option><option value="flagged">Flagged</option><option value="settled">Settled</option></select></div>
              <div className="field"><label htmlFor="fi-store">Store</label><select id="fi-store" value={storeSel} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{fuelStores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            </div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Delivered</th><th scope="col">Store</th><th scope="col">Invoice</th><th scope="col">BOL</th><th scope="col" className="num">Net gal</th><th scope="col" className="num">Delivered / gal</th><th scope="col" className="num">Total</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={9} className="muted">Nothing here.</td></tr>}
                {rows.slice(0, 200).map((i) => {
                  const fl = flags.get(i.id)!;
                  const st = statusOf(i, fl);
                  const g = invoiceGallons(i);
                  return [
                    <tr key={i.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{shortDate(i.deliveredOn)}</td><td>{code(i.storeId)} <span className="muted small">{VENDOR_LABEL[i.supplier]}</span></td>
                      <td><button className="btn sm ghost" aria-expanded={openId === i.id} onClick={() => setOpenId(openId === i.id ? null : i.id)}>{i.invoiceNo ?? 'No invoice yet'}</button></td>
                      <td>{i.bolNo}</td><td className="num">{gal(g)}</td><td className="num">{i.total ? dpg(i.total / g) : '—'}</td><td className="num"><Money c={i.total} /></td><td style={{ whiteSpace: 'nowrap' }}>{shortDate(i.dueOn)}</td>
                      <td>
                        {st === 'settled' && i.settlement && <Link className="pill ok" to={`/books/transactions/${i.settlement.txnId}`}>{i.settlement.kind === 'notice' ? `Netted ${shortDate(i.settlement.on)}` : `Paid from clearing ${shortDate(i.settlement.on)}`}</Link>}
                        {st === 'duplicate' && <span className="pill bad">Possible duplicate</span>}
                        {st === 'missing' && <span className="pill bad">Missing invoice</span>}
                        {st === 'on_notice' && <span className="pill warn">On an unposted notice</span>}
                        {st === 'past_due' && <span className="pill bad">Past due, not settled</span>}
                        {st === 'open' && <span className="pill">Open</span>}
                        {fl.outliers.map((o) => <span key={o.grade} className="pill warn" style={{ marginLeft: 4 }}>{GRADE_LABEL[o.grade]} {o.pct > 0 ? '+' : ''}{o.pct.toFixed(1)}% vs month</span>)}
                      </td>
                    </tr>,
                    openId === i.id && <tr key={i.id + '-d'}><td colSpan={9} style={{ background: 'var(--panel-2)' }}><InvoiceDetail invoice={i} onEdit={() => { setEditing(i); setOpenId(null); }} /></td></tr>,
                  ];
                })}
                {rows.length > 200 && <tr><td colSpan={9} className="muted">…and {rows.length - 200} more. Narrow the filters or export.</td></tr>}
              </tbody>
            </table></div>
            <TieOut items={[{ label: tieLines === tieTotal ? 'Lines + freight + taxes = invoice totals' : 'An invoice total does not add up', ok: tieLines === tieTotal, detail: <>{rows.length} deliveries · <Money c={tieTotal} dollar /></> }]} />
          </section>
        </>
      )}
      <Help k="fuelInvoices" />
    </>
  );
}

function InvoiceDetail({ invoice: i, onEdit }: { invoice: FuelInvoice; onEdit: () => void }) {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const [reason, setReason] = useState('');
  const fl = invoiceFlags(state, todayInChicago()).get(i.id)!;
  const dl = deliveredLines(i);
  const notice = i.settlement?.kind === 'notice' ? fuelOf(state).notices.find((n) => n.id === (i.settlement as { noticeId: ID }).noticeId) : undefined;
  const dupOf = fl.duplicateOf ? fuelOf(state).invoices.find((x) => x.id === fl.duplicateOf) : undefined;
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const id = books.nextId('att');
      if (!(await putFile(id, f))) { say('This browser is blocking storage, so the file could not be kept.'); continue; }
      attachToInvoice(books, user, i.id, { id, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, addedAt: new Date().toISOString(), addedBy: user.id });
      say(`Attached ${f.name}.`);
    }
  };
  const open = async (id: string, name: string) => {
    const blob = await getFile(id);
    if (!blob) { say(`${name} isn't on this device.`); return; }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="stack" style={{ gap: 12, padding: '6px 0' }}>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Grade</th><th scope="col" className="num">Gross gal</th><th scope="col" className="num">Net gal</th><th scope="col" className="num">Product cost</th><th scope="col" className="num">Product / gal</th><th scope="col" className="num">With freight &amp; tax</th><th scope="col" className="num">Delivered / gal</th></tr></thead>
        <tbody>
          {i.lines.map((l, k) => <tr key={k}><td>{GRADE_LABEL[l.grade]}</td><td className="num">{l.grossGallons.toLocaleString('en-US')}</td><td className="num">{l.netGallons.toLocaleString('en-US')}</td><td className="num"><Money c={l.cost} /></td><td className="num">{dpg(l.cost / l.netGallons)}</td><td className="num"><Money c={dl[k].cost} /></td><td className="num">{dpg(dl[k].cost / l.netGallons)}</td></tr>)}
          <tr><td colSpan={5}>Freight</td><td className="num"><Money c={i.freight} /></td><td /></tr>
          <tr><td colSpan={5}>Taxes</td><td className="num"><Money c={i.taxes} /></td><td /></tr>
          <tr className="total"><td colSpan={5}>Invoice total</td><td className="num"><Money c={i.total} /></td><td /></tr>
        </tbody>
      </table></div>
      <TieOut items={[{ label: dl.reduce((a, l) => a + l.cost, 0) === i.total ? 'Grades with freight and taxes add to the total' : 'Grades do not add to the total', ok: dl.reduce((a, l) => a + l.cost, 0) === i.total }]} />
      <div className="small">
        {i.settlement ? <>Settled {shortDate(i.settlement.on)} {notice ? <>on Craddock notice #{notice.noticeNo}</> : 'from Dash clearing on its due date'} · <Link to={`/books/transactions/${i.settlement.txnId}`}>ledger entry</Link></> : i.supplier === 'craddock' ? 'Nets on the next Craddock EFT notice on or after its due date.' : 'Paid from Dash clearing on its due date.'}
        {dupOf && <> · Same {dupOf.invoiceNo === i.invoiceNo ? 'invoice number' : 'BOL'} as the one delivered {shortDate(dupOf.deliveredOn)}.</>}
        <span className="muted"> · Batch {i.batchId}</span>
      </div>
      <div className="actions">
        {i.attachments.map((a) => <button key={a.id} className="btn sm" onClick={() => void open(a.id, a.name)}>Open {a.name}</button>)}
        {can(user, 'fuel.edit') && <label className="btn sm">Attach invoice PDF<input type="file" className="sr-only" accept=".pdf,image/*" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>}
        {can(user, 'fuel.edit') && !i.settlement && <button className="btn sm" onClick={onEdit}>{i.invoiceNo ? 'Edit' : 'Add the invoice'}</button>}
        {can(user, 'fuel.edit') && !i.settlement && (
          <span className="actions"><label className="sr-only" htmlFor={'rm-' + i.id}>Why remove</label><input id={'rm-' + i.id} placeholder="Why remove? e.g. duplicate" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 220 }} />
            <button className="btn sm danger" onClick={() => { try { removeInvoice(books, user, i.id, reason); say('Removed. It stays in the audit log.'); } catch (e) { say(errText(e)); } }}>Remove</button></span>
        )}
      </div>
      {toast}
    </div>
  );
}

function InvoiceForm({ invoice, onDone }: { invoice?: FuelInvoice; onDone: () => void }) {
  const { books, user } = useBooks();
  const fuelStores = useFuelStores();
  const [toast, say] = useToast();
  const line = (g: string) => invoice?.lines.find((l) => l.grade === g);
  const [f, setF] = useState({
    storeId: invoice?.storeId ?? fuelStores[0]?.id ?? '', invoiceNo: invoice?.invoiceNo ?? '', bolNo: invoice?.bolNo ?? '', deliveredOn: invoice?.deliveredOn ?? todayInChicago(), dueOn: invoice?.dueOn ?? addDays(todayInChicago(), 3),
    freight: invoice ? (invoice.freight / 100).toFixed(2) : '', taxes: invoice ? (invoice.taxes / 100).toFixed(2) : '', total: '',
    lines: Object.fromEntries(TANK_GRADES.map((g) => [g, { gross: line(g)?.grossGallons.toString() ?? '', net: line(g)?.netGallons.toString() ?? '', cost: line(g) ? (line(g)!.cost / 100).toFixed(2) : '' }])) as Record<string, { gross: string; net: string; cost: string }>,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const store = fuelStores.find((s) => s.id === f.storeId);
  const save = () => {
    const money = (s: string) => (s.trim() ? parseMoney(s) : 0);
    const lines = TANK_GRADES.filter((g) => f.lines[g].net.trim()).map((g) => ({ grade: g, grossGallons: Number((f.lines[g].gross || f.lines[g].net).replace(/,/g, '')), netGallons: Number(f.lines[g].net.replace(/,/g, '')), cost: money(f.lines[g].cost) ?? NaN }));
    try {
      saveInvoice(books, user, { id: invoice?.id, supplier: (store?.fuelSupplier ?? 'craddock') as FuelVendor, storeId: f.storeId, invoiceNo: f.invoiceNo, bolNo: f.bolNo, deliveredOn: f.deliveredOn, dueOn: f.dueOn, lines, freight: money(f.freight) ?? NaN, taxes: money(f.taxes) ?? NaN, total: f.total.trim() ? parseMoney(f.total) ?? NaN : undefined });
      say('Saved.');
      onDone();
    } catch (e) { setErrors(errList(e)); }
  };
  return (
    <section className="panel panel-pad" aria-labelledby="if-h" style={{ marginBottom: 20 }}>
      <h2 id="if-h" style={{ marginBottom: 12 }}>{invoice ? `Delivery BOL ${invoice.bolNo}` : 'Log a delivery'}</h2>
      <Errors errors={errors} />
      <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
        <div className="field"><label htmlFor="if-store">Store</label><select id="if-store" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}>{fuelStores.map((s) => <option key={s.id} value={s.id}>{s.code} · {VENDOR_LABEL[s.fuelSupplier as FuelVendor]}</option>)}</select></div>
        <div className="field"><label htmlFor="if-inv">Invoice #</label><input id="if-inv" value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} /><span className="hint">Leave blank if only the BOL has arrived.</span></div>
        <div className="field"><label htmlFor="if-bol">BOL #</label><input id="if-bol" value={f.bolNo} onChange={(e) => setF({ ...f, bolNo: e.target.value })} /></div>
        <div className="field"><label htmlFor="if-del">Delivered</label><input id="if-del" type="date" value={f.deliveredOn} onChange={(e) => setF({ ...f, deliveredOn: e.target.value })} /></div>
        <div className="field"><label htmlFor="if-due">Due</label><input id="if-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></div>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="t">
        <thead><tr><th scope="col">Grade</th><th scope="col">Gross gallons</th><th scope="col">Net gallons</th><th scope="col">Product cost</th></tr></thead>
        <tbody>{TANK_GRADES.map((g) => (
          <tr key={g}><td>{GRADE_LABEL[g]}</td>
            {(['gross', 'net', 'cost'] as const).map((k) => <td key={k}><label className="sr-only" htmlFor={`if-${g}-${k}`}>{GRADE_LABEL[g]} {k === 'cost' ? 'product cost' : `${k} gallons`}</label><input id={`if-${g}-${k}`} className="num" inputMode="decimal" value={f.lines[g][k]} onChange={(e) => setF({ ...f, lines: { ...f.lines, [g]: { ...f.lines[g], [k]: e.target.value } } })} style={{ minWidth: 110 }} /></td>)}</tr>
        ))}</tbody>
      </table></div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="field"><label htmlFor="if-fr">Freight</label><input id="if-fr" className="num" inputMode="decimal" value={f.freight} onChange={(e) => setF({ ...f, freight: e.target.value })} /></div>
        <div className="field"><label htmlFor="if-tx">Taxes</label><input id="if-tx" className="num" inputMode="decimal" value={f.taxes} onChange={(e) => setF({ ...f, taxes: e.target.value })} /></div>
        <div className="field"><label htmlFor="if-tot">Invoice total (to check)</label><input id="if-tot" className="num" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></div>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={save}>Save delivery</button><button className="btn ghost" onClick={onDone}>Cancel</button></div>
      {toast}
    </section>
  );
}

function InvoiceImport() {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const [file, setFile] = useState<{ name: string; rows: ParsedInvoiceRow[]; problems: string[] } | null>(null);
  const preview: InvoiceImportPreview | null = useMemo(() => (file ? previewInvoiceImport(state, file.rows) : null), [file, state]);
  const batches = fuelOf(state).batches.filter((b) => b.kind === 'invoices').sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  if (!can(user, 'fuel.edit')) return <p className="muted">Your role can't import invoices.</p>;
  return (
    <div className="stack">
      <section className="panel panel-pad" aria-labelledby="ii-h">
        <h2 id="ii-h" style={{ marginBottom: 8 }}>Import invoices</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>One row per grade: Supplier, Store, Invoice, BOL, Delivered, Due, Grade, Gross, Net, Cost, Freight, Taxes. Rows with the same invoice and BOL make one invoice. Invoices already on file are skipped.</p>
        <FileOrPaste id="ii-paste" label="Paste invoices" placeholder={'Supplier,Store,Invoice,BOL,Delivered,Due,Grade,Gross,Net,Cost,Freight,Taxes\nCraddock,HM11,C-9001,80001,2026-11-26,2026-11-29,Regular,6020,6000,12480.00,270.00,2184.00'} onText={(name, text) => setFile({ name, ...parseInvoiceFile(text) })} />
        {file && file.problems.length > 0 && <div className="note warn" style={{ marginTop: 12 }}><b>{file.problems.length} row(s) skipped.</b><ul>{file.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul></div>}
      </section>
      {file && preview && (
        <section className="panel" aria-labelledby="ip-h">
          <div className="panel-head"><h2 id="ip-h">Preview: {file.name}</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col">Invoice</th><th scope="col">BOL</th><th scope="col">Delivered</th><th scope="col" className="num">Net gal</th><th scope="col" className="num">Total</th><th scope="col">Status</th></tr></thead>
            <tbody>{preview.invoices.map((i) => (
              <tr key={i.key}><td>{i.storeCode}</td><td>{i.invoiceNo ?? '—'}</td><td>{i.bolNo}</td><td>{i.deliveredOn}</td><td className="num">{gal(invoiceGallons(i))}</td><td className="num"><Money c={i.lines.reduce((a, l) => a + l.cost, 0) + i.freight + i.taxes} /></td>
                <td>{i.duplicate ? <span className="pill">Already on file</span> : i.problems.length ? <span className="pill bad" title={i.problems.join(' ')}>{i.problems[0]}</span> : <span className="pill ok">New</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[{ label: `${preview.added} new, ${preview.skipped} skipped`, ok: preview.invoices.every((i) => i.duplicate || !i.problems.length), detail: <>{gal(preview.gallons)} gal · <Money c={preview.total} dollar /></> }]} />
          <div className="panel-pad actions">
            <button className="btn primary" disabled={!preview.added} onClick={() => { try { const r = commitInvoiceImport(books, user, { name: file.name, rows: file.rows }); setFile(null); say(`Imported ${r.invoices.length} invoices in batch ${r.batch.id}.`); } catch (e) { say(errText(e)); } }}>Import {preview.added} invoice{preview.added === 1 ? '' : 's'}</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </section>
      )}
      <BatchHistory batches={batches} />
      {toast}
    </div>
  );
}

function BatchHistory({ batches }: { batches: ReturnType<typeof fuelOf>['batches'] }) {
  const { state } = useBooks();
  const userName = (id: string) => state.users.find((u) => u.id === id)?.name ?? id;
  return (
    <section className="panel" aria-labelledby="bh-h">
      <div className="panel-head"><h2 id="bh-h">Import history</h2></div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">File</th><th scope="col" className="num">Added</th><th scope="col" className="num">Skipped</th><th scope="col">By</th></tr></thead>
        <tbody>{batches.length === 0 ? <tr><td colSpan={4} className="muted">No imports yet.</td></tr> : batches.slice(0, 20).map((b) => <tr key={b.id}><td>{b.fileName}<div className="muted small">batch {b.id}</div></td><td className="num">{b.added}</td><td className="num">{b.skipped}</td><td>{userName(b.by)} · {shortDate(b.importedAt.slice(0, 10))}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

// ── Supplier settlement ──────────────────────────────────────────────────
const sumType = (n: { lines: { type: NoticeLineType; amount: number }[] }, ...t: NoticeLineType[]) => n.lines.filter((l) => t.includes(l.type)).reduce((a, l) => a + l.amount, 0);

function checkItems(chk: NoticeCheck) {
  const inv = chk.invoices;
  const invOk = inv.every((c) => c.invoice && !c.problem);
  const posOff = chk.proceeds.filter((p) => p.diff !== 0);
  return [
    { label: chk.netsToZero ? 'Nets to zero' : 'Does not net to zero', ok: chk.netsToZero, detail: chk.netsToZero ? 'every line, including the draft or deposit, adds to $0.00' : <>off by <Money c={chk.net} dollar /></> },
    { label: invOk ? (inv.length === 1 ? 'The invoice matches the one on file' : `${inv.length} invoices match the invoices on file`) : 'Invoice lines need a look', ok: invOk, detail: inv.filter((c) => c.problem).map((c) => `${c.line.invoiceNo ?? '?'}: ${c.problem}`).join(' ') || undefined },
    { label: posOff.length ? 'Card proceeds differ from POS card sales' : 'Card proceeds match POS card sales', ok: !posOff.length, detail: posOff.length ? posOff.map((p) => `${shortDate(p.salesDate)} ${formatMoney(p.diff, { dollarSign: true })}`).join(', ') : `${chk.proceeds.length} sales days` },
  ];
}

function NoticeLines({ notice }: { notice: { noticeDate: string; lines: NoticeLineLike[] } }) {
  return (
    <div className="table-wrap"><table className="t">
      <thead><tr><th scope="col">Type</th><th scope="col">Processed</th><th scope="col">Books date</th><th scope="col">Description</th><th scope="col">Invoice</th><th scope="col" className="num">Amount</th></tr></thead>
      <tbody>
        {notice.lines.map((l, k) => <tr key={l.id ?? k}><td>{NOTICE_TYPE_LABEL[l.type]}</td><td>{l.processingDate ? shortDate(l.processingDate) : ''}</td><td>{shortDate(noticeLineDate(notice, l))}</td><td className="trunc" title={l.description}>{l.description}</td><td>{l.invoiceNo ?? ''}</td><td className="num"><Money c={l.amount} signed /></td></tr>)}
        <tr className="total"><td colSpan={5}>Net</td><td className="num"><Money c={noticeNet(notice)} /></td></tr>
      </tbody>
    </table></div>
  );
}

export function SettlementPage() {
  const { state, visible, version } = useBooks();
  const { sp, set } = useParams();
  const tab = sp.get('tab') ?? 'craddock';
  const fuelStores = useFuelStores();
  const asOf = fuelAsOf(state, fuelStores.map((s) => s.id));
  const today = todayInChicago();
  const crad = fuelStores.filter((s) => s.fuelSupplier === 'craddock');
  const dash = fuelStores.filter((s) => s.fuelSupplier === 'dash');
  const receivable = crad.reduce((a, s) => a + storeBalance(state, FUEL_ACCT.craddock, s.id, today), 0);
  const unposted = fuelOf(state).notices.filter((n) => n.status === 'unposted' && visible.has(n.storeId));
  const posted = fuelOf(state).notices.filter((n) => n.status === 'posted' && visible.has(n.storeId)).sort((a, b) => b.noticeDate.localeCompare(a.noticeDate));
  const dashBal = dash.reduce((a, s) => a + storeBalance(state, FUEL_ACCT.dash, s.id, today), 0);
  const open = useMemo(() => crad.reduce((a, s) => a + craddockReceivable(state, s.id, today).openBatches.length, 0), [state, version, today, crad.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = posted[0];
  return (
    <>
      <PageHead eyebrow="Fuel" title="Supplier settlement" lede="Craddock nets card proceeds, fees, discounts and fuel invoices into one draft or deposit per notice. Dash pays our invoices on their due dates out of the card money it holds." />
      <section className="figures" aria-label="Settlement" style={{ marginBottom: 20 }}>
        <Figure label="Craddock receivable" value={<Money c={receivable} whole dollar />} note={`${crad.map((s) => s.code).join(' + ')} today`} href="/books/accounts/acct_craddock" />
        <Figure label="Notices not posted" value={unposted.length} note={unposted.length ? `${unposted.filter((n) => noticeNet(n) !== 0).length} not netting to zero` : 'All posted'} />
        <Figure label="Card batches waiting" value={open} note="Sales days not yet on a posted notice" />
        <Figure label="Last notice" value={last ? <Money c={-sumType(last, 'BANK_DRAFT', 'DEPOSIT')} whole dollar /> : '—'} note={last ? `#${last.noticeNo} ${state.stores.find((s) => s.id === last.storeId)?.code} · ${sumType(last, 'BANK_DRAFT') ? 'draft' : 'deposit'} ${shortDate(noticeLineDate(last, { type: 'DEPOSIT' }))}` : undefined} />
        <Figure label="Dash clearing" value={<Money c={dashBal} whole dollar />} note={dashBal >= 0 ? 'Dash holds this much of our card money' : 'We owe Dash this much'} href="/books/accounts/acct_dash" />
      </section>
      <div className="seg" role="group" aria-label="Supplier" style={{ marginBottom: 16 }}>
        {[['craddock', 'Craddock notices'], ['dash', 'Dash clearing']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => set('tab', k === 'craddock' ? '' : k)}>{l}</button>)}
      </div>
      {tab === 'dash' ? <DashTab asOf={asOf} /> : <CraddockTab unposted={unposted} posted={posted} />}
      <Help k="fuelSettlement" />
    </>
  );
}

function CraddockTab({ unposted, posted }: { unposted: FuelNotice[]; posted: FuelNotice[] }) {
  const { state, books, user } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const fuelStores = useFuelStores();
  const crad = fuelStores.filter((s) => s.fuelSupplier === 'craddock');
  const [fallback, setFallback] = useState({ storeCode: crad[0]?.code ?? '', noticeNo: '', noticeDate: '' });
  const [file, setFile] = useState<{ name: string; lines: ParsedNoticeLine[]; problems: string[] } | null>(null);
  const preview: NoticeImportPreview | null = useMemo(() => (file ? previewNoticeImport(state, file.lines) : null), [file, state]);
  const [recDate, setRecDate] = useState(todayInChicago());
  const [unposting, setUnposting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [manual, setManual] = useState(false);
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const canPost = can(user, 'fuel.post');
  const ready = preview ? preview.notices.filter((n) => !n.duplicate && !n.problems.length) : [];
  const allNet = ready.every((n) => n.check?.canPost);
  const txnEffect = (n: FuelNotice) => n.txnIds.reduce((a, id) => a + (books.getTransaction(id)?.lines.filter((l) => l.accountId === FUEL_ACCT.craddock && l.storeId === n.storeId).reduce((x, l) => x + l.debit - l.credit, 0) ?? 0), 0);
  const postedOk = posted.every((n) => noticeNet(n) === 0 && txnEffect(n) === -sumType(n, 'CC_PROCEEDS'));
  const recs = crad.map((s) => craddockReceivable(state, s.id, recDate));
  return (
    <div className="stack">
      {can(user, 'fuel.edit') && (
        <section className="panel panel-pad" aria-labelledby="pn-h">
          <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 10 }}><h2 id="pn-h">Post a notice</h2><button className="btn sm ghost" aria-expanded={manual} onClick={() => setManual(!manual)}>{manual ? 'Upload or paste instead' : 'Enter by hand'}</button></div>
          {manual ? <ManualNotice onDone={(m) => { setManual(false); say(m); }} /> : (
            <>
              <p className="muted small" style={{ marginBottom: 10 }}>Columns: Notice, Store, Notice date, Type, Processing date, Description, Invoice, Amount. Proceeds and drafts are +; fees, host discounts, invoices and deposits are −. Leave Notice, Store or Notice date out of the file and fill them in here instead.</p>
              <div className="form-grid" style={{ marginBottom: 12 }}>
                <div className="field"><label htmlFor="pn-store">Store (if not in file)</label><select id="pn-store" value={fallback.storeCode} onChange={(e) => setFallback({ ...fallback, storeCode: e.target.value })}>{crad.map((s) => <option key={s.id} value={s.code}>{s.code}</option>)}</select></div>
                <div className="field"><label htmlFor="pn-no">Notice # (if not in file)</label><input id="pn-no" value={fallback.noticeNo} onChange={(e) => setFallback({ ...fallback, noticeNo: e.target.value })} /></div>
                <div className="field"><label htmlFor="pn-date">Notice date (if not in file)</label><input id="pn-date" type="date" value={fallback.noticeDate} onChange={(e) => setFallback({ ...fallback, noticeDate: e.target.value })} /></div>
              </div>
              <FileOrPaste id="pn-paste" label="Paste the notice" placeholder={'Notice,Store,Notice date,Type,Processing date,Description,Invoice,Amount\n41301,HM11,2026-11-30,CC_PROCEEDS,2026-11-24,Card batch,,6512.40\n41301,HM11,2026-11-30,CC_FEE,2026-11-24,Card fees,,-140.02\n41301,HM11,2026-11-30,DEPOSIT,,ACH deposit,,-6372.38'}
                onText={(name, text) => setFile({ name, ...parseNoticeFile(text, { storeCode: fallback.storeCode, noticeNo: fallback.noticeNo || undefined, noticeDate: fallback.noticeDate || undefined }) })} />
              {file && file.problems.length > 0 && <div className="note warn" style={{ marginTop: 12 }}><b>{file.problems.length} row(s) skipped.</b><ul>{file.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul></div>}
            </>
          )}
        </section>
      )}
      {file && preview && (
        <section className="panel" aria-labelledby="np-h">
          <div className="panel-head"><h2 id="np-h">Preview: {file.name}</h2><span className="muted small">{preview.added} new · {preview.skipped} skipped</span></div>
          {preview.notices.map((n) => (
            <div key={n.key} style={{ borderBottom: '1px solid var(--rule)' }}>
              <div className="panel-pad" style={{ paddingBottom: 8 }}><b>Notice #{n.noticeNo}</b> · {n.storeCode} · {n.noticeDate ? shortDate(n.noticeDate) : '—'} {n.duplicate ? <span className="pill">Already on file</span> : n.problems.length ? <span className="pill bad">{n.problems[0]}</span> : <span className="pill ok">New</span>}</div>
              <NoticeLines notice={{ noticeDate: n.noticeDate, lines: n.lines.map((l, k) => ({ ...l, id: String(k) })) }} />
              {n.check && !n.duplicate && <TieOut items={checkItems(n.check)} />}
            </div>
          ))}
          <div className="panel-pad actions">
            {canPost && <button className="btn primary" disabled={!ready.length || !allNet} onClick={() => { try { const r = commitNoticeImport(books, user, { name: file.name, lines: file.lines }, { post: true }); setFile(null); say(`Imported ${r.notices.length} and posted ${r.posted} notice${r.posted === 1 ? '' : 's'} (batch ${r.batch.id}).${r.notPosted.length ? ' Not posted: ' + r.notPosted.join(' ') : ''}`); } catch (e) { say(errText(e)); } }}>Import and post {ready.length} notice{ready.length === 1 ? '' : 's'}</button>}
            <button className="btn" disabled={!ready.length} onClick={() => { try { const r = commitNoticeImport(books, user, { name: file.name, lines: file.lines }); setFile(null); say(`Saved ${r.notices.length} notice${r.notices.length === 1 ? '' : 's'} unposted.`); } catch (e) { say(errText(e)); } }}>Save unposted</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
            {ready.length > 0 && !allNet && <span className="small neg">Fix the notice so it nets to zero and its invoices match before posting.</span>}
          </div>
        </section>
      )}

      <section className="panel" aria-labelledby="wp-h">
        <div className="panel-head"><h2 id="wp-h">Waiting to post</h2><span className="muted small">{unposted.length} notice{unposted.length === 1 ? '' : 's'}</span></div>
        {unposted.length === 0 ? <p className="panel-pad muted">Every notice is posted.</p> : unposted.map((n) => {
          const chk = checkNotice(state, n);
          return (
            <div key={n.id} style={{ borderBottom: '1px solid var(--rule)' }}>
              <div className="panel-pad actions" style={{ justifyContent: 'space-between' }}>
                <span><b>Notice #{n.noticeNo}</b> · {code(n.storeId)} · {shortDate(n.noticeDate)} · {n.lines.length} lines · {sumType(n, 'BANK_DRAFT') ? 'draft' : 'deposit'} <Money c={Math.abs(sumType(n, 'BANK_DRAFT', 'DEPOSIT'))} dollar /> on {shortDate(noticeLineDate(n, { type: 'DEPOSIT' }))}</span>
                {canPost && <button className="btn primary sm" disabled={!chk.canPost} onClick={() => { try { const t = postNotice(books, user, n.id); say(`Posted notice #${n.noticeNo}: ${t.length} entries.`); } catch (e) { say(errText(e)); } }}>Post notice #{n.noticeNo}</button>}
              </div>
              <NoticeLines notice={n} />
              <TieOut items={checkItems(chk)} />
            </div>
          );
        })}
      </section>

      <section className="panel" aria-labelledby="rc-h">
        <div className="panel-head"><h2 id="rc-h">Craddock receivable</h2>
          <div className="actions"><label htmlFor="rc-date" className="small">As of</label><input id="rc-date" type="date" value={recDate} onChange={(e) => e.target.value && setRecDate(e.target.value)} style={{ width: 160 }} /></div></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col" className="num">Opening</th><th scope="col" className="num">+ POS card sales</th><th scope="col" className="num">− Settled by notices</th><th scope="col" className="num">= Receivable</th><th scope="col" className="num">Ledger 1100</th><th scope="col">Card batches not on a posted notice</th></tr></thead>
          <tbody>{recs.map((r) => (
            <tr key={r.storeId}><td><b>{code(r.storeId)}</b></td><td className="num"><Money c={r.opening} /></td><td className="num"><Money c={r.posCard} /></td><td className="num"><Money c={r.relief} /></td><td className="num"><b><Money c={r.explained} /></b></td><td className="num"><Link to="/books/accounts/acct_craddock"><Money c={r.ledger} /></Link></td>
              <td className="small">{r.openBatches.length ? r.openBatches.map((b) => `${shortDate(b.salesDate)} ${formatMoney(b.amount)}`).join(' · ') : 'None'}</td></tr>
          ))}</tbody>
        </table></div>
        <TieOut items={recs.map((r) => ({ label: r.difference === 0 ? `${code(r.storeId)} receivable ties to the ledger` : `${code(r.storeId)} off by ${formatMoney(r.difference, { dollarSign: true })}`, ok: r.difference === 0, detail: r.difference ? 'An entry on 1100 did not come from the POS or a notice.' : undefined }))} />
      </section>

      <section className="panel" aria-labelledby="po-h">
        <div className="panel-head"><h2 id="po-h">Posted notices</h2>
          {can(user, 'export') && <button className="btn sm" onClick={() => exportCsv('craddock-notices', ['Notice', 'Store', 'Notice date', 'Type', 'Processing date', 'Books date', 'Description', 'Invoice', 'Amount', 'Batch'], posted.flatMap((n) => n.lines.map((l) => [n.noticeNo, code(n.storeId), n.noticeDate, l.type, l.processingDate ?? '', noticeLineDate(n, l), l.description, l.invoiceNo ?? '', csvMoney(l.amount), l.batchId])))}>Export CSV</button>}</div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Notice</th><th scope="col">Store</th><th scope="col">Date</th><th scope="col" className="num">Card proceeds</th><th scope="col" className="num">Fees</th><th scope="col" className="num">Host disc.</th><th scope="col" className="num">Invoices</th><th scope="col" className="num">Network / other</th><th scope="col" className="num">Draft (deposit)</th><th scope="col">Entries</th></tr></thead>
          <tbody>{posted.map((n) => (
            <tr key={n.id}><td>#{n.noticeNo}</td><td>{code(n.storeId)}</td><td style={{ whiteSpace: 'nowrap' }}>{shortDate(n.noticeDate)}</td>
              <td className="num"><Money c={sumType(n, 'CC_PROCEEDS')} /></td><td className="num"><Money c={sumType(n, 'CC_FEE')} /></td><td className="num"><Money c={sumType(n, 'HOST_DISCOUNT')} /></td><td className="num"><Money c={sumType(n, 'FUEL_INVOICE')} /></td><td className="num"><Money c={sumType(n, 'OTHER')} /></td><td className="num"><Money c={sumType(n, 'BANK_DRAFT', 'DEPOSIT')} /></td>
              <td style={{ whiteSpace: 'nowrap' }}>{n.txnIds.length} · <Link to={`/books/transactions/${n.txnIds.at(-1)}`}>bank</Link>
                {canPost && (unposting === n.id
                  ? <span className="actions" style={{ display: 'inline-flex', marginLeft: 6 }}><label className="sr-only" htmlFor={'up-' + n.id}>Why unpost</label><input id={'up-' + n.id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" style={{ width: 140 }} /><button className="btn sm danger" onClick={() => { try { unpostNotice(books, user, n.id, reason); setUnposting(null); say(`Unposted #${n.noticeNo}.`); } catch (e) { say(errText(e)); } }}>Unpost</button></span>
                  : <button className="btn sm ghost" onClick={() => { setUnposting(n.id); setReason(''); }}>Unpost…</button>)}</td></tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[{ label: postedOk ? 'Every posted notice nets to zero and cleared exactly its card proceeds' : 'A posted notice does not tie to its entries', ok: postedOk, detail: `${posted.length} notices` }]} />
      </section>
      {toast}
    </div>
  );
}

function ManualNotice({ onDone }: { onDone: (msg: string) => void }) {
  const { books, user } = useBooks();
  const crad = useFuelStores().filter((s) => s.fuelSupplier === 'craddock');
  const [head, setHead] = useState({ storeId: crad[0]?.id ?? '', noticeNo: '', noticeDate: todayInChicago() });
  const blank = { type: 'CC_PROCEEDS' as NoticeLineType, processingDate: '', description: '', invoiceNo: '', amount: '' };
  const [rows, setRows] = useState([{ ...blank }, { ...blank, type: 'CC_FEE' as NoticeLineType }, { ...blank, type: 'DEPOSIT' as NoticeLineType }]);
  const [errors, setErrors] = useState<string[]>([]);
  const lines = rows.filter((r) => r.amount.trim()).map((r) => ({ type: r.type, processingDate: r.processingDate || undefined, description: r.description, invoiceNo: r.invoiceNo || undefined, amount: signedNoticeAmount(r.type, parseMoney(r.amount) ?? NaN) }));
  const net = lines.reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0);
  const save = (post: boolean) => {
    try {
      const n = saveNotice(books, user, { ...head, lines });
      if (post) postNotice(books, user, n.id);
      onDone(post ? `Posted notice #${n.noticeNo}.` : `Saved notice #${n.noticeNo} unposted.`);
    } catch (e) { setErrors(errList(e)); }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor="mn-store">Store</label><select id="mn-store" value={head.storeId} onChange={(e) => setHead({ ...head, storeId: e.target.value })}>{crad.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
        <div className="field"><label htmlFor="mn-no">Notice #</label><input id="mn-no" value={head.noticeNo} onChange={(e) => setHead({ ...head, noticeNo: e.target.value })} /></div>
        <div className="field"><label htmlFor="mn-date">Notice date</label><input id="mn-date" type="date" value={head.noticeDate} onChange={(e) => setHead({ ...head, noticeDate: e.target.value })} /></div>
      </div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Type</th><th scope="col">Processed</th><th scope="col">Description</th><th scope="col">Invoice</th><th scope="col">Amount</th></tr></thead>
        <tbody>{rows.map((r, k) => {
          const upd = (p: Partial<typeof r>) => setRows(rows.map((x, j) => (j === k ? { ...x, ...p } : x)));
          return (
            <tr key={k}>
              <td><label className="sr-only" htmlFor={`mn-t${k}`}>Line {k + 1} type</label><select id={`mn-t${k}`} value={r.type} onChange={(e) => upd({ type: e.target.value as NoticeLineType })}>{NOTICE_TYPES.map((t) => <option key={t} value={t}>{NOTICE_TYPE_LABEL[t]}</option>)}</select></td>
              <td><label className="sr-only" htmlFor={`mn-p${k}`}>Line {k + 1} processing date</label><input id={`mn-p${k}`} type="date" value={r.processingDate} onChange={(e) => upd({ processingDate: e.target.value })} /></td>
              <td><label className="sr-only" htmlFor={`mn-d${k}`}>Line {k + 1} description</label><input id={`mn-d${k}`} value={r.description} onChange={(e) => upd({ description: e.target.value })} /></td>
              <td><label className="sr-only" htmlFor={`mn-i${k}`}>Line {k + 1} invoice</label><input id={`mn-i${k}`} value={r.invoiceNo} onChange={(e) => upd({ invoiceNo: e.target.value })} style={{ minWidth: 90 }} /></td>
              <td><label className="sr-only" htmlFor={`mn-a${k}`}>Line {k + 1} amount</label><input id={`mn-a${k}`} className="num" inputMode="decimal" value={r.amount} onChange={(e) => upd({ amount: e.target.value })} style={{ minWidth: 110 }} /></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <div className="actions">
        <button className="btn sm" onClick={() => setRows([...rows, { ...blank, type: 'FUEL_INVOICE' }])}>Add line</button>
        <span className={net === 0 ? 'pos' : 'neg'}>{net === 0 ? '✓ Nets to zero' : `Nets to ${formatMoney(net, { dollarSign: true })}`}</span>
        <span className="muted small">Type amounts as printed; the sign follows the line type.</span>
      </div>
      <div className="actions">
        {can(user, 'fuel.post') && <button className="btn primary" disabled={net !== 0 || !lines.length} onClick={() => save(true)}>Save and post</button>}
        <button className="btn" disabled={!lines.length} onClick={() => save(false)}>Save unposted</button>
      </div>
    </div>
  );
}

function DashTab({ asOf }: { asOf: string }) {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const dash = useFuelStores().filter((s) => s.fuelSupplier === 'dash');
  const [storeId, setStoreId] = useState(dash[0]?.id ?? '');
  const months = [...new Set(state.transactions.filter((t) => !t.deleted && t.lines.some((l) => l.accountId === FUEL_ACCT.dash && l.storeId === storeId)).map((t) => t.date.slice(0, 7)))].sort().reverse();
  const [month, setMonth] = useState(asOf.slice(0, 7));
  const from = `${month}-01`;
  const to = lastDayOfPeriod(month);
  const led = useMemo(() => clearingLedger(state, FUEL_ACCT.dash, storeId, from, to), [state, version, storeId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayInChicago();
  const nowBal = storeBalance(state, FUEL_ACCT.dash, storeId, today);
  const upcoming = dashUpcoming(state, storeId, today);
  const due14 = upcoming.filter((i) => i.dueOn <= addDays(today, 14));
  const ledgerClose = storeBalance(state, FUEL_ACCT.dash, storeId, to);
  const sumRows = led.rows.reduce((a, r) => a + r.cardIn + r.invoicesOut + r.fees + r.bank + r.other, 0);
  const [st, setSt] = useState({ date: today, fees: '', network: '', remit: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  if (!dash.length) return <p className="muted">No Dash stores you can see.</p>;
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="ow-h">
        <div className="panel-head"><h2 id="ow-h">Balance owed each way</h2><span className="muted small">today</span></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col" className="num">Clearing balance</th><th scope="col">Who owes whom</th><th scope="col" className="num">Invoices due next 14 days</th><th scope="col" className="num">Balance after them</th></tr></thead>
          <tbody>{dash.map((s) => {
            const b = storeBalance(state, FUEL_ACCT.dash, s.id, today);
            const up = dashUpcoming(state, s.id, today).filter((i) => i.dueOn <= addDays(today, 14)).reduce((a, i) => a + i.total, 0);
            return <tr key={s.id}><td><b>{s.code}</b></td><td className="num"><Money c={b} /></td><td>{b >= 0 ? <span className="pill ok">Dash holds our money</span> : <span className="pill warn">We owe Dash</span>}</td><td className="num"><Money c={-up} /></td><td className="num"><Money c={b - up} signed /></td></tr>;
          })}</tbody>
        </table></div>
      </section>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="dc-store">Store</label><select id="dc-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{dash.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
          <div className="field"><label htmlFor="dc-month">Month</label><select id="dc-month" value={month} onChange={(e) => setMonth(e.target.value)}>{(months.length ? months : [month]).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          {can(user, 'export') && <button className="btn sm" style={{ marginBottom: 6 }} onClick={() => exportCsv(`dash-clearing-${code(storeId)}-${month}`, ['Date', 'Card in', 'Invoices out', 'Fees', 'Bank', 'Other', 'Balance'], led.rows.map((r) => [r.date, csvMoney(r.cardIn), csvMoney(r.invoicesOut), csvMoney(r.fees), csvMoney(r.bank), csvMoney(r.other), csvMoney(r.balance)]))}>Export CSV</button>}
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Date</th><th scope="col" className="num">Card proceeds in</th><th scope="col" className="num">Invoices out</th><th scope="col" className="num">Fees</th><th scope="col" className="num">Remitted / drafted</th><th scope="col" className="num">Other</th><th scope="col" className="num">Balance</th></tr></thead>
          <tbody>
            <tr className="sub"><td>Opening</td><td colSpan={5} /><td className="num"><Money c={led.opening} /></td></tr>
            {led.rows.map((r) => (
              <tr key={r.date}><td style={{ whiteSpace: 'nowrap' }}>{shortDate(r.date)}</td><td className="num">{r.cardIn ? <Money c={r.cardIn} /> : ''}</td><td className="num">{r.invoicesOut ? <Link to={`/books/transactions/${r.txnIds.find((id) => books.getTransaction(id)?.lines.some((l) => l.accountId === FUEL_ACCT.cogs)) ?? r.txnIds[0]}`}><Money c={r.invoicesOut} /></Link> : ''}</td><td className="num">{r.fees ? <Money c={r.fees} /> : ''}</td><td className="num">{r.bank ? <Money c={r.bank} /> : ''}</td><td className="num">{r.other ? <Money c={r.other} /> : ''}</td><td className="num"><Money c={r.balance} /></td></tr>
            ))}
          </tbody>
        </table></div>
        <TieOut items={[
          { label: 'Opening + activity = closing', ok: led.opening + sumRows === led.closing, detail: <Money c={led.closing} dollar /> },
          { label: led.closing === ledgerClose ? 'Closing ties to the ledger (1110)' : 'Closing does not tie to the ledger', ok: led.closing === ledgerClose, detail: <>ledger <Money c={ledgerClose} dollar /> on {shortDate(to)}</> },
        ]} />
      </section>
      <div className="grid-2">
        <section className="panel" aria-labelledby="up-h">
          <div className="panel-head"><h2 id="up-h">Coming out of clearing</h2><span className="muted small">{code(storeId)} · now <Money c={nowBal} dollar /></span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Due</th><th scope="col">Invoice</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>{upcoming.length === 0 ? <tr><td colSpan={3} className="muted">No open Dash invoices.</td></tr> : upcoming.map((i) => <tr key={i.id}><td>{shortDate(i.dueOn)}{i.dueOn < today && <> <span className="pill bad">Past due</span></>}</td><td>{i.invoiceNo ?? `BOL ${i.bolNo}`}</td><td className="num"><Money c={i.total} /></td></tr>)}</tbody>
          </table></div>
          {can(user, 'fuel.post') && <div className="panel-pad actions"><button className="btn" disabled={!upcoming.some((i) => i.dueOn <= today && i.invoiceNo)} onClick={() => { try { const t = payDashInvoicesDue(books, user, { through: today, storeId }); say(`Paid ${t.length} invoice${t.length === 1 ? '' : 's'} from clearing, each on its due date.`); } catch (e) { say(errText(e)); } }}>Pay invoices due through today</button><span className="muted small">{due14.length} due in the next 14 days</span></div>}
        </section>
        {can(user, 'fuel.post') && (
          <section className="panel panel-pad" aria-labelledby="ds-h">
            <h2 id="ds-h" style={{ marginBottom: 12 }}>Post a Dash statement</h2>
            <Errors errors={errors} />
            <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
              <div className="field"><label htmlFor="ds-date">Date</label><input id="ds-date" type="date" value={st.date} onChange={(e) => setSt({ ...st, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="ds-fees">Card fees</label><input id="ds-fees" className="num" inputMode="decimal" value={st.fees} onChange={(e) => setSt({ ...st, fees: e.target.value })} /></div>
              <div className="field"><label htmlFor="ds-net">Network fees</label><input id="ds-net" className="num" inputMode="decimal" value={st.network} onChange={(e) => setSt({ ...st, network: e.target.value })} /></div>
              <div className="field"><label htmlFor="ds-remit">Remitted (− if drafted)</label><input id="ds-remit" className="num" inputMode="decimal" value={st.remit} onChange={(e) => setSt({ ...st, remit: e.target.value })} /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
              const m = (s: string) => (s.trim() ? parseMoney(s) ?? NaN : 0);
              try { postDashSettlement(books, user, { storeId, date: st.date, cardFees: m(st.fees), networkFees: m(st.network), remit: m(st.remit) }); setErrors([]); setSt({ ...st, fees: '', network: '', remit: '' }); say('Dash statement posted.'); } catch (e) { setErrors(errList(e)); }
            }}>Post statement</button></div>
          </section>
        )}
      </div>
      {toast}
    </div>
  );
}

// ── Truck lane ───────────────────────────────────────────────────────────
export function TruckLanePage() {
  const { state, books, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const truckStores = state.stores.filter((s) => s.hasTruckLane && visible.has(s.id) && !s.deleted);
  const storeId = truckStores[0]?.id ?? '';
  const f = fuelOf(state);
  const days = f.comdata.filter((c) => c.storeId === storeId).sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set(days.map((d) => d.date.slice(0, 7)))].sort().reverse();
  const [month, setMonth] = useState(months[0] ?? todayInChicago().slice(0, 7));
  const mDays = days.filter((d) => d.date.startsWith(month));
  const mGal = mDays.reduce((a, d) => a + d.gallons, 0);
  const mSales = mDays.reduce((a, d) => a + d.sales, 0);
  const mud = f.mudflap.filter((m) => m.storeId === storeId).sort((a, b) => b.date.localeCompare(a.date));
  const mMud = mud.filter((m) => m.date.startsWith(month)).reduce((a, m) => a + m.amount, 0);
  const fis = useMemo(() => (storeId ? fiservMonths(state, storeId) : []), [state, version, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const fm = fis.find((x) => x.period === month);
  const prevFee = [...fis].reverse().find((x) => x.feeRate !== null);
  const from = `${month}-01`;
  const to = lastDayOfPeriod(month);
  const ledgerDiesel = storeId ? ledgerFuelRevenue(state, [storeId], from, to) - f.sales.filter((s) => s.storeId === storeId && s.date >= from && s.date <= to).reduce((a, s) => a + s.retail, 0) : 0;
  const open1120 = storeId ? storeBalance(state, FUEL_ACCT.fiserv, storeId, addDays(from, -1)) : 0;
  const close1120 = storeId ? storeBalance(state, FUEL_ACCT.fiserv, storeId, to) : 0;
  const rollOk = fm ? open1120 + fm.truckCard - fm.mudflap - fm.deposits === close1120 : true;
  const [file, setFile] = useState<{ name: string; rows: ParsedComdataRow[]; problems: string[] } | null>(null);
  const preview = useMemo(() => (file ? previewComdataImport(state, file.rows) : null), [file, state]);
  const [mf, setMf] = useState({ date: todayInChicago(), kind: 'discount' as 'discount' | 'true_up', amount: '', gallons: '', note: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const code = state.stores.find((s) => s.id === storeId)?.code ?? '';
  const bankLines = state.bank.lines.filter((b) => /MER BNKCD/i.test(b.description)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  if (!storeId) return <PageHead eyebrow="Fuel" title="Truck lane" lede="None of the stores you can see has a truck lane." />;
  return (
    <>
      <PageHead eyebrow="Fuel" title="Truck lane" lede={<>{code} diesel from the Comdata truck-stop summary, kept apart from the store POS; Mudflap fuel-code discounts and true-ups; Fiserv / AccessOne merchant deposits and the fees debited the month after.</>}>
        <div className="field" style={{ width: 180 }}><label htmlFor="tl-month">Month</label><select id="tl-month" value={month} onChange={(e) => setMonth(e.target.value)}>{(months.length ? months : [month]).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`comdata-${code}-${month}`, ['Date', 'Gallons', 'Sales', 'Transactions', 'Batch'], mDays.map((d) => [d.date, d.gallons, csvMoney(d.sales), d.transactions, d.batchId]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Truck lane" style={{ marginBottom: 20 }}>
        <Figure label="Truck gallons" value={gal(mGal)} note={`${mDays.length} days from Comdata`} />
        <Figure label="Truck diesel sales" value={<Money c={mSales} whole dollar />} note={`${dpg(mGal ? mSales / mGal : null)} a gallon`} />
        <Figure label="Mudflap discounts" value={<Money c={mMud} whole dollar />} note={`${cpg(mGal ? mMud / mGal : null, 2)} a truck gallon`} />
        <Figure label="Fiserv deposits" value={<Money c={fm?.deposits ?? 0} whole dollar />} note={`${fm?.depositCount ?? 0} MER BNKCD deposits`} />
        <Figure label="Merchant fee rate" value={prevFee?.feeRate ? `${(prevFee.feeRate * 100).toFixed(2)}%` : '—'} note={prevFee ? `${periodLabel(prevFee.period)} fees, debited ${prevFee.feeDate ? shortDate(prevFee.feeDate) : 'next month'}` : 'No fees yet'} />
      </section>
      <section className="panel" aria-labelledby="cd-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="cd-h">Comdata summary · {periodLabel(month)}</h2></div>
        <div className="table-wrap" data-static="1" tabIndex={0} role="region" aria-label="Comdata days, scrolls" style={{ maxHeight: 420 }}><table className="t">
          <thead><tr><th scope="col">Date</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Sales</th><th scope="col" className="num">Per gallon</th><th scope="col" className="num">Transactions</th><th scope="col">Batch</th></tr></thead>
          <tbody>{mDays.map((d) => <tr key={d.id}><td>{shortDate(d.date)}</td><td className="num">{gal(d.gallons)}</td><td className="num"><Money c={d.sales} /></td><td className="num">{dpg(d.gallons ? d.sales / d.gallons : null)}</td><td className="num">{d.transactions}</td><td className="muted small">{d.batchId}</td></tr>)}</tbody>
        </table></div>
        <TieOut items={[
          { label: ledgerDiesel === mSales ? 'Comdata sales tie to truck-lane diesel revenue in the ledger' : 'Comdata sales do not tie to the ledger', ok: ledgerDiesel === mSales, detail: <>Comdata <Money c={mSales} dollar /> · ledger <Money c={ledgerDiesel} dollar /></> },
          { label: fm && fm.truckCard === mSales ? 'Truck-lane cards into Fiserv clearing match' : 'Truck-lane cards into Fiserv clearing differ', ok: !!fm && fm.truckCard === mSales, detail: <Money c={fm?.truckCard ?? 0} dollar /> },
        ]} />
      </section>

      {can(user, 'fuel.edit') && (
        <section className="panel panel-pad" aria-labelledby="ci-h" style={{ marginBottom: 20 }}>
          <h2 id="ci-h" style={{ marginBottom: 8 }}>Import the Comdata summary</h2>
          <FileOrPaste id="ci-paste" label="Paste the summary" placeholder={'Date,Store,Gallons,Sales,Transactions\n2026-11-27,HM15,940,3166.86,11'} onText={(name, text) => setFile({ name, ...parseComdataFile(text, code) })} />
          {file && file.problems.length > 0 && <div className="note warn" style={{ marginTop: 12 }}><b>{file.problems.length} row(s) skipped.</b><ul>{file.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul></div>}
          {file && preview && (
            <div style={{ marginTop: 12 }}>
              <div className="table-wrap"><table className="t">
                <thead><tr><th scope="col">Date</th><th scope="col">Store</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Sales</th><th scope="col">Status</th></tr></thead>
                <tbody>{preview.rows.map((r) => <tr key={r.key + r.gallons}><td>{r.date}</td><td>{r.storeCode}</td><td className="num">{gal(r.gallons)}</td><td className="num"><Money c={r.sales} /></td><td>{r.duplicate ? <span className="pill">Already on file</span> : r.problem ? <span className="pill bad">{r.problem}</span> : <span className="pill ok">New</span>}</td></tr>)}</tbody>
              </table></div>
              <TieOut items={[{ label: `${preview.added} new, ${preview.skipped} skipped`, ok: preview.rows.every((r) => r.duplicate || !r.problem), detail: <>{gal(preview.gallons)} gal · <Money c={preview.sales} dollar /></> }]} />
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="btn primary" disabled={!preview.added} onClick={() => { try { const r = commitComdataImport(books, user, { name: file.name, rows: file.rows }); setFile(null); say(`Imported ${r.rows.length} days in batch ${r.batch.id}.`); } catch (e) { say(errText(e)); } }}>Import {preview.added} day{preview.added === 1 ? '' : 's'}</button>
                <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="grid-2">
        <section className="panel" aria-labelledby="mf-h">
          <div className="panel-head"><h2 id="mf-h">Mudflap</h2><span className="muted small">4910 contra revenue</span></div>
          <div className="table-wrap" data-static="1" tabIndex={0} role="region" aria-label="Mudflap entries, scrolls" style={{ maxHeight: 360 }}><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Kind</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>{mud.length === 0 ? <tr><td colSpan={4} className="muted">None yet.</td></tr> : mud.map((m) => <tr key={m.id}><td>{shortDate(m.date)}</td><td><Link to={`/books/transactions/${m.txnId}`}>{m.kind === 'discount' ? 'Fuel-code discounts' : 'Card true-up'}</Link></td><td className="num">{m.gallons ? gal(m.gallons) : ''}</td><td className="num"><Money c={m.amount} /></td></tr>)}</tbody>
          </table></div>
          {can(user, 'fuel.post') && (
            <div className="panel-pad">
              <Errors errors={errors} />
              <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
                <div className="field"><label htmlFor="mf-date">Date</label><input id="mf-date" type="date" value={mf.date} onChange={(e) => setMf({ ...mf, date: e.target.value })} /></div>
                <div className="field"><label htmlFor="mf-kind">Kind</label><select id="mf-kind" value={mf.kind} onChange={(e) => setMf({ ...mf, kind: e.target.value as 'discount' | 'true_up' })}><option value="discount">Fuel-code discounts</option><option value="true_up">Card true-up</option></select></div>
                <div className="field"><label htmlFor="mf-amt">Amount</label><input id="mf-amt" className="num" inputMode="decimal" value={mf.amount} onChange={(e) => setMf({ ...mf, amount: e.target.value })} /><span className="hint">− for a true-up in our favour</span></div>
                <div className="field"><label htmlFor="mf-gal">Gallons</label><input id="mf-gal" className="num" inputMode="decimal" value={mf.gallons} onChange={(e) => setMf({ ...mf, gallons: e.target.value })} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { try { recordMudflap(books, user, { storeId, date: mf.date, kind: mf.kind, amount: parseMoney(mf.amount) ?? NaN, gallons: mf.gallons ? Number(mf.gallons.replace(/,/g, '')) : undefined, note: mf.note }); setErrors([]); setMf({ ...mf, amount: '', gallons: '' }); say('Posted to Mudflap discounts & true-ups.'); } catch (e) { setErrors(errList(e)); } }}>Post</button></div>
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="fs-h">
          <div className="panel-head"><h2 id="fs-h">Fiserv / AccessOne by month</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Truck cards</th><th scope="col" className="num">Mudflap</th><th scope="col" className="num">Deposits</th><th scope="col" className="num">Fees (next month)</th><th scope="col" className="num">Rate</th></tr></thead>
            <tbody>{fis.map((x) => <tr key={x.period}><td>{periodLabel(x.period)}</td><td className="num"><Money c={x.truckCard} /></td><td className="num"><Money c={x.mudflap} /></td><td className="num"><Money c={x.deposits} /></td><td className="num">{x.fees ? <Money c={x.fees} /> : <span className="muted small">not yet</span>}</td><td className="num">{x.feeRate ? `${(x.feeRate * 100).toFixed(2)}%` : '—'}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={[{ label: rollOk ? `Fiserv clearing rolls forward for ${periodLabel(month)}` : 'Fiserv clearing does not roll forward', ok: rollOk, detail: <>opening <Money c={open1120} dollar /> + cards − Mudflap − deposits = <Money c={close1120} dollar /></> }]} />
          <div className="panel-head" style={{ borderTop: '1px solid var(--rule)' }}><h2>Recent MER BNKCD bank lines</h2></div>
          <ul className="cards">{bankLines.map((b) => <li key={b.id}><Link to="/bank?tab=lines"><span className="c-desc">{b.description}</span><span className="c-amt"><Money c={b.amount} /></span><span className="c-meta">{shortDate(b.date)}</span></Link></li>)}</ul>
        </section>
      </div>
      {toast}
      <Help k="fuelTruck" />
    </>
  );
}
