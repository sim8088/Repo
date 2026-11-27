import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { Pill, Tabs, downloadText, useParam, userName } from '../components/glkit';
import {
  CAUSE_LABEL, FILE_CONNECTOR, PAYLOAD_LABEL, acceptSuggestions, buildPayloads, commitPull, connectionStatus, differencesReport, importQboTb, journalCsv, mappingStatus,
  parseQboAccountList, loadQboLists, payloadBalances, previewPull, pushBlock, pushPeriod, qboAlerts, qboOf, qboTb, saveConnection, setMapping,
  type MapKind, type ParsedQboTb, type ParsedQboTxn, type PayloadStatus,
} from '../../core/qbo';
import { ValidationError } from '../../core/books';
import { can } from '../../core/permissions';
import { formatMoney } from '../../core/money';
import { addDays, periodLabel, periodOf, periodsBetween, shortDate, todayInChicago } from '../../core/dates';
import { DEMO_START } from '../../data/seed';
import type { ID, QboLogKind } from '../../core/types';

const errText = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const STATUS_TONE: Record<PayloadStatus, 'ok' | 'warn' | 'bad' | undefined> = { pushed: 'ok', ready: undefined, changed: 'warn', blocked: 'bad' };
const STATUS_LABEL: Record<PayloadStatus, string> = { pushed: 'Pushed', ready: 'Ready', changed: 'Changed since push', blocked: 'Held: mapping' };

function useGate(title: string) {
  const { user, visible } = useBooks();
  if (!can(user, 'view.reports') || !visible.has('st_corp')) return <PageHead title={title} lede="Your role doesn't include the QuickBooks sync. Ask the CFO for access." />;
  return null;
}
const months = () => periodsBetween(DEMO_START.slice(0, 7), periodOf(todayInChicago())).reverse();
const lastMonth = () => periodOf(addDays(`${periodOf(todayInChicago())}-01`, -1));

function EntitySelect({ id, value, onChange }: { id: string; value: ID; onChange: (v: ID) => void }) {
  const { state } = useBooks();
  return <div className="field"><label htmlFor={id}>Entity</label><select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{state.entities.filter((e) => !e.deleted).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></div>;
}
function MonthSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return <div className="field"><label htmlFor={id}>Month</label><select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{months().map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>;
}

// ── Sync status ──────────────────────────────────────────────────────────
export function QboStatusPage() {
  const { state, books, user, allLines, version } = useBooks();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [edit, setEdit] = useState<{ entityId: ID; companyName: string; closedThrough: string } | null>(null);
  const gate = useGate('QuickBooks sync status');
  const conns = connectionStatus(state);
  const q = qboOf(state);
  const ms = useMemo(() => mappingStatus(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = useMemo(() => qboAlerts(state, allLines), [state, allLines]);
  const ready = useMemo(() => state.entities.reduce((a, e) => a + buildPayloads(state, e.id, { lines: allLines }).filter((p) => p.status === 'ready' || p.status === 'changed').length, 0), [state, allLines]);
  const logged = new Set(q.log.filter((l) => l.kind === 'push').flatMap((l) => (l.items ?? []).map((i) => i.qboId)));
  const pushTie = q.pushes.every((p) => logged.has(p.qboId));
  if (gate) return gate;
  return (
    <>
      <PageHead eyebrow="QuickBooks" title="Sync status" lede="Two-way with each entity's QuickBooks Online company. The live connection (OAuth) needs the hosted back end; until then the file connector moves everything by CSV, with the same mapping, de-duplication and sync log." />
      <section className="figures" aria-label="Sync" style={{ marginBottom: 20 }}>
        <Figure label="Live connections" value={`0 of ${conns.length}`} note="Needs the hosted back end" />
        <Figure label="Unmapped accounts" value={ms.unmappedAccounts.length} note={ms.unmappedAccounts.map((a) => a.number).join(', ') || 'Everything mapped'} href="/qbo/mapping?show=unmapped" />
        <Figure label="Entries pushed" value={q.pushes.length} note={`${ready} ready or changed`} href="/qbo/sync" />
        <Figure label="Differences over $5" value={alerts.reduce((a, x) => a + x.over.length, 0)} note={alerts.map((x) => `${state.entities.find((e) => e.id === x.entityId)?.code} ${x.period}`).join(', ') || 'None'} href={alerts[0] ? `/qbo/differences?entity=${alerts[0].entityId}&period=${alerts[0].period}` : '/qbo/differences'} />
      </section>
      <Errors errors={errors} />
      <section className="panel" aria-labelledby="qs-h">
        <div className="panel-head"><h2 id="qs-h">Connections</h2></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Entity</th><th scope="col">QBO company</th><th scope="col">Status</th><th scope="col">Connector</th><th scope="col">QBO closed through</th><th scope="col">Last push</th><th scope="col">Last QBO TB</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>
              {conns.map((c) => {
                const last = [...q.pushes].filter((p) => p.entityId === c.entity.id).sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))[0];
                const tb = [...q.trialBalances].filter((t) => t.entityId === c.entity.id && !t.superseded).sort((a, b) => b.period.localeCompare(a.period))[0];
                return (
                  <tr key={c.entity.id}>
                    <td><b>{c.entity.code}</b> <span className="muted small">{c.entity.name}</span></td>
                    <td>{c.conn.companyName ?? <span className="muted">not set</span>}</td>
                    <td><Pill tone="warn">{c.label}</Pill></td>
                    <td className="small">{FILE_CONNECTOR.label}</td>
                    <td>{c.conn.closedThrough ? shortDate(c.conn.closedThrough) : ''}</td>
                    <td className="small">{last ? `${last.period} · ${last.pushedAt.slice(0, 10)}` : ''}</td>
                    <td className="small">{tb ? <Link to={`/qbo/differences?entity=${c.entity.id}&period=${tb.period}`}>{tb.period}</Link> : ''}</td>
                    <td>{can(user, 'qbo.sync') && <button className="btn sm ghost" aria-label={`Edit ${c.entity.code} connection`} onClick={() => setEdit({ entityId: c.entity.id, companyName: c.conn.companyName ?? '', closedThrough: c.conn.closedThrough ?? '' })}>Edit</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {edit && (
          <div className="panel-pad">
            <div className="form-grid">
              <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="qs-co">QBO company name</label><input id="qs-co" value={edit.companyName} onChange={(e) => setEdit({ ...edit, companyName: e.target.value })} /></div>
              <div className="field"><label htmlFor="qs-cl">QBO closing date</label><input id="qs-cl" type="date" value={edit.closedThrough} onChange={(e) => setEdit({ ...edit, closedThrough: e.target.value })} /></div>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => { setErrors([]); try { saveConnection(books, user, edit.entityId, { companyName: edit.companyName.trim() || undefined, closedThrough: edit.closedThrough || undefined }); setEdit(null); say('Connection saved.'); } catch (e) { setErrors(errText(e)); } }}>Save connection</button>
              <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        )}
        <TieOut items={[{ label: pushTie ? 'Every pushed entry is in the sync log with its QBO id' : 'A pushed entry is missing from the log', ok: pushTie }]} />
      </section>
      <section className="panel panel-pad" aria-labelledby="qs-how" style={{ marginTop: 16 }}>
        <h2 id="qs-how" style={{ marginTop: 0 }}>Connecting for real, and working by file until then</h2>
        <ol className="small">
          <li><b>Live connection:</b> needs the hosted back end: an Intuit developer app (client id and secret kept on the server), OAuth sign-in per entity's QBO company, token refresh, and webhooks. Browsers can't hold those secrets, so the API connector stays off. The sync model here is the same one it will use.</li>
          <li><b>Map</b> accounts, stores (classes) and vendors on the Mapping screen. Suggestions come from the names; anything unmapped holds its entries back.</li>
          <li><b>Pull</b> from QBO: export the Transaction List by Date (checks, expenses, bills, bill payments) as CSV and import it. Duplicates of portal entries (same date, amount and payee) are skipped; the rest post with the batch id.</li>
          <li><b>Push</b> approved journal entries and the monthly summaries (sales, fuel COGS, card fees, payroll): download the journal CSV and import it in QBO (Settings › Import data › Journal entries). Each entry gets its QBO id in the sync log. Locked months and QBO's closing date refuse.</li>
          <li><b>Prove it:</b> import QBO's Trial Balance as CSV each month; the Differences report lines it up with the portal and explains each difference.</li>
        </ol>
      </section>
      {toast}
      <Help k="qboStatus" />
    </>
  );
}

// ── Mapping ──────────────────────────────────────────────────────────────
export function QboMappingPage() {
  const { state, books, user, version } = useBooks();
  const [toast, say] = useToast();
  const [tab, setTab] = useParam('tab', 'accounts');
  const [show, setShow] = useParam('show', '');
  const [errors, setErrors] = useState<string[]>([]);
  const [listText, setListText] = useState('');
  const gate = useGate('QuickBooks mapping');
  const ms = useMemo(() => mappingStatus(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = qboOf(state);
  if (gate) return gate;
  const kind = tab as MapKind;
  const rows = (kind === 'accounts' ? ms.accounts.map((r) => ({ id: r.item.id, label: `${r.item.number} · ${r.item.name}`, mapped: r.mapped, suggestion: r.suggestion }))
    : kind === 'classes' ? ms.classes.map((r) => ({ id: r.item.id, label: `${r.item.code} · ${r.item.name}`, mapped: r.mapped, suggestion: r.suggestion }))
      : ms.parties.map((r) => ({ id: r.item.id, label: `${r.item.name} (${r.item.kind})`, mapped: r.mapped, suggestion: r.suggestion })));
  const shown = show === 'unmapped' ? rows.filter((r) => !r.mapped) : rows;
  const options = kind === 'accounts' ? q.lists.accounts.map((a) => a.name) : kind === 'classes' ? q.lists.classes : [...q.lists.vendors, ...q.lists.customers];
  const sugg = rows.filter((r) => !r.mapped && r.suggestion).length;
  const canEdit = can(user, 'qbo.sync');
  const run = (fn: () => string) => { setErrors([]); try { say(fn()); } catch (e) { setErrors(errText(e)); } };
  const allInList = rows.every((r) => !r.mapped || !options.length || options.includes(r.mapped));
  return (
    <>
      <PageHead eyebrow="QuickBooks" title="Mapping" lede="Portal accounts, stores and vendors against their QuickBooks names. Suggestions match by account number, then by name; nothing maps itself without you.">
        <ExportButtons name={`qbo-mapping-${kind}`} sheet={`Mapping ${kind}`} header={['Portal', 'QBO', 'Suggested', 'Score']} rows={shown.map((r) => [r.label, r.mapped ?? '', r.suggestion?.name ?? '', r.suggestion ? r.suggestion.score.toFixed(2) : ''])} print={false} />
      </PageHead>
      <section className="figures" aria-label="Mapping" style={{ marginBottom: 20 }}>
        <Figure label="Accounts mapped" value={`${ms.accounts.length - ms.unmappedAccounts.length} of ${ms.accounts.length}`} note={ms.unmappedAccounts.length ? `Unmapped: ${ms.unmappedAccounts.map((a) => a.number).join(', ')}` : 'All mapped'} href="/qbo/mapping?tab=accounts&show=unmapped" />
        <Figure label="Stores → classes" value={`${ms.classes.length - ms.unmappedClasses} of ${ms.classes.length}`} href="/qbo/mapping?tab=classes" />
        <Figure label="Vendors & customers" value={`${ms.parties.length - ms.unmappedParties} of ${ms.parties.length}`} href="/qbo/mapping?tab=parties" />
        <Figure label="QBO lists" value={q.lists.accounts.length} note={`accounts · ${q.lists.classes.length} classes · ${q.lists.vendors.length + q.lists.customers.length} names`} />
      </section>
      <Tabs label="Mapping" value={kind} onChange={(v) => setTab(v)} options={[{ v: 'accounts', label: 'Accounts' }, { v: 'classes', label: 'Classes' }, { v: 'parties', label: 'Vendors' }]} />
      <Errors errors={errors} />
      <section className="panel" aria-labelledby="qm-h">
        <div className="panel-head"><h2 id="qm-h">{kind === 'accounts' ? 'Chart of accounts ↔ QBO accounts' : kind === 'classes' ? 'Stores ↔ QBO classes / locations' : 'Vendors and parties ↔ QBO vendors / customers'}</h2>
          {canEdit && <button className="btn sm" disabled={!sugg} onClick={() => run(() => `Mapped ${acceptSuggestions(books, user, kind)}.`)}>Accept {sugg} suggestion{sugg === 1 ? '' : 's'}</button>}
        </div>
        <div className="filters"><label className="check"><input type="checkbox" checked={show === 'unmapped'} onChange={(e) => setShow(e.target.checked ? 'unmapped' : '')} /> Unmapped only</label></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Portal</th><th scope="col">QBO</th><th scope="col">Suggestion</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{canEdit ? <select aria-label={`QBO name for ${r.label}`} value={r.mapped ?? ''} onChange={(e) => run(() => { setMapping(books, user, kind, r.id, e.target.value || null); return e.target.value ? `Mapped to ${e.target.value}.` : 'Mapping removed.'; })} style={{ maxWidth: 260 }}><option value="">Not mapped</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select> : r.mapped ?? ''}</td>
                  <td className="small">{r.suggestion ? <>{r.suggestion.name} <span className="muted">({Math.round(r.suggestion.score * 100)}%)</span> {canEdit && <button className="btn sm ghost" aria-label={`Use ${r.suggestion.name} for ${r.label}`} onClick={() => run(() => { setMapping(books, user, kind, r.id, r.suggestion!.name); return `Mapped to ${r.suggestion!.name}.`; })}>Use</button>}</> : ''}</td>
                  <td>{r.mapped ? <Pill tone="ok">Mapped</Pill> : <Pill tone="bad">Unmapped</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TieOut items={[{ label: allInList ? 'Every mapped name is in the QBO list' : 'A mapped name is no longer in the QBO list', ok: allInList }]} />
      </section>
      {canEdit && kind === 'accounts' && (
        <section className="panel panel-pad" aria-labelledby="qm-load" style={{ marginTop: 16 }}>
          <h2 id="qm-load" style={{ marginTop: 0 }}>Load QBO's account list</h2>
          <p className="small muted">Export Reports › Account List as CSV from QBO and paste it or choose the file. It replaces the account list the suggestions use.</p>
          <div className="field"><label htmlFor="qm-text">Account list CSV</label><textarea id="qm-text" value={listText} onChange={(e) => setListText(e.target.value)} placeholder={'Account,Type\nTrustmark Operating,Bank'} /></div>
          <div className="actions" style={{ marginTop: 10 }}>
            <label className="btn">Choose file<input type="file" accept=".csv,.txt" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setListText(await f.text()); }} /></label>
            <button className="btn primary" disabled={!listText.trim()} onClick={() => run(() => { const accts = parseQboAccountList(listText); if (!accts.length) throw new ValidationError(['No accounts found: the CSV needs Account and Type columns.']); loadQboLists(books, user, { accounts: accts }, 'the QBO account list'); setListText(''); return `Loaded ${accts.length} QBO accounts.`; })}>Load list</button>
          </div>
        </section>
      )}
      {toast}
      <Help k="qboMapping" />
    </>
  );
}

// ── Pull / push ──────────────────────────────────────────────────────────
export function QboSyncPage() {
  const { state, books, user, allLines } = useBooks();
  const [toast, say] = useToast();
  const [tab, setTab] = useParam('tab', 'push');
  const [entityId, setEntity] = useParam('entity', 'ent_corp');
  const [period, setPeriod] = useParam('period', lastMonth());
  const [errors, setErrors] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('pasted.csv');
  const gate = useGate('QuickBooks pull & push');
  const payloads = useMemo(() => buildPayloads(state, entityId, { periods: [period], lines: allLines }), [state, entityId, period, allLines]);
  const parsedPull = useMemo<{ rows: ParsedQboTxn[]; problems: string[] } | null>(() => (tab === 'pull' && text.trim() ? FILE_CONNECTOR.parseTransactions(text) : null), [tab, text]);
  const pullPreview = useMemo(() => (parsedPull?.rows.length ? previewPull(state, entityId, parsedPull.rows) : null), [state, entityId, parsedPull]);
  const parsedTb = useMemo<ParsedQboTb | null>(() => (tab === 'tb' && text.trim() ? FILE_CONNECTOR.parseTrialBalance(text) : null), [tab, text]);
  const block = pushBlock(state, entityId, period);
  const go = payloads.filter((p) => p.status === 'ready' || p.status === 'changed');
  const canSync = can(user, 'qbo.sync');
  const code = state.entities.find((e) => e.id === entityId)?.code ?? '';
  const run = (fn: () => string) => { setErrors([]); try { say(fn()); } catch (e) { setErrors(errText(e)); } };
  if (gate) return gate;
  const fileInput = (accept = '.csv,.txt') => <label className="btn">Choose file<input type="file" accept={accept} className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setFileName(f.name); setText(await f.text()); } }} /></label>;
  return (
    <>
      <PageHead eyebrow="QuickBooks" title="Pull & push" lede="By file until the live connection ships: pull QBO exports in, push the portal's approved entries and monthly summaries out as a journal CSV QBO imports." />
      <section className="figures" aria-label="Sync" style={{ marginBottom: 20 }}>
        <Figure label={`Ready for ${code} ${period}`} value={go.length} note={<Money c={go.reduce((a, p) => a + p.total, 0)} dollar />} />
        <Figure label="Pushed" value={payloads.filter((p) => p.status === 'pushed').length} />
        <Figure label="Held for mapping" value={payloads.filter((p) => p.status === 'blocked').length} href="/qbo/mapping?show=unmapped" />
        <Figure label="Rows pulled" value={qboOf(state).pulled.length} note={`${qboOf(state).pulled.filter((p) => p.status === 'duplicate').length} were duplicates`} />
      </section>
      <Tabs label="Direction" value={tab as 'push' | 'pull' | 'tb'} onChange={(v) => { setTab(v); setText(''); }} options={[{ v: 'push', label: 'Push' }, { v: 'pull', label: 'Pull' }, { v: 'tb', label: 'QBO trial balance' }]} />
      <Errors errors={errors} />
      <div className="filters" style={{ padding: 0, marginBottom: 12 }}>
        <EntitySelect id="qy-ent" value={entityId} onChange={setEntity} />
        {tab !== 'pull' && <MonthSelect id="qy-month" value={period} onChange={setPeriod} />}
      </div>
      {tab === 'push' && (
        <section className="panel" aria-labelledby="push-h">
          <div className="panel-head"><h2 id="push-h">Entries for {code} · {periodLabel(period)}</h2>
            <span className="actions">
              {canSync && <button className="btn sm" disabled={!payloads.length} onClick={() => downloadText(`qbo-journal-${code}-${period}-preview.csv`, journalCsv(state, payloads))}>Download CSV (preview)</button>}
              {canSync && <button className="btn sm primary" disabled={!go.length || !!block} onClick={() => run(() => { const r = pushPeriod(books, user, entityId, period); downloadText(`qbo-journal-${code}-${period}.csv`, r.csv); return `Pushed ${r.pushed.length}; the journal CSV downloaded for QBO.${r.blocked.length ? ` ${r.blocked.length} held for mapping.` : ''}`; })}>Push {go.length} and download CSV</button>}
            </span>
          </div>
          {block && <p className="panel-pad note warn" style={{ margin: 16 }}>{block}</p>}
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th scope="col">Journal no.</th><th scope="col">What</th><th scope="col">Date</th><th scope="col" className="num">Total</th><th scope="col" className="num">Lines</th><th scope="col">Status</th><th scope="col">QBO id</th></tr></thead>
              <tbody>
                {payloads.length === 0 && <tr><td colSpan={7} className="muted">Nothing for this entity and month.</td></tr>}
                {payloads.map((p) => (
                  <tr key={p.key}>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.jeId ? <Link to={`/books/journals/${p.jeId}`}>{p.docNumber}</Link> : p.docNumber}</td>
                    <td className="small">{PAYLOAD_LABEL[p.kind]}{p.errors.length > 0 && <div className="neg">{p.errors.join(' ')}</div>}{p.warnings.length > 0 && <div className="muted">{p.warnings.join(' ')}</div>}</td>
                    <td>{shortDate(p.date)}</td>
                    <td className="num"><Money c={p.total} /></td>
                    <td className="num">{p.lines.length}</td>
                    <td><Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill></td>
                    <td className="small">{p.push?.qboId ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TieOut items={[
            { label: payloads.every(payloadBalances) ? 'Every entry balances on its own' : 'An entry doesn\'t balance', ok: payloads.every(payloadBalances) },
            { label: block ? 'Month closed to pushes' : 'Month open for pushes', ok: !block },
          ]} />
        </section>
      )}
      {tab === 'pull' && (
        <section className="panel panel-pad" aria-labelledby="pull-h">
          <h2 id="pull-h" style={{ marginTop: 0 }}>Pull a QBO export</h2>
          <p className="small muted">QBO › Reports › Transaction List by Date (checks, expenses, bills, bill payments), exported as CSV. Columns: Date, Transaction Type, Num, Name, Memo/Description, Account, Split, Amount.</p>
          <div className="field"><label htmlFor="pull-text">QBO export</label><textarea id="pull-text" rows={6} value={text} onChange={(e) => { setText(e.target.value); setFileName('pasted.csv'); }} /></div>
          <div className="actions" style={{ marginTop: 10 }}>{fileInput()}</div>
          {parsedPull?.problems.length ? <ul className="small neg">{parsedPull.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
          {pullPreview && (
            <>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="t">
                  <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Account</th><th scope="col" className="num">Amount</th><th scope="col">Result</th></tr></thead>
                  <tbody>{pullPreview.rows.map((r) => (
                    <tr key={r.hash}><td>{r.date}</td><td>{r.type} {r.num}</td><td>{r.name}</td><td className="small">{r.account}{r.split ? ` / ${r.split}` : ''}</td><td className="num"><Money c={r.amount} /></td>
                      <td className="small"><Pill tone={r.status === 'new' ? 'ok' : r.status === 'held' ? 'bad' : undefined}>{r.status === 'already' ? 'Already pulled' : r.status === 'duplicate' ? 'Duplicate' : r.status === 'new' ? 'Will post' : 'Held'}</Pill> {r.txnId && <Link to={`/books/transactions/${r.txnId}`}>{state.transactions.find((t) => t.id === r.txnId)?.ref}</Link>} {r.reason && r.status === 'held' ? r.reason : ''}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <TieOut items={[
                { label: `${pullPreview.rows.length} rows: ${pullPreview.counts.new} new, ${pullPreview.counts.duplicate} duplicates, ${pullPreview.counts.held} held, ${pullPreview.counts.already} already pulled`, ok: pullPreview.counts.new + pullPreview.counts.duplicate + pullPreview.counts.held + pullPreview.counts.already === pullPreview.rows.length },
                { label: 'File totals', ok: true, detail: <>in <Money c={pullPreview.totalIn} dollar /> · out <Money c={pullPreview.totalOut} dollar /></> },
              ]} />
              {canSync && <div className="actions" style={{ marginTop: 10 }}><button className="btn primary" disabled={!pullPreview.rows.some((r) => r.status !== 'already')} onClick={() => run(() => { const r = commitPull(books, user, entityId, { name: fileName, rows: parsedPull!.rows }); setText(''); return `Pulled: ${r.posted.length} posted, ${r.preview.counts.duplicate} duplicates skipped (batch ${r.batchId}).`; })}>Pull {pullPreview.rows.filter((r) => r.status !== 'already').length} rows</button></div>}
            </>
          )}
        </section>
      )}
      {tab === 'tb' && (
        <section className="panel panel-pad" aria-labelledby="tb-h">
          <h2 id="tb-h" style={{ marginTop: 0 }}>Import QBO's trial balance</h2>
          <p className="small muted">QBO › Reports › Trial Balance, as of the month end, exported as CSV. Re-importing the same file changes nothing; a new version replaces the old one.{qboTb(state, entityId, period) ? ` One is on file for ${code} ${period}.` : ''}</p>
          <div className="field"><label htmlFor="tb-text">QBO trial balance</label><textarea id="tb-text" rows={6} value={text} onChange={(e) => { setText(e.target.value); setFileName('pasted.csv'); }} /></div>
          <div className="actions" style={{ marginTop: 10 }}>{fileInput()}<Link className="btn" to={`/qbo/differences?entity=${entityId}&period=${period}`}>Differences report</Link></div>
          {parsedTb && (
            <>
              {parsedTb.problems.length > 0 && <ul className="small neg">{parsedTb.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
              <TieOut items={[
                { label: `${parsedTb.rows.length} accounts${parsedTb.asOf ? ` as of ${parsedTb.asOf}` : ''}`, ok: parsedTb.rows.length > 0 },
                { label: parsedTb.totalDebit === parsedTb.totalCredit ? 'Debits equal credits' : 'Doesn\'t balance', ok: parsedTb.totalDebit === parsedTb.totalCredit, detail: <Money c={parsedTb.totalDebit} dollar /> },
                ...(parsedTb.reported ? [{ label: parsedTb.reported.debit === parsedTb.totalDebit ? 'Rows add to the TOTAL line' : 'Rows don\'t add to TOTAL', ok: parsedTb.reported.debit === parsedTb.totalDebit && parsedTb.reported.credit === parsedTb.totalCredit }] : []),
              ]} />
              {canSync && <div className="actions" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => run(() => { const r = importQboTb(books, user, { entityId, period, fileName, parsed: parsedTb }); setText(''); return r.added ? `Imported the QBO trial balance for ${code} ${period}.` : 'Already imported: nothing changed.'; })}>Import trial balance</button></div>}
            </>
          )}
        </section>
      )}
      {toast}
      <Help k="qboSync" />
    </>
  );
}

// ── Differences ──────────────────────────────────────────────────────────
export function QboDifferencesPage() {
  const { state, allLines } = useBooks();
  const latest = [...qboOf(state).trialBalances].filter((t) => !t.superseded).sort((a, b) => b.period.localeCompare(a.period))[0];
  const [entityId, setEntity] = useParam('entity', latest?.entityId ?? 'ent_corp');
  const [period, setPeriod] = useParam('period', latest?.period ?? lastMonth());
  const [all, setAll] = useParam('all', '');
  const gate = useGate('QBO differences');
  const d = useMemo(() => differencesReport(state, entityId, period, { lines: allLines }), [state, entityId, period, allLines]);
  if (gate) return gate;
  const code = state.entities.find((e) => e.id === entityId)?.code ?? '';
  const rows = all ? d.rows : d.differences;
  const netDiff = d.differences.reduce((a, r) => a + r.difference, 0);
  return (
    <>
      <PageHead eyebrow="QuickBooks" title="Differences report" lede={`The portal's trial balance for ${code} at ${shortDate(d.asOf)} against QBO's, by QBO account, with the likely cause of each difference.`}>
        <ExportButtons name={`qbo-differences-${code}-${period}`} sheet={`Differences ${code} ${period}`} header={['QBO account', 'Portal', 'QBO', 'Difference', 'Over $5', 'Cause', 'Explanation']} rows={rows.map((r) => [r.label, csvMoney(r.portal), csvMoney(r.qbo), csvMoney(r.difference), r.over ? 'yes' : '', r.cause ? CAUSE_LABEL[r.cause] : '', r.explanation])} />
      </PageHead>
      <section className="figures" aria-label="Differences" style={{ marginBottom: 20 }}>
        <Figure label="QBO trial balance" value={d.tb ? shortDate(d.tb.asOf) : 'Not imported'} note={d.tb ? `${d.tb.fileName} · ${d.tb.importedAt.slice(0, 10)}` : 'Import it on Pull & push'} href={d.tb ? undefined : `/qbo/sync?tab=tb&entity=${entityId}&period=${period}`} />
        <Figure label="Differences" value={d.differences.length} note={`${d.rows.length} accounts compared`} />
        <Figure label="Over $5" value={d.over.length} note={d.over.length ? 'Alert: fix before close' : 'Nothing material'} />
        <Figure label="Explained" value={`${d.differences.filter((r) => r.cause && r.cause !== 'unexplained').length} of ${d.differences.length}`} />
      </section>
      <section className="panel" aria-labelledby="qd-h">
        <div className="panel-head"><h2 id="qd-h">{code} · {periodLabel(period)}</h2></div>
        <div className="filters">
          <EntitySelect id="qd-ent" value={entityId} onChange={setEntity} />
          <MonthSelect id="qd-month" value={period} onChange={setPeriod} />
          <label className="check"><input type="checkbox" checked={!!all} onChange={(e) => setAll(e.target.checked ? '1' : '')} /> Show accounts that agree</label>
        </div>
        {!d.tb ? <p className="panel-pad muted">No QBO trial balance imported for {code} {period}. <Link to={`/qbo/sync?tab=tb&entity=${entityId}&period=${period}`}>Import it</Link>.</p> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th scope="col">QBO account</th><th scope="col" className="num">Portal</th><th scope="col" className="num">QBO</th><th scope="col" className="num">Difference</th><th scope="col">Likely cause</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="muted">The portal and QBO agree on every account.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.accountIds.length ? <Link to={`/books/accounts/${r.accountIds[0]}?from=${period}-01&to=${d.asOf}&entity=${entityId}`}>{r.label}</Link> : r.label}</td>
                    <td className="num"><Money c={r.portal} /></td>
                    <td className="num"><Money c={r.qbo} /></td>
                    <td className="num">{r.difference ? <Money c={r.difference} className={r.over ? 'neg' : undefined} /> : ''}</td>
                    <td className="small">{r.cause && <Pill tone={r.cause === 'unexplained' ? 'bad' : 'warn'}>{CAUSE_LABEL[r.cause]}</Pill>} {r.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.tb && (
          <TieOut items={[
            { label: d.portalTotal.debit === d.portalTotal.credit ? 'Portal trial balance balances' : 'Portal TB out of balance', ok: d.portalTotal.debit === d.portalTotal.credit },
            { label: d.qboTotal.debit === d.qboTotal.credit ? 'QBO trial balance balances' : 'QBO TB out of balance', ok: d.qboTotal.debit === d.qboTotal.credit },
            { label: netDiff === 0 ? 'Differences net to zero across accounts' : 'Differences don\'t net to zero', ok: netDiff === 0 },
            { label: d.over.length ? `${d.over.length} difference${d.over.length === 1 ? '' : 's'} over ${formatMoney(state.settings.materialityCents, { dollarSign: true })}` : `No difference over ${formatMoney(state.settings.materialityCents, { dollarSign: true })}`, ok: d.over.length === 0 },
            { label: d.allExplained ? 'Every difference has a cause' : 'Some differences aren\'t explained', ok: d.allExplained },
          ]} />
        )}
      </section>
      {d.tb && d.differences.length > 0 && (
        <section className="panel" aria-labelledby="qd-cause" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2 id="qd-cause">By cause</h2></div>
          <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Cause</th><th scope="col" className="num">Accounts</th><th scope="col" className="num">Net</th><th scope="col">Fix</th></tr></thead>
            <tbody>{(Object.keys(d.byCause) as (keyof typeof d.byCause)[]).filter((k) => d.byCause[k].count).map((k) => (
              <tr key={k}><td>{CAUSE_LABEL[k]}</td><td className="num">{d.byCause[k].count}</td><td className="num"><Money c={d.byCause[k].amount} /></td>
                <td className="small">{k === 'unmapped' ? <Link to="/qbo/mapping?show=unmapped">Map the account</Link> : k === 'not_pushed' ? <Link to={`/qbo/sync?entity=${entityId}&period=${period}`}>Push the month</Link> : k === 'timing' ? 'Agree the date with the CPA' : 'Compare the GL detail with QBO'}</td></tr>
            ))}</tbody></table></div>
        </section>
      )}
      <Help k="qboDifferences" />
    </>
  );
}

// ── Sync log ─────────────────────────────────────────────────────────────
const LOG_LABEL: Record<QboLogKind, string> = { pull: 'Pull', push: 'Push', tb_import: 'TB import', mapping: 'Mapping', connection: 'Connection', error: 'Error', fix: 'Fix' };

export function QboLogPage() {
  const { state } = useBooks();
  const [kind, setKind] = useParam('kind', '');
  const gate = useGate('QuickBooks sync log');
  if (gate) return gate;
  const q = qboOf(state);
  const log = [...q.log].filter((l) => !kind || l.kind === kind).sort((a, b) => b.at.localeCompare(a.at));
  const code = (id?: string) => state.entities.find((e) => e.id === id)?.code ?? '';
  const n = (k: QboLogKind) => q.log.filter((l) => l.kind === k).length;
  const items = q.log.filter((l) => l.kind === 'push').reduce((a, l) => a + (l.items?.length ?? 0), 0);
  const ids = new Set(q.log.filter((l) => l.kind === 'push').flatMap((l) => (l.items ?? []).map((i) => i.qboId)));
  const tie = q.pushes.every((p) => ids.has(p.qboId));
  return (
    <>
      <PageHead eyebrow="QuickBooks" title="Sync log" lede="What moved between the portal and QuickBooks, when, who did it and who approved it, with errors and how they were fixed.">
        <ExportButtons name="qbo-sync-log" sheet="Sync log" header={['When', 'Who', 'Kind', 'Entity', 'Month', 'What', 'QBO ids', 'Errors', 'Approved by', 'Batch']} rows={log.map((l) => [l.at.slice(0, 16).replace('T', ' '), userName(state.users, l.by), LOG_LABEL[l.kind], code(l.entityId), l.period ?? '', l.summary, (l.items ?? []).map((i) => `${i.ref}=${i.qboId ?? ''}`).join('; '), (l.errors ?? []).join('; '), userName(state.users, l.approvedBy), l.batchId ?? ''])} />
      </PageHead>
      <section className="figures" aria-label="Log" style={{ marginBottom: 20 }}>
        <Figure label="Pushes" value={n('push')} note={`${items} entries sent`} href="/qbo/log?kind=push" />
        <Figure label="Pulls" value={n('pull')} href="/qbo/log?kind=pull" />
        <Figure label="QBO TB imports" value={n('tb_import')} href="/qbo/log?kind=tb_import" />
        <Figure label="Errors" value={n('error') + q.log.filter((l) => l.kind !== 'error' && l.errors?.length).length} href="/qbo/log?kind=error" />
      </section>
      <section className="panel" aria-labelledby="ql-h">
        <div className="panel-head"><h2 id="ql-h">Log</h2><span className="muted small">{log.length} entries</span></div>
        <div className="filters"><div className="field"><label htmlFor="ql-kind">Kind</label><select id="ql-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option>{(Object.keys(LOG_LABEL) as QboLogKind[]).map((k) => <option key={k} value={k}>{LOG_LABEL[k]}</option>)}</select></div></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Kind</th><th scope="col">What</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {log.length === 0 && <tr><td colSpan={5} className="muted">Nothing logged.</td></tr>}
              {log.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: 'nowrap' }} className="small">{l.at.slice(0, 16).replace('T', ' ')}</td>
                  <td className="small">{userName(state.users, l.by)}</td>
                  <td><Pill tone={l.kind === 'error' ? 'bad' : l.errors?.length ? 'warn' : undefined}>{LOG_LABEL[l.kind]}</Pill></td>
                  <td>{l.summary}{l.approvedBy && <span className="muted small"> · approved by {userName(state.users, l.approvedBy)}</span>}</td>
                  <td className="small">{l.items?.length ? <details><summary>{l.items.length} item{l.items.length === 1 ? '' : 's'}</summary>{l.items.map((i) => <div key={i.ref + (i.qboId ?? '')}>{i.ref}{i.qboId ? ` → ${i.qboId}` : ''}{i.detail ? ` · ${i.detail}` : ''}</div>)}</details> : ''}{l.errors?.map((e) => <div key={e} className="neg">{e}</div>)}{l.fix && <div className="pos">Fix: {l.fix}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TieOut items={[{ label: tie ? 'Every pushed entry appears in the log with its QBO id' : 'A pushed entry is missing from the log', ok: tie, detail: `${q.pushes.length} entries on record` }]} />
      </section>
      <Help k="qboLog" />
    </>
  );
}
