import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { buildInbox } from '../inbox';
import { CountUp, Forecourt, Gauge, Help, Money, PageHead, TieOut } from '../components/ui';
import { balanceAsOf, pnl } from '../../core/reports';
import { periodOf, shortDate, todayInChicago, addDays, periodLabel } from '../../core/dates';
import { formatMoney } from '../../core/money';
import { forecast } from '../../core/forecast';
import { CompassLine } from './Compass';

/** To-do kinds shown before "Show all". */
const TOP = 8;

/** Morning, afternoon or evening at the stores (America/Chicago). */
function partOfDay(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Chicago' }).format(now));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

export function Today() {
  const { state, lines, visible, stores, user } = useBooks();
  const today = todayInChicago();
  const inbox = useMemo(() => buildInbox(state, lines, visible, today), [state, lines, visible, today]);

  const bank = state.accounts.find((a) => a.id === 'acct_trustmark');
  const bankBal = bank ? balanceAsOf(state, bank.id, today, lines) : 0;
  const floor = bank?.floorCents ?? 0;
  const cashIds = state.accounts.filter((a) => a.subtype === 'cash').map((a) => a.id);
  const cash = cashIds.reduce((a, id) => a + balanceAsOf(state, id, today, lines), 0);
  const canSeeBank = visible.has('st_corp');
  const fc = useMemo(() => (canSeeBank && bank ? forecast(state, bank.id, today) : null), [state, bank, today, canSeeBank, lines]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // This month to date; if nothing has been sold yet this month (sales not entered), the latest month with sales.
  const { month, mtd, partial } = useMemo(() => {
    const ids = stores.map((s) => s.id);
    let m = periodOf(salesDays.length ? glance : today);
    for (let i = 0; i < 3; i++) {
      const r = pnl(state, { from: m, to: m, storeIds: ids, lines });
      if (r.netSales.total !== 0 || i === 2) return { month: m, mtd: r, partial: m === periodOf(today) };
      m = periodOf(addDays(`${m}-01`, -1));
    }
    throw new Error('unreachable');
  }, [state, stores, lines, glance, today, salesDays]);
  const open = inbox.filter((i) => !i.review).reduce((a, i) => a + i.count, 0);
  const todo = inbox.filter((i) => !i.review && i.count > 0);
  const [all, setAll] = useState(false);
  const shown = all ? todo : todo.slice(0, TOP);
  const later = inbox.filter((i) => i.review && i.count > 0);
  const clear = inbox.filter((i) => i.count === 0);
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
      <PageHead eyebrow={new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} title={`Good ${partOfDay()}, ${user.name.split(' ')[0]}`}
        icon={<Forecourt />}
        lede={open ? `${open} item${open === 1 ? '' : 's'} need you today. Start at the top of the list.` : 'Nothing needs you right now. The books are clean.'}>
        <Link className="btn primary" to="/books/new">New entry</Link>
      </PageHead>

      <div className="stack">
        <section className="sign-strip" aria-label="Headline numbers">
          {canSeeBank && (
            <Link className="sign-cell" to="/bank">
              <span className="sign-label">Trustmark today</span>
              <span className={'sign-digits' + (bankBal < floor ? ' neg' : '')}><CountUp value={bankBal} format={(c) => formatMoney(c, { whole: true, dollarSign: true })} /></span>
              <Gauge value={bankBal} min={0} max={Math.max(floor * 3, bankBal)} target={floor} width={78} label="Trustmark against its floor"
                valueText={bankBal < floor ? `${formatMoney(floor - bankBal, { whole: true, dollarSign: true })} below the floor` : `${formatMoney(bankBal - floor, { whole: true, dollarSign: true })} above the floor`} />
              <span className="sign-note">{bankBal < floor ? `${formatMoney(floor - bankBal, { whole: true, dollarSign: true })} under the floor: top it up` : `${formatMoney(bankBal - floor, { whole: true, dollarSign: true })} above the ${formatMoney(floor, { whole: true, dollarSign: true })} floor`}</span>
            </Link>
          )}
          {fc && (
            <Link className="sign-cell" to="/cash/forecast">
              <span className="sign-label">Lowest in 13 weeks</span>
              <span className={'sign-digits' + (fc.minBalance < fc.floor ? ' neg' : '')}><CountUp value={fc.minBalance} format={(c) => formatMoney(c, { whole: true, dollarSign: true })} /></span>
              <span className="sign-note">{fc.minBalance < fc.floor ? `Under the floor on ${shortDate(fc.minDate)}` : `On ${shortDate(fc.minDate)}, still above the floor`}</span>
            </Link>
          )}
          {!canSeeBank && (
            <Link className="sign-cell" to="/cash">
              <span className="sign-label">Cash in the store</span>
              <span className="sign-digits"><CountUp value={cash} format={(c) => formatMoney(c, { whole: true, dollarSign: true })} /></span>
              <span className="sign-note">Registers and safe</span>
            </Link>
          )}
          <Link className="sign-cell" to={`/reports/pnl?from=${month}&to=${month}`}>
            <span className="sign-label">{partial ? `Profit so far in ${periodLabel(month).split(' ')[0]}` : `Profit in ${periodLabel(month)}`}</span>
            <span className={'sign-digits' + (mtd.netIncome.total < 0 ? ' neg' : ' pos')}><CountUp value={mtd.netIncome.total} format={(c) => formatMoney(c, { whole: true, dollarSign: true })} /></span>
            <span className="sign-note">On {formatMoney(mtd.netSales.total, { whole: true, dollarSign: true })} net sales</span>
          </Link>
          <a className="sign-cell" href="#inbox-h">
            <span className="sign-label">To do</span>
            <span className="sign-digits"><CountUp value={open} format={(n) => String(n)} /></span>
            <span className="sign-note">{open ? `${todo.length} kind${todo.length === 1 ? '' : 's'} of work, below` : 'All clear: nothing waiting'}</span>
          </a>
        </section>

        <CompassLine />

        <div className={salesDays.length ? 'grid-2' : undefined}>
          <section className="panel" aria-labelledby="inbox-h">
            <div className="panel-head"><h2 id="inbox-h">To do</h2><span className="muted small">{open ? `${open} item${open === 1 ? '' : 's'}` : 'Nothing waiting'}</span></div>
            {todo.length ? (
              <ul className="inbox">
                {shown.map((i) => (
                  <li key={i.key}>
                    <span className="n">{i.count}</span>
                    <span className="what"><b>{i.title}</b><span>{i.detail}</span></span>
                    <Link className="btn sm" to={i.to} aria-label={`${i.action}: ${i.title}`}>{i.action}</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-line">All the lights are green. Nothing needs you right now.</p>}
            {todo.length > TOP && (
              <button type="button" className="btn show-all" aria-expanded={all} onClick={() => setAll((a) => !a)}>
                {all ? 'Show the top 8 only' : `Show all ${todo.length} kinds of work`}
              </button>
            )}
            {all && later.length > 0 && (
              <>
                <h3 className="inbox-sub">When you have time</h3>
                <ul className="inbox">
                  {later.map((i) => (
                    <li key={i.key}>
                      <span className="n">{i.count}</span>
                      <span className="what"><b>{i.title}</b><span>{i.detail}</span></span>
                      <Link className="btn sm" to={i.to} aria-label={`${i.action}: ${i.title}`}>{i.action}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {clear.length > 0 && (
              <details className="inbox-clear">
                <summary>{clear.length} other check{clear.length === 1 ? ' is' : 's are'} clear</summary>
                <ul className="inbox">
                  {clear.map((i) => (
                    <li key={i.key}>
                      <span className="n zero">0</span>
                      <span className="what"><b>{i.title}</b><span>{i.detail}</span></span>
                      <span className="pill ok">Clear</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {salesDays.length > 0 && <section className="panel" aria-labelledby="glance-h">
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
          </section>}
        </div>
      </div>
      <Help k="today" />
    </>
  );
}
