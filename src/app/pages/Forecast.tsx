import { Fragment, useMemo, useState } from 'react';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import { forecast, saveForecastItem, setPatternIncluded } from '../../core/forecast';
import { addDays, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { bankStoreId } from '../../core/bank';
import type { ForecastItem } from '../../core/types';

export function ForecastPage() {
  const { state, books, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const today = todayInChicago();
  const accountId = 'acct_trustmark';
  const f = useMemo(() => forecast(state, accountId, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null);
  const canEdit = can(user, 'bank.reconcile');
  const [item, setItem] = useState({ label: '', amount: '', dir: 'out', cadence: 'once' as ForecastItem['cadence'], start: addDays(today, 7), end: '' });
  const [errors, setErrors] = useState<string[]>([]);
  if (!visible.has(bankStoreId(state))) return <PageHead title="Cash forecast" lede="Your role doesn't include the company bank accounts." />;
  const maxAbs = Math.max(...f.weeks.map((w) => Math.abs(w.ending)), f.floor, 1);
  const below = f.weeks.filter((w) => w.belowFloor);
  const totalIn = f.weeks.reduce((a, w) => a + w.inflows, 0);
  const totalOut = f.weeks.reduce((a, w) => a + w.outflows, 0);
  const disabled = new Set(state.settings.forecastDisabled);
  return (
    <>
      <PageHead eyebrow="Bank & cash" title="13-week cash forecast" lede={<>Trustmark, starting from today's book balance. {below.length ? <span className="neg">{below.length} week{below.length === 1 ? '' : 's'} below the {formatMoney(f.floor, { dollarSign: true, whole: true })} floor.</span> : <>Stays above the {formatMoney(f.floor, { dollarSign: true, whole: true })} floor all 13 weeks.</>}</>}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('cash-forecast-13-weeks', ['Week starting', 'Week ending', 'Inflows', 'Outflows', 'Ending balance'], f.weeks.map((w) => [w.start, w.end, csvMoney(w.inflows), csvMoney(w.outflows), csvMoney(w.ending)]))}>Export CSV</button>}
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
      </PageHead>
      <section className="figures" style={{ marginBottom: 20 }} aria-label="Projected balances">
        <Figure label="Today (books)" value={<Money c={f.opening} whole dollar />} />
        {[7, 14, 30].map((n) => <Figure key={n} label={`In ${n} days`} value={<Money c={f.at(n)} whole dollar className={f.at(n) < f.floor ? 'neg' : undefined} />} note={shortDate(addDays(today, n))} />)}
        <Figure label="Lowest point" value={<Money c={f.minBalance} whole dollar className={f.minBalance < f.floor ? 'neg' : undefined} />} note={`${shortDate(f.minDate)} · ${formatMoney(f.minBalance - f.floor, { dollarSign: true, whole: true })} vs floor`} />
      </section>

      <section className="panel" aria-labelledby="fc-h" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2 id="fc-h">Week by week</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Week</th><th scope="col" className="num">Inflows</th><th scope="col" className="num">Outflows</th><th scope="col" className="num">Ending balance</th><th scope="col" className="hide-phone" style={{ width: '28%' }}>Against the floor</th><th scope="col"><span className="sr-only">Detail</span></th></tr></thead>
          <tbody>{f.weeks.map((w) => (
            <Fragment key={w.start}>
              <tr>
                <td style={{ whiteSpace: 'nowrap' }}>{shortDate(w.start)} – {shortDate(w.end).replace(/, \d{4}$/, '')}</td>
                <td className="num pos"><Money c={w.inflows} whole /></td>
                <td className="num"><Money c={-w.outflows} whole /></td>
                <td className={'num ' + (w.belowFloor ? 'neg' : '')} style={{ fontWeight: 600 }}><Money c={w.ending} whole /></td>
                <td className="hide-phone" aria-hidden="true">
                  <div style={{ position: 'relative', height: 14, background: 'var(--panel-2)', borderRadius: 3 }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(0, (w.ending / maxAbs) * 100)}%`, background: w.belowFloor ? 'var(--neg)' : 'var(--ink-2)', borderRadius: 3, opacity: 0.75 }} />
                    <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${(f.floor / maxAbs) * 100}%`, borderLeft: '2px solid var(--accent)' }} title="Floor" />
                  </div>
                </td>
                <td><button className="btn sm ghost" aria-expanded={open === w.start} onClick={() => setOpen(open === w.start ? null : w.start)}>{open === w.start ? 'Hide' : `${w.events.length} items`}</button></td>
              </tr>
              {open === w.start && (
                <tr><td colSpan={6} style={{ background: 'var(--panel-2)' }}>
                  <table className="t"><tbody>{w.events.map((e, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{shortDate(e.date)}</td><td>{e.label}{e.source === 'manual' && <span className="pill" style={{ marginLeft: 6 }}>added</span>}</td><td className="num"><Money c={e.amount} /></td></tr>)}</tbody></table>
                </td></tr>
              )}
            </Fragment>
          ))}
            <tr className="total"><td>13 weeks</td><td className="num"><Money c={totalIn} whole /></td><td className="num"><Money c={-totalOut} whole /></td><td className="num"><Money c={f.weeks.at(-1)!.ending} whole /></td><td className="hide-phone" /><td /></tr>
          </tbody>
        </table></div>
        <TieOut items={[{ label: f.opening + totalIn - totalOut === f.weeks.at(-1)!.ending ? 'Opening + inflows − outflows = ending' : 'Roll-forward does not tie', ok: f.opening + totalIn - totalOut === f.weeks.at(-1)!.ending }]} />
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="pat-h">
          <div className="panel-head"><h2 id="pat-h">Recurring items found</h2><span className="muted small">last 13 weeks of the books</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Include</th><th scope="col">Item</th><th scope="col">Repeats</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>
              {f.patterns.map((p) => (
                <tr key={p.key}>
                  <td><input type="checkbox" aria-label={`Include ${p.label}`} disabled={!canEdit} checked={!disabled.has(p.key)} onChange={(e) => { setPatternIncluded(books, user, p.key, p.label, e.target.checked); say(e.target.checked ? 'Included.' : 'Left out of the forecast.'); }} /></td>
                  <td className="trunc" title={p.label}>{p.label}</td>
                  <td className="small">{p.cadence === 'monthly' ? `Monthly, day ${p.anchor}` : p.cadence === 'weekly' ? `Weekly, ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.anchor]}` : 'Several times a week (weekly total)'}</td>
                  <td className="num"><Money c={p.amount} /></td>
                </tr>
              ))}
              <tr>
                <td><input type="checkbox" aria-label="Include cash at HQ" disabled={!canEdit} checked={!disabled.has('cash_in_transit')} onChange={(e) => setPatternIncluded(books, user, 'cash_in_transit', 'Cash at HQ', e.target.checked)} /></td>
                <td>Cash at HQ waiting to be deposited</td><td className="small">Once, tomorrow</td><td className="num"><Money c={f.weeks[0].events.find((e) => e.key === 'cash_in_transit')?.amount ?? 0} /></td>
              </tr>
            </tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="add-h">
          <div className="panel-head"><h2 id="add-h">Items you added</h2></div>
          {state.forecastItems.length > 0 && (
            <table className="t"><tbody>{state.forecastItems.map((it) => (
              <tr key={it.id}><td><input type="checkbox" aria-label={`Include ${it.label}`} disabled={!canEdit} checked={it.active} onChange={(e) => saveForecastItem(books, user, { ...it, active: e.target.checked })} /></td><td>{it.label}<div className="muted small">{it.cadence === 'once' ? shortDate(it.start) : `${it.cadence} from ${shortDate(it.start)}`}{it.end ? ` to ${shortDate(it.end)}` : ''}</div></td><td className="num"><Money c={it.amount} /></td></tr>
            ))}</tbody></table>
          )}
          {canEdit && (
            <div className="panel-pad">
              <Errors errors={errors} />
              <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="fi-l">What</label><input id="fi-l" value={item.label} placeholder="e.g. Property tax HM13" onChange={(e) => setItem({ ...item, label: e.target.value })} /></div>
                <div className="field"><label htmlFor="fi-d">Direction</label><select id="fi-d" value={item.dir} onChange={(e) => setItem({ ...item, dir: e.target.value })}><option value="out">Money out</option><option value="in">Money in</option></select></div>
                <div className="field"><label htmlFor="fi-a">Amount</label><input id="fi-a" className="num" inputMode="decimal" value={item.amount} onChange={(e) => setItem({ ...item, amount: e.target.value })} /></div>
                <div className="field"><label htmlFor="fi-c">Repeats</label><select id="fi-c" value={item.cadence} onChange={(e) => setItem({ ...item, cadence: e.target.value as ForecastItem['cadence'] })}><option value="once">Once</option><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option></select></div>
                <div className="field"><label htmlFor="fi-s">{item.cadence === 'once' ? 'Date' : 'Starting'}</label><input id="fi-s" type="date" value={item.start} onChange={(e) => setItem({ ...item, start: e.target.value })} /></div>
                {item.cadence !== 'once' && <div className="field"><label htmlFor="fi-e">Until (optional)</label><input id="fi-e" type="date" value={item.end} onChange={(e) => setItem({ ...item, end: e.target.value })} /></div>}
              </div>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn primary sm" onClick={() => {
                  const v = parseMoney(item.amount);
                  try {
                    saveForecastItem(books, user, { id: books.nextId('fi'), label: item.label, amount: v === null ? NaN : Math.abs(v) * (item.dir === 'out' ? -1 : 1), cadence: item.cadence, start: item.start, end: item.end || undefined, active: true });
                    setItem({ ...item, label: '', amount: '' }); setErrors([]); say('Added to the forecast.');
                  } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); }
                }}>Add to forecast</button>
              </div>
            </div>
          )}
        </section>
      </div>
      {toast}
      <Help k="forecast" />
    </>
  );
}
