import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { buildInbox } from '../inbox';
import { Figure, Help, Money, PageHead, TieOut } from '../components/ui';
import { balanceAsOf, pnl } from '../../core/reports';
import { periodOf, shortDate, todayInChicago, addDays, periodLabel } from '../../core/dates';
import { formatMoney } from '../../core/money';

export function Today() {
  const { state, lines, visible, stores, user } = useBooks();
  const today = todayInChicago();
  const inbox = useMemo(() => buildInbox(state, lines, visible, today), [state, lines, visible, today]);

  const bank = state.accounts.find((a) => a.id === 'acct_trustmark');
  const bankBal = bank ? balanceAsOf(state, bank.id, today, lines) : 0;
  const floor = bank?.floorCents ?? 0;
  const cashIds = state.accounts.filter((a) => a.subtype === 'cash').map((a) => a.id);
  const clearIds = state.accounts.filter((a) => a.subtype === 'clearing').map((a) => a.id);
  const cash = cashIds.reduce((a, id) => a + balanceAsOf(state, id, today, lines), 0);
  const clearing = clearIds.reduce((a, id) => a + balanceAsOf(state, id, today, lines), 0);
  const canSeeBank = visible.has('st_corp');

  // Yesterday, or the latest day with sales if yesterday has none.
  const salesDays = useMemo(() => {
    const rev = new Set(state.accounts.filter((a) => a.type === 'revenue').map((a) => a.id));
    return [...new Set(lines.filter((f) => rev.has(f.l.accountId) && f.t.tags.includes('pos')).map((f) => f.date))].sort();
  }, [state, lines]);
  const yesterday = addDays(today, -1);
  const glance = salesDays.includes(yesterday) ? yesterday : salesDays.filter((d) => d <= today).at(-1) ?? yesterday;
  const operating = stores.filter((s) => s.kind === 'operating');
  const day = useMemo(() => {
    const out = new Map<string, { fuel: number; inside: number; kitchen: number; gal: number; txn?: string }>();
    const acc = new Map(state.accounts.map((a) => [a.id, a]));
    for (const f of lines) {
      if (f.date !== glance || !f.t.tags.includes('pos')) continue;
      const a = acc.get(f.l.accountId);
      if (!a || a.type !== 'revenue') continue;
      const r = out.get(f.l.storeId) ?? { fuel: 0, inside: 0, kitchen: 0, gal: 0 };
      const v = f.l.credit - f.l.debit;
      if (a.lob === 'fuel') {
        r.fuel += v;
        r.gal += Number(/^(\d+) gal/.exec(f.l.memo ?? '')?.[1] ?? 0);
      } else if (a.lob === 'kitchen') r.kitchen += v;
      else r.inside += v;
      r.txn = f.t.id;
      out.set(f.l.storeId, r);
    }
    return out;
  }, [state, lines, glance]);
  const dayTotal = [...day.values()].reduce((a, r) => a + r.fuel + r.inside + r.kitchen, 0);

  const month = periodOf(glance);
  const mtd = useMemo(() => pnl(state, { from: month, to: month, storeIds: stores.map((s) => s.id), lines }), [state, stores, lines, month]);
  const open = inbox.filter((i) => !i.review).reduce((a, i) => a + i.count, 0);
  // Independent check: sum the POS entries' revenue lines straight from the transactions.
  const posTotal = useMemo(() => {
    const rev = new Set(state.accounts.filter((a) => a.type === 'revenue').map((a) => a.id));
    let n = 0;
    for (const t of state.transactions) {
      if (t.deleted || t.date !== glance || !t.tags.includes('pos')) continue;
      for (const l of t.lines) if (rev.has(l.accountId) && visible.has(l.storeId)) n += l.credit - l.debit;
    }
    return n;
  }, [state, glance, visible]);

  return (
    <>
      <PageHead eyebrow={new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} title={`Good morning, ${user.name.split(' ')[0]}`}
        lede={open ? `${open} item${open === 1 ? '' : 's'} need you today. Start at the top of the inbox.` : 'Nothing needs you right now. The books are clean.'}>
        <Link className="btn primary" to="/books/new">New entry</Link>
      </PageHead>

      <div className="stack">
        <section className="figures" aria-label="Cash position">
          {canSeeBank && (
            <Figure label="Trustmark balance" href="/books/accounts/acct_trustmark" value={<Money c={bankBal} whole dollar className={bankBal < floor ? 'neg' : undefined} />}
              note={bankBal < floor ? <span className="neg">Below the {formatMoney(floor, { whole: true, dollarSign: true })} floor by {formatMoney(floor - bankBal, { dollarSign: true })}</span> : <>{formatMoney(bankBal - floor, { whole: true, dollarSign: true })} above the {formatMoney(floor, { whole: true, dollarSign: true })} floor</>} />
          )}
          <Figure label="Cash on hand" href={`/books/accounts/${cashIds[0] ?? ''}`} value={<Money c={cash} whole dollar />} note="Registers, safe and in transit, all stores" />
          <Figure label="Supplier clearing" href="/books/accounts/acct_craddock" value={<Money c={clearing} whole dollar />} note="Craddock, Dash and Fiserv, net. Positive is owed to us." />
          <Figure label={`${periodLabel(month)} net profit`} href={`/reports/pnl?from=${month}&to=${month}`} value={<Money c={mtd.netIncome.total} whole dollar signed />} note={`On ${formatMoney(mtd.netSales.total, { whole: true, dollarSign: true })} net sales, to date`} />
        </section>

        <div className="grid-2">
          <section className="panel" aria-labelledby="inbox-h">
            <div className="panel-head"><h2 id="inbox-h">Inbox</h2><span className="muted small">{open} to do{inbox.some((i) => i.review && i.count) && ' · plus review queues'}</span></div>
            <ul className="inbox">
              {inbox.map((i) => (
                <li key={i.key}>
                  <span className={'n' + (i.count ? '' : ' zero')}>{i.count}</span>
                  <span className="what"><b>{i.title}</b><span>{i.detail}</span></span>
                  {i.count > 0 ? <Link className="btn sm" to={i.to} aria-label={`${i.action}: ${i.title}`}>{i.action}</Link> : <span className="pill ok">Clear</span>}
                </li>
              ))}
            </ul>
            <div className="tieout"><span className="muted">Bank matching, fuel notices, cash handoffs, bills, payroll and compliance deadlines join this inbox as their phases ship. <Link to="/roadmap">See the roadmap</Link>.</span></div>
          </section>

          <section className="panel" aria-labelledby="glance-h">
            <div className="panel-head">
              <h2 id="glance-h">{glance === yesterday ? 'Yesterday' : 'Latest sales day'} at a glance</h2>
              <span className="muted small">{shortDate(glance)}{glance !== yesterday && ' · nothing posted for yesterday yet'}</span>
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th scope="col">Store</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Fuel</th><th scope="col" className="num">Inside</th><th scope="col" className="num">Kitchen</th><th scope="col" className="num">Total</th></tr></thead>
                <tbody>
                  {operating.map((s) => {
                    const r = day.get(s.id);
                    return (
                      <tr key={s.id}>
                        <td>{r?.txn ? <Link to={`/books/transactions/${r.txn}`}>{s.code} {s.name}</Link> : <>{s.code} {s.name}</>}{!r && <span className="muted small"> · no sales posted</span>}</td>
                        <td className="num">{r ? r.gal.toLocaleString('en-US') : '–'}</td>
                        <td className="num">{r ? <Money c={r.fuel} whole /> : '–'}</td>
                        <td className="num">{r ? <Money c={r.inside} whole /> : '–'}</td>
                        <td className="num">{r ? <Money c={r.kitchen} whole /> : '–'}</td>
                        <td className="num">{r ? <Money c={r.fuel + r.inside + r.kitchen} whole /> : '–'}</td>
                      </tr>
                    );
                  })}
                  <tr className="total"><td>All stores</td><td className="num">{[...day.values()].reduce((a, r) => a + r.gal, 0).toLocaleString('en-US')}</td><td className="num"><Money c={[...day.values()].reduce((a, r) => a + r.fuel, 0)} whole /></td><td className="num"><Money c={[...day.values()].reduce((a, r) => a + r.inside, 0)} whole /></td><td className="num"><Money c={[...day.values()].reduce((a, r) => a + r.kitchen, 0)} whole /></td><td className="num"><Money c={dayTotal} whole /></td></tr>
                </tbody>
              </table>
            </div>
            <TieOut items={[{ label: posTotal === dayTotal ? 'Ties to the POS daily close entries' : `Off from the POS entries by ${formatMoney(Math.abs(posTotal - dayTotal), { dollarSign: true })}`, ok: posTotal === dayTotal, detail: 'sales before tax' }]} />
          </section>
        </div>
      </div>
      <Help k="today" />
    </>
  );
}
