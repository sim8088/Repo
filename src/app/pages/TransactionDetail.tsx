import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Help, Money, PageHead, TieOut, useToast } from '../components/ui';
import { shortDate, periodOf } from '../../core/dates';
import { can } from '../../core/permissions';
import { getFile, putFile } from '../../data/storage';
import { formatMoney } from '../../core/money';

const KIND: Record<string, string> = { money_out: 'Money out', money_in: 'Money in', journal: 'Journal entry', transfer: 'Transfer', opening: 'Opening balance' };

export function TransactionDetail() {
  const { id } = useParams();
  const { state, books, user, visible } = useBooks();
  const [toast, say] = useToast();
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = id ? books.getTransaction(id) : undefined;
  if (!t || !t.lines.some((l) => visible.has(l.storeId))) {
    return <><PageHead title="Transaction not found" lede="It may be outside the stores you can see, or the link is wrong." /><Link to="/books/transactions">Back to transactions</Link></>;
  }
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const store = (sid: string) => state.stores.find((s) => s.id === sid);
  const ent = (eid?: string) => state.entities.find((e) => e.id === eid);
  const party = t.partyId ? state.parties.find((p) => p.id === t.partyId) : undefined;
  const dr = t.lines.reduce((a, l) => a + l.debit, 0);
  const cr = t.lines.reduce((a, l) => a + l.credit, 0);
  const byEntity = new Map<string, number>();
  for (const l of t.lines) { const e = store(l.storeId)?.entityId ?? ''; byEntity.set(e, (byEntity.get(e) ?? 0) + l.debit - l.credit); }
  const entitiesOk = [...byEntity.values()].every((v) => v === 0);
  const locked = books.isLocked(periodOf(t.date));
  const history = state.audit.filter((a) => a.objectId === t.id).reverse();
  const userName = (uid: string) => state.users.find((u) => u.id === uid)?.name ?? uid;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > 15 * 1024 * 1024) { say(`${f.name} is over 15 MB. Compress it or save a smaller PDF.`); continue; }
        const attId = books.nextId('att');
        const ok = await putFile(attId, f);
        if (!ok) { say('This browser is blocking storage, so the file could not be kept. Allow site data and try again.'); continue; }
        books.addAttachment(user, t.id, { id: attId, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, addedAt: new Date().toISOString(), addedBy: user.id });
        say(`Attached ${f.name}.`);
      }
    } catch (e) { say((e as Error).message); }
    setBusy(false);
  };
  const open = async (attId: string, name: string) => {
    const blob = await getFile(attId);
    if (!blob) { say(`${name} isn't on this device. Attachments live where they were uploaded until the hosted back end ships.`); return; }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <>
      <PageHead eyebrow={`${KIND[t.kind]} · ${t.ref}`} title={t.description} lede={<>{shortDate(t.date)}{party && <> · {party.name}</>}{locked && <> · <span className="pill">Locked month</span></>}{t.deleted && <> · <span className="pill bad">Deleted {shortDate(t.deleted.at.slice(0, 10))}: {t.deleted.reason}</span></>}</>}>
        {!t.deleted && !locked && can(user, 'txn.edit') && <Link className="btn" to={`/books/transactions/${t.id}/edit`}>Edit</Link>}
        {!t.deleted && !locked && can(user, 'txn.delete') && <button className="btn danger" onClick={() => setConfirmDelete(true)}>Delete</button>}
        {t.deleted && !locked && can(user, 'txn.delete') && <button className="btn" onClick={() => { books.restoreTransaction(user, t.id); say('Restored.'); }}>Restore</button>}
        <button className="btn" onClick={() => window.print()}>Print</button>
      </PageHead>
      {confirmDelete && (
        <div className="panel panel-pad" style={{ marginBottom: 20 }} role="region" aria-label="Confirm delete">
          <div className="field"><label htmlFor="del-reason">Why are you deleting this?</label><input id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate of TX-000412" autoFocus /></div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn danger" disabled={!reason.trim()} onClick={() => { try { books.deleteTransaction(user, t.id, reason); setConfirmDelete(false); say('Deleted. It stays in the books, hidden, and can be restored.'); } catch (e) { say((e as Error).message); } }}>Delete transaction</button>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </div>
        </div>
      )}
      <div className="stack">
        <section className="panel" aria-labelledby="lines-h">
          <div className="panel-head"><h2 id="lines-h">Lines</h2><span className="muted small">{t.lines.length} lines</span></div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th scope="col">Account</th><th scope="col">Store</th><th scope="col">Entity</th><th scope="col">Memo</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th></tr></thead>
              <tbody>
                {t.lines.map((l) => {
                  const a = acc.get(l.accountId);
                  const s = store(l.storeId);
                  return (
                    <tr key={l.id}>
                      <td><Link to={`/books/accounts/${l.accountId}?from=${periodOf(t.date)}-01`}>{a?.number} · {a?.name}</Link>{l.system && <> <span className="pill" title="Added by the ledger so each entity balances">auto</span></>}</td>
                      <td>{s?.code}</td>
                      <td>{ent(s?.entityId)?.code}{l.counterEntityId && <span className="muted small"> ↔ {ent(l.counterEntityId)?.code}</span>}</td>
                      <td className="trunc" title={l.memo}>{l.memo}{l.partyId && <span className="muted"> · {state.parties.find((p) => p.id === l.partyId)?.name}</span>}</td>
                      <td className="num">{l.debit ? <Money c={l.debit} /> : ''}</td>
                      <td className="num">{l.credit ? <Money c={l.credit} /> : ''}</td>
                    </tr>
                  );
                })}
                <tr className="total"><td colSpan={4}>Total</td><td className="num"><Money c={dr} /></td><td className="num"><Money c={cr} /></td></tr>
              </tbody>
            </table>
          </div>
          <TieOut items={[
            { label: dr === cr ? 'Debits equal credits' : `Off by ${formatMoney(Math.abs(dr - cr), { dollarSign: true })}`, ok: dr === cr },
            { label: entitiesOk ? 'Each entity balances' : 'An entity is out of balance', ok: entitiesOk, detail: byEntity.size > 1 ? `${byEntity.size} entities, settled through Corporate` : undefined },
          ]} />
        </section>

        <div className="grid-2">
          <section className="panel" aria-labelledby="docs-h">
            <div className="panel-head"><h2 id="docs-h">Documents</h2>
              {!t.deleted && can(user, 'txn.create') && (
                <label className="btn sm" style={{ margin: 0 }} aria-disabled={busy}>
                  {busy ? 'Saving…' : 'Attach photo or PDF'}
                  <input type="file" accept="image/*,application/pdf" capture="environment" multiple className="sr-only" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
                </label>
              )}
            </div>
            {t.attachments.length === 0 ? <p className="panel-pad muted">No source document yet. Attach the invoice, notice, statement line or receipt photo so this number traces to its source.</p> : (
              <ul className="inbox">
                {t.attachments.map((a) => (
                  <li key={a.id} style={{ gridTemplateColumns: '1fr auto' }}>
                    <span className="what"><b>{a.name}</b><span>{(a.size / 1024).toFixed(0)} KB · {userName(a.addedBy)} · {shortDate(a.addedAt.slice(0, 10))}</span></span>
                    <span className="actions"><button className="btn sm" onClick={() => void open(a.id, a.name)}>Open</button>{can(user, 'txn.edit') && !locked && <button className="btn sm ghost" onClick={() => books.removeAttachment(user, t.id, a.id)} aria-label={`Remove ${a.name}`}>Remove</button>}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel panel-pad" aria-labelledby="det-h">
            <h2 id="det-h" style={{ marginBottom: 12 }}>Details</h2>
            <dl className="kv">
              <dt>Reference</dt><dd>{t.ref}</dd>
              {t.checkNo && <><dt>Check #</dt><dd>{t.checkNo}</dd></>}
              {t.docNo && <><dt>Invoice / doc #</dt><dd>{t.docNo}</dd></>}
              {t.memo && <><dt>Memo</dt><dd>{t.memo}</dd></>}
              {t.tags.length > 0 && <><dt>Tags</dt><dd>{t.tags.map((g) => <span key={g} className="pill" style={{ marginRight: 4 }}>{g}</span>)}</dd></>}
              <dt>Source</dt><dd>{t.source}{t.batchId && ` · batch ${t.batchId}`}</dd>
              <dt>Created</dt><dd>{userName(t.createdBy)} · {new Date(t.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</dd>
              <dt>Last changed</dt><dd>{userName(t.updatedBy)} · {new Date(t.updatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</dd>
            </dl>
          </section>
        </div>

        <section className="panel" aria-labelledby="hist-h">
          <div className="panel-head"><h2 id="hist-h">History</h2></div>
          {history.length === 0 ? <p className="panel-pad muted">{t.source === 'demo' ? 'Loaded with the demo dataset; no changes since.' : 'No changes since it was created.'}</p> : (
            <ul className="inbox">{history.map((h) => (
              <li key={h.id} style={{ gridTemplateColumns: '1fr auto' }}><span className="what"><b>{h.summary}</b><span>{userName(h.userId)}{h.reason && ` · “${h.reason}”`}</span></span><span className="muted small">{new Date(h.at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</span></li>
            ))}</ul>
          )}
        </section>
      </div>
      {toast}
      <Help k="txnDetail" />
    </>
  );
}
