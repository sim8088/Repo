import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Errors, Figure, Help, Money, PageHead, PartyOptions, TieOut, csvMoney, useToast } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { Pill, Tabs, keepFile, openAttachment, useParam, userName } from '../components/glkit';
import {
  JE_STATUS_LABEL, JE_TEMPLATES, TEMPLATE_GROUP_LABEL, approvalLimit, approveJournal, corpStoreId, createJournal, fromTemplate, generateRecurring, getJournal, glOf, jeTotal, nextRecurringDate,
  postReversals, recurringDue, rejectJournal, reversalsDue, saveRecurring, setRecurringActive, template, type JeDraft, type TemplateGroup,
} from '../../core/journals';
import { ValidationError } from '../../core/books';
import { can } from '../../core/permissions';
import { canApproveKind } from '../../core/limits';
import { jeLimitKind } from '../../core/journals';
import { formatMoney, parseMoney } from '../../core/money';
import { periodOf, shortDate, todayInChicago } from '../../core/dates';
import type { Attachment, ID, JournalEntry } from '../../core/types';

type Tab = 'entries' | 'templates' | 'recurring' | 'reversing';
const errText = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const statusTone = (j: JournalEntry) => (j.status === 'posted' ? 'ok' : j.status === 'pending' ? 'warn' : 'bad');

export function JournalsPage() {
  const { state, books, user, visible, version } = useBooks();
  const [toast, say] = useToast();
  const [tab, setTab] = useParam('tab', 'entries');
  const [status, setStatus] = useParam('status', '');
  const [errors, setErrors] = useState<string[]>([]);
  const today = todayInChicago();
  const gl = useMemo(() => glOf(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = gl.entries.filter((j) => j.lines.some((l) => visible.has(l.storeId)));
  const list = [...mine].filter((j) => !status || j.status === status).sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref));
  const pending = mine.filter((j) => j.status === 'pending');
  const month = periodOf(today);
  const postedMonth = mine.filter((j) => j.status === 'posted' && periodOf(j.date) === month);
  const due = recurringDue(state, today, visible);
  const revDue = reversalsDue(state, today).filter((j) => j.lines.some((l) => visible.has(l.storeId)));
  const txn = (id?: ID) => (id ? state.transactions.find((t) => t.id === id) : undefined);
  const txnDebits = (id?: ID) => txn(id)?.lines.filter((l) => !l.system).reduce((a, l) => a + l.debit, 0) ?? 0;
  const postedTie = mine.filter((j) => j.status === 'posted').every((j) => txnDebits(j.txnId) === jeTotal(j.lines));
  const pendingTie = pending.every((j) => !j.txnId);
  const run = (fn: () => string) => { setErrors([]); try { say(fn()); } catch (e) { setErrors(errText(e)); } };
  const canPrep = can(user, 'journal.create');
  if (!can(user, 'view.reports')) return <PageHead title="Journal entries" lede="Your role doesn't include the general ledger. Ask the CFO for access." />;

  return (
    <>
      <PageHead eyebrow="Books" title="Journal entries" lede={`Manual entries with a required memo. Over ${formatMoney(approvalLimit(state), { dollarSign: true })} an entry waits for someone else to approve it before it posts.`}>
        {canPrep && <Link className="btn primary" to="/books/journals/new">New journal entry</Link>}
        <ExportButtons name={`journal-entries-${today}`} sheet="Journal entries" header={['Ref', 'Date', 'Description', 'Status', 'Adjusting', 'Amount', 'Reverses on', 'Prepared by', 'Approved by', 'Posted as']}
          rows={list.map((j) => [j.ref, j.date, j.description, JE_STATUS_LABEL[j.status], j.adjusting ? 'yes' : '', csvMoney(jeTotal(j.lines)), j.reverseOn ?? '', userName(state.users, j.preparedBy), userName(state.users, j.approved?.by), txn(j.txnId)?.ref ?? ''])} />
      </PageHead>
      <section className="figures" aria-label="Journal entries" style={{ marginBottom: 20 }}>
        <Figure label="Awaiting approval" value={pending.length} note={<Money c={pending.reduce((a, j) => a + jeTotal(j.lines), 0)} dollar />} href="/books/journals?status=pending" />
        <Figure label={`Posted in ${month}`} value={postedMonth.length} note={`${postedMonth.filter((j) => j.adjusting).length} adjusting`} />
        <Figure label="Recurring runs due" value={due.length} note={due[0] ? `${due[0].schedule.name} · ${due[0].date}` : 'Nothing due'} href="/books/journals?tab=recurring" />
        <Figure label="Reversals due" value={revDue.length} note={revDue.length ? 'Post them from the Reversing tab' : 'Every reversal is posted'} href="/books/journals?tab=reversing" />
      </section>
      <Tabs label="View" value={tab as Tab} onChange={(v) => setTab(v)} options={[{ v: 'entries', label: 'Entries' }, { v: 'templates', label: 'Templates' }, { v: 'recurring', label: 'Recurring' }, { v: 'reversing', label: 'Reversing' }]} />
      <Errors errors={errors} />
      {tab === 'entries' && (
        <section className="panel" aria-labelledby="je-h">
          <div className="panel-head"><h2 id="je-h">Entries</h2><span className="muted small">{list.length} shown</span></div>
          <div className="filters">
            <div className="field"><label htmlFor="je-status">Status</label><select id="je-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="pending">Awaiting approval</option><option value="posted">Posted</option><option value="rejected">Rejected</option></select></div>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th scope="col">Ref</th><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Status</th><th scope="col" className="num">Amount</th><th scope="col">Reverses</th><th scope="col">Prepared by</th><th scope="col">Posted as</th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={8} className="muted">No entries.</td></tr>}
                {list.map((j) => (
                  <tr key={j.id}>
                    <td><Link to={`/books/journals/${j.id}`}>{j.ref}</Link></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{shortDate(j.date)}</td>
                    <td className="trunc" title={j.memo}>{j.description}{j.adjusting && <> <Pill>adjusting</Pill></>}{j.recurring && <> <Pill>recurring</Pill></>}</td>
                    <td><Pill tone={statusTone(j)}>{JE_STATUS_LABEL[j.status]}</Pill></td>
                    <td className="num"><Money c={jeTotal(j.lines)} /></td>
                    <td>{j.reverseOn ? (j.reversal ? <Link to={`/books/transactions/${j.reversal.txnId}`}>{txn(j.reversal.txnId)?.ref}</Link> : shortDate(j.reverseOn)) : ''}</td>
                    <td>{userName(state.users, j.preparedBy)}</td>
                    <td>{j.txnId ? <Link to={`/books/transactions/${j.txnId}`}>{txn(j.txnId)?.ref}</Link> : <span className="muted">nothing posted</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TieOut items={[
            { label: postedTie ? 'Each posted entry agrees with its ledger transaction' : 'A posted entry disagrees with its transaction', ok: postedTie },
            { label: pendingTie ? 'Entries awaiting approval posted nothing' : 'A pending entry has a posting', ok: pendingTie },
          ]} />
        </section>
      )}
      {tab === 'templates' && <TemplatesPanel />}
      {tab === 'recurring' && <RecurringPanel onRun={run} />}
      {tab === 'reversing' && (
        <section className="panel" aria-labelledby="rev-h">
          <div className="panel-head"><h2 id="rev-h">Reversing entries</h2>
            {canPrep && <button className="btn sm primary" disabled={!revDue.length} onClick={() => run(() => { const r = postReversals(books, user, today); return `Posted ${r.posted.length} reversal${r.posted.length === 1 ? '' : 's'}.${r.skipped.length ? ' Skipped: ' + r.skipped.join(' ') : ''}`; })}>Post {revDue.length} reversal{revDue.length === 1 ? '' : 's'} due</button>}
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th scope="col">Entry</th><th scope="col">Dated</th><th scope="col">Reverses on</th><th scope="col" className="num">Amount</th><th scope="col">Reversal</th></tr></thead>
              <tbody>
                {mine.filter((j) => j.reverseOn && j.status !== 'rejected').map((j) => (
                  <tr key={j.id}>
                    <td><Link to={`/books/journals/${j.id}`}>{j.ref}</Link> <span className="muted">{j.description}</span></td>
                    <td>{shortDate(j.date)}</td>
                    <td>{shortDate(j.reverseOn!)}</td>
                    <td className="num"><Money c={jeTotal(j.lines)} /></td>
                    <td>{j.reversal ? <><Pill tone="ok">Posted</Pill> <Link to={`/books/transactions/${j.reversal.txnId}`}>{txn(j.reversal.txnId)?.ref}</Link></> : j.status === 'pending' ? <Pill tone="warn">After approval</Pill> : j.reverseOn! <= today ? <Pill tone="bad">Due</Pill> : <Pill>Scheduled</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TieOut items={[(() => { const ok = mine.filter((j) => j.reversal).every((j) => txnDebits(j.reversal!.txnId) === jeTotal(j.lines)); return { label: ok ? 'Every reversal mirrors its entry to the cent' : 'A reversal differs from its entry', ok }; })()]} />
        </section>
      )}
      {toast}
      <Help k="journals" />
    </>
  );
}

function TemplatesPanel() {
  const { state, user } = useBooks();
  const groups = [...new Set(JE_TEMPLATES.map((t) => t.group))] as TemplateGroup[];
  const acct = (id: ID) => state.accounts.find((a) => a.id === id);
  return (
    <section className="panel" aria-labelledby="tpl-h">
      <div className="panel-head"><h2 id="tpl-h">Templates</h2><span className="muted small">Accounts and sides are filled in: give amounts, stores and a date.</span></div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th scope="col">Template</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Flags</th><th scope="col"><span className="sr-only">Use</span></th></tr></thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g} className="section"><td colSpan={5}>{TEMPLATE_GROUP_LABEL[g]}</td></tr>,
              ...JE_TEMPLATES.filter((t) => t.group === g).map((t) => (
                <tr key={t.key} className="indent">
                  <td><b>{t.label}</b><div className="muted small">{t.detail}</div></td>
                  <td className="small">{t.lines.filter((l) => l.side === 'debit').map((l) => `${acct(l.accountId)?.number} ${acct(l.accountId)?.name}`).join('; ')}</td>
                  <td className="small">{t.lines.filter((l) => l.side === 'credit').map((l) => `${acct(l.accountId)?.number} ${acct(l.accountId)?.name}`).join('; ')}</td>
                  <td>{t.adjusting && <Pill>adjusting</Pill>} {t.autoReverse && <Pill>reverses</Pill>}</td>
                  <td>{can(user, 'journal.create') && <Link className="btn sm" to={`/books/journals/new?template=${t.key}`} aria-label={`Use ${t.label}`}>Use</Link>}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <TieOut items={[(() => { const ok = JE_TEMPLATES.every((t) => t.lines.every((l) => acct(l.accountId)?.active)); return { label: ok ? 'Every template account is in the chart and active' : 'A template account is missing or inactive', ok }; })()]} />
    </section>
  );
}

function RecurringPanel({ onRun }: { onRun: (fn: () => string) => void }) {
  const { state, books, user, stores, visible } = useBooks();
  const today = todayInChicago();
  const gl = glOf(state);
  const list = gl.recurring.filter((r) => r.lines.some((l) => visible.has(l.storeId)));
  const due = recurringDue(state, today, visible);
  const canPrep = can(user, 'journal.create');
  const [form, setForm] = useState({ template: 'accr_interest', store: stores.find((s) => s.kind === 'corporate')?.id ?? stores[0]?.id ?? '', amount: '', frequency: 'monthly', day: '28', start: periodOf(today), end: '', name: '' });
  const [errs, setErrs] = useState<string[]>([]);
  const t = template(form.template)!;
  const add = () => {
    setErrs([]);
    try {
      const amt = parseMoney(form.amount);
      if (!amt || amt <= 0) throw new ValidationError(['Enter the amount each run posts, like 850.00.']);
      const d = fromTemplate(state, t.key, { date: `${form.start}-01`, stores: [form.store], amounts: t.amounts.map((_, i) => (i === 0 ? amt : 0)) });
      saveRecurring(books, user, { name: form.name || t.label, description: t.description, memo: t.memo, templateKey: t.key, lines: d.lines, adjusting: t.adjusting, autoReverse: !!t.autoReverse, frequency: form.frequency as 'monthly', day: Number(form.day), start: form.start, end: form.end || undefined });
      setForm({ ...form, amount: '', name: '' });
    } catch (e) { setErrs(errText(e)); }
  };
  const generatedOk = list.every((r) => Object.values(r.generated).every((id) => gl.entries.some((j) => j.id === id)));
  return (
    <>
      <section className="panel" aria-labelledby="rec-h" style={{ marginBottom: 16 }}>
        <div className="panel-head"><h2 id="rec-h">Recurring entries</h2>
          {canPrep && <button className="btn sm primary" disabled={!due.length} onClick={() => onRun(() => { const r = generateRecurring(books, user, today, [...new Set(due.map((d) => d.schedule.id))]); return `Generated ${r.created.length} entr${r.created.length === 1 ? 'y' : 'ies'}.${r.errors.length ? ' ' + r.errors.join(' ') : ''}`; })}>Generate {due.length} due</button>}
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Schedule</th><th scope="col">Runs</th><th scope="col" className="num">Each run</th><th scope="col">Generated</th><th scope="col">Next</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={7} className="muted">No recurring entries yet.</td></tr>}
              {list.map((r) => {
                const d = due.filter((x) => x.schedule.id === r.id);
                return (
                  <tr key={r.id}>
                    <td><b>{r.name}</b><div className="muted small">{r.description}</div></td>
                    <td className="small">{r.frequency === 'monthly' ? 'Monthly' : 'Quarterly'} on day {r.day} · {r.start} to {r.end ?? 'open'}{r.autoReverse ? ' · reverses' : ''}</td>
                    <td className="num"><Money c={jeTotal(r.lines)} /></td>
                    <td className="small">{Object.entries(r.generated).map(([p, id]) => <Link key={p} to={`/books/journals/${id}`} style={{ marginRight: 6 }}>{p}</Link>)}</td>
                    <td>{d.length ? <Pill tone="bad">{d.length} due</Pill> : nextRecurringDate(r, today) ?? 'Ended'}</td>
                    <td>{r.active ? <Pill tone="ok">Active</Pill> : <Pill>Paused</Pill>}</td>
                    <td>{canPrep && <button className="btn sm ghost" onClick={() => onRun(() => { setRecurringActive(books, user, r.id, !r.active); return `${r.active ? 'Resumed' : 'Paused'} ${r.name}.`; })}>{r.active ? 'Pause' : 'Resume'}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TieOut items={[{ label: generatedOk ? 'Every generated run is in the journal, once per period' : 'A generated run is missing', ok: generatedOk }]} />
      </section>
      {canPrep && (
        <section className="panel panel-pad" aria-labelledby="rec-new-h">
          <h2 id="rec-new-h" style={{ marginTop: 0 }}>Set up a recurring entry</h2>
          <Errors errors={errs} />
          <div className="form-grid">
            <div className="field"><label htmlFor="r-tpl">Template</label><select id="r-tpl" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>{JE_TEMPLATES.filter((x) => x.amounts.length === 1).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
            <div className="field"><label htmlFor="r-name">Name</label><input id="r-name" value={form.name} placeholder={t.label} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="r-store">{t.stores[0]}</label><select id="r-store" value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <div className="field"><label htmlFor="r-amt">{t.amounts[0]}</label><input id="r-amt" className="num" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="field"><label htmlFor="r-freq">Frequency</label><select id="r-freq" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>
            <div className="field"><label htmlFor="r-day">Day of month</label><input id="r-day" inputMode="numeric" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} /></div>
            <div className="field"><label htmlFor="r-start">First month</label><input id="r-start" type="month" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
            <div className="field"><label htmlFor="r-end">Last month</label><input id="r-end" type="month" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={add}>Save schedule</button></div>
        </section>
      )}
    </>
  );
}

interface Row { key: number; accountId: ID; storeId: ID; debit: string; credit: string; memo: string }
let K = 1;
const toRows = (d: Pick<JeDraft, 'lines'>): Row[] => d.lines.map((l) => ({ key: K++, accountId: l.accountId, storeId: l.storeId, debit: l.debit ? (l.debit / 100).toFixed(2) : '', credit: l.credit ? (l.credit / 100).toFixed(2) : '', memo: l.memo ?? '' }));

export function JournalFormPage() {
  const { state, books, user, stores } = useBooks();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const defStore = stores.find((s) => s.kind === 'operating')?.id ?? stores[0]?.id ?? '';
  const corp = corpStoreId(state);
  const [tplKey, setTplKey] = useState(sp.get('template') ?? '');
  const tpl = template(tplKey);
  const [date, setDate] = useState(today);
  const [tStores, setTStores] = useState<ID[]>([defStore, defStore]);
  const [tAmounts, setTAmounts] = useState<string[]>(['', '']);
  const [partyId, setPartyId] = useState('');
  const initial = tpl ? fromTemplate(state, tpl.key, { date: today, stores: [defStore], amounts: tpl.amounts.map(() => 0) }) : null;
  const [description, setDescription] = useState(initial?.description ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [adjusting, setAdjusting] = useState(initial?.adjusting ?? false);
  const [reverseOn, setReverseOn] = useState(initial?.reverseOn ?? '');
  const [rows, setRows] = useState<Row[]>(() => (tpl ? tpl.lines.map((l) => ({ key: K++, accountId: l.accountId, storeId: l.corp ? corp : defStore, debit: '', credit: '', memo: '' })) : [{ key: K++, accountId: '', storeId: defStore, debit: '', credit: '', memo: '' }, { key: K++, accountId: '', storeId: defStore, debit: '', credit: '', memo: '' }]));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const cents = (s: string) => (s.trim() ? parseMoney(s) : 0);

  const refill = (key: string, x: { date?: string; stores?: ID[]; amounts?: string[]; party?: string }) => {
    const t = template(key);
    if (!t) return;
    const amounts = (x.amounts ?? tAmounts).map((a) => cents(a) ?? 0);
    try {
      const d = fromTemplate(state, key, { date: x.date ?? date, stores: x.stores ?? tStores, amounts, partyId: (x.party ?? partyId) || undefined });
      const filled = toRows(d);
      setRows(filled.length >= 2 ? filled : t.lines.map((l) => ({ key: K++, accountId: l.accountId, storeId: l.corp ? corp : (x.stores ?? tStores)[l.store ?? 0], debit: '', credit: '', memo: '' })));
      setDescription(d.description);
      setAdjusting(d.adjusting ?? false);
      setReverseOn(d.reverseOn ?? '');
      setErrors([]);
    } catch (e) { setErrors(errText(e)); }
  };
  const pickTemplate = (key: string) => {
    setTplKey(key);
    const t = template(key);
    if (!t) return;
    setMemo(t.memo);
    refill(key, {});
  };

  const draft: JeDraft = {
    date, description, memo, adjusting, reverseOn: reverseOn || undefined, templateKey: tpl?.key, partyId: partyId || undefined, attachments,
    lines: rows.filter((r) => r.accountId || r.debit || r.credit).map((r) => ({ accountId: r.accountId, storeId: r.storeId, debit: cents(r.debit) ?? NaN, credit: cents(r.credit) ?? NaN, memo: r.memo || undefined, partyId: partyId || undefined })),
  };
  const dr = draft.lines.reduce((a, l) => a + (Number.isFinite(l.debit) ? l.debit : 0), 0);
  const crT = draft.lines.reduce((a, l) => a + (Number.isFinite(l.credit) ? l.credit : 0), 0);
  const over = dr > approvalLimit(state);
  const entOf = (storeId: ID) => state.entities.find((e) => e.id === state.stores.find((s) => s.id === storeId)?.entityId)?.code ?? '';
  const save = () => {
    setErrors([]);
    try {
      const j = createJournal(books, user, draft);
      nav(`/books/journals/${j.id}`);
    } catch (e) { setErrors(errText(e)); }
  };
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const r = await keepFile(books, user.id, f);
      if (typeof r === 'string') say(r); else setAttachments((a) => [...a, r]);
    }
  };
  if (!can(user, 'journal.create')) return <PageHead title="New journal entry" lede="Your role can't prepare journal entries. The bookkeeper or the CFO prepares them." />;

  return (
    <>
      <PageHead eyebrow="Books · Journal entries" title="New journal entry" lede="Pick a template to fill the accounts and sides, or enter the lines yourself. Each line's entity comes from its store.">
        <Link className="btn" to="/books/journals">Cancel</Link>
      </PageHead>
      <div className="stack">
        <Errors errors={errors} />
        <section className="panel panel-pad" aria-label="Template">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="jf-tpl">Template</label>
              <select id="jf-tpl" value={tplKey} onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">None: enter the lines</option>
                {(Object.keys(TEMPLATE_GROUP_LABEL) as TemplateGroup[]).map((g) => <optgroup key={g} label={TEMPLATE_GROUP_LABEL[g]}>{JE_TEMPLATES.filter((t) => t.group === g).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>)}
              </select>
              {tpl && <span className="hint">{tpl.detail}</span>}
            </div>
            <div className="field"><label htmlFor="jf-date">Date</label><input id="jf-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); if (tpl) refill(tpl.key, { date: e.target.value }); }} /></div>
            {tpl?.stores.map((label, i) => (
              <div className="field" key={label}><label htmlFor={`jf-ts${i}`}>{label}</label><select id={`jf-ts${i}`} value={tStores[i] ?? defStore} onChange={(e) => { const n = [...tStores]; n[i] = e.target.value; setTStores(n); refill(tpl.key, { stores: n }); }}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
            ))}
            {tpl?.amounts.map((label, i) => (
              <div className="field" key={label}><label htmlFor={`jf-ta${i}`}>{label}</label><input id={`jf-ta${i}`} className="num" inputMode="decimal" value={tAmounts[i] ?? ''} onChange={(e) => { const n = [...tAmounts]; n[i] = e.target.value; setTAmounts(n); refill(tpl.key, { amounts: n }); }} /></div>
            ))}
            {tpl?.partyType && <div className="field"><label htmlFor="jf-party">{tpl.partyType === 'owner' ? 'Owner' : 'Tenant / party'}</label><select id="jf-party" value={partyId} onChange={(e) => { setPartyId(e.target.value); refill(tpl.key, { party: e.target.value }); }}><option value="">None</option><PartyOptions /></select></div>}
          </div>
        </section>
        <section className="panel" aria-labelledby="jf-lines-h">
          <div className="panel-head"><h2 id="jf-lines-h">Lines</h2><span className={dr === crT ? 'pos' : 'neg'}>Debits <Money c={dr} /> · Credits <Money c={crT} /> {dr === crT ? '· balanced' : `· off by ${formatMoney(Math.abs(dr - crT), { dollarSign: true })}`}</span></div>
          <div className="panel-pad lines-grid">
            {rows.map((r, i) => (
              <div className="line-row" key={r.key}>
                <div className="field acct"><label htmlFor={'jfa' + r.key}>Account {i + 1}</label><select id={'jfa' + r.key} value={r.accountId} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, accountId: e.target.value } : x)))}><option value="">Choose…</option><AccountOptions /></select></div>
                <div className="field"><label htmlFor={'jfs' + r.key}>Store ({entOf(r.storeId)})</label><select id={'jfs' + r.key} value={r.storeId} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, storeId: e.target.value } : x)))}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
                <div className="field"><label htmlFor={'jfd' + r.key}>Debit {i + 1}</label><input id={'jfd' + r.key} className="num" inputMode="decimal" value={r.debit} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x)))} /></div>
                <div className="field"><label htmlFor={'jfc' + r.key}>Credit {i + 1}</label><input id={'jfc' + r.key} className="num" inputMode="decimal" value={r.credit} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x)))} /></div>
                <div className="field memo"><label htmlFor={'jfm' + r.key}>Line memo {i + 1}</label><input id={'jfm' + r.key} value={r.memo} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, memo: e.target.value } : x)))} /></div>
                <button className="btn ghost rm" aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>✕</button>
              </div>
            ))}
            <div className="actions"><button className="btn sm" onClick={() => setRows([...rows, { key: K++, accountId: '', storeId: rows.at(-1)?.storeId ?? defStore, debit: dr > crT ? ((dr - crT) / 100).toFixed(2) : '', credit: crT > dr ? ((crT - dr) / 100).toFixed(2) : '', memo: '' }])}>Add a line{dr !== crT && ' for the difference'}</button></div>
          </div>
        </section>
        <section className="panel panel-pad" aria-label="Entry details">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="jf-desc">Description</label><input id="jf-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="field"><label htmlFor="jf-rev">Auto-reverse on</label><input id="jf-rev" type="date" value={reverseOn} onChange={(e) => setReverseOn(e.target.value)} /><span className="hint">Leave blank for no reversal</span></div>
            <label className="check" style={{ alignSelf: 'end', marginBottom: 8 }}><input type="checkbox" checked={adjusting} onChange={(e) => setAdjusting(e.target.checked)} /> Adjusting entry</label>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="jf-memo">Memo (required)</label><textarea id="jf-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Why this entry exists and where the numbers come from" /></div>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <label className="btn sm">Attach support<input type="file" className="sr-only" accept="image/*,.pdf,.csv,.xlsx" multiple onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>
            {attachments.map((a) => <Pill key={a.id}>{a.name}</Pill>)}
          </div>
        </section>
        {over && <p className="note warn">Over the {formatMoney(approvalLimit(state), { dollarSign: true })} limit: this entry will wait for approval by someone other than you (the CFO or an owner) and posts nothing until then.</p>}
        <div className="actions">
          <button className="btn primary" onClick={save} disabled={dr !== crT || dr === 0}>{over ? 'Submit for approval' : 'Post entry'}</button>
          <span className="muted small">Locked months refuse the entry and its reversal date.</span>
        </div>
      </div>
      {toast}
      <Help k="journalForm" />
    </>
  );
}

export function JournalDetailPage() {
  const { id } = useParams();
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const j = id ? getJournal(state, id) : undefined;
  if (!j) return <PageHead title="Journal entry not found" lede={<Link to="/books/journals">All journal entries</Link>} />;
  const t = j.txnId ? state.transactions.find((x) => x.id === j.txnId) : undefined;
  const rev = j.reversal ? state.transactions.find((x) => x.id === j.reversal!.txnId) : undefined;
  const total = jeTotal(j.lines);
  const dr = j.lines.reduce((a, l) => a + l.debit, 0);
  const cr = j.lines.reduce((a, l) => a + l.credit, 0);
  const acct = (aid: ID) => state.accounts.find((a) => a.id === aid);
  const store = (sid: ID) => state.stores.find((s) => s.id === sid);
  const entCode = (sid: ID) => state.entities.find((e) => e.id === store(sid)?.entityId)?.code ?? '';
  const userLines = t?.lines.filter((l) => !l.system) ?? [];
  const postedTies = !t || (userLines.length === j.lines.length && j.lines.every((l, i) => userLines[i].accountId === l.accountId && userLines[i].debit === l.debit && userLines[i].credit === l.credit));
  const canDecide = j.status === 'pending' && canApproveKind(state, user, jeLimitKind(j)) && user.id !== j.preparedBy;
  const run = (fn: () => void, msg: string) => { setErrors([]); try { fn(); say(msg); setRejecting(false); } catch (e) { setErrors(errText(e)); } };
  const history = state.audit.filter((a) => a.objectType === 'journal' && a.objectId === j.id);
  return (
    <>
      <PageHead eyebrow={`Books · Journal entry · ${shortDate(j.date)}`} title={`${j.ref} · ${j.description}`} lede={j.memo}>
        <Link className="btn" to="/books/journals">All entries</Link>
        <ExportButtons name={`${j.ref}`} sheet={j.ref} header={['Account', 'Store', 'Entity', 'Debit', 'Credit', 'Memo']} rows={j.lines.map((l) => [`${acct(l.accountId)?.number} ${acct(l.accountId)?.name}`, store(l.storeId)?.code ?? '', entCode(l.storeId), csvMoney(l.debit), csvMoney(l.credit), l.memo ?? ''])} />
      </PageHead>
      <section className="figures" aria-label="Entry" style={{ marginBottom: 20 }}>
        <Figure label="Status" value={JE_STATUS_LABEL[j.status]} note={j.needsApproval ? `Over the ${formatMoney(approvalLimit(state), { dollarSign: true })} limit` : 'Within the limit: posted on entry'} />
        <Figure label="Amount" value={<Money c={total} dollar />} note={`${j.lines.length} lines${j.adjusting ? ' · adjusting' : ''}`} />
        <Figure label="Prepared by" value={userName(state.users, j.preparedBy)} note={shortDate(j.preparedAt.slice(0, 10))} />
        <Figure label={j.rejected ? 'Rejected by' : 'Approved by'} value={j.approved ? userName(state.users, j.approved.by) : j.rejected ? userName(state.users, j.rejected.by) : j.needsApproval ? 'Waiting' : 'Not needed'} note={j.rejected?.reason ?? j.approved?.note} />
        {j.reverseOn && <Figure label="Reverses on" value={shortDate(j.reverseOn)} note={rev ? `Posted as ${rev.ref}` : j.status === 'pending' ? 'After approval' : 'Not yet'} href={rev ? `/books/transactions/${rev.id}` : undefined} />}
      </section>
      <Errors errors={errors} />
      {canDecide && (
        <section className="panel panel-pad" aria-label="Decide" style={{ marginBottom: 16 }}>
          <div className="actions" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ width: 280 }}><label htmlFor="jd-note">{rejecting ? 'Why reject?' : 'Note (optional)'}</label><input id="jd-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            {rejecting
              ? <button className="btn danger" onClick={() => run(() => rejectJournal(books, user, j.id, note), `Rejected ${j.ref}.`)}>Confirm reject</button>
              : <><button className="btn primary" onClick={() => run(() => approveJournal(books, user, j.id, note), `Approved ${j.ref}; it is posted.`)}>Approve and post</button>{can(user, 'approve') && <button className="btn ghost" onClick={() => setRejecting(true)}>Reject…</button>}</>}
          </div>
        </section>
      )}
      {j.status === 'pending' && !canDecide && <p className="note" style={{ marginBottom: 16 }}>{user.id === j.preparedBy ? 'You prepared this entry, so someone else (the CFO or an owner) approves it.' : 'Waiting for the CFO or an owner to approve it.'} Nothing is posted until then.</p>}
      <section className="panel" aria-labelledby="jd-lines">
        <div className="panel-head"><h2 id="jd-lines">Lines</h2>{t && <Link to={`/books/transactions/${t.id}`}>Posted as {t.ref}</Link>}</div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Account</th><th scope="col">Store</th><th scope="col">Entity</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th><th scope="col">Memo</th></tr></thead>
            <tbody>
              {j.lines.map((l) => (
                <tr key={l.id}>
                  <td><Link to={`/books/accounts/${l.accountId}?from=${j.date}&to=${j.date}`}>{acct(l.accountId)?.number} · {acct(l.accountId)?.name}</Link></td>
                  <td>{store(l.storeId)?.code}</td><td>{entCode(l.storeId)}</td>
                  <td className="num">{l.debit ? <Money c={l.debit} /> : ''}</td><td className="num">{l.credit ? <Money c={l.credit} /> : ''}</td>
                  <td className="muted">{l.memo}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={3}>Total</td><td className="num"><Money c={dr} /></td><td className="num"><Money c={cr} /></td><td /></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: dr === cr ? 'Debits equal credits' : 'Out of balance', ok: dr === cr },
          { label: t ? (postedTies ? 'The posted transaction carries these lines' : 'The posted transaction differs') : 'Nothing posted yet', ok: postedTies },
          ...(rev ? [(() => { const ok = rev.lines.filter((l) => !l.system).reduce((a, l) => a + l.debit, 0) === total; return { label: ok ? 'Reversal mirrors the entry' : 'Reversal differs', ok }; })()] : []),
        ]} />
      </section>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="panel" aria-labelledby="jd-att">
          <div className="panel-head"><h2 id="jd-att">Attachments</h2></div>
          {j.attachments.length === 0 ? <p className="panel-pad muted">No support attached. Attach the schedule or statement to the posted transaction.</p> : (
            <ul className="inbox">{j.attachments.map((a) => <li key={a.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span>{a.name}</span><button className="btn sm" onClick={() => void openAttachment(a, say)}>Open</button></li>)}</ul>
          )}
        </section>
        <section className="panel" aria-labelledby="jd-hist">
          <div className="panel-head"><h2 id="jd-hist">History</h2></div>
          {history.length === 0 && <p className="panel-pad muted">No history on this device: the demo load keeps one audit line for the whole dataset.</p>}
          <ul className="inbox">{history.map((h) => <li key={h.id} style={{ gridTemplateColumns: 'minmax(0,1fr)' }}><span><b>{userName(state.users, h.userId)}</b> · {h.summary}</span><span className="muted small">{h.at.slice(0, 16).replace('T', ' ')}{h.reason ? ` · ${h.reason}` : ''}</span></li>)}</ul>
        </section>
      </div>
      {toast}
      <Help k="journalDetail" />
    </>
  );
}
