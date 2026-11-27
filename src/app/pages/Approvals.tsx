import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { Empty, Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import { APPROVAL_PROVIDERS, approvalQueue } from '../../core/approvals';
import { awaitingApproval, billTotal } from '../../core/payables';
import { daysBetween, shortDate, todayInChicago } from '../../core/dates';
import { can } from '../../core/permissions';
import { canApproveKind } from '../../core/limits';
import { ValidationError } from '../../core/books';

export function ApprovalsPage() {
  const { state, books, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const queue = useMemo(() => approvalQueue(state, visible), [state, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const total = queue.reduce((a, i) => a + i.amount, 0);
  const oldest = queue[0];
  const userName = (id: string) => state.users.find((u) => u.id === id)?.name ?? id;
  const billsDirect = awaitingApproval(state).filter((b) => visible.has(b.storeId)).reduce((a, b) => a + billTotal(b), 0);
  const billsQueued = queue.filter((i) => i.kind === 'bill').reduce((a, i) => a + i.amount, 0);
  const run = (fn: () => void, msg: string) => { setErrors([]); try { fn(); say(msg); setRejecting(null); } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); } };
  return (
    <>
      <PageHead eyebrow="Today" title="Approvals" lede="Everything waiting for a yes or no. Approving a bill posts it to the books.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('approvals', ['Kind', 'Item', 'Detail', 'Amount', 'Requested by', 'Requested'], queue.map((i) => [i.provider.label, i.title, i.detail, csvMoney(i.amount), userName(i.requestedBy), i.requestedAt.slice(0, 10)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Approvals" style={{ marginBottom: 20 }}>
        <Figure label="Waiting" value={queue.length} note={queue.length ? 'Oldest first' : 'Nothing to approve'} />
        <Figure label="Total amount" value={<Money c={total} whole dollar />} />
        <Figure label="Oldest" value={oldest ? `${Math.max(0, daysBetween(oldest.requestedAt.slice(0, 10), today))} days` : '—'} note={oldest?.title} />
        <Figure label="Kinds" value={APPROVAL_PROVIDERS.length} note={APPROVAL_PROVIDERS.map((p) => p.label).join(', ') + '; more arrive with later phases'} />
      </section>
      <Errors errors={errors} />
      {APPROVAL_PROVIDERS.map((p) => {
        const items = queue.filter((i) => i.provider === p);
        const allowed = p.limitKind ? canApproveKind(state, user, p.limitKind) : can(user, p.permission);
        return (
          <section key={p.kind} className="panel" aria-labelledby={`ap-${p.kind}`} style={{ marginBottom: 16 }}>
            <div className="panel-head"><h2 id={`ap-${p.kind}`}>{p.label}</h2><span className="muted small">{items.length} waiting</span></div>
            {!allowed && items.length > 0 && <p className="panel-pad muted small" style={{ paddingBottom: 0 }}>Your role can see these but can't approve them. The owner or the CFO approves.</p>}
            {items.length === 0 ? <div className="panel-pad"><Empty>Nothing waiting for a signature. Enjoy the coffee.</Empty></div> : (
              <ul className="inbox">
                {items.map((i) => (
                  <li key={i.id} style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline' }}>
                      <b style={{ flex: 1, minWidth: 180 }}><Link to={i.to}>{i.title}</Link></b>
                      <span className="num" style={{ fontWeight: 600 }}><Money c={i.amount} dollar /></span>
                    </div>
                    <span className="muted small">{i.detail} · entered by {userName(i.requestedBy)} on {shortDate(i.requestedAt.slice(0, 10))}</span>
                    {allowed && (
                      <div className="actions" style={{ alignItems: 'flex-end' }}>
                        <div className="field" style={{ width: 260 }}><label htmlFor={`an-${i.id}`}>{rejecting === i.id ? 'Why reject?' : 'Note (optional)'}</label><input id={`an-${i.id}`} value={notes[i.id] ?? ''} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} /></div>
                        {rejecting === i.id
                          ? <button className="btn danger sm" onClick={() => run(() => p.reject(books, user, i.id, notes[i.id] ?? ''), 'Rejected.')}>Confirm reject</button>
                          : <>
                            <button className="btn primary sm" onClick={() => run(() => p.approve(books, user, i.id, notes[i.id]), `Approved ${i.title}.`)} aria-label={`Approve ${i.title}`}>Approve</button>
                            {can(user, p.permission) && <button className="btn ghost sm" onClick={() => setRejecting(i.id)} aria-label={`Reject ${i.title}`}>Reject…</button>}
                          </>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {p.kind === 'bill' && <TieOut items={[{ label: billsDirect === billsQueued ? 'Matches every bill awaiting approval' : 'Does not match the bills awaiting approval', ok: billsDirect === billsQueued, detail: <Money c={billsDirect} dollar /> }]} />}
          </section>
        );
      })}
      <p className="muted small">Bills and journal entries over the approval threshold are here (write-offs are journal entries from a write-off template). Who may approve how much is set under <Link to="/controls/limits">Controls › Approval limits</Link>; an approval over your limit is refused and says who can approve it.</p>
      {toast}
      <Help k="approvals" />
    </>
  );
}
