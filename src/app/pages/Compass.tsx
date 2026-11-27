import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, PageHead, TieOut, useToast } from '../components/ui';
import { ExportButtons, useEntries } from '../components/reportkit';
import {
  ROLE_HINT, ROLE_LABEL, STAGES, STAGE_LABEL, assumptions, compassChange, compassInputs, compassOf, compassRows, compassSensitivity, compassVerdict, recordCompass,
  saveCompassSettings, type GateStatus, type Verdict,
} from '../../core/compass';
import { growthOf } from '../../core/growth';
import { periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import type { CompassSettings } from '../../core/types';

const usd = (c: number) => formatMoney(Math.round(c), { dollarSign: true, whole: true });
const pc = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`);
const ptsS = (v: number | null) => (v === null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)} pts`);
const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const GATE_PILL: Record<GateStatus, string> = { pass: 'ok', fail: 'bad', na: 'warn' };
const GATE_LABEL: Record<GateStatus, string> = { pass: 'Pass', fail: 'Fail', na: "Can't tell yet" };
/** Months of sales shown in the same-store table (the latest). */
const SS_MONTHS = 6;
const ROLE_PILL = { grow: 'ok', harvest: '', fix: 'bad', watch: 'warn' } as const;

function Panel({ id, title, extra, children }: { id: string; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head"><h2 id={id}>{title}</h2>{extra && <span className="muted small">{extra}</span>}</div>
      {children}
    </section>
  );
}

/** The live verdict and its sensitivity, recomputed when the books change. */
function useCompass(): { v: Verdict; sens: ReturnType<typeof compassSensitivity> } {
  const { state, version } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  return useMemo(() => {
    const cs = compassOf(state).settings;
    const gs = growthOf(state).settings;
    const gt = { dscr: gs.dscrTarget, leverage: gs.leverageTarget };
    const inputs = compassInputs(state, today, { entries, settings: cs });
    return { v: compassVerdict(inputs, cs, gt), sens: compassSensitivity(inputs, cs, gt) };
  }, [state, version, entries, today]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One line on Today: the stage and the first move. */
export function CompassLine() {
  const { state, user, version } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  const ok = can(user, 'view.reports') && can(user, 'view.all_stores');
  const v = useMemo(() => {
    if (!ok) return null;
    const cs = compassOf(state).settings;
    const gs = growthOf(state).settings;
    return compassVerdict(compassInputs(state, today, { entries, settings: cs }), cs, { dscr: gs.dscrTarget, leverage: gs.leverageTarget });
  }, [state, version, entries, today, ok]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return null;
  const m = v.moves[0];
  return <p className="note compass-today"><Link to="/growth/compass">Growth compass: {STAGE_LABEL[v.stage]}</Link>{m ? <> · next move: {m.title}</> : null}</p>;
}

const pctField = (bps?: number) => (bps === undefined ? '' : String(bps / 100));
const xField = (h?: number) => (h === undefined ? '' : (h / 100).toFixed(2));
type Form = Record<keyof CompassSettings, string>;
const toForm = (s: CompassSettings): Form => ({
  costOfEquityBps: pctField(s.costOfEquityBps), taxRateBps: pctField(s.taxRateBps), basis: s.basis ?? '', cashConversionMinPct: String(s.cashConversionMinPct), reserveCushionPct: String(s.reserveCushionPct),
  valueStoreSharePct: String(s.valueStoreSharePct), dscrAfterTarget: xField(s.dscrAfterTarget), leverageAfterTarget: xField(s.leverageAfterTarget), rampMinPct: String(s.rampMinPct),
  scaleMonths: String(s.scaleMonths), scaleFundMonths: String(s.scaleFundMonths), growSpreadPts: String(s.growSpreadPts), growVolumePct: String(s.growVolumePct),
  watchMonths: String(s.watchMonths), shockCpg: String(s.shockCpg), shockGallonsPct: String(s.shockGallonsPct),
});
const num = (s: string) => { const n = Number(s.replace(/[,%x¢\s]/g, '')); return s.trim() && Number.isFinite(n) ? n : NaN; };
function fromForm(f: Form): Partial<CompassSettings> {
  const opt = (s: string, k: number) => (s.trim() ? Math.round(num(s) * k) : undefined);
  return {
    costOfEquityBps: Math.round(num(f.costOfEquityBps) * 100), taxRateBps: opt(f.taxRateBps, 100), basis: (f.basis || undefined) as CompassSettings['basis'],
    cashConversionMinPct: num(f.cashConversionMinPct), reserveCushionPct: num(f.reserveCushionPct), valueStoreSharePct: num(f.valueStoreSharePct),
    dscrAfterTarget: opt(f.dscrAfterTarget, 100), leverageAfterTarget: opt(f.leverageAfterTarget, 100), rampMinPct: num(f.rampMinPct),
    scaleMonths: num(f.scaleMonths), scaleFundMonths: num(f.scaleFundMonths), growSpreadPts: num(f.growSpreadPts), growVolumePct: num(f.growVolumePct),
    watchMonths: num(f.watchMonths), shockCpg: num(f.shockCpg), shockGallonsPct: num(f.shockGallonsPct),
  };
}
const FIELD: Record<keyof CompassSettings, { label: string; hint: string }> = {
  costOfEquityBps: { label: 'Cost of equity %', hint: 'A judgement call: what the owners could earn elsewhere at this risk. Default 15%.' },
  taxRateBps: { label: 'Tax rate %', hint: 'Blank: the owner rate from the tax tables.' },
  basis: { label: 'P&L basis', hint: 'Blank: the covenant basis from the Debt settings.' },
  cashConversionMinPct: { label: 'Cash conversion at least %', hint: 'Free cash flow ÷ EBITDA. Default 60%.' },
  reserveCushionPct: { label: 'Reserve cushion %', hint: 'Cash above the reserve as % of the target. Default 10%.' },
  valueStoreSharePct: { label: 'Stores creating value %', hint: 'Share of measured stores with a positive spread. Default 75%.' },
  dscrAfterTarget: { label: 'DSCR after the new loan (x)', hint: 'Blank: the growth DSCR target.' },
  leverageAfterTarget: { label: 'Leverage after the deal (x)', hint: 'Blank: the growth leverage target.' },
  rampMinPct: { label: 'Ramp at least %', hint: 'Of the newest store’s targets. Default 100%.' },
  scaleMonths: { label: 'Months the gates must hold', hint: 'Before Scale. Default 3.' },
  scaleFundMonths: { label: 'Months to fund the store after next', hint: 'For Scale. Default 6.' },
  growSpreadPts: { label: 'Grow: spread at least (pts)', hint: 'Default 10 points.' },
  growVolumePct: { label: 'Grow: gallons up at least %', hint: 'On the month before. Default 2%.' },
  watchMonths: { label: 'Watch: months open under', hint: 'Default 12.' },
  shockCpg: { label: 'Sensitivity: fuel margin ¢', hint: 'Either way. Default 2¢.' },
  shockGallonsPct: { label: 'Sensitivity: gallons %', hint: 'Either way. Default 10%.' },
};

export function CompassPage() {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const ok = can(user, 'view.reports') && can(user, 'view.all_stores');
  const edit = can(user, 'growth.edit');
  const today = todayInChicago();
  const { v, sens } = useCompass();
  const cs = compassOf(state).settings;
  const [form, setForm] = useState<Form>(() => toForm(cs));
  if (!ok) return <PageHead eyebrow="Growth" title="Growth compass" lede="Your role doesn't include the growth screens." />;
  const i = v.inputs;
  const ch = compassChange(state, { stage: v.stage, period: i.period });
  const hist = [...compassOf(state).history].sort((a, b) => b.period.localeCompare(a.period));
  const recorded = hist.find((h) => h.period === i.period);
  const stageIdx = STAGES.findIndex((s) => s.key === v.stage);
  const rows = compassRows(v);
  const ann = i.annualized ? `annualized from ${i.months} month${i.months === 1 ? '' : 's'}` : 'trailing twelve months';
  const save = () => { setErrors([]); try { saveCompassSettings(books, user, fromForm(form)); say('Assumptions saved. The verdict is recalculated.'); } catch (e) { setErrors(errList(e)); } };
  const ruleOk = (() => { for (const s of STAGES.slice(0, 4)) if (v.gates.some((g) => g.stage === s.key && g.status !== 'pass')) return v.stage === s.key; return v.stage === 'scale'; })();
  const capOk = i.company.capital.fixed + i.company.capital.inventory + i.company.capital.workingCapital === i.company.capital.total;
  return (
    <>
      <PageHead eyebrow="Growth" title="Growth compass" lede={`When to grow, and what to do first. One verdict from return on capital, cash and debt capacity, through five explicit gates. Read on ${periodLabel(i.from)}${i.from !== i.period ? ` – ${periodLabel(i.period)}` : ''}, ${i.basis} basis, ${ann}.`}>
        <ExportButtons name={`growth-compass-${i.period}`} header={['Section', 'Item', 'Value', 'Detail', 'More']} rows={rows} sheet="Growth compass" />
        {edit && <button className="btn primary" onClick={() => { try { recordCompass(books, user, today); say(`${periodLabel(i.period)} recorded: ${STAGE_LABEL[v.stage]}.`); } catch (e) { setErrors(errList(e)); } }}>{recorded ? 'Record again' : `Record ${periodLabel(i.period)}`}</button>}
      </PageHead>
      {toast}
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel compass-verdict" aria-labelledby="cp-verdict">
          <div className="panel-pad">
            <h2 id="cp-verdict" className="sr-only">Verdict</h2>
            <ol className="compass-ladder" aria-label="Growth stages">
              {STAGES.map((s, k) => <li key={s.key} className={k === stageIdx ? 'on' : k < stageIdx ? 'past' : ''} aria-current={k === stageIdx ? 'step' : undefined}><span className="n">{k + 1}</span>{s.label}</li>)}
            </ol>
            <p className="compass-stage" data-testid="compass-stage">{STAGE_LABEL[v.stage]}</p>{v.provisional && <p className="muted small" style={{ margin: '0 0 4px' }}>Provisional: some gates can't be judged on these books yet.</p>}
            <p className="compass-why">{v.sentence}</p>
            <p className="compass-spread" style={{ margin: '0 0 6px' }}>
              ROIC − WACC: <b className={v.company.spread === null ? undefined : v.company.spread >= 0 ? 'pos' : 'neg'}>{v.company.spread === null ? "can't tell yet" : ptsS(v.company.spread)}</b>
              <span className="muted"> (ROIC {v.company.roic === null ? 'not measurable without fixed assets' : pc(v.company.roic)} vs WACC {pc(v.wacc.wacc)})</span>
            </p>
            <p className="muted small" style={{ margin: 0 }}>{STAGES[stageIdx].definition}</p>
          </div>
        </section>
        {v.missing.length > 0 && <div className="note warn" role="note"><b>Can't tell yet on these books{v.provisional ? ' (the stage is provisional)' : ''}:</b><ul>{v.missing.map((m) => <li key={m.key}>{m.label}: needs {m.needs}.</li>)}</ul></div>}
        {ch.changed && <div className="note warn" role="status">{ch.message}</div>}
        <section className="figures" aria-label="Returns and cash">
          <Figure label="ROIC − WACC" value={<span className={v.company.spread === null ? undefined : v.company.spread >= 0 ? 'pos' : 'neg'}>{ptsS(v.company.spread)}</span>} note={v.company.spread === null ? 'No invested capital to measure' : v.company.spread >= 0 ? 'Creating value' : 'Earning less than the capital costs'} />
          <Figure label="Company ROIC vs WACC" value={<>{v.company.roic === null ? "Can't tell yet" : pc(v.company.roic)}<span className="muted"> vs {pc(v.wacc.wacc)}</span></>} note={v.company.roic === null ? `Needs fixed assets on the books; cost of equity ${pc(v.wacc.costOfEquity)} (a judgement call)` : `NOPAT ${usd(v.company.nopatAnnual)} ÷ ${usd(i.company.capital.total)} invested; cost of equity ${pc(v.wacc.costOfEquity)} (a judgement call)`} />
          <Figure label="Months to fund the next store" value={v.cash.monthsToFund === null ? (v.gates.find((g) => g.key === 'equity')?.status === 'na' ? "Can't tell yet" : '–') : String(v.cash.monthsToFund)} note={i.cash.equityKnown ? `${usd(i.cash.equityNeed)} equity; ${usd(Math.max(0, i.cash.deployable))} above the reserve` : 'No pro forma or next-store equity on file'} href="/growth/capital" />
          <Figure label="Free cash flow" value={v.cash.fcfAnnual === null ? "Can't tell yet" : usd(v.cash.fcfAnnual)} note={v.cash.fcfAnnual === null ? 'Needs bank activity, not just a P&L' : `A year; ${pc(v.cash.conversion, 0)} of EBITDA`} href={`/reports/cash-flow?from=${i.from}&to=${i.period}`} />
          <Figure label="Bank vs floor" value={i.bank.accounts.length && i.bank.known ? <span className={i.bank.balance < i.bank.floor ? 'neg' : undefined}>{usd(i.bank.balance)}</span> : "Can't tell yet"} note={i.bank.accounts.length ? `Floor ${usd(i.bank.floor)}${i.bank.lastDate && i.bank.lastDate < i.asOf ? `; last entry ${shortDate(i.bank.lastDate)}` : ''}` : 'No floor set'} href="/bank" />
        </section>

        <Panel id="cp-gates-h" title="The gates" extra={`${STAGES[stageIdx].next}: ${v.gates.filter((g) => g.stage === v.stage && g.status === 'pass').length} of ${v.gates.filter((g) => g.stage === v.stage).length} pass`}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Stage</th><th scope="col">Gate</th><th scope="col">Result</th><th scope="col">Now</th><th scope="col">Threshold</th><th scope="col">How it was measured</th></tr></thead>
            <tbody>{v.gates.map((g) => (
              <tr key={g.key} className={g.stage === v.stage ? 'compass-current' : undefined}>
                <td className="small">{STAGE_LABEL[g.stage]} →</td>
                <td><Link to={g.to}>{g.label}</Link></td>
                <td><span className={'pill ' + GATE_PILL[g.status]}>{GATE_LABEL[g.status]}</span></td>
                <td>{g.value}</td><td className="small">{g.target}</td><td className="small" style={{ minWidth: 260 }}>{g.detail}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: 'The stage is the first rung with a gate that does not pass', ok: ruleOk },
            { label: recorded ? `${periodLabel(i.period)} is in the history` : `${periodLabel(i.period)} not recorded yet`, ok: !!recorded, detail: recorded ? STAGE_LABEL[recorded.stage] : hist[0] ? `last recorded ${periodLabel(hist[0].period)}: ${STAGE_LABEL[hist[0].stage]}` : undefined },
          ]} />
        </Panel>

        <Panel id="cp-moves-h" title="Next three moves" extra="What clears a failing gate first, then by estimated value a year">
          {v.moves.length ? <ol className="compass-moves">{v.moves.map((m) => (
            <li key={m.key}>
              <div className="compass-move-head"><b>{m.title}</b><span className="num">{m.value === null ? '' : `${usd(m.value)}${m.valueKind === 'annual' ? ' a year' : ' at risk'}`}</span></div>
              <p className="small" style={{ margin: '2px 0 4px' }}>{m.why}</p>
              <Link className="small" to={m.to}>{m.linkLabel}</Link>
            </li>
          ))}</ol> : <p className="panel-pad muted">Nothing to rank: no store lever, project, debt or deal on file.</p>}
        </Panel>

        <Panel id="roles-h" title="Store roles" extra="Store ROIC is before corporate overhead">
          <div className="compass-roles">{v.stores.map((s) => {
            const x = s.input;
            const last = x.monthly.at(-1);
            return (
              <article key={x.storeId} className="compass-card" aria-label={`${x.code} ${ROLE_LABEL[s.role]}`}>
                <div className="compass-card-head"><b>{x.code} {x.name}</b><span className={'pill ' + ROLE_PILL[s.role]}>{ROLE_LABEL[s.role]}</span></div>
                <p className="muted small" style={{ margin: '0 0 6px' }}>{ROLE_HINT[s.role]}</p>
                <dl className="compass-dl">
                  <dt>ROIC</dt><dd>{pc(s.roic)}</dd>
                  <dt>Spread</dt><dd className={s.spread === null ? undefined : s.spread >= 0 ? 'pos' : 'neg'}>{ptsS(s.spread)}</dd>
                  <dt>Profit a gallon, all-in</dt><dd>{s.profitPerGallon === null ? '–' : `${s.profitPerGallon.toFixed(1)}¢`}</dd>
                  <dt>Profit a month</dt><dd>{s.profitPerMonth === null ? '–' : usd(s.profitPerMonth)}</dd>
                  <dt>Fuel margin</dt><dd>{x.fuelCpg === null ? '–' : `${x.fuelCpg.toFixed(1)}¢${x.fuelSource === 'pnl' ? ' (P&L)' : ''}`}</dd>
                  <dt>Margin a transaction</dt><dd>{x.traffic ? `${usd(x.traffic.marginPerTxn)}` : 'No POS counts'}</dd>
                  <dt>Labor</dt><dd>{s.laborPct === null ? '–' : `${s.laborPct.toFixed(1)}% vs ${x.laborTargetPct.toFixed(1)}%`}</dd>
                  <dt>Break-even headroom</dt><dd>{pc(x.breakEvenSafety)}</dd>
                  <dt>Sales vs month before</dt><dd>{s.salesChange === null ? 'One month only' : `${s.salesChange >= 0 ? '+' : ''}${pc(s.salesChange)}`}</dd>
                  <dt>Vs budget{x.budget ? ` (${periodLabel(x.budget.period).split(' ')[0]})` : ''}</dt><dd>{x.budget && x.budget.budgetSales ? `${x.budget.sales >= x.budget.budgetSales ? '+' : ''}${pc((x.budget.sales - x.budget.budgetSales) / x.budget.budgetSales)} sales` : 'No budget'}</dd>
                </dl>
                <p className="small" style={{ margin: '8px 0 0' }}>{s.roleWhy}</p>
                {s.mainLever && s.role !== 'watch' && <p className="small" style={{ margin: '4px 0 0' }}><Link to={s.mainLever.to}>Main lever: {s.mainLever.label}</Link> (about {usd(s.mainLever.gap)} a year)</p>}
                {last && <span className="sr-only">{periodLabel(last.period)} sales {usd(last.sales)}</span>}
              </article>
            );
          })}</div>
          <p className="panel-pad muted small" style={{ margin: 0 }}>Margin a transaction = average ticket × inside and kitchen margin, on the days with an imported POS customer count{v.stores.some((s) => s.input.traffic) ? ` (${Math.max(...v.stores.map((s) => s.input.traffic?.days ?? 0))} days on file)` : ''}. Break-even headroom is on the accrual basis (Budgets › Break-even).</p>
        </Panel>

        <Panel id="cp-ss-h" title="Same-store growth" extra={i.hasPriorYear ? 'Month over month and against the budget' : `No prior year on these books: they start ${i.firstPeriod ? periodLabel(i.firstPeriod) : 'empty'}, so this is month over month and against the budget only`}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th>{(v.stores[0]?.input.monthly ?? []).slice(-SS_MONTHS).map((m) => <th key={m.period} scope="col" className="num">{periodLabel(m.period)} sales</th>)}<th scope="col" className="num">Month over month</th><th scope="col" className="num">Gallons, month over month</th><th scope="col" className="num">Vs budget</th><th scope="col">Trend</th></tr></thead>
            <tbody>{v.stores.map((s) => <tr key={s.input.storeId}>
              <td>{s.input.code}</td>
              {s.input.monthly.slice(-SS_MONTHS).map((m) => <td key={m.period} className="num">{usd(m.sales)}</td>)}
              <td className="num">{s.salesChange === null ? '–' : pc(s.salesChange)}</td>
              <td className="num">{s.volumeChange === null ? '–' : pc(s.volumeChange)}</td>
              <td className="num">{s.input.budget && s.input.budget.budgetSales ? pc((s.input.budget.sales - s.input.budget.budgetSales) / s.input.budget.budgetSales) : '–'}</td>
              <td>{s.trend === 'na' ? 'Not enough months' : s.trend === 'up' ? 'Up' : s.trend === 'down' ? 'Down' : 'Flat'}</td>
            </tr>)}</tbody>
          </table></div>
        </Panel>

        <div className="grid-2">
          <Panel id="cp-cash-h" title="Cash engine and capacity">
            <div className="table-wrap"><table className="t">
              <tbody>
                {i.cash.known ? <>
                  <tr><th scope="row">Operating cash flow</th><td className="num">{usd(i.cash.operating)}</td></tr>
                  <tr><th scope="row">Less capex</th><td className="num">{usd(i.cash.capex)}</td></tr>
                  <tr className="total"><th scope="row">Free cash flow ({i.months} month{i.months === 1 ? '' : 's'})</th><td className="num">{usd(i.cash.fcf)}</td></tr>
                </> : <tr><th scope="row">Free cash flow</th><td className="small">Can't tell yet: {usd(i.cash.placeholder)} of profit sits on the import's settlement clearing account, not in the bank. Import the bank statements (Bank) to measure cash.</td></tr>}
                <tr><th scope="row">Bank vs floor</th><td className="num">{i.bank.accounts.length ? `${usd(i.bank.balance)} vs ${usd(i.bank.floor)}` : 'No floor set'}</td></tr>
                <tr><th scope="row">Bank and overdraft fees</th><td className="num">{i.fees.count ? `${i.fees.count} charge${i.fees.count === 1 ? '' : 's'}, ${usd(i.fees.total)}` : 'None'}</td></tr>
                <tr><th scope="row">Cash conversion (FCF ÷ EBITDA)</th><td className="num">{pc(v.cash.conversion)}</td></tr>
                <tr><th scope="row">Cash vs reserve</th><td className="num">{usd(i.cash.cash)} vs {i.cash.reserveGaps.length ? `${usd(i.cash.reserveTarget)} so far (incomplete)` : usd(i.cash.reserveTarget)}</td></tr>
                <tr><th scope="row">Deployable</th><td className="num">{i.cash.reserveGaps.length ? "Can't tell yet" : usd(i.cash.deployable)}</td></tr>
                <tr><th scope="row">DSCR today</th><td className="num">{i.capacity.dscr === null ? '–' : `${i.capacity.dscr.toFixed(2)}x`}</td></tr>
                <tr><th scope="row">DSCR after {i.capacity.dealName ?? 'a new loan'}</th><td className="num">{v.capacity.dscrAfter === null ? '–' : `${v.capacity.dscrAfter.toFixed(2)}x`}</td></tr>
                <tr><th scope="row">Leverage after the deal</th><td className="num">{v.capacity.leverageAfter === null ? "Can't tell yet" : `${v.capacity.leverageAfter.toFixed(2)}x`}</td></tr>
                <tr><th scope="row">Newest store ramp{i.ramp ? ` (${i.ramp.code})` : ''}</th><td className="num">{i.ramp?.rows.at(-1) ? `${pc(i.ramp.rows.at(-1)!.gallonsPct)} gal · ${pc(i.ramp.rows.at(-1)!.insidePct)} inside` : 'No targets'}</td></tr>
              </tbody>
            </table></div>
            <TieOut items={[
              { label: 'Free cash flow ties to the cash flow statement', ok: i.ties.cashFlow && i.ties.cashFlowNetIncome, detail: `operating ${usd(i.cash.operating)} and capex ${usd(i.cash.capex)} from the statement; its net income ${usd(i.tieDetail.cfNetIncome)} = the booked P&L ${usd(i.tieDetail.bookedNetIncome)}` },
            ]} />
          </Panel>
          <Panel id="cp-trig-h" title={`Open store #${i.nextStoreNumber} when …`} extra={v.stage === 'replicate' || v.stage === 'scale' ? 'Ready for one store; these are the gates to a pipeline' : undefined}>
            {v.triggers.length ? <ul className="compass-triggers">{v.triggers.map((t) => (
              <li key={t.gate}>
                <b>{t.label}</b>: {t.target} <span className="muted">(now {t.now})</span>
                <div className="small">{t.etaDate ? <>Estimated {shortDate(t.etaDate)}: {t.eta}.</> : <>{t.eta[0].toUpperCase() + t.eta.slice(1)}.</>}</div>
              </li>
            ))}</ul> : <p className="panel-pad">Every gate passes.</p>}
          </Panel>
        </div>

        <Panel id="cp-sens-h" title="Sensitivity" extra="Which gate flips first if fuel margin or gallons move; costs, covenants and the reserve held">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">If</th><th scope="col">Stage</th><th scope="col">Gates that flip</th></tr></thead>
            <tbody>
              <tr><td>As today</td><td>{STAGE_LABEL[v.stage]}</td><td className="muted">–</td></tr>
              {sens.scenarios.map((x) => <tr key={x.key}><td>{x.label}</td><td>{STAGE_LABEL[x.stage]}{x.stage !== v.stage && <span className="pill warn" style={{ marginLeft: 6 }}>moves</span>}</td><td className="small">{x.flips.length ? x.flips.map((f) => `${f.label}: ${GATE_LABEL[f.from].toLowerCase()} → ${GATE_LABEL[f.to].toLowerCase()}`).join('; ') : 'None'}</td></tr>)}
            </tbody>
          </table></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Gate</th><th scope="col">Today</th><th scope="col" className="num">Flips at fuel margin</th><th scope="col" className="num">Flips at gallons</th></tr></thead>
            <tbody>{sens.flipPoints.filter((f) => f.cpg !== null || f.gallonsPct !== null).map((f) => <tr key={f.key}><td>{f.label}</td><td><span className={'pill ' + GATE_PILL[f.status]}>{GATE_LABEL[f.status]}</span></td><td className="num">{f.cpg === null ? 'Not within ±10¢' : `${f.cpg > 0 ? '+' : ''}${f.cpg.toFixed(1)}¢`}</td><td className="num">{f.gallonsPct === null ? 'Not within ±30%' : `${f.gallonsPct > 0 ? '+' : ''}${f.gallonsPct}%`}</td></tr>)}</tbody>
          </table></div>
          <p className="panel-pad small" style={{ margin: 0 }}>{sens.firstFlip ? <>First to flip: <b>{sens.firstFlip.label}</b>, at {sens.firstFlip.cpg! > 0 ? '+' : ''}{sens.firstFlip.cpg!.toFixed(1)}¢ a gallon.</> : 'No gate flips within ±10¢ of fuel margin.'} Gates not listed don't move within ±10¢ or ±30% gallons.</p>
        </Panel>

        <Panel id="how-h" title="How this is calculated" extra={edit ? 'Every assumption is editable' : 'Read only for your role'}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Item</th><th scope="col">Formula and source</th><th scope="col">Value</th></tr></thead>
            <tbody>{assumptions(v).map((a) => <tr key={a.key}><td>{a.label}</td><td className="small" style={{ minWidth: 280 }}>{a.formula}</td><td className="small">{a.value}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={[
            { label: 'EBITDA ties to the covenant metrics', ok: i.ties.ebitda, detail: `${usd(i.tieDetail.ebitdaStatement)} from the P&L = ${usd(i.tieDetail.ebitdaMetric)}` },
            { label: 'Every store column adds to the company P&L', ok: i.ties.storesAddUp },
            { label: 'Invested capital ties to the balance sheet', ok: i.ties.capital && capOk && i.ties.balanceSheet, detail: `Σ entities ${usd(i.tieDetail.capitalEntities)} = group ${usd(i.tieDetail.capitalConsolidated)}` },
            { label: 'Debt in the weights ties to the loan accounts', ok: i.ties.debt, detail: `${usd(i.tieDetail.debtBs)} = ${usd(i.tieDetail.debtMetric)}` },
          ]} />
          {edit && <div className="panel-pad">
            <h3 style={{ marginTop: 0 }}>Change the assumptions</h3>
            <div className="form-grid">
              {(Object.keys(FIELD) as (keyof CompassSettings)[]).map((k) => k === 'basis'
                ? <div className="field" key={k}><label htmlFor={`cp-${k}`}>{FIELD[k].label}</label><select id={`cp-${k}`} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}><option value="">Covenant basis ({i.basis})</option><option value="booked">Booked</option><option value="accrual">Accrual</option></select><span className="hint">{FIELD[k].hint}</span></div>
                : <div className="field" key={k}><label htmlFor={`cp-${k}`}>{FIELD[k].label}</label><input id={`cp-${k}`} className="num" inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /><span className="hint">{FIELD[k].hint}</span></div>)}
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={save}>Save assumptions</button>
              <button className="btn" onClick={() => setForm(toForm(compassOf(state).settings))}>Undo changes</button>
            </div>
          </div>}
        </Panel>

        {hist.length > 0 && <Panel id="cp-hist-h" title="History">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col">Stage</th><th scope="col" className="num">ROIC</th><th scope="col" className="num">WACC</th><th scope="col">Ready to replicate</th><th scope="col">Recorded</th></tr></thead>
            <tbody>{hist.map((h) => <tr key={h.period}><td>{periodLabel(h.period)}</td><td>{STAGE_LABEL[h.stage]}</td><td className="num">{h.roicPct === null ? '–' : `${h.roicPct.toFixed(1)}%`}</td><td className="num">{h.waccPct === null ? '–' : `${h.waccPct.toFixed(1)}%`}</td><td>{h.replicateReady ? 'Yes' : 'No'}</td><td className="small">{shortDate(h.at.slice(0, 10))}</td></tr>)}</tbody>
          </table></div>
        </Panel>}
      </div>
      <Help k="growthCompass" />
    </>
  );
}
