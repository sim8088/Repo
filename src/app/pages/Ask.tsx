import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Figure, Help, PageHead, TieOut, useExport, useToast } from '../components/ui';
import { EXAMPLES, answerCsv, answerText, ask, formatFigure } from '../../core/ask';
import { shortDate, todayInChicago } from '../../core/dates';
import { can } from '../../core/permissions';

const SHOW = 100;

/** Ask a question in plain English; the answer comes straight from the books with the rows that prove it. */
export function AskPage() {
  const { state, user, visible, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const q = sp.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const [all, setAll] = useState(false);
  const today = todayInChicago();
  const r = useMemo(() => (q.trim() ? ask(state, q, { today, visible }) : null), [state, q, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (text: string) => { setDraft(text); setAll(false); const x = new URLSearchParams(sp); if (text.trim()) x.set('q', text.trim()); else x.delete('q'); setSp(x); };
  const copy = async () => {
    if (!r) return;
    try { await navigator.clipboard.writeText(answerText(r)); say('Copied the answer and its proof as text.'); } catch { say('This browser blocked copying. Select the text and copy it instead.'); }
  };
  const proofSum = r?.ok ? r.proof.reduce((a, p) => a + p.amount, 0) : 0;
  return (
    <>
      <PageHead eyebrow="Search & ask" title="Ask" lede="Ask about payments, invoices, gallons, balances, sales, who owes us or bills due. Answers are worked out from the books, with the transactions behind them as proof. Nothing is estimated: when the data isn't there, it says what's missing." />
      <section className="panel panel-pad" aria-labelledby="ask-h" style={{ marginBottom: 20 }}>
        <h2 id="ask-h" className="sr-only">Your question</h2>
        <form onSubmit={(e) => { e.preventDefault(); go(draft); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 280px' }}><label htmlFor="ask-q">Question</label><input id="ask-q" type="search" value={draft} placeholder="What did we pay Entergy for HM11 in October?" onChange={(e) => setDraft(e.target.value)} /></div>
          <button className="btn primary" type="submit">Ask</button>
        </form>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label="Examples" role="group">
          {EXAMPLES.map((x) => <button key={x} className="btn sm" onClick={() => go(x)}>{x}</button>)}
        </div>
      </section>
      {r && !r.ok && (
        <section className="panel panel-pad" aria-labelledby="ask-miss" role="status">
          <h2 id="ask-miss" style={{ marginBottom: 6 }}>Not answered</h2>
          <p><b>{r.reason}</b></p>
          <p className="small" style={{ marginTop: 6 }}>What's missing:</p>
          <ul className="small" style={{ paddingLeft: 18 }}>{r.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="small" style={{ marginTop: 6 }}>Try asking:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>{r.suggestions.map((x) => <button key={x} className="btn sm" onClick={() => go(x)}>{x}</button>)}</div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn sm" onClick={() => void copy()}>Copy as text</button></div>
        </section>
      )}
      {r && r.ok && (
        <>
          <section className="figures" aria-label="Answer" style={{ marginBottom: 20 }}>
            <Figure label="Answer" value={formatFigure(r, r.figure)} note={r.headline} />
            <Figure label="Proof rows" value={r.proof.length} note="Every row is a transaction, bill, invoice or statement" />
            <Figure label="As of" value={shortDate(today)} note="Books as they stand now" />
          </section>
          <section className="panel" aria-labelledby="ask-a">
            <div className="panel-head"><h2 id="ask-a">{r.headline}</h2>
              <div className="actions"><button className="btn sm" onClick={() => void copy()}>Copy as text</button>{can(user, 'export') && <button className="btn sm" onClick={() => { const c = answerCsv(r); exportCsv('ask-answer', c.header, c.rows); }}>Export CSV</button>}</div>
            </div>
            <div className="panel-pad small">
              <p><b>How I read it:</b> {r.reading}</p>
              {r.notes.map((n) => <p key={n} className="muted" style={{ marginTop: 4 }}>{n}</p>)}
            </div>
            {r.proof.length > 0 && <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Date</th><th scope="col">Reference</th><th scope="col">Store</th><th scope="col">Description</th><th scope="col" className="num">{r.amountLabel}</th></tr></thead>
              <tbody>{(all ? r.proof : r.proof.slice(0, SHOW)).map((p, i) => (
                <tr key={i}><td>{shortDate(p.date)}</td><td>{p.to ? <Link to={p.to}>{p.ref ?? 'Open'}</Link> : p.ref ?? ''}</td><td>{p.store}</td><td className="trunc" title={p.description}>{p.description}</td><td className="num">{formatFigure(r, p.amount)}</td></tr>
              ))}</tbody>
              <tfoot><tr><th scope="row" colSpan={4}>Total</th><td className="num"><b>{formatFigure(r, proofSum)}</b></td></tr></tfoot>
            </table></div>}
            {r.proof.length > SHOW && !all && <div className="panel-pad"><button className="btn sm" onClick={() => setAll(true)}>Show all {r.proof.length} rows</button></div>}
            <TieOut items={[{ label: proofSum === r.figure ? 'The proof rows add to the answer' : 'The proof rows do not add to the answer', ok: proofSum === r.figure, detail: `${r.proof.length} rows` }]} />
          </section>
        </>
      )}
      {toast}
      <Help k="ask" />
    </>
  );
}
