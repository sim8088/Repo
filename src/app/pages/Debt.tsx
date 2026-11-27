import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Gauge, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { ExportButtons, useEntries } from '../components/reportkit';
import {
  COVENANT_LABEL, TRIGGER_LABEL, acknowledgeBalance, addMarketRate, addPropertyValue, bpsPct, covLimit, covenantMonitor, debtDashboard, debtOf, defaultProposal,
  deleteScenario, formatCovenant, formatMetric, paydownPlan, propertyValues, ratioX, refinance, refinanceTriggers, relatedPartyLoans, reserveHistory, reserveTarget,
  saveAlternative, saveCovenant, saveDebtSettings, saveRpTerms, saveScenario, validateProposal, RP_LOAN_ACCTS, type CovenantTest, type DebtRow, type RefiProposal,
} from '../../core/debt';
import { LOAN_KIND_LABEL, loansOf, loanStatus } from '../../core/loans';
import { balanceSheet, statement } from '../../core/statements';
import { balanceAsOf } from '../../core/reports';
import { lastDayOfPeriod, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { xlsx, type Cell } from '../../core/xlsx';
import type { AlternativeKind, CovenantKind, ID, LoanKind, ReportBasis } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const usd = (c: number) => formatMoney(c, { dollarSign: true, whole: true });
const pctIn = (s: string) => { const n = Number(s.replace('%', '').trim()); return s.trim() && Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const moneyIn = (s: string) => (s.trim() ? parseMoney(s) ?? NaN : 0);
const pctOut = (bps: number | null | undefined, d = 2) => (bps === null || bps === undefined ? '–' : bpsPct(bps, d));

function NoAccess({ title }: { title: string }) {
  return <PageHead eyebrow="Assets & debt" title={title} lede="Your role doesn't include debt and treasury." />;
}
const STATUS_PILL: Record<CovenantTest['status'], [string, string]> = { ok: ['ok', 'Holds'], near: ['warn', 'Near'], breach: ['bad', 'Breach'], na: ['', 'No data'] };

function useCode() {
  const { state } = useBooks();
  return (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
}

// ── Debt dashboard ───────────────────────────────────────────────────────
export function DebtDashboardPage() {
  const { state, user, visible, version } = useBooks();
  const today = todayInChicago();
  const code = useCode();
  const d = useMemo(() => debtDashboard(state, today, visible), [state, today, visible, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rp = useMemo(() => relatedPartyLoans(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(user, 'view.reports')) return <NoAccess title="Debt dashboard" />;
  const s = debtOf(state).settings;
  const yr = today.slice(0, 4);
  const interestYtd = d.company.reduce((a, r) => a + r.status.interestPaidYtd, 0);
  const projected = d.company.reduce((a, r) => a + r.projected12, 0);
  const nextMat = [...d.company].filter((r) => r.balance > 0).sort((a, b) => (a.balloon?.date ?? a.maturity).localeCompare(b.balloon?.date ?? b.maturity))[0];
  const header = ['Loan', 'Kind', 'Lender', 'Held by', 'Store', 'Balance', 'Rate %', 'After-tax %', 'Fixed / variable', 'Index', 'Payment', 'Next due', 'Maturity', 'Balloon', 'Collateral', 'Guarantor', 'Prepayment penalty', 'Covenants', 'Interest to date', 'Projected interest 12 mo', 'LTV %'];
  const rows = d.rows.map((r) => [r.loan.name, LOAN_KIND_LABEL[r.loan.kind], r.loan.lender, r.heldBy === 'company' ? 'Company' : `${r.carriedBy} (related party)`, code(r.loan.storeId), csvMoney(r.balance), (r.rateBps / 100).toFixed(2), (r.afterTaxBps / 100).toFixed(2), r.loan.rateType, r.loan.index ?? '', csvMoney(r.payment), r.nextDue ?? '', r.maturity, r.balloon ? csvMoney(r.balloon.payment) : '', r.loan.collateral, r.loan.guarantor, r.loan.prepaymentPenalty, [...r.covenants.map(formatCovenantText), ...r.loan.covenants].join(' | '), r.interestToDate === null ? '' : csvMoney(r.interestToDate), csvMoney(r.projected12), r.ltv === null ? '' : (r.ltv * 100).toFixed(1)]);
  const mortgages = d.accountTie.find((t) => t.accountId === 'acct_mortgages');
  const table = (list: DebtRow[]) => (
    <div className="table-wrap"><table className="t">
      <thead><tr><th scope="col">Loan</th><th scope="col" className="num">Balance</th><th scope="col">Rate</th><th scope="col" className="num">Payment</th><th scope="col">Maturity</th><th scope="col">Collateral · guarantor</th><th scope="col">Prepayment penalty</th><th scope="col">Covenants</th><th scope="col" className="num">Interest to date</th><th scope="col" className="num">Projected 12 mo</th></tr></thead>
      <tbody>{list.map((r) => (
        <tr key={r.loan.id}>
          <td><Link to={`/assets/loans/${r.loan.id}`}>{r.loan.name}</Link><div className="muted small">{LOAN_KIND_LABEL[r.loan.kind]} · {r.loan.lender} · {code(r.loan.storeId)}</div>{r.heldBy === 'related_party' && <span className="pill warn">Carried by {r.carriedBy}</span>}</td>
          <td className="num"><Money c={r.balance} />{r.ltv !== null && <div className="muted small">LTV {(r.ltv * 100).toFixed(1)}%</div>}</td>
          <td>{bpsPct(r.rateBps)} <span className="muted small">{r.loan.rateType === 'variable' ? `variable, ${r.loan.index} + ${bpsPct(r.loan.marginBps ?? 0)}` : 'fixed'}</span><div className="muted small">{bpsPct(r.afterTaxBps)} after tax</div></td>
          <td className="num">{r.loan.interestOnly ? <><Money c={r.payment} /><div className="muted small">interest only</div></> : <Money c={r.payment} />}</td>
          <td>{shortDate(r.maturity)}{r.balloon && <div><span className="pill warn">Balloon <Money c={r.balloon.payment} whole dollar /></span></div>}</td>
          <td className="small">{r.loan.collateral || '—'}<div className="muted">{r.loan.guarantor || 'No guarantor'}</div></td>
          <td className="small">{r.loan.prepaymentPenalty || '—'}</td>
          <td className="small">{r.covenants.length ? <Link to="/debt/covenants">{r.covenants.map(formatCovenantText).join('; ')}</Link> : r.loan.covenants.length ? r.loan.covenants.length + ' non-financial' : '—'}</td>
          <td className="num">{r.interestToDate === null ? <span className="muted small">Not ours</span> : <Money c={r.interestToDate} />}</td>
          <td className="num"><Money c={r.projected12} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Debt dashboard" lede="Every loan, mortgage, line of credit, equipment note and related-party loan in one place, with what it costs, when it comes due, and how it ties to the books.">
        <ExportButtons name="debt-dashboard" header={header} rows={rows} sheet="Debt" />
      </PageHead>
      <section className="figures" aria-label="Debt at a glance" style={{ marginBottom: 20 }}>
        <Figure label="Company debt on the books" value={<Money c={d.companyDebt} whole dollar />} note={d.ties ? 'Ties to 2300–2320 and the schedules' : 'Does not tie: see below'} />
        <Figure label="Weighted-average cost of debt" value={pctOut(d.wacdBps)} note={`${pctOut(d.afterTaxWacdBps)} after tax at ${bpsPct(s.taxRateBps, 0)}; ${pctOut(d.wacdAllBps)} with related-party mortgages`} />
        <Figure label={`Interest ${yr} · next 12 months`} value={<Money c={interestYtd} whole dollar />} note={`6500 on the ledger to date ${usd(d.interestLedger)}; ${usd(projected)} projected`} />
        <Figure label="Next maturity" value={nextMat ? shortDate(nextMat.balloon?.date ?? nextMat.maturity) : '—'} note={nextMat ? `${nextMat.loan.name}: ${usd(nextMat.balloon?.payment ?? nextMat.balance)}` : 'Nothing owed'} />
        <Figure label="Carried by related parties" value={<Money c={d.relatedCarried} whole dollar />} note={`${d.related.length} store mortgages, information only`} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="dd-co">
          <div className="panel-head"><h2 id="dd-co">On our books</h2><span className="muted small">Balance by the schedule; interest to date from the payments posted to 6500</span></div>
          {table(d.company)}
          <TieOut items={[
            ...d.accountTie.filter((t) => t.loans || t.ledger).map((t) => { const a = state.accounts.find((x) => x.id === t.accountId)!; return { label: `${a.number} ${a.name} ${t.loans === t.ledger ? 'ties to its loan schedules' : 'is off from its schedules'}`, ok: t.loans === t.ledger, detail: <><Money c={t.ledger} dollar /> in the GL</> }; }),
            { label: d.interestAttributed === d.interestLedger ? 'Interest to date adds to 6500 Interest expense' : 'Some 6500 interest is not from a loan payment', ok: d.interestAttributed === d.interestLedger, detail: <><Money c={d.interestAttributed} dollar /> from loans vs <Money c={d.interestLedger} dollar /> on the ledger</> },
          ]} />
        </section>
        <section className="panel" aria-labelledby="dd-rp">
          <div className="panel-head"><h2 id="dd-rp">Carried by related parties (information only)</h2><span className="muted small">Reimbursed through the rent pass-throughs</span></div>
          {table(d.related)}
          <TieOut items={[{ label: (mortgages?.ledger ?? 0) === 0 ? '2300 Notes payable – mortgages holds nothing: these are not double-booked' : '2300 has a balance: check a related-party mortgage was not booked as ours', ok: (mortgages?.ledger ?? 0) === 0 }]} />
        </section>
        <div className="grid-2">
          <section className="panel" aria-labelledby="dd-lad">
            <div className="panel-head"><h2 id="dd-lad">Maturity ladder</h2><span className="muted small">Company debt</span></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">When</th><th scope="col" className="num">Amortization</th><th scope="col" className="num">Maturities</th><th scope="col" className="num">Total</th></tr></thead>
              <tbody>{d.ladder.map((b) => <tr key={b.label}><td>{b.label}{b.loans.length > 0 && <div className="muted small">{b.loans.join(', ')}</div>}</td><td className="num"><Money c={b.amortization} /></td><td className="num"><Money c={b.maturities} /></td><td className="num"><b><Money c={b.total} /></b></td></tr>)}</tbody>
            </table></div>
            <TieOut items={[{ label: 'The ladder adds to company debt', ok: d.ladder.reduce((a, b) => a + b.total, 0) === d.companyDebt, detail: <Money c={d.ladder.reduce((a, b) => a + b.total, 0)} dollar /> }]} />
          </section>
          <section className="panel" aria-labelledby="dd-rpl">
            <div className="panel-head"><h2 id="dd-rpl">Related-party loans</h2><Link className="small" to="/debt/related-party">Terms and confirmations</Link></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Party</th><th scope="col">Direction</th><th scope="col" className="num">Balance</th><th scope="col">Rate</th></tr></thead>
              <tbody>{rp.map((r) => <tr key={r.partyId + r.accountId}><td>{r.partyName}</td><td>{r.direction === 'lent' ? 'We lent (1910)' : 'They lent us (2400)'}</td><td className="num"><Money c={r.balance} /></td><td>{r.terms ? bpsPct(r.terms.rateBps) : <span className="muted small">No terms</span>}{r.imputed && <span className="pill warn"> Below AFR</span>}</td></tr>)}</tbody>
            </table></div>
          </section>
        </div>
      </div>
      <Help k="debtDashboard" />
    </>
  );
}

function formatCovenantText(c: { kind: CovenantKind; threshold: number }) {
  return `${COVENANT_LABEL[c.kind].replace(/ \(.*\)/, '')} ${formatCovenant(c)}`;
}

// ── Covenant monitor ─────────────────────────────────────────────────────
export function CovenantsPage() {
  const { state, books, user, version } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const mon = useMemo(() => covenantMonitor(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const loans = loansOf(state);
  const [cv, setCv] = useState({ loanId: loans[0]?.id ?? '', kind: 'dscr' as CovenantKind, threshold: '1.25', text: '' });
  if (!can(user, 'view.reports')) return <NoAccess title="Covenant monitor" />;
  const h = mon.headline;
  const s = mon.settings;
  const edit = can(user, 'debt.edit');
  const worst = mon.tests.filter((t) => t.status === 'breach' || t.status === 'near');
  const header = ['Month', 'Window from', 'Months', 'Annualized ×', 'Provisional', 'Net income', 'Interest', 'D&A', 'EBITDA', 'Rent', 'Debt service', 'Related-party debt service', 'DSCR', 'Debt', 'Leverage', 'FCC', 'Global DSCR', 'Liquidity'];
  const rows = mon.metrics.map((m) => [m.period, m.from, m.months, m.factor.toFixed(2), m.provisional ? 'yes' : '', csvMoney(m.netIncome), csvMoney(m.interest), csvMoney(m.depreciation), csvMoney(m.ebitda), csvMoney(m.rent), csvMoney(m.debtService), csvMoney(m.relatedDebtService), m.dscr?.toFixed(2) ?? '', csvMoney(m.debt), m.leverage !== null && Number.isFinite(m.leverage) ? m.leverage.toFixed(2) : '', m.fcc?.toFixed(2) ?? '', m.globalDscr?.toFixed(2) ?? '', csvMoney(m.liquidity)]);
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Covenant monitor" lede="DSCR, leverage, minimum liquidity and fixed-charge coverage, calculated monthly from the statements, with headroom against each covenant and a forecast breach date.">
        <ExportButtons name="covenant-metrics" header={header} rows={rows} sheet="Covenant metrics" print={false} />
        <Link className="btn" to="/debt/lender-package">Lender package</Link>
      </PageHead>
      <section className="figures" aria-label="Covenant ratios" style={{ marginBottom: 20 }}>
        <Figure label="DSCR" value={ratioX(h?.dscr)} note={h ? <>EBITDA {usd(h.ebitdaAnnual)} ÷ debt service {usd(h.debtServiceAnnual)} a year{h.dscr !== null && h.dscr !== undefined && Number.isFinite(h.dscr) && <div><Gauge value={h.dscr} min={0} max={Math.max(3, s.dscrTarget / 50)} target={s.dscrTarget / 100} width={88} label="DSCR against target" valueText={`${ratioX(h.dscr)} vs ${(s.dscrTarget / 100).toFixed(2)}x target`} /></div>}</> : 'No months yet'} />
        <Figure label="Leverage (debt ÷ EBITDA)" value={ratioX(h?.leverage)} note={h ? `${usd(h.debt)} debt at ${shortDate(h.date)}` : ''} />
        <Figure label="Fixed-charge coverage" value={ratioX(h?.fcc)} note={h ? `Group DSCR with related-party mortgages ${ratioX(h.globalDscr)}` : ''} />
        <Figure label="Liquidity today" value={<Money c={mon.metrics.at(-1)?.liquidity ?? 0} whole dollar />} note="Operating bank account(s)" />
        <Figure label="Covenants near or in breach" value={String(worst.length)} note={worst.length ? worst.map((t) => `${t.loan?.name}: ${COVENANT_LABEL[t.covenant.kind]}`).join('; ') : `All ${mon.tests.length} hold with headroom`} />
      </section>
      {h && <p className="note" style={{ marginBottom: 16 }}>Ratios for <b>{periodLabel(h.period)}</b>, the latest {s.includeCurrentMonth ? 'month' : 'complete month'}, on the <b>{s.ratioBasis}</b> basis. {h.months < s.ttmMonths ? <>The books hold {h.months} month{h.months === 1 ? '' : 's'}, fewer than the {s.ttmMonths}-month trailing window, so {h.annualized ? <>EBITDA and debt service are <b>annualized (× {h.factor.toFixed(2)})</b>. DSCR and FCC don't change with annualizing; leverage does.</> : 'the figures are not annualized: leverage reads high.'}</> : `Trailing ${s.ttmMonths} months.`} Ratio forecasts need three complete months of trend; liquidity uses the 13-week cash forecast.</p>}
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel" aria-labelledby="cv-t">
          <div className="panel-head"><h2 id="cv-t">Covenants</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Loan</th><th scope="col">Covenant</th><th scope="col" className="num">Limit</th><th scope="col" className="num">Actual</th><th scope="col" className="num">Headroom</th><th scope="col">Status</th><th scope="col">Forecast breach</th></tr></thead>
            <tbody>{mon.tests.map((t) => {
              const [cls, lab] = STATUS_PILL[t.status];
              return (
                <tr key={t.covenant.id}>
                  <td>{t.loan ? <Link to={`/assets/loans/${t.loan.id}`}>{t.loan.name}</Link> : t.covenant.loanId}</td>
                  <td>{COVENANT_LABEL[t.covenant.kind]}{t.covenant.text && <div className="muted small">{t.covenant.text}</div>}</td>
                  <td className="num">{formatCovenant(t.covenant)}</td>
                  <td className="num">{formatMetric(t.covenant.kind, t.actual)}<div className="muted small">{t.covenant.kind === 'min_liquidity' ? 'today' : t.period}</div></td>
                  <td className="num">{t.headroom === null ? '–' : t.covenant.kind === 'min_liquidity' ? usd(t.headroom) : `${t.headroom.toFixed(2)}x`}{t.headroomPct !== null && <div className="muted small">{(t.headroomPct * 100).toFixed(0)}%</div>}</td>
                  <td><span className={'pill ' + cls}>{lab}</span></td>
                  <td>{t.forecast.date ? <><b>{shortDate(t.forecast.date)}</b><div className="muted small">{t.forecast.method === 'now' ? 'Breached now' : t.forecast.method === 'forecast' ? `13-week forecast reaches ${formatMetric(t.covenant.kind, t.forecast.value ?? null)}` : `Trend reaches ${formatMetric(t.covenant.kind, t.forecast.value ?? null)}`}{t.forecast.within ? '' : ' (beyond 2 quarters)'}</div></> : <span className="muted small">{t.covenant.kind === 'min_liquidity' ? `Not in the forecast; low ${t.forecast.low ? usd(t.forecast.low.amount) + ' on ' + shortDate(t.forecast.low.date) : '–'}` : 'No breach on the trend'}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="cv-m">
          <div className="panel-head"><h2 id="cv-m">Monthly calculation</h2><span className="muted small">Each month uses its trailing window; the month in progress is provisional</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Net income</th><th scope="col" className="num">+ Interest</th><th scope="col" className="num">+ D&amp;A</th><th scope="col" className="num">EBITDA</th><th scope="col" className="num">Debt service</th><th scope="col" className="num">DSCR</th><th scope="col" className="num">Debt</th><th scope="col" className="num">Leverage</th><th scope="col" className="num">Rent</th><th scope="col" className="num">FCC</th><th scope="col" className="num">Group DSCR</th><th scope="col" className="num">Liquidity</th></tr></thead>
            <tbody>{mon.metrics.map((m) => (
              <tr key={m.period}>
                <td>{periodLabel(m.period)}{m.provisional && <span className="pill"> To date</span>}<div className="muted small">{m.months} mo{m.annualized ? ` × ${m.factor.toFixed(2)}` : ''}</div></td>
                <td className="num"><Money c={m.netIncome} /></td><td className="num"><Money c={m.interest} /></td><td className="num"><Money c={m.depreciation} /></td><td className="num"><b><Money c={m.ebitda} /></b></td>
                <td className="num"><Money c={m.debtService} /></td><td className="num"><b>{ratioX(m.dscr)}</b></td><td className="num"><Money c={m.debt} /></td><td className="num">{ratioX(m.leverage)}</td>
                <td className="num"><Money c={m.rent} /></td><td className="num">{ratioX(m.fcc)}</td><td className="num">{ratioX(m.globalDscr)}</td><td className="num"><Money c={m.liquidity} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: mon.ties.ebitda ? 'EBITDA ties to the P&L: net income + 6500 + 6400/6410' : 'EBITDA does not tie to the P&L', ok: mon.ties.ebitda, detail: h ? <>{periodLabel(h.from)}–{periodLabel(h.period)}, <Link to={`/reports/pnl?basis=${s.ratioBasis}&view=month&from=${h.from}&to=${h.period}`}>open the P&amp;L</Link></> : undefined },
            { label: mon.ties.interest ? 'Scheduled interest equals 6500 on the ledger' : 'Scheduled interest differs from 6500: post the loan payments', ok: mon.ties.interest, detail: h ? <Money c={h.scheduledInterest} dollar /> : undefined },
            { label: mon.ties.debt ? 'Debt ties to the loan schedules and 2300–2320' : 'Debt on the ledger is off from the schedules', ok: mon.ties.debt, detail: h ? <Money c={h.debt} dollar /> : undefined },
          ]} />
        </section>
        {edit && (
          <div className="grid-2">
            <section className="panel panel-pad" aria-labelledby="cv-add">
              <h2 id="cv-add" style={{ marginBottom: 8 }}>Add a covenant</h2>
              <div className="form-grid">
                <div className="field"><label htmlFor="cv-l">Loan</label><select id="cv-l" value={cv.loanId} onChange={(e) => setCv({ ...cv, loanId: e.target.value })}>{loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
                <div className="field"><label htmlFor="cv-k">Test</label><select id="cv-k" value={cv.kind} onChange={(e) => { const k = e.target.value as CovenantKind; setCv({ ...cv, kind: k, threshold: k === 'min_liquidity' ? '30,000' : k === 'leverage' ? '3.00' : '1.25' }); }}>{(Object.keys(COVENANT_LABEL) as CovenantKind[]).map((k) => <option key={k} value={k}>{COVENANT_LABEL[k]}</option>)}</select></div>
                <div className="field"><label htmlFor="cv-th">{cv.kind === 'min_liquidity' ? 'Minimum balance' : cv.kind === 'leverage' ? 'Maximum ratio (x)' : 'Minimum ratio (x)'}</label><input id="cv-th" className="num" inputMode="decimal" value={cv.threshold} onChange={(e) => setCv({ ...cv, threshold: e.target.value })} /></div>
                <div className="field"><label htmlFor="cv-tx">Wording in the agreement</label><input id="cv-tx" value={cv.text} onChange={(e) => setCv({ ...cv, text: e.target.value })} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
                setErrors([]);
                try {
                  const th = cv.kind === 'min_liquidity' ? parseMoney(cv.threshold) ?? NaN : Math.round(Number(cv.threshold) * 100);
                  const c = saveCovenant(books, user, { loanId: cv.loanId, kind: cv.kind, threshold: th, text: cv.text.trim() || undefined, active: true });
                  say(`Added ${COVENANT_LABEL[c.kind]} ${formatCovenant(c)}.`);
                } catch (e) { setErrors(errList(e)); }
              }}>Add covenant</button></div>
            </section>
            <RatioSettings onSaved={say} onErrors={setErrors} />
          </div>
        )}
      </div>
      {toast}
      <Help k="covenants" />
    </>
  );
}

function RatioSettings({ onSaved, onErrors }: { onSaved: (m: string) => void; onErrors: (e: string[]) => void }) {
  const { state, books, user } = useBooks();
  const s = debtOf(state).settings;
  const [f, setF] = useState({ ratioBasis: s.ratioBasis, ttmMonths: String(s.ttmMonths), annualize: s.annualize, includeCurrentMonth: s.includeCurrentMonth, nearPct: String(s.nearPct), horizonDays: String(s.horizonDays), dscrTarget: (s.dscrTarget / 100).toFixed(2) });
  return (
    <section className="panel panel-pad" aria-labelledby="cv-set">
      <h2 id="cv-set" style={{ marginBottom: 8 }}>How the ratios are measured</h2>
      <div className="form-grid">
        <div className="field"><label htmlFor="rs-b">Basis</label><select id="rs-b" value={f.ratioBasis} onChange={(e) => setF({ ...f, ratioBasis: e.target.value as ReportBasis })}><option value="booked">Booked (ledger)</option><option value="cash">Cash</option><option value="accrual">Accrual</option></select></div>
        <div className="field"><label htmlFor="rs-t">Trailing months</label><input id="rs-t" className="num" inputMode="numeric" value={f.ttmMonths} onChange={(e) => setF({ ...f, ttmMonths: e.target.value })} /></div>
        <div className="field"><label htmlFor="rs-n">Near when headroom under (%)</label><input id="rs-n" className="num" inputMode="numeric" value={f.nearPct} onChange={(e) => setF({ ...f, nearPct: e.target.value })} /></div>
        <div className="field"><label htmlFor="rs-h">Forecast horizon (days)</label><input id="rs-h" className="num" inputMode="numeric" value={f.horizonDays} onChange={(e) => setF({ ...f, horizonDays: e.target.value })} /></div>
        <div className="field"><label htmlFor="rs-d">DSCR target (x)</label><input id="rs-d" className="num" inputMode="decimal" value={f.dscrTarget} onChange={(e) => setF({ ...f, dscrTarget: e.target.value })} /></div>
        <label className="check"><input type="checkbox" checked={f.annualize} onChange={(e) => setF({ ...f, annualize: e.target.checked })} /> Annualize a short history</label>
        <label className="check"><input type="checkbox" checked={f.includeCurrentMonth} onChange={(e) => setF({ ...f, includeCurrentMonth: e.target.checked })} /> Report the month in progress</label>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => {
        onErrors([]);
        try {
          saveDebtSettings(books, user, { ratioBasis: f.ratioBasis, ttmMonths: Number(f.ttmMonths), annualize: f.annualize, includeCurrentMonth: f.includeCurrentMonth, nearPct: Number(f.nearPct), horizonDays: Number(f.horizonDays), dscrTarget: Math.round(Number(f.dscrTarget) * 100) });
          onSaved('Saved how the ratios are measured.');
        } catch (e) { onErrors(errList(e)); }
      }}>Save</button></div>
    </section>
  );
}

// ── Lender reporting package ─────────────────────────────────────────────
export function LenderPackagePage() {
  const { state, user, books, version } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  const [sp, setSp] = useSearchParams();
  const company = loansOf(state).filter((l) => l.heldBy === 'company');
  const loanId = sp.get('loan') ?? company.find((l) => debtOf(state).covenants.some((c) => c.loanId === l.id))?.id ?? company[0]?.id ?? '';
  const mon = useMemo(() => covenantMonitor(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dash = useMemo(() => debtDashboard(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = mon.headline;
  const st = useMemo(() => (h ? statement(state, { basis: mon.settings.ratioBasis, from: h.from, to: h.period, storeIds: state.stores.map((s) => s.id), entries }) : null), [state, h, entries, mon.settings.ratioBasis]);
  const bs = useMemo(() => (h ? balanceSheet(state, { asOf: lastDayOfPeriod(h.period) }) : null), [state, h]);
  if (!can(user, 'view.reports') || !can(user, 'view.all_stores')) return <NoAccess title="Lender package" />;
  const loan = company.find((l) => l.id === loanId);
  const tests = mon.tests.filter((t) => t.covenant.loanId === loanId);
  const status = loan ? loanStatus(state, loan, today) : null;
  const sheets: { name: string; rows: Cell[][] }[] = [
    { name: 'Covenants', rows: [['Loan', 'Covenant', 'Limit', 'Actual', 'Headroom', 'Status', 'Forecast breach'], ...tests.map((t) => [t.loan?.name ?? '', COVENANT_LABEL[t.covenant.kind], t.covenant.kind === 'min_liquidity' ? covLimit(t.covenant) / 100 : covLimit(t.covenant), t.actual === null ? '' : t.covenant.kind === 'min_liquidity' ? t.actual / 100 : Number(t.actual.toFixed(4)), t.headroom === null ? '' : t.covenant.kind === 'min_liquidity' ? t.headroom / 100 : Number(t.headroom.toFixed(4)), STATUS_PILL[t.status][1], t.forecast.date ?? ''])] },
    { name: 'Monthly ratios', rows: [['Month', 'Months', 'Annualized ×', 'Net income', 'EBITDA', 'Debt service', 'DSCR', 'Debt', 'Leverage', 'FCC', 'Liquidity'], ...mon.metrics.map((m) => [m.period, m.months, Number(m.factor.toFixed(4)), m.netIncome / 100, m.ebitda / 100, m.debtService / 100, m.dscr === null ? '' : Number(m.dscr.toFixed(4)), m.debt / 100, m.leverage !== null && Number.isFinite(m.leverage) ? Number(m.leverage.toFixed(4)) : '', m.fcc === null ? '' : Number(m.fcc.toFixed(4)), m.liquidity / 100])] },
    { name: 'Debt schedule', rows: [['Loan', 'Lender', 'Balance', 'Rate %', 'Payment', 'Maturity', 'Collateral', 'Guarantor'], ...dash.company.map((r) => [r.loan.name, r.loan.lender, r.balance / 100, r.rateBps / 100, r.payment / 100, r.maturity, r.loan.collateral, r.loan.guarantor])] },
    ...(st ? [{ name: 'P&L summary', rows: [['Line', 'Amount'], ['Net sales', st.netSales.total / 100], ['Cost of goods', st.cogs.total / 100], ['Gross profit', st.grossProfit.total / 100], ['Operating expenses', st.expenses.total / 100], ['Net income', st.netIncome.total / 100], ['EBITDA', (h?.ebitda ?? 0) / 100]] as Cell[][] }] : []),
  ];
  const exportXlsx = () => {
    const data = xlsx(sheets);
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `lender-package-${loanId}-${h?.period ?? today}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { books.logExport(user, a.download); } catch { /* no export permission */ }
  };
  const csvRows = sheets[0].rows.slice(1).map((r) => r.map((c) => (c === null || c === undefined ? '' : c)));
  return (
    <>
      <PageHead eyebrow="Assets & debt · Covenants" title="Lender package" lede="The covenant compliance pack for one lender: the certificate, the monthly ratios, the debt schedule and the statements behind them. Print it to PDF or export it.">
        {can(user, 'export') && <button className="btn" onClick={exportXlsx}>Export Excel (all sheets)</button>}
        <ExportButtons name={`lender-covenants-${loanId}`} header={sheets[0].rows[0] as string[]} rows={csvRows as (string | number)[][]} sheet="Covenants" />
      </PageHead>
      <div className="filters no-print panel" style={{ marginBottom: 16 }}>
        <div className="field wide"><label htmlFor="lp-l">Loan</label><select id="lp-l" value={loanId} onChange={(e) => setSp({ loan: e.target.value }, { replace: true })}>{company.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      </div>
      {loan && status && h && st && bs && (
        <article className="pack">
          <header className="pack-head">
            <div className="eyebrow">{state.settings.companyName} · prepared for {loan.lender}</div>
            <h2>Covenant compliance · {periodLabel(h.period)}</h2>
            <p className="muted small">{loan.name}. {h.months} month{h.months === 1 ? '' : 's'} on the books{h.annualized ? `, annualized × ${h.factor.toFixed(2)}` : ''}; {mon.settings.ratioBasis} basis. Prepared {shortDate(today)}.</p>
          </header>
          <section className="pack-sec">
            <h3>Compliance certificate</h3>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Covenant</th><th scope="col" className="num">Required</th><th scope="col" className="num">Actual</th><th scope="col" className="num">Headroom</th><th scope="col">In compliance</th></tr></thead>
              <tbody>{tests.map((t) => <tr key={t.covenant.id}><td>{t.covenant.text ?? COVENANT_LABEL[t.covenant.kind]}</td><td className="num">{formatCovenant(t.covenant)}</td><td className="num">{formatMetric(t.covenant.kind, t.actual)}</td><td className="num">{t.headroom === null ? '–' : t.covenant.kind === 'min_liquidity' ? usd(t.headroom) : `${t.headroom.toFixed(2)}x`}</td><td>{t.pass ? 'Yes' : t.pass === false ? <b>No</b> : '–'}</td></tr>)}</tbody>
            </table></div>
            {loan.covenants.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Other covenants: {loan.covenants.join('; ')}.</p>}
          </section>
          <div className="grid-2 pack-grid">
            <section className="pack-sec">
              <h3>Loan</h3>
              <dl className="kv">
                <dt>Balance</dt><dd><Money c={status.scheduleBalance} dollar /></dd>
                <dt>Rate</dt><dd>{bpsPct(loan.rateBps)} {loan.rateType}{loan.index ? ` (${loan.index})` : ''}</dd>
                <dt>Payment</dt><dd>{loan.interestOnly ? 'Interest only' : <Money c={loan.payment} dollar />}</dd>
                <dt>Maturity</dt><dd>{shortDate(loan.maturity)}</dd>
                <dt>Collateral</dt><dd>{loan.collateral}</dd>
                <dt>Guarantor</dt><dd>{loan.guarantor}</dd>
              </dl>
            </section>
            <section className="pack-sec">
              <h3>EBITDA</h3>
              <dl className="kv">
                <dt>Net sales</dt><dd className="num"><Money c={st.netSales.total} dollar /></dd>
                <dt>Gross profit</dt><dd className="num"><Money c={st.grossProfit.total} dollar /></dd>
                <dt>Net income</dt><dd className="num"><Money c={h.netIncome} dollar /></dd>
                <dt>+ Interest</dt><dd className="num"><Money c={h.interest} dollar /></dd>
                <dt>+ Depreciation</dt><dd className="num"><Money c={h.depreciation} dollar /></dd>
                <dt>EBITDA</dt><dd className="num"><b><Money c={h.ebitda} dollar /></b></dd>
                <dt>Debt service</dt><dd className="num"><Money c={h.debtService} dollar /></dd>
              </dl>
            </section>
          </div>
          <section className="pack-sec">
            <h3>Debt schedule</h3>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Loan</th><th scope="col">Lender</th><th scope="col" className="num">Balance</th><th scope="col">Rate</th><th scope="col">Maturity</th></tr></thead>
              <tbody>{dash.company.map((r) => <tr key={r.loan.id}><td>{r.loan.name}</td><td>{r.loan.lender}</td><td className="num"><Money c={r.balance} /></td><td>{bpsPct(r.rateBps)}</td><td>{shortDate(r.maturity)}</td></tr>)}</tbody>
            </table></div>
          </section>
          <section className="pack-sec">
            <h3>Balance sheet at {shortDate(bs.asOf)}</h3>
            <dl className="kv">{bs.sections.map((sec) => <Frag key={sec.key}><dt>{sec.label}</dt><dd className="num"><Money c={sec.total} dollar /></dd></Frag>)}</dl>
            <TieOut items={[
              { label: bs.difference === 0 ? 'Balance sheet balances and agrees to the trial balance' : 'Balance sheet does not balance', ok: bs.difference === 0 && bs.agreesToTb },
              { label: st.difference === 0 ? 'P&L ties to its entries' : 'P&L does not tie', ok: st.difference === 0 },
              { label: mon.ties.ebitda && mon.ties.interest ? 'EBITDA and interest tie to the P&L' : 'EBITDA or interest does not tie', ok: mon.ties.ebitda && mon.ties.interest },
            ]} />
          </section>
        </article>
      )}
      <Help k="lenderPackage" />
    </>
  );
}
function Frag({ children }: { children: ReactNode }) { return <>{children}</>; }

// ── Refinance analyzer ───────────────────────────────────────────────────
interface ProposalForm { rate: string; term: string; amort: string; fees: string; penalty: string; cashOut: string; roll: boolean }
const toForm = (p: RefiProposal): ProposalForm => ({ rate: (p.rateBps / 100).toFixed(2), term: String(p.termMonths), amort: String(p.amortizationMonths), fees: (p.fees / 100).toFixed(2), penalty: (p.prepaymentPenalty / 100).toFixed(2), cashOut: (p.cashOut / 100).toFixed(2), roll: p.rollInCosts });
const fromForm = (f: ProposalForm): RefiProposal => ({ rateBps: pctIn(f.rate), termMonths: Number(f.term), amortizationMonths: Number(f.amort), fees: moneyIn(f.fees), prepaymentPenalty: moneyIn(f.penalty), cashOut: moneyIn(f.cashOut), rollInCosts: f.roll });

export function RefinancePage() {
  const { state, books, user, visible, version } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const d = debtOf(state);
  const loans = loansOf(state).filter((l) => visible.has(l.storeId));
  const scenario = d.scenarios.find((s) => s.id === sp.get('scenario'));
  const loanId = scenario?.loanId ?? sp.get('loan') ?? loans[0]?.id ?? '';
  const loan = loans.find((l) => l.id === loanId);
  const [form, setForm] = useState<{ key: string; f: ProposalForm } | null>(null);
  const key = scenario?.id ?? loanId;
  const f: ProposalForm = form && form.key === key ? form.f : scenario ? toForm(scenario) : loan ? toForm(defaultProposal(state, loan, today)) : toForm({ rateBps: 0, termMonths: 0, amortizationMonths: 0, fees: 0, prepaymentPenalty: 0, cashOut: 0, rollInCosts: false });
  const setF = (x: Partial<ProposalForm>) => setForm({ key, f: { ...f, ...x } });
  const [name, setName] = useState('');
  const mon = useMemo(() => covenantMonitor(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const triggers = useMemo(() => refinanceTriggers(state, today, { monitor: mon, visible }), [state, today, mon, visible]);
  const p = fromForm(f);
  const invalid = validateProposal(p);
  const r = useMemo(() => (loan && !invalid.length ? refinance(state, { ...p, loanId: loan.id }, today, { metrics: mon.headline }) : null), [state, loan, JSON.stringify(p), invalid.length, mon]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(user, 'view.reports')) return <NoAccess title="Refinance analyzer" />;
  const edit = can(user, 'debt.edit');
  const st = loan ? loanStatus(state, loan, today) : null;
  const pick = (k: 'loan' | 'scenario', v: string) => { setForm(null); setSp(v ? { [k]: v } : {}, { replace: true }); };
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Refinance analyzer" lede="Compare a loan with a proposed one: what the payment does, the interest saved, when the costs pay back, the NPV at our cost of capital, and DSCR before and after.">
        {r && <ExportButtons name={`refinance-${loan!.id}`} header={['Measure', 'Current', 'Proposed']} rows={[
          ['Balance / principal', csvMoney(r.balance), csvMoney(r.newPrincipal)], ['Rate %', (loan!.rateBps / 100).toFixed(2), (p.rateBps / 100).toFixed(2)], ['Monthly payment', csvMoney(r.currentPayment), csvMoney(r.newPayment)],
          ['Months', r.remainingMonths, p.termMonths], ['Total interest', csvMoney(r.currentInterest), csvMoney(r.newInterest)], ['Costs (fees + penalty)', '', csvMoney(r.costs)],
          ['Break-even months', '', r.breakEvenMonths ?? 'none'], ['NPV of savings', '', csvMoney(r.npv)], ['DSCR', r.dscrBefore?.toFixed(2) ?? '', r.dscrAfter?.toFixed(2) ?? ''],
        ]} sheet="Refinance" />}
      </PageHead>
      <div className="filters panel" style={{ marginBottom: 16 }}>
        <div className="field wide"><label htmlFor="rf-l">Loan</label><select id="rf-l" value={loanId} onChange={(e) => pick('loan', e.target.value)}>{loans.map((l) => <option key={l.id} value={l.id}>{l.name}{l.heldBy === 'related_party' ? ' (related party)' : ''}</option>)}</select></div>
        <div className="field wide"><label htmlFor="rf-s">Saved scenario</label><select id="rf-s" value={scenario?.id ?? ''} onChange={(e) => (e.target.value ? pick('scenario', e.target.value) : pick('loan', loanId))}><option value="">None (start from the market)</option>{d.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
      {r && (
        <section className="figures" aria-label="Refinance result" style={{ marginBottom: 20 }}>
          <Figure label="Monthly payment change" value={<Money c={r.paymentChange} dollar />} note={`${usd(r.currentPayment)} → ${usd(r.newPayment)}`} />
          <Figure label="Break-even" value={r.breakEvenMonths === null ? 'Never' : `${r.breakEvenMonths} months`} note={r.breakEvenMonths === null ? 'The payment does not fall' : `Costs ${usd(r.costs)} ÷ ${usd(r.cashFreedMonthly)} saved a month`} />
          <Figure label={`NPV at ${bpsPct(d.settings.costOfCapitalBps)}`} value={<Money c={r.npv} signed whole dollar />} note="PV of current payments − PV of new ones + cash out − costs paid" />
          <Figure label="Interest saved" value={<Money c={r.interestSavedSameMonths} signed whole dollar />} note={`Over the ${r.sameMonths} months both run; life of loan ${usd(r.interestSaved)}`} />
          <Figure label={`DSCR after (${r.dscrKind === 'company' ? 'company' : 'group'})`} value={ratioX(r.dscrAfter)} note={`From ${ratioX(r.dscrBefore)}. Cash freed ${usd(r.cashFreedMonthly)} a month; first year ${usd(r.cashFreedFirstYear)}`} />
        </section>
      )}
      <Errors errors={[...errors, ...(loan ? invalid : [])]} />
      <div className="stack">
        <div className="grid-2">
          <section className="panel panel-pad" aria-labelledby="rf-p">
            <h2 id="rf-p" style={{ marginBottom: 8 }}>Proposed loan</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="rf-r">Rate (%)</label><input id="rf-r" className="num" inputMode="decimal" value={f.rate} onChange={(e) => setF({ rate: e.target.value })} /></div>
              <div className="field"><label htmlFor="rf-t">Term (months)</label><input id="rf-t" className="num" inputMode="numeric" value={f.term} onChange={(e) => setF({ term: e.target.value })} /></div>
              <div className="field"><label htmlFor="rf-a">Amortization (months)</label><input id="rf-a" className="num" inputMode="numeric" value={f.amort} onChange={(e) => setF({ amort: e.target.value })} /></div>
              <div className="field"><label htmlFor="rf-f">Fees</label><input id="rf-f" className="num" inputMode="decimal" value={f.fees} onChange={(e) => setF({ fees: e.target.value })} /></div>
              <div className="field"><label htmlFor="rf-pp">Prepayment penalty</label><input id="rf-pp" className="num" inputMode="decimal" value={f.penalty} onChange={(e) => setF({ penalty: e.target.value })} /><span className="hint">{loan?.prepaymentPenalty}</span></div>
              <div className="field"><label htmlFor="rf-c">Cash out</label><input id="rf-c" className="num" inputMode="decimal" value={f.cashOut} onChange={(e) => setF({ cashOut: e.target.value })} /></div>
              <label className="check"><input type="checkbox" checked={f.roll} onChange={(e) => setF({ roll: e.target.checked })} /> Roll fees and penalty into the loan</label>
            </div>
            {edit && loan && (
              <div className="actions" style={{ marginTop: 12 }}>
                <div className="field"><label htmlFor="rf-n">Scenario name</label><input id="rf-n" value={name} placeholder={scenario?.name ?? `${loan.name} at ${f.rate}%`} onChange={(e) => setName(e.target.value)} /></div>
                <button className="btn primary" onClick={() => { setErrors([]); try { const sc = saveScenario(books, user, { ...p, loanId: loan.id, name: name.trim() || (scenario?.name ?? `${loan.name} at ${f.rate}%`), id: scenario && !name.trim() ? scenario.id : undefined, note: scenario?.note }); setName(''); setForm(null); setSp({ scenario: sc.id }, { replace: true }); say(`Saved ${sc.name}.`); } catch (e) { setErrors(errList(e)); } }}>Save scenario</button>
                {scenario && <button className="btn danger" onClick={() => { try { deleteScenario(books, user, scenario.id); pick('loan', loanId); say('Deleted the scenario.'); } catch (e) { setErrors(errList(e)); } }}>Delete</button>}
                <button className="btn" onClick={() => setForm(null)}>Reset</button>
              </div>
            )}
          </section>
          {r && st && (
            <section className="panel" aria-labelledby="rf-c-h">
              <div className="panel-head"><h2 id="rf-c-h">Current vs proposed</h2></div>
              <div className="table-wrap"><table className="t">
                <thead><tr><th scope="col">Measure</th><th scope="col" className="num">Current</th><th scope="col" className="num">Proposed</th></tr></thead>
                <tbody>
                  <tr><td>Balance / new principal</td><td className="num"><Money c={r.balance} /></td><td className="num"><Money c={r.newPrincipal} /></td></tr>
                  <tr><td>Rate</td><td className="num">{bpsPct(loan!.rateBps)}</td><td className="num">{bpsPct(p.rateBps)}</td></tr>
                  <tr><td>Monthly payment</td><td className="num"><Money c={r.currentPayment} /></td><td className="num"><Money c={r.newPayment} /></td></tr>
                  <tr><td>Months left</td><td className="num">{r.remainingMonths}</td><td className="num">{p.termMonths}</td></tr>
                  <tr><td>Interest to the end</td><td className="num"><Money c={r.currentInterest} /></td><td className="num"><Money c={r.newInterest} /></td></tr>
                  <tr><td>Fees + penalty</td><td className="num">–</td><td className="num"><Money c={r.costs} />{r.upfront === 0 && r.costs > 0 && <div className="muted small">rolled in</div>}</td></tr>
                  <tr><td>Cash out at closing</td><td className="num">–</td><td className="num"><Money c={p.cashOut} /></td></tr>
                </tbody>
              </table></div>
              <TieOut items={[
                { label: st.ledgerBalance === null ? 'Balance is the related party\'s schedule (not on our books)' : st.ties ? 'Current balance ties to the ledger' : 'Current balance is off from the ledger', ok: st.ledgerBalance === null || !!st.ties, detail: <Money c={st.scheduleBalance} dollar /> },
                { label: 'The new schedule repays its principal', ok: r.newRows.reduce((a, x) => a + x.principal, 0) === r.newPrincipal },
              ]} />
            </section>
          )}
        </div>
        <section className="panel" aria-labelledby="rf-tr">
          <div className="panel-head"><h2 id="rf-tr">Refinance triggers</h2><span className="muted small">Gap ≥ {d.settings.refiGapBps} bps with break-even under {d.settings.refiBreakEvenMonths} months · maturity within {d.settings.maturityMonths} months · LTV below {d.settings.ltvTargetPct}% · variable above fixed · covenant forecast to breach</span></div>
          {triggers.length ? <ul className="cards">{triggers.map((t) => <li key={t.kind + t.loanId + t.title} className="panel-pad"><span className={'pill ' + (t.kind === 'covenant_forecast' || t.kind === 'maturity' ? 'warn' : 'ok')}>{TRIGGER_LABEL[t.kind]}</span> <b>{t.title}</b><div className="muted small">{t.detail}</div>{t.kind !== 'covenant_forecast' && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => pick('loan', t.loanId)}>Analyze {t.loanName}</button>}</li>)}</ul> : <p className="panel-pad muted">No trigger fires today.</p>}
        </section>
        <div className="grid-2">
          <MarketRates onSay={say} />
          <PropertyValues onSay={say} />
        </div>
      </div>
      {toast}
      <Help k="refinance" />
    </>
  );
}

function MarketRates({ onSay }: { onSay: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const today = todayInChicago();
  const [errors, setErrors] = useState<string[]>([]);
  const [x, setX] = useState({ date: today, kind: 'mortgage' as LoanKind, rateType: 'fixed' as 'fixed' | 'variable', rate: '', source: '' });
  const rates = [...debtOf(state).marketRates].sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
  return (
    <section className="panel" aria-labelledby="mr-h">
      <div className="panel-head"><h2 id="mr-h">Market rates</h2><span className="muted small">The latest quote is the market</span></div>
      <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }} tabIndex={0} role="region" aria-label="Market rates, scrolls" data-static="1"><table className="t">
        <thead><tr><th scope="col">Date</th><th scope="col">Kind</th><th scope="col" className="num">Rate</th><th scope="col">Source</th></tr></thead>
        <tbody>{rates.map((r) => <tr key={r.id}><td>{shortDate(r.date)}</td><td>{LOAN_KIND_LABEL[r.kind]} · {r.rateType}</td><td className="num">{bpsPct(r.rateBps)}</td><td className="small">{r.source}</td></tr>)}</tbody>
      </table></div>
      {can(user, 'debt.edit') && (
        <div className="panel-pad">
          <Errors errors={errors} />
          <div className="form-grid">
            <div className="field"><label htmlFor="mr-d">Date</label><input id="mr-d" type="date" value={x.date} onChange={(e) => setX({ ...x, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="mr-k">Kind</label><select id="mr-k" value={x.kind} onChange={(e) => setX({ ...x, kind: e.target.value as LoanKind })}>{(Object.keys(LOAN_KIND_LABEL) as LoanKind[]).map((k) => <option key={k} value={k}>{LOAN_KIND_LABEL[k]}</option>)}</select></div>
            <div className="field"><label htmlFor="mr-t">Fixed or variable</label><select id="mr-t" value={x.rateType} onChange={(e) => setX({ ...x, rateType: e.target.value as 'fixed' | 'variable' })}><option value="fixed">Fixed</option><option value="variable">Variable</option></select></div>
            <div className="field"><label htmlFor="mr-r">Quoted rate (%)</label><input id="mr-r" className="num" inputMode="decimal" value={x.rate} onChange={(e) => setX({ ...x, rate: e.target.value })} /></div>
            <div className="field"><label htmlFor="mr-s">Source</label><input id="mr-s" value={x.source} onChange={(e) => setX({ ...x, source: e.target.value })} /></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { setErrors([]); try { addMarketRate(books, user, { date: x.date, kind: x.kind, rateType: x.rateType, rateBps: pctIn(x.rate), source: x.source.trim() || undefined }); setX({ ...x, rate: '' }); onSay('Recorded the quote.'); } catch (e) { setErrors(errList(e)); } }}>Add quote</button></div>
        </div>
      )}
    </section>
  );
}

function PropertyValues({ onSay }: { onSay: (m: string) => void }) {
  const { state, books, user, stores } = useBooks();
  const today = todayInChicago();
  const [errors, setErrors] = useState<string[]>([]);
  const mtgStores = [...new Set(loansOf(state).filter((l) => l.kind === 'mortgage').map((l) => l.storeId))];
  const [x, setX] = useState({ storeId: mtgStores[0] ?? stores[0]?.id ?? '', date: today, value: '', source: '' });
  const target = debtOf(state).settings.ltvTargetPct;
  return (
    <section className="panel" aria-labelledby="pv-h">
      <div className="panel-head"><h2 id="pv-h">Property values and LTV</h2><span className="muted small">Target below {target}%</span></div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Store</th><th scope="col" className="num">Latest value</th><th scope="col" className="num">Mortgage</th><th scope="col" className="num">LTV</th></tr></thead>
        <tbody>{loansOf(state).filter((l) => l.kind === 'mortgage').map((l) => {
          const { latest, prior } = propertyValues(state, l.storeId, today);
          const bal = loanStatus(state, l, today).scheduleBalance;
          const ltv = latest ? bal / latest.value : null;
          return <tr key={l.id}><td>{stores.find((s) => s.id === l.storeId)?.code ?? ''}<div className="muted small">{latest ? `${latest.source}, ${shortDate(latest.date)}` : 'No value yet'}{prior ? ` · was ${usd(prior.value)}` : ''}</div></td><td className="num">{latest ? <Money c={latest.value} whole /> : '–'}</td><td className="num"><Money c={bal} whole /></td><td className="num">{ltv === null ? '–' : <span className={'pill ' + (ltv * 100 < target ? 'ok' : '')}>{(ltv * 100).toFixed(1)}%</span>}</td></tr>;
        })}</tbody>
      </table></div>
      {can(user, 'debt.edit') && (
        <div className="panel-pad">
          <Errors errors={errors} />
          <div className="form-grid">
            <div className="field"><label htmlFor="pv-s">Store</label><select id="pv-s" value={x.storeId} onChange={(e) => setX({ ...x, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <div className="field"><label htmlFor="pv-d">Date</label><input id="pv-d" type="date" value={x.date} onChange={(e) => setX({ ...x, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="pv-v">Value</label><input id="pv-v" className="num" inputMode="decimal" value={x.value} onChange={(e) => setX({ ...x, value: e.target.value })} /></div>
            <div className="field"><label htmlFor="pv-src">Source</label><input id="pv-src" value={x.source} placeholder="Appraisal, broker opinion" onChange={(e) => setX({ ...x, source: e.target.value })} /></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { setErrors([]); try { addPropertyValue(books, user, { storeId: x.storeId, date: x.date, value: parseMoney(x.value) ?? NaN, source: x.source }); setX({ ...x, value: '' }); onSay('Recorded the value.'); } catch (e) { setErrors(errList(e)); } }}>Add value</button></div>
        </div>
      )}
    </section>
  );
}

// ── Paydown vs invest ────────────────────────────────────────────────────
const ALT_LABEL: Record<AlternativeKind, string> = { new_store: 'New store', equipment: 'Equipment upgrade', inventory: 'Inventory', cash_reserve: 'Cash reserve', other: 'Other' };

export function PaydownPage() {
  const { state, books, user, version } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [amount, setAmount] = useState('');
  const amt = amount.trim() ? parseMoney(amount) ?? undefined : undefined;
  const plan = useMemo(() => paydownPlan(state, today, { entries, amount: amt }), [state, today, entries, amt, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dash = useMemo(() => debtDashboard(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = debtOf(state).settings;
  const [alt, setAlt] = useState({ name: '', kind: 'equipment' as AlternativeKind, amount: '', ret: '', taxable: true });
  const [set, setSet] = useState({ tax: (s.taxRateBps / 100).toFixed(1), equity: (s.nextStoreEquity / 100).toFixed(0) });
  if (!can(user, 'view.reports')) return <NoAccess title="Paydown vs invest" />;
  const edit = can(user, 'debt.edit');
  const e = plan.effects;
  const alloc = new Map(plan.allocations.map((a) => [a.use.key, a.amount]));
  const header = ['Rank', 'Use', 'Kind', 'Balance / size', 'Rate %', 'After-tax %', 'Recommended'];
  const rows = plan.ranked.map((u, i) => [i + 1, u.label, u.kind === 'debt' ? 'Pay down debt' : ALT_LABEL[u.alt!.kind], csvMoney(u.amount), (u.rateBps / 100).toFixed(2), (u.afterTaxBps / 100).toFixed(2), csvMoney(alloc.get(u.key) ?? 0)]);
  const debtSum = plan.debts.reduce((a, u) => a + u.amount, 0);
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Paydown vs invest" lede={`Each debt's after-tax cost against the after-tax return on what else the cash could do, at a ${bpsPct(s.taxRateBps, 1)} tax rate. Once the reserve is met, deployable cash goes down the list from the top (avalanche).`}>
        <ExportButtons name="paydown-vs-invest" header={header} rows={rows} sheet="Paydown vs invest" print={false} />
      </PageHead>
      <section className="figures" aria-label="Paydown vs invest" style={{ marginBottom: 20 }}>
        <Figure label="Deployable cash" value={<Money c={Math.max(0, plan.reserve.deployable)} whole dollar />} note={plan.reserveMet ? 'Above the reserve target' : `Reserve short by ${usd(-plan.reserve.deployable)}`} href="/debt/reserve" />
        <Figure label="Best use, after tax" value={plan.ranked[0] ? bpsPct(plan.ranked[0].afterTaxBps) : '—'} note={plan.ranked[0]?.label ?? 'Add alternatives below'} />
        <Figure label="DSCR after" value={ratioX(e.dscrAfter)} note={`From ${ratioX(e.dscrBefore)}, after the recommended uses`} />
        <Figure label="Liquidity" value={<Money c={e.liquidityAfter} whole dollar />} note={`From ${usd(e.liquidityBefore)}`} />
        <Figure label="Months to fund the next store" value={e.monthsToFundAfter === null ? 'Not on this cash flow' : String(e.monthsToFundAfter)} note={`Needs ${usd(s.nextStoreEquity)}; ${e.monthsToFundBefore === null ? 'n/a' : e.monthsToFundBefore} before`} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel" aria-labelledby="pd-r">
          <div className="panel-head"><h2 id="pd-r">Ranked by after-tax rate</h2>
            <div className="field" style={{ width: 200 }}><label htmlFor="pd-a">Amount to deploy</label><input id="pd-a" className="num" inputMode="decimal" value={amount} placeholder={(Math.max(0, plan.reserve.deployable) / 100).toFixed(2)} onChange={(ev) => setAmount(ev.target.value)} /></div>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col" className="num">#</th><th scope="col">Use</th><th scope="col" className="num">Balance / size</th><th scope="col" className="num">Rate</th><th scope="col" className="num">After tax</th><th scope="col" className="num">Recommended</th></tr></thead>
            <tbody>{plan.ranked.map((u, i) => (
              <tr key={u.key}><td className="num">{i + 1}</td><td>{u.loan ? <Link to={`/assets/loans/${u.loan.id}`}>{u.label}</Link> : u.label}<div className="muted small">{u.kind === 'debt' ? `Pay down debt${u.interestOnly ? ' (interest falls at once)' : ' (shortens the term)'}` : ALT_LABEL[u.alt!.kind]}</div></td>
                <td className="num"><Money c={u.amount} /></td><td className="num">{bpsPct(u.rateBps)}</td><td className="num"><b>{bpsPct(u.afterTaxBps)}</b></td><td className="num">{alloc.get(u.key) ? <Money c={alloc.get(u.key)!} /> : '–'}</td></tr>
            ))}</tbody>
          </table></div>
          {!plan.reserveMet && <p className="panel-pad note warn">Cash is below the reserve target, so nothing is recommended yet: fund the reserve first.</p>}
          <TieOut items={[
            { label: debtSum === dash.companyDebt ? 'Debts listed add to company debt on the dashboard' : 'Debts listed differ from the dashboard', ok: debtSum === dash.companyDebt, detail: <Money c={debtSum} dollar /> },
            { label: 'Recommended uses add to no more than the cash to deploy', ok: plan.allocations.reduce((a, x) => a + x.amount, 0) <= plan.toDeploy, detail: <Money c={plan.allocations.reduce((a, x) => a + x.amount, 0)} dollar /> },
          ]} />
        </section>
        <div className="grid-2">
          <section className="panel" aria-labelledby="pd-e">
            <div className="panel-head"><h2 id="pd-e">Effect</h2></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Measure</th><th scope="col" className="num">Before</th><th scope="col" className="num">After</th></tr></thead>
              <tbody>
                <tr><td>DSCR</td><td className="num">{ratioX(e.dscrBefore)}</td><td className="num">{ratioX(e.dscrAfter)}</td></tr>
                <tr><td>Liquidity (cash for the reserve)</td><td className="num"><Money c={e.liquidityBefore} /></td><td className="num"><Money c={e.liquidityAfter} /></td></tr>
                <tr><td>Free cash a month (EBITDA − debt service)</td><td className="num"><Money c={e.monthlyFreeCashBefore} /></td><td className="num"><Money c={e.monthlyFreeCashAfter} /></td></tr>
                <tr><td>Interest saved a year</td><td className="num">–</td><td className="num"><Money c={e.interestSaved} /></td></tr>
                <tr><td>Return gained a year (pre-tax)</td><td className="num">–</td><td className="num"><Money c={e.returnsGained} /></td></tr>
                <tr><td>Months to fund the next store</td><td className="num">{e.monthsToFundBefore ?? '–'}</td><td className="num">{e.monthsToFundAfter ?? '–'}</td></tr>
              </tbody>
            </table></div>
          </section>
          {edit && (
            <section className="panel panel-pad" aria-labelledby="pd-add">
              <h2 id="pd-add" style={{ marginBottom: 8 }}>Add an alternative</h2>
              <div className="form-grid">
                <div className="field"><label htmlFor="al-n">Name</label><input id="al-n" value={alt.name} onChange={(ev) => setAlt({ ...alt, name: ev.target.value })} /></div>
                <div className="field"><label htmlFor="al-k">Kind</label><select id="al-k" value={alt.kind} onChange={(ev) => setAlt({ ...alt, kind: ev.target.value as AlternativeKind })}>{(Object.keys(ALT_LABEL) as AlternativeKind[]).map((k) => <option key={k} value={k}>{ALT_LABEL[k]}</option>)}</select></div>
                <div className="field"><label htmlFor="al-a">Amount</label><input id="al-a" className="num" inputMode="decimal" value={alt.amount} onChange={(ev) => setAlt({ ...alt, amount: ev.target.value })} /></div>
                <div className="field"><label htmlFor="al-r">Expected return (%)</label><input id="al-r" className="num" inputMode="decimal" value={alt.ret} onChange={(ev) => setAlt({ ...alt, ret: ev.target.value })} /></div>
                <label className="check"><input type="checkbox" checked={alt.taxable} onChange={(ev) => setAlt({ ...alt, taxable: ev.target.checked })} /> Return is taxed</label>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { setErrors([]); try { const a = saveAlternative(books, user, { name: alt.name, kind: alt.kind, amount: parseMoney(alt.amount) ?? NaN, returnBps: pctIn(alt.ret), taxable: alt.taxable }); setAlt({ ...alt, name: '', amount: '', ret: '' }); say(`Added ${a.name}.`); } catch (er) { setErrors(errList(er)); } }}>Add</button></div>
              <h2 style={{ margin: '16px 0 8px' }}>Assumptions</h2>
              <div className="form-grid">
                <div className="field"><label htmlFor="pd-t">Tax rate (%)</label><input id="pd-t" className="num" inputMode="decimal" value={set.tax} onChange={(ev) => setSet({ ...set, tax: ev.target.value })} /></div>
                <div className="field"><label htmlFor="pd-q">Next-store equity</label><input id="pd-q" className="num" inputMode="decimal" value={set.equity} onChange={(ev) => setSet({ ...set, equity: ev.target.value })} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { setErrors([]); try { saveDebtSettings(books, user, { taxRateBps: pctIn(set.tax), nextStoreEquity: parseMoney(set.equity) ?? NaN }); say('Saved the assumptions.'); } catch (er) { setErrors(errList(er)); } }}>Save assumptions</button></div>
            </section>
          )}
        </div>
      </div>
      {toast}
      <Help k="paydown" />
    </>
  );
}

// ── Cash reserve policy ──────────────────────────────────────────────────
export function ReservePage() {
  const { state, books, user, version } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  const code = useCode();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const r = useMemo(() => reserveTarget(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hist = useMemo(() => reserveHistory(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => paydownPlan(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const pol = debtOf(state).settings.reserve;
  const [f, setF] = useState({ weeks: String(pol.weeksFixed), lookback: String(pol.lookbackMonths), fuel: pol.fuelLoad, payroll: pol.payroll, cushion: (pol.cushion / 100).toFixed(2), clearing: pol.cashSubtypes.includes('clearing') });
  if (!can(user, 'view.reports') || !can(user, 'view.all_stores')) return <NoAccess title="Cash reserve" />;
  const cashAccts = state.accounts.filter((a) => a.type === 'asset' && pol.cashSubtypes.includes(a.subtype));
  const cashLedger = cashAccts.reduce((a, x) => a + balanceAsOf(state, x.id, today), 0);
  const header = ['Part', 'Detail', 'Amount'];
  const rows: (string | number)[][] = [
    ['Fixed costs', `${pol.weeksFixed} weeks × ${csvMoney(r.weeklyFixed)} a week`, csvMoney(r.fixedPart)],
    ...r.fuelLoads.map((x) => ['Fuel load', `${code(x.storeId)} typical load (${x.loads} deliveries in 90 days)`, csvMoney(x.cost)]),
    ['Payroll', `Average of ${r.payrollWeeks.join(', ')}`, csvMoney(r.payroll)], ['Cushion', '', csvMoney(r.cushion)], ['Target', '', csvMoney(r.target)], ['Cash', cashAccts.map((a) => a.number).join(' + '), csvMoney(r.cash)], ['Deployable', 'Cash − target', csvMoney(r.deployable)],
  ];
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Cash reserve" lede="The cash we keep on hand: N weeks of fixed costs, one fuel load per store and one payroll. Cash above the target is deployable.">
        <ExportButtons name="cash-reserve" header={header} rows={rows} sheet="Cash reserve" print={false} />
      </PageHead>
      <section className="figures" aria-label="Reserve" style={{ marginBottom: 20 }}>
        <Figure label="Reserve target" value={<Money c={r.target} whole dollar />} note={`${pol.weeksFixed} weeks fixed + ${r.fuelLoads.length} fuel loads + 1 payroll${r.cushion ? ' + cushion' : ''}`} />
        <Figure label="Cash" value={<Money c={r.cash} whole dollar />} note={cashAccts.map((a) => a.number).join(' + ')} />
        <Figure label={r.deployable >= 0 ? 'Deployable' : 'Short of the reserve'} value={<Money c={Math.abs(r.deployable)} whole dollar />} note={r.deployable >= 0 ? 'Cash above the target' : 'Rebuild before deploying'} href="/debt/paydown" />
        <Figure label="Month ends above the reserve" value={String(hist.monthsAbove)} note={hist.monthsAbove >= 2 ? 'Two or more in a row: put it to work' : 'In a row, latest first'} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <div className="grid-2">
          <section className="panel" aria-labelledby="rv-b">
            <div className="panel-head"><h2 id="rv-b">How the target builds up</h2></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Part</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>
                <tr><td>{pol.weeksFixed} weeks of fixed costs<div className="muted small">{usd(r.weeklyFixed)} a week: {usd(r.fixedCosts)} of expenses in {r.months.map(periodLabel).join(', ') || 'no complete month'} (less card fees, payroll and depreciation)</div></td><td className="num"><Money c={r.fixedPart} /></td></tr>
                {r.fuelLoads.map((x) => <tr key={x.storeId}><td>One fuel load, {code(x.storeId)}<div className="muted small">{x.loads ? `Median of ${x.loads} deliveries in 90 days` : 'No deliveries in 90 days'}</div></td><td className="num"><Money c={x.cost} /></td></tr>)}
                <tr><td>One payroll<div className="muted small">Average labor cost of {r.payrollWeeks.length} pay weeks to {r.payrollWeeks[0] ? shortDate(r.payrollWeeks[0]) : '–'}</div></td><td className="num"><Money c={r.payroll} /></td></tr>
                {r.cushion > 0 && <tr><td>Cushion</td><td className="num"><Money c={r.cushion} /></td></tr>}
                <tr><td><b>Target</b></td><td className="num"><b><Money c={r.target} /></b></td></tr>
                <tr><td>Cash on hand</td><td className="num"><Money c={r.cash} /></td></tr>
                <tr><td><b>Deployable</b></td><td className="num"><b><Money c={r.deployable} /></b></td></tr>
              </tbody>
            </table></div>
            <TieOut items={[
              { label: 'Target = fixed costs + fuel loads + payroll + cushion', ok: r.target === r.fixedPart + r.fuelPart + r.payroll + r.cushion },
              { label: cashLedger === r.cash ? 'Cash ties to the balance sheet accounts' : 'Cash differs from the ledger', ok: cashLedger === r.cash, detail: <>{cashAccts.map((a) => a.number).join(', ')}: <Money c={cashLedger} dollar /></> },
            ]} />
          </section>
          <section className="panel" aria-labelledby="rv-h">
            <div className="panel-head"><h2 id="rv-h">Month ends</h2></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Date</th><th scope="col" className="num">Cash</th><th scope="col" className="num">Target</th><th scope="col" className="num">Deployable</th></tr></thead>
              <tbody>{hist.points.map((p) => <tr key={p.date}><td>{shortDate(p.date)}{p.date === today && <span className="pill"> Today</span>}</td><td className="num"><Money c={p.cash} /></td><td className="num"><Money c={p.target} /></td><td className="num"><span className={'pill ' + (p.above ? 'ok' : 'bad')}><Money c={p.deployable} /></span></td></tr>)}</tbody>
            </table></div>
            <div className="panel-head"><h2 id="rv-u">Suggested uses</h2><Link className="small" to="/debt/paydown">Paydown vs invest</Link></div>
            <ol style={{ margin: 0, padding: '8px 20px 16px 36px' }}>{plan.ranked.slice(0, 5).map((u) => <li key={u.key}>{u.label} <span className="muted small">{bpsPct(u.afterTaxBps)} after tax{plan.allocations.find((a) => a.use.key === u.key) ? ` · ${usd(plan.allocations.find((a) => a.use.key === u.key)!.amount)} recommended` : ''}</span></li>)}</ol>
          </section>
        </div>
        {can(user, 'debt.edit') && (
          <section className="panel panel-pad" aria-labelledby="rv-p">
            <h2 id="rv-p" style={{ marginBottom: 8 }}>Reserve policy</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="rv-w">Weeks of fixed costs</label><input id="rv-w" className="num" inputMode="numeric" value={f.weeks} onChange={(e) => setF({ ...f, weeks: e.target.value })} /></div>
              <div className="field"><label htmlFor="rv-l">Average over (months)</label><input id="rv-l" className="num" inputMode="numeric" value={f.lookback} onChange={(e) => setF({ ...f, lookback: e.target.value })} /></div>
              <div className="field"><label htmlFor="rv-c">Cushion</label><input id="rv-c" className="num" inputMode="decimal" value={f.cushion} onChange={(e) => setF({ ...f, cushion: e.target.value })} /></div>
              <label className="check"><input type="checkbox" checked={f.fuel} onChange={(e) => setF({ ...f, fuel: e.target.checked })} /> One fuel load per store</label>
              <label className="check"><input type="checkbox" checked={f.payroll} onChange={(e) => setF({ ...f, payroll: e.target.checked })} /> One payroll</label>
              <label className="check"><input type="checkbox" checked={f.clearing} onChange={(e) => setF({ ...f, clearing: e.target.checked })} /> Count supplier and card clearing as cash</label>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { setErrors([]); try { saveDebtSettings(books, user, { reserve: { weeksFixed: Number(f.weeks), lookbackMonths: Number(f.lookback), fuelLoad: f.fuel, payroll: f.payroll, cushion: moneyIn(f.cushion), cashSubtypes: f.clearing ? ['bank', 'cash', 'clearing'] : ['bank', 'cash'] } }); say('Saved the reserve policy.'); } catch (e) { setErrors(errList(e)); } }}>Save policy</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="reserve" />
    </>
  );
}

// ── Related-party loans ──────────────────────────────────────────────────
export function RelatedPartyLoansPage() {
  const { state, books, user, version } = useBooks();
  const today = todayInChicago();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const rows = useMemo(() => relatedPartyLoans(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = debtOf(state);
  const related = state.parties.filter((p) => !p.deleted && (p.type === 'related_company' || p.type === 'owner'));
  const [t, setT] = useState({ partyId: related[0]?.id ?? '', direction: 'lent' as 'lent' | 'borrowed', rate: '0', schedule: '', start: today, maturity: '', documented: true });
  const [ack, setAck] = useState<{ termsId: ID; period: string; amount: string; by: string; note: string } | null>(null);
  const [afr, setAfr] = useState((d.settings.afrBps / 100).toFixed(2));
  if (!can(user, 'view.reports') || !can(user, 'view.all_stores')) return <NoAccess title="Related-party loans" />;
  const edit = can(user, 'debt.edit');
  const lent = rows.filter((r) => r.direction === 'lent');
  const borrowed = rows.filter((r) => r.direction === 'borrowed');
  const flagged = rows.filter((r) => r.imputed);
  const unconfirmed = rows.filter((r) => r.terms).flatMap((r) => r.months.filter((m) => m.balance !== 0 && !m.ack));
  const tie = (acct: ID) => {
    const a = state.accounts.find((x) => x.id === acct)!;
    const gl = balanceAsOf(state, acct, today);
    const parties = rows.filter((r) => r.accountId === acct).reduce((x, r) => x + r.balance, 0);
    return { label: gl === parties ? `${a.number} ${a.name}: the parties add to the account` : `${a.number} ${a.name}: ${usd(gl - parties)} is not tagged to a party`, ok: gl === parties, detail: <Money c={gl} dollar /> };
  };
  const header = ['Party', 'Direction', 'Account', 'Balance', 'Rate %', 'Schedule', 'Documented', 'Below AFR', 'Imputed interest a year', 'Last confirmed'];
  const exportRows = rows.map((r) => [r.partyName, r.direction, state.accounts.find((a) => a.id === r.accountId)?.number ?? '', csvMoney(r.balance), r.terms ? (r.terms.rateBps / 100).toFixed(2) : '', r.terms?.schedule ?? 'No documented terms', r.terms?.documented ? 'yes' : 'no', r.imputed ? 'yes' : '', csvMoney(r.imputedAnnual), r.months.filter((m) => m.ack).at(-1)?.period ?? '']);
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Related-party loans" lede={`Loans to and from the owners' other businesses: documented terms, balances agreed each month, and a flag where the rate is below the applicable federal rate (${bpsPct(d.settings.afrBps)}).`}>
        <ExportButtons name="related-party-loans" header={header} rows={exportRows} sheet="Related-party loans" print={false} />
      </PageHead>
      <section className="figures" aria-label="Related-party loans" style={{ marginBottom: 20 }}>
        <Figure label="Lent to related parties" value={<Money c={lent.reduce((a, r) => a + r.balance, 0)} whole dollar />} note={`${lent.length} parties on 1910`} />
        <Figure label="Owed to related parties" value={<Money c={borrowed.reduce((a, r) => a + r.balance, 0)} whole dollar />} note={`${borrowed.length} parties on 2400`} />
        <Figure label="Below the AFR" value={String(flagged.length)} note={flagged.length ? `${flagged.map((r) => r.partyName).join(', ')}: about ${usd(flagged.reduce((a, r) => a + r.imputedAnnual, 0))} a year imputed` : 'Every documented rate is at or above the AFR'} />
        <Figure label="Month ends not confirmed" value={String(unconfirmed.length)} note="Documented loans with a balance" />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel" aria-labelledby="rp-t">
          <div className="panel-head"><h2 id="rp-t">Balances and terms</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Party</th><th scope="col">Direction</th><th scope="col" className="num">Balance</th><th scope="col">Rate</th><th scope="col">Terms</th><th scope="col">Monthly confirmations</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.partyId + r.accountId}>
                <td><Link to={`/intercompany/parties/${r.partyId}`}>{r.partyName}</Link></td>
                <td>{r.direction === 'lent' ? 'We lent' : 'They lent us'}<div className="muted small">{state.accounts.find((a) => a.id === r.accountId)?.number}</div></td>
                <td className="num"><Money c={r.balance} /></td>
                <td>{r.terms ? bpsPct(r.terms.rateBps) : '–'}{r.imputed && <div><span className="pill warn">Below AFR · imputed ≈ {usd(r.imputedAnnual)}/yr</span></div>}</td>
                <td className="small">{r.terms ? <>{r.terms.schedule}{r.terms.maturity ? `; due ${shortDate(r.terms.maturity)}` : ''}<div className="muted">{r.terms.documented ? 'Signed note on file' : 'Not documented'}</div></> : <span className="pill bad">No documented terms</span>}</td>
                <td className="small">{r.terms ? r.months.map((m) => (
                  <div key={m.period}>{periodLabel(m.period)}: <Money c={m.balance} dollar /> {m.agreed === true ? <span className="pill ok">Agreed</span> : m.agreed === false ? <span className="pill bad">Differs: {usd(m.ack!.confirmedBalance)}</span> : m.balance === 0 ? <span className="muted">nil</span> : edit ? <button className="btn sm" onClick={() => setAck({ termsId: r.terms!.id, period: m.period, amount: (m.balance / 100).toFixed(2), by: '', note: '' })}>Record confirmation</button> : <span className="pill warn">Not confirmed</span>}</div>
                )) : <span className="muted">Record terms first</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[tie(RP_LOAN_ACCTS.lent), tie(RP_LOAN_ACCTS.borrowed)]} />
        </section>
        {ack && edit && (
          <section className="panel panel-pad" aria-labelledby="rp-a">
            <h2 id="rp-a" style={{ marginBottom: 8 }}>Confirmation for {periodLabel(ack.period)}</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="ra-a">Balance they confirmed</label><input id="ra-a" className="num" inputMode="decimal" value={ack.amount} onChange={(e) => setAck({ ...ack, amount: e.target.value })} /></div>
              <div className="field"><label htmlFor="ra-b">Confirmed by</label><input id="ra-b" value={ack.by} onChange={(e) => setAck({ ...ack, by: e.target.value })} /></div>
              <div className="field"><label htmlFor="ra-n">Note (needed if it differs)</label><input id="ra-n" value={ack.note} onChange={(e) => setAck({ ...ack, note: e.target.value })} /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setErrors([]); try { acknowledgeBalance(books, user, { termsId: ack.termsId, period: ack.period, confirmedBalance: parseMoney(ack.amount) ?? NaN, confirmedBy: ack.by, note: ack.note }); setAck(null); say('Recorded the confirmation.'); } catch (e) { setErrors(errList(e)); } }}>Save confirmation</button><button className="btn" onClick={() => setAck(null)}>Cancel</button></div>
          </section>
        )}
        {edit && (
          <div className="grid-2">
            <section className="panel panel-pad" aria-labelledby="rp-n">
              <h2 id="rp-n" style={{ marginBottom: 8 }}>Record loan terms</h2>
              <div className="form-grid">
                <div className="field"><label htmlFor="rt-p">Party</label><select id="rt-p" value={t.partyId} onChange={(e) => setT({ ...t, partyId: e.target.value })}>{related.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div className="field"><label htmlFor="rt-d">Direction</label><select id="rt-d" value={t.direction} onChange={(e) => setT({ ...t, direction: e.target.value as 'lent' | 'borrowed' })}><option value="lent">We lent (1910)</option><option value="borrowed">They lent us (2400)</option></select></div>
                <div className="field"><label htmlFor="rt-r">Rate (%)</label><input id="rt-r" className="num" inputMode="decimal" value={t.rate} onChange={(e) => setT({ ...t, rate: e.target.value })} /></div>
                <div className="field"><label htmlFor="rt-s">Repayment terms</label><input id="rt-s" value={t.schedule} placeholder="On demand; monthly $1,000" onChange={(e) => setT({ ...t, schedule: e.target.value })} /></div>
                <div className="field"><label htmlFor="rt-st">Start</label><input id="rt-st" type="date" value={t.start} onChange={(e) => setT({ ...t, start: e.target.value })} /></div>
                <div className="field"><label htmlFor="rt-m">Maturity</label><input id="rt-m" type="date" value={t.maturity} onChange={(e) => setT({ ...t, maturity: e.target.value })} /></div>
                <label className="check"><input type="checkbox" checked={t.documented} onChange={(e) => setT({ ...t, documented: e.target.checked })} /> Signed note on file</label>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setErrors([]); try { const existing = d.rpTerms.find((x) => x.partyId === t.partyId && x.accountId === RP_LOAN_ACCTS[t.direction]); saveRpTerms(books, user, { id: existing?.id, partyId: t.partyId, direction: t.direction, accountId: RP_LOAN_ACCTS[t.direction], rateBps: pctIn(t.rate), schedule: t.schedule, start: t.start, maturity: t.maturity || undefined, documented: t.documented }); say('Saved the terms.'); } catch (e) { setErrors(errList(e)); } }}>Save terms</button></div>
            </section>
            <section className="panel panel-pad" aria-labelledby="rp-afr">
              <h2 id="rp-afr" style={{ marginBottom: 8 }}>Applicable federal rate</h2>
              <p className="small muted" style={{ marginBottom: 8 }}>A related-party loan at a rate below the AFR can have interest imputed for tax (IRC §7872). Use the short-term AFR for demand loans; ask the CPA about the $10,000 de minimis rule.</p>
              <div className="form-grid"><div className="field"><label htmlFor="rp-af">AFR (%)</label><input id="rp-af" className="num" inputMode="decimal" value={afr} onChange={(e) => setAfr(e.target.value)} /></div></div>
              <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => { setErrors([]); try { saveDebtSettings(books, user, { afrBps: pctIn(afr) }); say('Saved the AFR.'); } catch (e) { setErrors(errList(e)); } }}>Save AFR</button></div>
            </section>
          </div>
        )}
      </div>
      {toast}
      <Help k="rpLoans" />
    </>
  );
}
