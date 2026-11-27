import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { ExportButtons } from '../components/reportkit';
import { useParam, userName } from '../components/glkit';
import { consolidate, consolidationLog, entryTotal, recordConsolidation } from '../../core/consolidation';
import { ValidationError } from '../../core/books';
import { can } from '../../core/permissions';
import { formatMoney } from '../../core/money';
import { shortDate, todayInChicago } from '../../core/dates';

export function ConsolidationPage() {
  const { state, books, user, allLines, visible } = useBooks();
  const [toast, say] = useToast();
  const [asOf, setAsOf] = useParam('asOf', todayInChicago());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const c = useMemo(() => consolidate(state, { asOf, lines: allLines }), [state, asOf, allLines]);
  const log = consolidationLog(state);
  const code = (id: string) => state.entities.find((e) => e.id === id)?.code ?? id;
  const acct = (id: string) => state.accounts.find((a) => a.id === id);
  const elimTotal = c.entries.reduce((a, e) => a + entryTotal(e), 0);
  const ents = c.entities;
  if (!can(user, 'view.reports') || !visible.has('st_corp')) return <PageHead title="Consolidation" lede="Your role doesn't include company reports. Ask the CFO for access." />;
  const header = ['Number', 'Account', ...ents.map((e) => e.code), 'Combined', 'Eliminations', 'Consolidated'];
  const rows = c.rows.map((r) => [r.account.number, r.account.name, ...ents.map((e) => csvMoney(r.byEntity[e.id] ?? 0)), csvMoney(r.combined), csvMoney(r.elimination), csvMoney(r.consolidated)]);
  const dc = (n: number) => (n ? <Money c={n} /> : '');
  return (
    <>
      <PageHead eyebrow="Books" title="Consolidation" lede={`Each entity's books side by side as of ${shortDate(asOf)} (debits positive, credits in parentheses), the eliminations, and the group. Eliminations live here only; they never post to an entity's ledger.`}>
        <ExportButtons name={`consolidated-tb-${asOf}`} header={header} rows={rows} sheet={`Consolidated ${asOf}`} />
      </PageHead>
      <section className="figures" aria-label="Consolidation" style={{ marginBottom: 20 }}>
        <Figure label="Entities" value={ents.length} note={ents.map((e) => e.code).join(', ')} />
        <Figure label="Eliminated" value={<Money c={elimTotal} whole dollar />} note={`${c.entries.length} elimination entries`} />
        <Figure label="Eliminations net" value={<Money c={c.eliminationNet} dollar />} note={c.eliminationNet === 0 ? 'Nets to zero' : 'Should be zero'} />
        <Figure label="Consolidated net income" value={<Money c={c.netIncome.consolidated} whole dollar />} note="Fiscal year to date" />
      </section>
      <section className="panel" aria-labelledby="cons-h">
        <div className="panel-head"><h2 id="cons-h">Consolidated trial balance</h2></div>
        <div className="filters"><div className="field"><label htmlFor="cons-asof">As of</label><input id="cons-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Account</th>{ents.map((e) => <th key={e.id} scope="col" className="num">{e.code}</th>)}<th scope="col" className="num">Combined</th><th scope="col" className="num">Eliminations</th><th scope="col" className="num">Consolidated</th></tr></thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.account.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><Link to={`/books/accounts/${r.account.id}?to=${asOf}`}>{r.account.number} {r.account.name}</Link></td>
                  {ents.map((e) => <td key={e.id} className="num">{dc(r.byEntity[e.id] ?? 0)}</td>)}
                  <td className="num">{dc(r.combined)}</td><td className="num">{dc(r.elimination)}</td><td className="num"><b>{dc(r.consolidated)}</b></td>
                </tr>
              ))}
              <tr className="total"><td>Net (debits − credits)</td>{ents.map((e) => <td key={e.id} className="num"><Money c={c.entityDifference[e.id]} /></td>)}<td className="num"><Money c={c.combinedDifference} /></td><td className="num"><Money c={c.eliminationNet} /></td><td className="num"><Money c={c.consolidatedDifference} /></td></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: Object.values(c.entityDifference).every((d) => d === 0) ? 'Each entity balances on its own' : 'An entity is out of balance', ok: Object.values(c.entityDifference).every((d) => d === 0) },
          { label: c.eliminationNet === 0 ? 'Eliminations net to zero' : `Eliminations are off by ${formatMoney(c.eliminationNet, { dollarSign: true })}`, ok: c.eliminationNet === 0 },
          { label: c.icCleared ? 'Due to / due from and intercompany fees are zero after eliminating' : 'Intercompany balances remain after eliminating', ok: c.icCleared },
          { label: c.pairsAgree ? 'Every pair of entities agrees on what they owe each other' : 'A pair of entities disagrees', ok: c.pairsAgree, detail: <Link to="/intercompany/eliminations">pair check</Link> },
          { label: c.netIncome.combined === c.netIncome.consolidated ? 'Consolidated net income = sum of the entities' : 'Net income changed in consolidation', ok: c.netIncome.combined === c.netIncome.consolidated },
        ]} />
      </section>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="panel" aria-labelledby="elim-h">
          <div className="panel-head"><h2 id="elim-h">Elimination entries</h2></div>
          {c.entries.length === 0 ? <p className="panel-pad muted">Nothing to eliminate at this date.</p> : c.entries.map((e) => (
            <div key={e.key} className="table-wrap">
              <table className="t">
                <caption className="small" style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600 }}>{e.label}</caption>
                <thead><tr><th scope="col">Entity</th><th scope="col">Account</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th></tr></thead>
                <tbody>{e.lines.map((l, i) => <tr key={i}><td>{code(l.entityId)}</td><td>{acct(l.accountId)?.number} {acct(l.accountId)?.name}</td><td className="num">{l.debit ? <Money c={l.debit} /> : ''}</td><td className="num">{l.credit ? <Money c={l.credit} /> : ''}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
          <TieOut items={[{ label: c.entriesBalance ? 'Every elimination entry balances' : 'An elimination entry doesn\'t balance', ok: c.entriesBalance }]} />
        </section>
        <section className="panel" aria-labelledby="elog-h">
          <div className="panel-head"><h2 id="elog-h">Elimination entry log</h2></div>
          <Errors errors={errors} />
          {can(user, 'journal.create') && (
            <div className="panel-pad actions" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 240 }}><label htmlFor="elog-note">Note</label><input id="elog-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October close" /></div>
              <button className="btn primary" onClick={() => { setErrors([]); try { recordConsolidation(books, user, asOf, note); setNote(''); say(`Recorded the consolidation as of ${asOf}.`); } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); } }}>Record as of {shortDate(asOf)}</button>
            </div>
          )}
          {log.length === 0 ? <p className="panel-pad muted">No consolidation recorded yet.</p> : (
            <ul className="inbox">{log.map((r) => <li key={r.id} style={{ gridTemplateColumns: 'minmax(0,1fr)' }}><span><b>As of {shortDate(r.asOf)}</b> · {r.entries.length} entries · <Money c={r.entries.reduce((a, e) => a + entryTotal(e), 0)} dollar /> · {r.ok ? 'tied' : 'not tied'}</span><span className="muted small">{userName(state.users, r.by)} · {r.at.slice(0, 16).replace('T', ' ')}{r.note ? ` · ${r.note}` : ''}</span></li>)}</ul>
          )}
        </section>
      </div>
      {toast}
      <Help k="consolidation" />
    </>
  );
}
