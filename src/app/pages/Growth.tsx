import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import { ExportButtons, useEntries } from '../components/reportkit';
import { AttachButton, DocList } from '../components/docs';
import { useParam } from '../components/glkit';
import {
  DD_AREA_LABEL, DD_STATUS_LABEL, DECISION_LABEL, GALLON_VARIANCE_PCT, MODE_LABEL, PF_YEARS, PROJECT_KIND_LABEL, RAG_LABEL, RAG_PILL, SITE_FACTORS,
  acquisitionProForma, addFixPlan, analyzeAcquisition, attachDdDoc, capitalAllocation, companyValuation, compareOptions, deploySuggestion, distributionTie,
  distributionsByOwner, evaluateDeal, expansionScorecard, factorScores, growthOf, inputsFromStore, lastCompleteMonth, proFormaResult, quarterLabel, quarterlyReview,
  rampCheck, recordDistribution, recordScorecard, returnsByStore, reviewWorkbook, safeDistribution, safeDistributionHistory, saveAcquisition, saveGrowthSettings,
  saveProForma, saveProject, saveSite, saveValuationSnapshot, saveWeights, scorecardChange, sensitivity, setDdItem, setQoe, siteScorecard, taxDistributionCover,
  valuationTrend, newestStore, type DealRef, type PfYear,
} from '../../core/growth';
import { debtOf, ratioX, reserveHistory } from '../../core/debt';
import { ownerDraws } from '../../core/intercompany';
import { balanceAsOf } from '../../core/reports';
import { firstBooksPeriod } from '../../core/debt';
import { lastDayOfPeriod, periodLabel, periodsBetween, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { xlsx } from '../../core/xlsx';
import type { Acquisition, CapitalLine, CapitalProject, DdStatus, Financing, ID, ProForma, ProFormaInputs, Rag, Risk, SiteFactor, SiteProfile } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const usd = (c: number) => formatMoney(c, { dollarSign: true, whole: true });
const pc = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`);
const yrs = (v: number | null | undefined) => (v === null || v === undefined ? 'Not within 10 years' : `${v.toFixed(1)} years`);
const moneyIn = (s: string) => (s.trim() ? parseMoney(s) ?? NaN : 0);
const numIn = (s: string) => { const n = Number(s.replace(/[,%\s]/g, '')); return s.trim() && Number.isFinite(n) ? n : NaN; };
const gal = (n: number) => Math.round(n).toLocaleString('en-US');
const dollars = (c: number) => (c / 100).toFixed(2);

function NoAccess({ title }: { title: string }) {
  return <PageHead eyebrow="Growth" title={title} lede="Your role doesn't include the growth and owner screens." />;
}
function RagPill({ s }: { s: Rag }) {
  return <span className={'pill ' + RAG_PILL[s]}>{RAG_LABEL[s]}</span>;
}
function useGrowth() {
  const { state, books, user, version, stores } = useBooks();
  const entries = useEntries();
  const today = todayInChicago();
  const g = useMemo(() => growthOf(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = can(user, 'view.reports') && can(user, 'view.all_stores');
  const edit = can(user, 'growth.edit');
  const code = (id?: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  return { state, books, user, version, stores, entries, today, g, ok, edit, code };
}
function useXlsxBook() {
  const { books, user } = useBooks();
  return (name: string, sheets: { name: string; rows: (string | number | null | undefined)[][] }[]) => {
    const data = xlsx(sheets);
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = name + '.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { books.logExport(user, name + '.xlsx'); } catch { /* no export role */ }
  };
}
function Field({ id, label, value, onChange, num = true, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; num?: boolean; hint?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} className={num ? 'num' : undefined} inputMode={num ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} />{hint && <span className="muted small">{hint}</span>}</div>;
}
function Panel({ id, title, extra, children }: { id: string; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head"><h2 id={id}>{title}</h2>{extra && <span className="muted small">{extra}</span>}</div>
      {children}
    </section>
  );
}

const SHORT: Record<string, string> = { ebitda: 'EBITDA', samestore: 'Same-store', breakeven: 'Break-even', reserve: 'Reserve + equity', dscr: 'DSCR', leverage: 'Leverage', management: 'Management', ramp: 'Ramp' };

// ── Expansion readiness ──────────────────────────────────────────────────
export function ReadinessPage() {
  const { state, books, user, version, entries, today, g, ok, edit, code } = useGrowth();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const sc = useMemo(() => expansionScorecard(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const ch = scorecardChange(state, sc);
  const newest = newestStore(state);
  const ramp = useMemo(() => (newest ? rampCheck(state, newest.id, today, entries) : { rows: [] }), [state, newest, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fix, setFix] = useState({ storeId: 'st_hm11', text: '' });
  const [mgr, setMgr] = useState({ ready: g.settings.managerReady, note: g.settings.managerNote ?? '' });
  if (!ok) return <NoAccess title="Expansion readiness" />;
  const greens = sc.checks.filter((c) => c.status === 'green').length;
  const hist = [...g.scoreHistory].sort((a, b) => b.period.localeCompare(a.period));
  const recorded = hist.find((h) => h.period === sc.period);
  const ruleOk = sc.overall === (sc.checks.some((c) => c.status === 'red') ? 'red' : sc.checks.every((c) => c.status === 'green') ? 'green' : 'amber');
  const header = ['Check', 'Status', 'Value', 'Target', 'Detail'];
  const rows = sc.checks.map((c) => [c.label, RAG_LABEL[c.status], c.value, c.target, c.detail]);
  const operating = state.stores.filter((s) => s.kind === 'operating' && !s.deleted);
  return (
    <>
      <PageHead eyebrow="Growth" title="Expansion readiness" lede={`Are we ready for the next store? Eight checks, each green, amber or red, recalculated each month. Ratios are for ${periodLabel(sc.period)}, the latest complete month.`}>
        <ExportButtons name={`expansion-readiness-${sc.period}`} header={header} rows={rows} sheet="Expansion readiness" />
        {edit && <button className="btn primary" onClick={() => { try { recordScorecard(books, user, today); say(`${periodLabel(sc.period)} recorded.`); } catch (e) { setErrors(errList(e)); } }}>{recorded ? 'Record again' : `Record ${periodLabel(sc.period)}`}</button>}
      </PageHead>
      <section className="figures" aria-label="Readiness" style={{ marginBottom: 20 }}>
        <Figure label="Overall" value={<RagPill s={sc.overall} />} note={sc.overall === 'green' ? 'Ready to commit to the next deal' : sc.overall === 'red' ? 'Fix the red checks first' : 'Close, with work to do'} />
        <Figure label="Checks green" value={`${greens} of ${sc.checks.length}`} note={`${sc.checks.filter((c) => c.status === 'red').length} red, ${sc.checks.filter((c) => c.status === 'amber' || c.status === 'na').length} amber or not enough history`} />
        <Figure label="TTM EBITDA" value={<Money c={sc.metrics?.ebitdaAnnual ?? 0} whole dollar />} note={sc.metrics?.annualized ? `Annualized from ${sc.metrics.months} months` : 'Trailing twelve months'} href="/debt/covenants" />
        <Figure label="Equity for the next deal" value={<Money c={sc.equityNeed} whole dollar />} note={`${usd(Math.max(0, sc.reserve.deployable))} above the reserve today`} href="/growth/capital" />
        <Figure label="Last recorded" value={hist[0] ? <RagPill s={hist[0].overall} /> : '–'} note={hist[0] ? periodLabel(hist[0].period) : 'Nothing recorded yet'} />
      </section>
      {ch.changed && <div className="note warn" role="status" style={{ marginBottom: 16 }}>{ch.message}</div>}
      <Errors errors={errors} />
      <div className="stack">
        <Panel id="rd-c" title="The checks" extra={sc.deal ? <>Deal tested: <Link to={`/growth/pro-forma?id=${sc.deal.pf.id}`}>{sc.deal.pf.name}</Link></> : 'No deal pro forma yet'}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">Value</th><th scope="col">Target</th><th scope="col">How it was measured</th></tr></thead>
            <tbody>{sc.checks.map((c) => <tr key={c.key}><td><Link to={c.to}>{c.label}</Link></td><td><RagPill s={c.status} /></td><td>{c.value}</td><td className="small">{c.target}</td><td className="small" style={{ minWidth: 260 }}>{c.detail}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={[
            { label: 'Overall follows the rule: any red is red, all green is green, otherwise amber', ok: ruleOk },
            { label: recorded ? `${periodLabel(sc.period)} is in the history` : `${periodLabel(sc.period)} not recorded yet`, ok: !!recorded, detail: recorded ? <RagPill s={recorded.overall} /> : undefined },
          ]} />
        </Panel>
        <div className="grid-2">
          <Panel id="rd-f" title="Fix plans for stores below break-even">
            {g.fixPlans.length ? <ul style={{ margin: 0, padding: '8px 20px 12px 36px' }}>{g.fixPlans.map((f) => <li key={f.id}><b>{code(f.storeId)}</b> {f.text} <span className="muted small">{shortDate(f.at.slice(0, 10))}</span></li>)}</ul> : <p className="panel-pad muted">No fix plans yet.</p>}
            {edit && <div className="panel-pad">
              <div className="form-grid">
                <div className="field"><label htmlFor="fx-s">Store</label><select id="fx-s" value={fix.storeId} onChange={(e) => setFix({ ...fix, storeId: e.target.value })}>{operating.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></div>
                <Field id="fx-t" label="Fix plan" num={false} value={fix.text} onChange={(v) => setFix({ ...fix, text: v })} hint="What changes, who owns it, by when." />
              </div>
              <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => { setErrors([]); try { addFixPlan(books, user, fix); setFix({ ...fix, text: '' }); say('Fix plan added.'); } catch (e) { setErrors(errList(e)); } }}>Add fix plan</button></div>
            </div>}
          </Panel>
          <Panel id="rd-m" title="Management bandwidth">
            <div className="panel-pad">
              <p style={{ marginTop: 0 }}>{g.settings.managerReady ? <>A manager is ready to promote{g.settings.managerNote ? `: ${g.settings.managerNote}` : ''}.</> : 'Nobody is marked ready to promote.'} Books closed on time is read from <Link to="/close/periods">Close › Periods</Link>.</p>
              {edit && <>
                <div className="field"><label><input type="checkbox" checked={mgr.ready} onChange={(e) => setMgr({ ...mgr, ready: e.target.checked })} /> A manager is ready to run the next store</label></div>
                <Field id="mg-n" label="Who, and why ready" num={false} value={mgr.note} onChange={(v) => setMgr({ ...mgr, note: v })} />
                <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => { setErrors([]); try { saveGrowthSettings(books, user, { managerReady: mgr.ready, managerNote: mgr.note.trim() || undefined }); say('Saved.'); } catch (e) { setErrors(errList(e)); } }}>Save</button></div>
              </>}
            </div>
          </Panel>
        </div>
        <section className="panel" aria-labelledby="ramp">
          <div className="panel-head"><h2 id="ramp">Ramp: {newest?.code ?? 'newest store'} vs its targets</h2><span className="muted small">A month in progress is compared with its target prorated by the days with sales.</span></div>
          {ramp.rows.length ? <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Days</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Target</th><th scope="col" className="num">%</th><th scope="col" className="num">Inside sales</th><th scope="col" className="num">Target</th><th scope="col" className="num">%</th><th scope="col" className="num">EBITDA</th><th scope="col" className="num">Target</th><th scope="col">Status</th></tr></thead>
            <tbody>{ramp.rows.map((r) => <tr key={r.period}><td>{periodLabel(r.period)}</td><td className="num">{r.days} of {r.daysInMonth}</td><td className="num">{gal(r.actual.gallons)}</td><td className="num">{gal(r.target.gallons)}</td><td className="num">{pc(r.gallonsPct)}</td><td className="num"><Money c={r.actual.insideSales} /></td><td className="num"><Money c={r.target.insideSales} /></td><td className="num">{pc(r.insidePct)}</td><td className="num"><Money c={r.actual.ebitda} /></td><td className="num"><Money c={r.target.ebitda} /></td><td><RagPill s={r.status} /></td></tr>)}</tbody>
          </table></div> : <p className="panel-pad muted">No ramp targets with sales yet.</p>}
          <TieOut items={ramp.rows.map((r) => ({ label: `${periodLabel(r.period)} target prorated ${r.days}/${r.daysInMonth}`, ok: Math.abs(r.target.gallons - Math.round(((ramp.plan?.targets.find((t) => t.period === r.period)?.gallons ?? 0) * r.days) / r.daysInMonth)) <= 1 }))} />
        </section>
        <Panel id="rd-h" title="History" extra="One row a month, as recorded">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col">Overall</th>{sc.checks.map((c) => <th key={c.key} scope="col">{SHORT[c.key] ?? c.key}</th>)}<th scope="col">Recorded</th></tr></thead>
            <tbody>{hist.map((h) => <tr key={h.period}><td>{periodLabel(h.period)}</td><td><RagPill s={h.overall} /></td>{sc.checks.map((c) => <td key={c.key}>{h.checks[c.key] ? <RagPill s={h.checks[c.key]} /> : '–'}</td>)}<td className="small">{shortDate(h.at.slice(0, 10))}</td></tr>)}</tbody>
          </table></div>
        </Panel>
      </div>
      {toast}
      <Help k="growthReadiness" />
    </>
  );
}

// ── Sites ────────────────────────────────────────────────────────────────
const BLANK_SITE = { name: '', area: '', kind: 'prospect' as SiteProfile['kind'], aadt: '', visibility: '3', access: '3', population: '', growth: '', trucks: '', zoning: 'unknown' as SiteProfile['zoning'], environmental: 'unknown' as SiteProfile['environmental'], utilities: 'all' as SiteProfile['utilities'], income: '' };
export function SitesPage() {
  const { state, books, user, version, g, ok, edit } = useGrowth();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const sc = useMemo(() => siteScorecard(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [w, setW] = useState<Record<SiteFactor, string>>(() => Object.fromEntries(SITE_FACTORS.map((f) => [f.key, String(g.weights[f.key])])) as Record<SiteFactor, string>);
  const [f, setF] = useState(BLANK_SITE);
  const [comp, setComp] = useState({ siteId: '', name: '', brand: '', distance: '', price: '', amenities: '' });
  if (!ok) return <NoAccess title="Site scorecard" />;
  const prospects = sc.rows.filter((r) => r.site.kind === 'prospect');
  const best = [...prospects].sort((a, b) => b.score - a.score)[0];
  const header = ['Site', 'Kind', 'Score', 'vs our stores', 'Rating', ...SITE_FACTORS.map((x) => x.label), 'AADT', 'Competitors 1-3 mi'];
  const rows = sc.rows.map((r) => [r.site.name, r.site.kind, r.score, r.vsExisting ?? '', r.rating, ...SITE_FACTORS.map((x) => r.scores[x.key]), r.site.aadt, r.site.competitors.map((c) => `${c.name} (${c.brand}, ${c.distanceMi} mi${c.priceCpg ? `, ${(c.priceCpg / 100).toFixed(2)}` : ''}${c.amenities ? `, ${c.amenities}` : ''})`).join('; ')]);
  const tw = SITE_FACTORS.reduce((a, x) => a + g.weights[x.key], 0);
  const recomputed = sc.rows.every((r) => Math.abs(r.score - Math.round((SITE_FACTORS.reduce((a, x) => a + factorScores(r.site)[x.key] * g.weights[x.key], 0) / tw) * 10) / 10) < 0.05);
  return (
    <>
      <PageHead eyebrow="Growth" title="Site scorecard" lede="Each prospect scored on traffic, visibility, access, competition, population, truck traffic, zoning, environmental, utilities and income, with weights you set, against our own stores' sites.">
        <ExportButtons name="site-scorecard" header={header} rows={rows} sheet="Sites" print={false} />
      </PageHead>
      <section className="figures" aria-label="Sites" style={{ marginBottom: 20 }}>
        <Figure label="Prospects" value={String(prospects.length)} note={`${prospects.filter((r) => r.rating === 'strong').length} strong, ${prospects.filter((r) => r.rating === 'weak').length} weak`} />
        <Figure label="Best prospect" value={best ? best.score.toFixed(1) : '–'} note={best?.site.name ?? 'Add a prospect below'} />
        <Figure label="Our stores' average" value={sc.existingAvg === null ? '–' : sc.existingAvg.toFixed(1)} note={`${sc.rows.length - prospects.length} store sites entered`} />
        <Figure label="Weights" value={String(sc.weightTotal)} note="Scores are a weighted average, so the total needn't be 100" />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <Panel id="st-t" title="Scores" extra="0–100 per factor; strong = at or above our stores' average, weak = 15 or more below">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Site</th><th scope="col" className="num">Score</th><th scope="col" className="num">vs our stores</th><th scope="col">Rating</th>{SITE_FACTORS.map((x) => <th key={x.key} scope="col" className="num" title={x.hint}>{x.label}</th>)}</tr></thead>
            <tbody>{sc.rows.map((r) => <tr key={r.site.id}><td>{r.site.name}<div className="muted small">{r.site.kind === 'existing' ? 'Our store' : `Prospect · ${r.site.status}`} · {r.site.area}</div></td><td className="num"><b>{r.score.toFixed(1)}</b></td><td className="num">{r.vsExisting === null ? '–' : (r.vsExisting >= 0 ? '+' : '') + r.vsExisting.toFixed(1)}</td><td><span className={'pill ' + (r.rating === 'strong' ? 'ok' : r.rating === 'weak' ? 'bad' : 'warn')}>{r.rating}</span></td>{SITE_FACTORS.map((x) => <td key={x.key} className="num">{r.scores[x.key]}</td>)}</tr>)}</tbody>
          </table></div>
          <TieOut items={[{ label: 'Every score = Σ weight × factor score ÷ Σ weights', ok: recomputed }]} />
        </Panel>
        <Panel id="st-c" title="Competition within 3 miles">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Site</th><th scope="col">Competitor</th><th scope="col">Brand</th><th scope="col" className="num">Miles</th><th scope="col" className="num">Regular price</th><th scope="col">Amenities</th></tr></thead>
            <tbody>{sc.rows.flatMap((r) => r.site.competitors.map((c, i) => <tr key={r.site.id + i}><td>{r.site.name}</td><td>{c.name}</td><td>{c.brand}</td><td className="num">{c.distanceMi.toFixed(1)}</td><td className="num">{c.priceCpg ? `$${(c.priceCpg / 100).toFixed(2)}` : '–'}</td><td>{c.amenities}</td></tr>))}</tbody>
          </table></div>
          {edit && <div className="panel-pad">
            <div className="form-grid">
              <div className="field"><label htmlFor="cp-s">Site</label><select id="cp-s" value={comp.siteId} onChange={(e) => setComp({ ...comp, siteId: e.target.value })}><option value="">Choose…</option>{g.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <Field id="cp-n" label="Competitor" num={false} value={comp.name} onChange={(v) => setComp({ ...comp, name: v })} />
              <Field id="cp-b" label="Brand" num={false} value={comp.brand} onChange={(v) => setComp({ ...comp, brand: v })} />
              <Field id="cp-d" label="Distance (miles)" value={comp.distance} onChange={(v) => setComp({ ...comp, distance: v })} />
              <Field id="cp-p" label="Regular price ($/gal)" value={comp.price} onChange={(v) => setComp({ ...comp, price: v })} />
              <Field id="cp-a" label="Amenities" num={false} value={comp.amenities} onChange={(v) => setComp({ ...comp, amenities: v })} />
            </div>
            <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => {
              setErrors([]);
              const s = g.sites.find((x) => x.id === comp.siteId);
              if (!s) { setErrors(['Choose the site.']); return; }
              try { saveSite(books, user, { ...s, competitors: [...s.competitors, { name: comp.name.trim(), brand: comp.brand.trim(), distanceMi: numIn(comp.distance), priceCpg: comp.price.trim() ? Math.round(numIn(comp.price) * 100) : undefined, amenities: comp.amenities.trim() }] }); setComp({ ...comp, name: '', brand: '', distance: '', price: '', amenities: '' }); say('Competitor added.'); } catch (e) { setErrors(errList(e)); }
            }}>Add competitor</button></div>
          </div>}
        </Panel>
        {edit && <div className="grid-2">
          <section className="panel panel-pad" aria-labelledby="st-w">
            <h2 id="st-w" style={{ marginBottom: 8 }}>Weights</h2>
            <div className="form-grid">{SITE_FACTORS.map((x) => <Field key={x.key} id={`w-${x.key}`} label={x.label} value={w[x.key]} onChange={(v) => setW({ ...w, [x.key]: v })} hint={x.hint} />)}</div>
            <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => { setErrors([]); try { saveWeights(books, user, Object.fromEntries(SITE_FACTORS.map((x) => [x.key, numIn(w[x.key])])) as Record<SiteFactor, number>); say('Weights saved.'); } catch (e) { setErrors(errList(e)); } }}>Save weights</button></div>
          </section>
          <section className="panel panel-pad" aria-labelledby="st-n">
            <h2 id="st-n" style={{ marginBottom: 8 }}>Add a site</h2>
            <div className="form-grid">
              <Field id="ns-n" label="Name" num={false} value={f.name} onChange={(v) => setF({ ...f, name: v })} />
              <Field id="ns-a" label="Area" num={false} value={f.area} onChange={(v) => setF({ ...f, area: v })} />
              <div className="field"><label htmlFor="ns-k">Kind</label><select id="ns-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as SiteProfile['kind'] })}><option value="prospect">Prospect</option><option value="existing">One of our stores</option></select></div>
              <Field id="ns-t" label="Traffic (AADT)" value={f.aadt} onChange={(v) => setF({ ...f, aadt: v })} />
              <Field id="ns-v" label="Visibility (1–5)" value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })} />
              <Field id="ns-i" label="Ingress / egress (1–5)" value={f.access} onChange={(v) => setF({ ...f, access: v })} />
              <Field id="ns-p" label="Population (3 mi)" value={f.population} onChange={(v) => setF({ ...f, population: v })} />
              <Field id="ns-g" label="Population growth % a year" value={f.growth} onChange={(v) => setF({ ...f, growth: v })} />
              <Field id="ns-tr" label="Trucks a day" value={f.trucks} onChange={(v) => setF({ ...f, trucks: v })} />
              <div className="field"><label htmlFor="ns-z">Zoning</label><select id="ns-z" value={f.zoning} onChange={(e) => setF({ ...f, zoning: e.target.value as SiteProfile['zoning'] })}><option value="permitted">Permitted</option><option value="conditional">Conditional use</option><option value="rezoning">Needs rezoning</option><option value="unknown">Unknown</option></select></div>
              <div className="field"><label htmlFor="ns-e">Environmental</label><select id="ns-e" value={f.environmental} onChange={(e) => setF({ ...f, environmental: e.target.value as SiteProfile['environmental'] })}><option value="clean">Clean Phase I</option><option value="recs">RECs found</option><option value="phase2">Phase II needed</option><option value="contaminated">Contaminated</option><option value="unknown">Unknown</option></select></div>
              <div className="field"><label htmlFor="ns-u">Utilities</label><select id="ns-u" value={f.utilities} onChange={(e) => setF({ ...f, utilities: e.target.value as SiteProfile['utilities'] })}><option value="all">All at the site</option><option value="partial">Partial</option><option value="none">None</option></select></div>
              <Field id="ns-m" label="Median household income" value={f.income} onChange={(v) => setF({ ...f, income: v })} />
            </div>
            <div className="actions" style={{ marginTop: 8 }}><button className="btn primary" onClick={() => {
              setErrors([]);
              try {
                saveSite(books, user, { name: f.name, area: f.area, kind: f.kind, status: f.kind === 'existing' ? 'open' : 'reviewing', aadt: numIn(f.aadt), visibility: numIn(f.visibility), access: numIn(f.access), competitors: [], population: numIn(f.population), growthBps: Math.round(numIn(f.growth || '0') * 100), trucksPerDay: numIn(f.trucks || '0'), zoning: f.zoning, environmental: f.environmental, utilities: f.utilities, medianIncome: moneyIn(f.income) });
                setF(BLANK_SITE); say('Site saved.');
              } catch (e) { setErrors(errList(e)); }
            }}>Save site</button></div>
          </section>
        </div>}
      </div>
      {toast}
      <Help k="growthSites" />
    </>
  );
}

// ── Pro forma ────────────────────────────────────────────────────────────
type Draft = { name: string; mode: ProForma['mode']; siteId: string; monthsToOpen: string; source?: string; i: Record<string, string>; ramp: string; capital: { label: string; kind: CapitalLine['kind']; amount: string }[]; upfront: string; cpgInc: string; cpgMonths: string; loan: string; rate: string; term: string; amort: string; re: string; app: string; overrun: string; risks: string };
const MONEY_KEYS = ['insideSales', 'kitchenSales', 'otherIncome', 'labor', 'occupancy', 'utilities', 'repairs', 'insurance', 'propertyTax', 'otherExpense'] as const;
const NUM_KEYS = ['gallons', 'cpg', 'retailCpg', 'insideMarginPct', 'foodCostPct', 'cardFeePct', 'growthPct'] as const;
const INPUT_LABEL: Record<string, string> = {
  gallons: 'Gallons a month', cpg: 'Fuel margin (¢/gal)', retailCpg: 'Retail price (¢/gal)', insideSales: 'Inside sales a month', insideMarginPct: 'Inside margin %', kitchenSales: 'Kitchen sales a month', foodCostPct: 'Food cost %',
  otherIncome: 'Other income a month', labor: 'Labor a month', occupancy: 'Rent / occupancy a month', utilities: 'Utilities a month', cardFeePct: 'Card fees % of sales', repairs: 'Repairs a month', insurance: 'Insurance a month', propertyTax: 'Property tax a month', otherExpense: 'Other expenses a month', growthPct: 'Growth % a year after year 1',
};
function toDraft(p: ProForma): Draft {
  const i = p.inputs;
  const up = p.incentives.filter((x) => x.kind === 'upfront').reduce((a, x) => a + x.amount, 0);
  const cpg = p.incentives.find((x) => x.kind === 'cpg');
  return {
    name: p.name, mode: p.mode, siteId: p.siteId ?? '', monthsToOpen: String(p.monthsToOpen), source: p.source,
    i: { ...Object.fromEntries(MONEY_KEYS.map((k) => [k, dollars(i[k])])), gallons: String(i.gallons), cpg: String(i.cpg), retailCpg: String(i.retailCpg), insideMarginPct: String(i.insideMarginPct), foodCostPct: String(i.foodCostPct), cardFeePct: String(i.cardFeePct), growthPct: String(i.growthBps / 100) },
    ramp: i.ramp.join(', '), capital: p.capital.map((c) => ({ label: c.label, kind: c.kind, amount: dollars(c.amount) })), upfront: dollars(up), cpgInc: String(cpg?.cpg ?? 0), cpgMonths: String(cpg?.months ?? 0),
    loan: dollars(p.financing.loanAmount), rate: String(p.financing.rateBps / 100), term: String(p.financing.termMonths), amort: String(p.financing.amortizationMonths), re: dollars(p.realEstateValue), app: String(p.appreciationBps / 100), overrun: String(p.overrunPct), risks: p.risks.join('\n'),
  };
}
function fromDraft(d: Draft, base?: ProForma): Omit<ProForma, 'id' | 'updatedAt' | 'updatedBy'> {
  const inputs = {
    ...Object.fromEntries(MONEY_KEYS.map((k) => [k, moneyIn(d.i[k] ?? '')])),
    gallons: numIn(d.i.gallons), cpg: numIn(d.i.cpg), retailCpg: numIn(d.i.retailCpg), insideMarginPct: numIn(d.i.insideMarginPct), foodCostPct: numIn(d.i.foodCostPct), cardFeePct: numIn(d.i.cardFeePct),
    growthBps: Math.round(numIn(d.i.growthPct || '0') * 100), ramp: d.ramp.split(/[,\s]+/).filter(Boolean).map(Number),
  } as ProFormaInputs;
  const incentives = [
    ...(moneyIn(d.upfront) ? [{ label: base?.incentives.find((x) => x.kind === 'upfront')?.label ?? 'Upfront incentive', kind: 'upfront' as const, amount: moneyIn(d.upfront) }] : []),
    ...(numIn(d.cpgInc || '0') ? [{ label: base?.incentives.find((x) => x.kind === 'cpg')?.label ?? 'Per-gallon incentive', kind: 'cpg' as const, amount: 0, cpg: numIn(d.cpgInc), months: numIn(d.cpgMonths) }] : []),
  ];
  return {
    name: d.name, mode: d.mode, siteId: d.siteId || undefined, acquisitionId: base?.acquisitionId, source: d.source, monthsToOpen: numIn(d.monthsToOpen), inputs,
    capital: d.capital.filter((c) => c.label.trim() || c.amount.trim()).map((c) => ({ label: c.label, kind: c.kind, amount: moneyIn(c.amount) })), incentives,
    financing: { loanAmount: moneyIn(d.loan), rateBps: Math.round(numIn(d.rate || '0') * 100), termMonths: numIn(d.term || '0'), amortizationMonths: numIn(d.amort || '0') },
    realEstateValue: moneyIn(d.re), appreciationBps: Math.round(numIn(d.app || '0') * 100), overrunPct: numIn(d.overrun || '0'), risks: d.risks.split('\n').map((x) => x.trim()).filter(Boolean), note: base?.note,
  };
}
const PL_ROWS: { key: keyof PfYear; label: string; strong?: boolean; gallons?: boolean }[] = [
  { key: 'gallons', label: 'Gallons', gallons: true }, { key: 'fuelGp', label: 'Fuel gross profit' }, { key: 'insideSales', label: 'Inside sales' }, { key: 'insideGp', label: 'Inside gross profit' },
  { key: 'kitchenSales', label: 'Kitchen sales' }, { key: 'kitchenGp', label: 'Kitchen gross profit' }, { key: 'otherIncome', label: 'Other income' }, { key: 'incentive', label: 'Supplier incentives' },
  { key: 'grossProfit', label: 'Gross profit', strong: true }, { key: 'labor', label: 'Labor' }, { key: 'occupancy', label: 'Occupancy' }, { key: 'utilities', label: 'Utilities' }, { key: 'cardFees', label: 'Card fees' },
  { key: 'repairs', label: 'Repairs' }, { key: 'insurance', label: 'Insurance' }, { key: 'propertyTax', label: 'Property tax' }, { key: 'otherExpense', label: 'Other expenses' }, { key: 'opex', label: 'Operating expenses', strong: true },
  { key: 'ebitda', label: 'EBITDA', strong: true }, { key: 'interest', label: 'Interest' }, { key: 'principal', label: 'Principal' }, { key: 'debtService', label: 'Debt service' }, { key: 'cashAfterDebt', label: 'Cash flow after debt service', strong: true },
];
export function ProFormaPage() {
  const { state, books, user, version, entries, today, g, ok, edit } = useGrowth();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [id, setId] = useParam('id', g.proFormas[0]?.id ?? '');
  const saved = g.proFormas.find((p) => p.id === id) ?? g.proFormas[0];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pre, setPre] = useState({ storeId: 'st_hm15', from: '', to: '' });
  const live = useMemo(() => { if (!draft) return saved; try { return { ...fromDraft(draft, saved), id: saved?.id ?? 'draft', updatedAt: '', updatedBy: '' } as ProForma; } catch { return saved; } }, [draft, saved]);
  const r = useMemo(() => (live ? proFormaResult(live, g.settings) : null), [live, g.settings, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const sens = useMemo(() => (live && r && r.months.every((m) => Number.isFinite(m.ebitda)) ? sensitivity(live, g.settings) : null), [live, r, g.settings]);
  const exportX = useXlsxBook();
  const csv = useExport();
  if (!ok) return <NoAccess title="New store pro forma" />;
  const first = firstBooksPeriod(state) ?? lastCompleteMonth(today);
  const lastFull = lastCompleteMonth(today);
  const set = (patch: Partial<Draft>) => setDraft({ ...(draft ?? toDraft(saved!)), ...patch });
  const setI = (k: string, v: string) => { const d = draft ?? toDraft(saved!); setDraft({ ...d, i: { ...d.i, [k]: v } }); };
  const valid = !!r && r.months.every((m) => Number.isFinite(m.ebitda));
  const annualHeader = ['Line', ...Array.from({ length: PF_YEARS }, (_, k) => `Year ${k + 1}`)];
  const annualRows = r && valid ? PL_ROWS.map((row) => [row.label, ...r.years.map((y) => (row.gallons ? y.gallons : Number(dollars(y[row.key] as number))))]) : [];
  return (
    <>
      <PageHead eyebrow="Growth" title="New store pro forma" lede="Ten years of monthly P&L for a store we might buy, build or lease: volumes ramp to stabilized, then grow; capital, incentives and the loan give the returns. Pre-tax; a balloon is assumed refinanced on the same amortization.">
        <div className="field" style={{ minWidth: 220 }}><label htmlFor="pf-pick" className="sr-only">Pro forma</label><select id="pf-pick" value={saved?.id ?? ''} onChange={(e) => { setId(e.target.value); setDraft(null); }}>{g.proFormas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        {r && valid && can(user, 'export') && <button className="btn" onClick={() => exportX(`pro-forma-${(live?.name ?? 'draft').replace(/\W+/g, '-').toLowerCase()}`, [
          { name: 'Annual', rows: [annualHeader, ...annualRows] },
          { name: 'Monthly', rows: [['Month', ...PL_ROWS.map((x) => x.label)], ...r.months.map((m) => [m.n, ...PL_ROWS.map((x) => (x.gallons ? m.gallons : Number(dollars(m[x.key as keyof typeof m] as number))))])] },
          { name: 'IRR cash flows', rows: [['Years from today', 'Flow', 'Unlevered', 'Levered'], ...r.unleveredFlows.map((f, k) => [Math.round(f.t * 1000) / 1000, f.label ?? '', Number(dollars(f.amount)), Number(dollars(r.leveredFlows[k].amount))])] },
        ])}>Export Excel</button>}
        {r && valid && can(user, 'export') && <button className="btn" onClick={() => csv('pro-forma-annual', annualHeader, annualRows.map((x) => x.map(String)))}>Export CSV</button>}
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
      </PageHead>
      {!saved && <p className="muted">No pro forma yet. {edit ? 'Prefill one from a store below.' : ''}</p>}
      {r && valid && <section className="figures" aria-label="Returns" style={{ marginBottom: 20 }}>
        <Figure label="Levered IRR" value={pc(r.leveredIrr)} note={`Unlevered ${pc(r.unleveredIrr)}`} />
        <Figure label="NPV (levered)" value={<Money c={r.leveredNpv} whole dollar />} note={`At ${(g.settings.discountRateBps / 100).toFixed(1)}%; unlevered ${usd(r.unleveredNpv)}`} />
        <Figure label="Equity" value={<Money c={r.equity} whole dollar />} note={`${usd(r.capitalTotal)} capital − ${usd(r.upfrontIncentives)} incentives − ${usd(r.loan)} loan`} />
        <Figure label="Cash-on-cash" value={pc(r.cashOnCash)} note={`Year ${r.stabilizedYear}, stabilized; payback ${yrs(r.leveredPaybackYears)}`} />
        <Figure label={`DSCR, year ${r.stabilizedYear}`} value={ratioX(r.years[r.stabilizedYear - 1].dscr)} note={`Year 1 ${ratioX(r.years[0].dscr)}`} />
      </section>}
      {live?.source && <p className="muted small">{live.source}</p>}
      {!valid && saved && <div className="note warn" style={{ marginBottom: 16 }}>Some inputs aren't numbers yet; the results show once they are.</div>}
      <Errors errors={errors} />
      <div className="stack">
        {r && valid && <Panel id="pf-a" title="Annual P&L" extra={`Opens in ${live!.monthsToOpen} months · ${MODE_LABEL[live!.mode]}`}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Line</th>{r.years.map((y) => <th key={y.year} scope="col" className="num">Year {y.year}</th>)}</tr></thead>
            <tbody>
              {PL_ROWS.map((row) => <tr key={row.key}><td>{row.strong ? <b>{row.label}</b> : row.label}</td>{r.years.map((y) => <td key={y.year} className="num">{row.gallons ? gal(y.gallons) : row.strong ? <b><Money c={y[row.key] as number} /></b> : <Money c={y[row.key] as number} />}</td>)}</tr>)}
              <tr><td>DSCR</td>{r.years.map((y) => <td key={y.year} className="num">{ratioX(y.dscr)}</td>)}</tr>
            </tbody>
          </table></div>
          <TieOut items={[
            { label: r.ties ? 'Every annual total = the sum of its 12 months' : 'Annual totals do not add to the months', ok: r.ties },
            { label: 'EBITDA − debt service = cash after debt service, each year', ok: r.years.every((y) => y.ebitda - y.debtService === y.cashAfterDebt) },
          ]} />
          <details className="panel-pad"><summary>Monthly P&L (120 months)</summary>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Month</th><th scope="col" className="num">Ramp</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Gross profit</th><th scope="col" className="num">Operating expenses</th><th scope="col" className="num">EBITDA</th><th scope="col" className="num">Debt service</th><th scope="col" className="num">Cash after debt</th></tr></thead>
              <tbody>{r.months.map((m) => <tr key={m.n}><td>{m.n} <span className="muted small">yr {m.year}</span></td><td className="num">{m.rampPct}%</td><td className="num">{gal(m.gallons)}</td><td className="num"><Money c={m.grossProfit} /></td><td className="num"><Money c={m.opex} /></td><td className="num"><Money c={m.ebitda} /></td><td className="num"><Money c={m.debtService} /></td><td className="num"><Money c={m.cashAfterDebt} /></td></tr>)}</tbody>
            </table></div>
          </details>
        </Panel>}
        {r && valid && <div className="grid-2">
          <Panel id="pf-f" title="IRR cash flows" extra="The flows the IRR and NPV are computed on">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">When</th><th scope="col">Flow</th><th scope="col" className="num">Unlevered</th><th scope="col" className="num">Levered</th></tr></thead>
              <tbody>{r.unleveredFlows.map((f, k) => <tr key={k}><td className="num">{f.t ? `${f.t.toFixed(2)} yrs` : 'Today'}</td><td className="small">{r.leveredFlows[k].label}</td><td className="num"><Money c={f.amount} /></td><td className="num"><Money c={r.leveredFlows[k].amount} /></td></tr>)}</tbody>
            </table></div>
            <TieOut items={[
              { label: 'NPV of the levered flows at the levered IRR is zero', ok: r.leveredIrr === null || Math.abs(r.leveredFlows.reduce((a, f) => a + f.amount / Math.pow(1 + r.leveredIrr!, f.t), 0)) < 100 },
              { label: 'Year-0 equity = capital − upfront incentives − loan (+ debt service before opening)', ok: -r.leveredFlows[0].amount === r.capitalTotal - r.upfrontIncentives - r.loan + r.preOpeningDebtService },
            ]} />
            <p className="panel-pad muted small" style={{ margin: 0 }}>Residual at year {PF_YEARS}: real estate {usd(r.residualRealEstate)} + inventory and working capital back {usd(r.recoveredCapital)}; loan payoff {usd(r.loanBalanceAtExit)}.</p>
          </Panel>
          <Panel id="pf-b" title="Break-even" extra={`Year ${r.breakEven.year}, a month`}>
            <div className="panel-pad"><dl className="kv">
              <dt>Gallons (EBITDA = 0)</dt><dd>{r.breakEven.gallonsEbitda === null ? '–' : gal(r.breakEven.gallonsEbitda)} <span className="muted small">vs {gal(r.breakEven.planGallons)} planned</span></dd>
              <dt>Gallons (after debt service)</dt><dd>{r.breakEven.gallonsAfterDebt === null ? '–' : gal(r.breakEven.gallonsAfterDebt)}</dd>
              <dt>Inside sales (EBITDA = 0)</dt><dd>{r.breakEven.insideEbitda === null ? '–' : <Money c={r.breakEven.insideEbitda} dollar whole />} <span className="muted small">vs {usd(r.breakEven.planInside)} planned</span></dd>
              <dt>Inside sales (after debt service)</dt><dd>{r.breakEven.insideAfterDebt === null ? '–' : <Money c={r.breakEven.insideAfterDebt} dollar whole />}</dd>
            </dl><p className="muted small">Each holds the other lines at plan. Card fees move with sales; everything else is fixed.</p></div>
          </Panel>
        </div>}
        {sens && <Panel id="pf-s" title="Sensitivity" extra="Levered IRR; base case in the middle">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Gallons \ margin</th>{sens.cpgSteps.map((c) => <th key={c} scope="col" className="num">{c > 0 ? '+' : ''}{c}¢</th>)}</tr></thead>
            <tbody>{sens.gallonSteps.map((gp, k) => <tr key={gp}><th scope="row">{gp > 0 ? '+' : ''}{gp}%</th>{sens.irrGrid[k].map((v, j) => <td key={j} className="num">{k === 2 && j === 2 ? <b>{pc(v)}</b> : pc(v)}</td>)}</tr>)}</tbody>
          </table></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Loan rate</th><th scope="col" className="num">Levered IRR</th><th scope="col" className="num">NPV</th><th scope="col" className="num">DSCR, stabilized</th><th scope="col" className="num">Cash-on-cash</th></tr></thead>
            <tbody>{sens.rateRows.map((x) => <tr key={x.delta}><td>{(x.rateBps / 100).toFixed(2)}% {x.delta ? <span className="muted small">({x.delta > 0 ? '+' : ''}{(x.delta / 100).toFixed(2)}%)</span> : <span className="muted small">(base)</span>}</td><td className="num">{pc(x.leveredIrr)}</td><td className="num"><Money c={x.npv} /></td><td className="num">{ratioX(x.dscr)}</td><td className="num">{pc(x.cashOnCash)}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={[{ label: 'The base cell equals the headline levered IRR', ok: sens.irrGrid[2][2] === r!.leveredIrr }]} />
        </Panel>}
        {edit && <section className="panel panel-pad" aria-labelledby="pf-pre">
          <h2 id="pf-pre" style={{ marginBottom: 8 }}>Start from a store's actuals</h2>
          <div className="form-grid">
            <div className="field"><label htmlFor="pp-s">Store</label><select id="pp-s" value={pre.storeId} onChange={(e) => setPre({ ...pre, storeId: e.target.value })}>{state.stores.filter((s) => s.kind === 'operating').map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></div>
            <Field id="pp-f" label="From month (YYYY-MM)" num={false} value={pre.from || first} onChange={(v) => setPre({ ...pre, from: v })} />
            <Field id="pp-t" label="To month (YYYY-MM)" num={false} value={pre.to || lastFull} onChange={(v) => setPre({ ...pre, to: v })} />
          </div>
          <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => {
            setErrors([]);
            const from = pre.from || first, to = pre.to || lastFull;
            if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to) { setErrors(['Enter the months as YYYY-MM, from on or before to.']); return; }
            const x = inputsFromStore(state, pre.storeId, { from, to, entries });
            const base = saved ? toDraft(saved) : toDraft({ id: '', name: '', mode: 'build', monthsToOpen: 12, inputs: { ...x.inputs, ramp: [60, 70, 80, 90], growthBps: 200 }, capital: [{ label: 'Construction', kind: 'construction', amount: 0 }], incentives: [], financing: { loanAmount: 0, rateBps: 700, termMonths: 120, amortizationMonths: 240 }, realEstateValue: 0, appreciationBps: 0, overrunPct: 0, risks: [], updatedAt: '', updatedBy: '' });
            const d = toDraft({ ...fromDraft(base, saved), id: '', updatedAt: '', updatedBy: '', inputs: { ...x.inputs, ramp: base.ramp.split(/[,\s]+/).filter(Boolean).map(Number), growthBps: Math.round(numIn(base.i.growthPct || '0') * 100) } });
            setDraft({ ...d, name: `New store like ${state.stores.find((s) => s.id === pre.storeId)?.code}`, source: x.source });
            setId('');
            say('Prefilled. Adjust and save as a new pro forma.');
          }}>Prefill the inputs</button></div>
        </section>}
        {edit && (draft || saved) && (() => {
          const d = draft ?? toDraft(saved!);
          return (
            <section className="panel panel-pad" aria-labelledby="pf-e">
              <h2 id="pf-e" style={{ marginBottom: 8 }}>Inputs</h2>
              <div className="form-grid">
                <Field id="pe-n" label="Name" num={false} value={d.name} onChange={(v) => set({ name: v })} />
                <div className="field"><label htmlFor="pe-m">Buy, build or lease</label><select id="pe-m" value={d.mode} onChange={(e) => set({ mode: e.target.value as ProForma['mode'] })}><option value="buy">Buy</option><option value="build">Build</option><option value="lease">Lease</option></select></div>
                <div className="field"><label htmlFor="pe-s">Site</label><select id="pe-s" value={d.siteId} onChange={(e) => set({ siteId: e.target.value })}><option value="">None</option>{g.sites.filter((s) => s.kind === 'prospect').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                <Field id="pe-o" label="Months to open" value={d.monthsToOpen} onChange={(v) => set({ monthsToOpen: v })} />
                {[...NUM_KEYS.slice(0, 3), 'insideSales', 'insideMarginPct', 'kitchenSales', 'foodCostPct', 'otherIncome', 'labor', 'occupancy', 'utilities', 'cardFeePct', 'repairs', 'insurance', 'propertyTax', 'otherExpense', 'growthPct'].map((k) => <Field key={k} id={`pi-${k}`} label={INPUT_LABEL[k]} value={d.i[k] ?? ''} onChange={(v) => setI(k, v)} />)}
                <Field id="pe-r" label="Ramp: % of stabilized, month by month" num={false} value={d.ramp} onChange={(v) => set({ ramp: v })} hint="e.g. 55, 62, 68 … then 100%" />
              </div>
              <h3 style={{ margin: '16px 0 8px' }}>Capital needs</h3>
              <div className="table-wrap"><table className="t">
                <thead><tr><th scope="col">Line</th><th scope="col">Kind</th><th scope="col" className="num">Amount</th></tr></thead>
                <tbody>{d.capital.map((c, k) => <tr key={k}>
                  <td><label className="sr-only" htmlFor={`cl-${k}`}>Capital line {k + 1}</label><input id={`cl-${k}`} value={c.label} onChange={(e) => set({ capital: d.capital.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} /></td>
                  <td><label className="sr-only" htmlFor={`ck-${k}`}>Kind of line {k + 1}</label><select id={`ck-${k}`} value={c.kind} onChange={(e) => set({ capital: d.capital.map((x, j) => (j === k ? { ...x, kind: e.target.value as CapitalLine['kind'] } : x)) })}>{['land', 'building', 'construction', 'equipment', 'pos', 'signage', 'inventory', 'working_capital', 'opening', 'other'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select></td>
                  <td><label className="sr-only" htmlFor={`ca-${k}`}>Amount of line {k + 1}</label><input id={`ca-${k}`} className="num" inputMode="decimal" value={c.amount} onChange={(e) => set({ capital: d.capital.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)) })} /></td>
                </tr>)}</tbody>
              </table></div>
              <div className="actions" style={{ margin: '8px 0 12px' }}><button className="btn sm" onClick={() => set({ capital: [...d.capital, { label: '', kind: 'other', amount: '' }] })}>Add a capital line</button></div>
              <div className="form-grid">
                <Field id="pe-up" label="Upfront brand / supplier incentive" value={d.upfront} onChange={(v) => set({ upfront: v })} />
                <Field id="pe-ci" label="Incentive ¢ per gallon" value={d.cpgInc} onChange={(v) => set({ cpgInc: v })} />
                <Field id="pe-cm" label="for months" value={d.cpgMonths} onChange={(v) => set({ cpgMonths: v })} />
                <Field id="pe-l" label="Loan amount" value={d.loan} onChange={(v) => set({ loan: v })} />
                <Field id="pe-ra" label="Rate %" value={d.rate} onChange={(v) => set({ rate: v })} />
                <Field id="pe-t" label="Term (months)" value={d.term} onChange={(v) => set({ term: v })} />
                <Field id="pe-am" label="Amortization (months)" value={d.amort} onChange={(v) => set({ amort: v })} />
                <Field id="pe-re" label="Real estate value at opening" value={d.re} onChange={(v) => set({ re: v })} />
                <Field id="pe-ap" label="Appreciation % a year" value={d.app} onChange={(v) => set({ app: v })} />
                <Field id="pe-ov" label="Construction overrun risk %" value={d.overrun} onChange={(v) => set({ overrun: v })} />
                <div className="field"><label htmlFor="pe-rk">Risks (one a line)</label><textarea id="pe-rk" rows={3} value={d.risks} onChange={(e) => set({ risks: e.target.value })} /></div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={() => { setErrors([]); try { const p = saveProForma(books, user, { ...fromDraft(d, saved), id: id && saved ? saved.id : undefined }); setDraft(null); setId(p.id); say('Pro forma saved.'); } catch (e) { setErrors(errList(e)); } }}>{id && saved ? 'Save changes' : 'Save as new'}</button>
                {saved && <button className="btn" onClick={() => { setErrors([]); try { const p = saveProForma(books, user, { ...fromDraft(d, saved), name: `${d.name} (copy)` }); setDraft(null); setId(p.id); say('Saved a copy.'); } catch (e) { setErrors(errList(e)); } }}>Save a copy</button>}
                {draft && <button className="btn" onClick={() => setDraft(null)}>Discard changes</button>}
              </div>
            </section>
          );
        })()}
      </div>
      {toast}
      <Help k="growthProForma" />
    </>
  );
}

// ── Buy vs build vs lease ────────────────────────────────────────────────
export function ComparePage() {
  const { state, g, ok } = useGrowth();
  const [site, setSite] = useParam('site', '');
  const options = useMemo(() => {
    const pfs = g.proFormas.filter((p) => !site || p.siteId === site);
    const acqs = site ? [] : g.acquisitions.filter((a) => a.status !== 'passed').map((a) => acquisitionProForma(state, a)).filter((p) => !pfs.some((x) => x.id === p.id));
    return compareOptions([...pfs, ...acqs], g.settings);
  }, [g, site, state]);
  if (!ok) return <NoAccess title="Buy vs build vs lease" />;
  const name = (id?: ID) => options.rows.find((r) => r.pf.id === id)?.pf.name ?? '–';
  const header = ['Option', 'Mode', 'Levered IRR %', 'Unlevered IRR %', 'Levered NPV', 'Upfront cash', 'Months to open', 'Residual real estate', 'IRR with overrun %', 'Risks'];
  const rows = options.rows.map((x) => [x.pf.name, x.pf.mode, x.r.leveredIrr === null ? '' : (x.r.leveredIrr * 100).toFixed(1), x.r.unleveredIrr === null ? '' : (x.r.unleveredIrr * 100).toFixed(1), csvMoney(x.r.leveredNpv), csvMoney(x.upfrontCash), x.timeToOpen, csvMoney(x.residualRealEstate), x.irrWithOverrun === null ? '' : (x.irrWithOverrun * 100).toFixed(1), x.risks.join(' | ')]);
  return (
    <>
      <PageHead eyebrow="Growth" title="Buy vs build vs lease" lede="The options side by side: returns, the cash it takes up front, how long until it opens, what is left in real estate at the end, and what could go wrong.">
        <div className="field" style={{ minWidth: 220 }}><label htmlFor="cmp-s" className="sr-only">Site</label><select id="cmp-s" value={site} onChange={(e) => setSite(e.target.value)}><option value="">All options and acquisitions</option>{g.sites.filter((s) => s.kind === 'prospect').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <ExportButtons name="buy-build-lease" header={header} rows={rows.map((x) => x.map(String))} sheet="Options" />
      </PageHead>
      <section className="figures" aria-label="Options" style={{ marginBottom: 20 }}>
        <Figure label="Options" value={String(options.rows.length)} note={[...new Set(options.rows.map((x) => x.pf.mode))].join(', ') || 'None'} />
        <Figure label="Best levered IRR" value={pc(options.rows.find((x) => x.pf.id === options.bestIrr)?.r.leveredIrr)} note={name(options.bestIrr)} />
        <Figure label="Best NPV" value={<Money c={options.rows.find((x) => x.pf.id === options.bestNpv)?.r.leveredNpv ?? 0} whole dollar />} note={name(options.bestNpv)} />
        <Figure label="Least cash up front" value={<Money c={options.rows.find((x) => x.pf.id === options.leastCash)?.upfrontCash ?? 0} whole dollar />} note={name(options.leastCash)} />
      </section>
      <section className="panel" aria-labelledby="cmp-t">
        <div className="panel-head"><h2 id="cmp-t">Side by side</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Measure</th>{options.rows.map((x) => <th key={x.pf.id} scope="col" className="num">{x.pf.id.startsWith('acq:') ? x.pf.name : <Link to={`/growth/pro-forma?id=${x.pf.id}`}>{x.pf.name}</Link>}<div className="muted small">{MODE_LABEL[x.pf.mode]}</div></th>)}</tr></thead>
          <tbody>
            <tr><td>Levered IRR</td>{options.rows.map((x) => <td key={x.pf.id} className="num">{pc(x.r.leveredIrr)}</td>)}</tr>
            <tr><td>Unlevered IRR</td>{options.rows.map((x) => <td key={x.pf.id} className="num">{pc(x.r.unleveredIrr)}</td>)}</tr>
            <tr><td>NPV (levered)</td>{options.rows.map((x) => <td key={x.pf.id} className="num"><Money c={x.r.leveredNpv} /></td>)}</tr>
            <tr><td>Upfront cash (equity)</td>{options.rows.map((x) => <td key={x.pf.id} className="num"><Money c={x.upfrontCash} /></td>)}</tr>
            <tr><td>Months to open</td>{options.rows.map((x) => <td key={x.pf.id} className="num">{x.timeToOpen}</td>)}</tr>
            <tr><td>Stabilized EBITDA</td>{options.rows.map((x) => <td key={x.pf.id} className="num"><Money c={x.r.years[x.r.stabilizedYear - 1].ebitda} /></td>)}</tr>
            <tr><td>Residual real estate (year {PF_YEARS})</td>{options.rows.map((x) => <td key={x.pf.id} className="num"><Money c={x.residualRealEstate} /></td>)}</tr>
            <tr><td>IRR with the construction overrun</td>{options.rows.map((x) => <td key={x.pf.id} className="num">{x.irrWithOverrun === null ? '–' : pc(x.irrWithOverrun)}</td>)}</tr>
            <tr><td>Risk factors</td>{options.rows.map((x) => <td key={x.pf.id} className="small" style={{ minWidth: 200 }}><ul style={{ margin: 0, paddingLeft: 16 }}>{x.risks.map((k) => <li key={k}>{k}</li>)}</ul></td>)}</tr>
          </tbody>
        </table></div>
        <TieOut items={[{ label: 'Upfront cash = capital − upfront incentives − loan, for every option', ok: options.rows.every((x) => x.upfrontCash === x.r.capitalTotal - x.r.upfrontIncentives - x.r.loan) }]} />
      </section>
      <Help k="growthCompare" />
    </>
  );
}

// ── Acquisitions ─────────────────────────────────────────────────────────
export function AcquisitionsPage() {
  const { books, user, version, g, ok, edit } = useGrowth();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const [id, setId] = useParam('id', g.acquisitions[0]?.id ?? '');
  const acq = g.acquisitions.find((a) => a.id === id) ?? g.acquisitions[0];
  const a = useMemo(() => (acq ? analyzeAcquisition(acq, g.settings) : null), [acq, g.settings, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sup, setSup] = useState<Record<string, string>>({});
  const [offer, setOffer] = useState('');
  if (!ok) return <NoAccess title="Acquisitions" />;
  if (!acq || !a) return <><PageHead eyebrow="Growth" title="Acquisitions" lede="No acquisition target yet." /><Help k="growthAcquisitions" /></>;
  const header = ['Section', 'Line', 'Amount'];
  const rows = [...acq.sellerPnl.map((l) => [l.section, l.label, csvMoney(l.amount)]), ['', 'Seller\'s reported profit', csvMoney(a.reportedEbitda)], ...acq.addBacks.map((x) => [x.kind, x.label, csvMoney(x.kind === 'normalize' ? -x.amount : x.amount)]), ['', 'Normalized EBITDA', csvMoney(a.normalizedEbitda)]];
  const save = (patch: Partial<Acquisition>, msg: string) => { setErrors([]); try { saveAcquisition(books, user, { ...acq, ...patch }); say(msg); } catch (e) { setErrors(errList(e)); } };
  const vaultDocs = acq.dd.reduce((n, d) => n + d.attachments.length, 0);
  const sec = (k: 'revenue' | 'cogs' | 'expense') => acq.sellerPnl.filter((l) => l.section === k);
  return (
    <>
      <PageHead eyebrow="Growth" title="Acquisitions" lede="Buying an existing store: the seller's numbers normalized, fuel volume checked against supplier statements, three valuation methods, the closing cash and the diligence tracker.">
        <div className="field" style={{ minWidth: 220 }}><label htmlFor="acq-p" className="sr-only">Target</label><select id="acq-p" value={acq.id} onChange={(e) => setId(e.target.value)}>{g.acquisitions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <ExportButtons name="acquisition-normalization" header={header} rows={rows} sheet="Normalization" />
        <Link className="btn" to={`/growth/evaluate?deal=acq:${acq.id}`}>Evaluate this deal</Link>
      </PageHead>
      <section className="figures" aria-label="Target" style={{ marginBottom: 20 }}>
        <Figure label="Normalized EBITDA" value={<Money c={a.normalizedEbitda} whole dollar />} note={`Seller reported ${usd(a.reportedEbitda)}`} />
        <Figure label="Valuation (mid)" value={<Money c={a.valuation.mid} whole dollar />} note={`Range ${usd(a.valuation.low)} – ${usd(a.valuation.high)}; asking ${usd(acq.askingPrice)}`} />
        <Figure label="Cash at closing" value={<Money c={a.purchase.total} whole dollar />} note={`Equity ${usd(a.purchase.equity)} after a ${usd(a.purchase.loan)} loan`} />
        <Figure label="Due diligence" value={`${a.dd.done} of ${a.dd.total}`} note={a.dd.issues ? `${a.dd.issues} issue${a.dd.issues === 1 ? '' : 's'} open` : 'No issues found'} />
        <Figure label="Fuel volume" value={a.gallons.verified ? gal(a.gallons.annual) : 'Unverified'} note={a.gallons.flagged ? `${a.gallons.flagged} months more than ${GALLON_VARIANCE_PCT}% off` : 'Gallons a year'} />
      </section>
      <p className="muted small">{acq.area} · {acq.status} · {acq.note}</p>
      <Errors errors={errors} />
      <div className="stack">
        <div className="grid-2">
          <Panel id="aq-p" title="Seller's P&L, normalized" extra="Last twelve months, as presented">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Line</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>
                {(['revenue', 'cogs', 'expense'] as const).map((k) => sec(k).map((l) => <tr key={k + l.label}><td>{l.label} <span className="muted small">{k === 'cogs' ? 'cost of goods' : k}</span></td><td className="num"><Money c={k === 'revenue' ? l.amount : -l.amount} /></td></tr>))}
                <tr><td><b>Seller's reported profit</b></td><td className="num"><b><Money c={a.reportedEbitda} /></b></td></tr>
                {acq.addBacks.map((x) => <tr key={x.label}><td>{x.kind === 'normalize' ? 'Less: ' : 'Add back: '}{x.label} <span className="muted small">{x.kind === 'perk' ? 'owner perk' : x.kind === 'normalize' ? 'normalization' : 'add-back'}{x.note ? ` · ${x.note}` : ''}</span></td><td className="num"><Money c={x.kind === 'normalize' ? -x.amount : x.amount} /></td></tr>)}
                <tr><td><b>Normalized EBITDA</b></td><td className="num"><b><Money c={a.normalizedEbitda} /></b></td></tr>
              </tbody>
            </table></div>
            <TieOut items={[
              { label: 'Reported = revenue − cost of goods − expenses', ok: a.reportedEbitda === a.revenue - a.cogs - a.expenses },
              { label: 'Normalized = reported + add-backs + perks − normalizations', ok: a.normalizedEbitda === a.reportedEbitda + a.addBacks + a.perks - a.normalizations },
            ]} />
          </Panel>
          <Panel id="aq-v" title="Valuation">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Method</th><th scope="col" className="num">Low</th><th scope="col" className="num">High</th></tr></thead>
              <tbody>
                <tr><td>EBITDA × {(g.settings.multipleLow / 100).toFixed(1)}–{(g.settings.multipleHigh / 100).toFixed(1)}</td><td className="num"><Money c={a.valuation.multiple.low} /></td><td className="num"><Money c={a.valuation.multiple.high} /></td></tr>
                <tr><td>Per gallon ({gal(a.gallons.annual)} × ${(g.settings.perGallonLow / 100).toFixed(2)}–${(g.settings.perGallonHigh / 100).toFixed(2)})</td><td className="num"><Money c={a.valuation.perGallon.low} /></td><td className="num"><Money c={a.valuation.perGallon.high} /></td></tr>
                <tr><td>Real estate {usd(acq.realEstateValue)} + business ({usd(a.valuation.realEstatePlusBusiness.businessEbitda)} EBITDA after {usd(acq.marketRent)} market rent)</td><td className="num"><Money c={a.valuation.realEstatePlusBusiness.low} /></td><td className="num"><Money c={a.valuation.realEstatePlusBusiness.high} /></td></tr>
                <tr><td><b>Range</b> <span className="muted small">mid {usd(a.valuation.mid)}</span></td><td className="num"><b><Money c={a.valuation.low} /></b></td><td className="num"><b><Money c={a.valuation.high} /></b></td></tr>
              </tbody>
            </table></div>
            <div className="panel-head"><h2 id="aq-c">Cash at closing</h2></div>
            <div className="panel-pad"><dl className="kv">
              <dt>Purchase price (offer)</dt><dd><Money c={a.purchase.price} dollar /></dd>
              <dt>Inside inventory at cost</dt><dd><Money c={a.purchase.inventory} dollar /></dd>
              <dt>Fuel in the tanks</dt><dd><Money c={a.purchase.fuelInTank} dollar /> <span className="muted small">{gal(acq.fuelGallonsInTank)} gal × ${(acq.fuelCostCpg / 100).toFixed(2)}</span></dd>
              <dt>Total</dt><dd><b><Money c={a.purchase.total} dollar /></b></dd>
              <dt>Less loan</dt><dd><Money c={-a.purchase.loan} dollar /></dd>
              <dt>Equity</dt><dd><b><Money c={a.purchase.equity} dollar /></b></dd>
            </dl>
              {edit && <div className="form-grid" style={{ marginTop: 8 }}><Field id="aq-o" label="Offer price" value={offer || dollars(acq.offerPrice)} onChange={setOffer} /><div className="field"><span className="seg-label" aria-hidden>&nbsp;</span><button className="btn" onClick={() => save({ offerPrice: moneyIn(offer || dollars(acq.offerPrice)) }, 'Offer saved.')}>Save offer</button></div></div>}
            </div>
            <TieOut items={[{ label: 'Total = price + inventory + fuel in the tanks', ok: a.purchase.total === a.purchase.price + a.purchase.inventory + a.purchase.fuelInTank }]} />
          </Panel>
        </div>
        <Panel id="aq-g" title="Fuel volume: seller vs supplier statements" extra={`Flag over ${GALLON_VARIANCE_PCT}%`}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Seller says</th><th scope="col" className="num">Supplier statement</th><th scope="col" className="num">Variance</th></tr></thead>
            <tbody>{a.gallons.checks.map((c, k) => <tr key={c.period}><td>{periodLabel(c.period)}</td><td className="num">{gal(c.seller)}</td>
              <td className="num">{edit ? <><label className="sr-only" htmlFor={`sg-${k}`}>Supplier gallons for {periodLabel(c.period)}</label><input id={`sg-${k}`} className="num" inputMode="numeric" style={{ maxWidth: 120 }} value={sup[c.period] ?? (c.supplier === undefined ? '' : String(c.supplier))} onChange={(e) => setSup({ ...sup, [c.period]: e.target.value })} /></> : c.supplier === undefined ? '–' : gal(c.supplier)}</td>
              <td className="num">{c.variancePct === null ? '–' : <span className={'pill ' + (c.flagged ? 'bad' : 'ok')}>{c.variancePct >= 0 ? '+' : ''}{c.variancePct.toFixed(1)}%</span>}</td></tr>)}</tbody>
          </table></div>
          {edit && <div className="panel-pad"><button className="btn" onClick={() => save({ gallonChecks: acq.gallonChecks.map((c) => ({ ...c, supplier: sup[c.period] === undefined ? c.supplier : sup[c.period].trim() ? numIn(sup[c.period]) : undefined })) }, 'Supplier gallons saved.')}>Save supplier gallons</button></div>}
          <TieOut items={[{ label: a.gallons.verified ? `Annual gallons = supplier months averaged × 12 (${gal(a.gallons.annual)})` : 'Not verified: enter supplier statements', ok: a.gallons.verified && !a.gallons.flagged, detail: a.gallons.flagged ? `${a.gallons.flagged} months flagged` : undefined }]} />
        </Panel>
        <div className="grid-2">
          <Panel id="aq-q" title="Quality of earnings checklist" extra={`${a.qoe.done} of ${a.qoe.total} done`}>
            <ul style={{ listStyle: 'none', margin: 0, padding: '8px 16px 12px' }}>{acq.qoe.map((q) => <li key={q.key} style={{ padding: '4px 0' }}>
              <label><input type="checkbox" checked={q.done} disabled={!edit} onChange={(e) => { setErrors([]); try { setQoe(books, user, acq.id, q.key, { done: e.target.checked, note: q.note }); } catch (x) { setErrors(errList(x)); } }} /> {q.label}</label>
              {q.note && <div className="muted small">{q.note}</div>}
            </li>)}</ul>
          </Panel>
          <Panel id="aq-d" title="Due diligence" extra={`${a.dd.done} of ${a.dd.total} done · documents in the vault`}>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Item</th><th scope="col">Status</th><th scope="col">Owner · due</th><th scope="col">Documents</th></tr></thead>
              <tbody>{acq.dd.map((d) => <tr key={d.id}>
                <td>{d.title}<div className="muted small">{DD_AREA_LABEL[d.area]}{d.note ? ` · ${d.note}` : ''}</div></td>
                <td>{edit ? <><label className="sr-only" htmlFor={`dd-${d.id}`}>Status of {d.title}</label><select id={`dd-${d.id}`} value={d.status} onChange={(e) => { setErrors([]); const st = e.target.value as DdStatus; let note = d.note; if (st === 'issue' && !note) note = window.prompt('Describe the issue') ?? ''; try { setDdItem(books, user, acq.id, d.id, { status: st, note }); say('Updated.'); } catch (x) { setErrors(errList(x)); } }}>{(Object.keys(DD_STATUS_LABEL) as DdStatus[]).map((s) => <option key={s} value={s}>{DD_STATUS_LABEL[s]}</option>)}</select></> : <span className={'pill ' + (d.status === 'done' ? 'ok' : d.status === 'issue' ? 'bad' : 'warn')}>{DD_STATUS_LABEL[d.status]}</span>}</td>
                <td className="small">{d.owner}{d.due ? ` · ${shortDate(d.due)}` : ''}</td>
                <td><DocList items={d.attachments} say={say} />{edit && <AttachButton books={books} userId={user.id} label="Attach" say={say} onFile={(att) => { try { attachDdDoc(books, user, acq.id, d.id, att); say('Attached; it is in the document vault.'); } catch (x) { setErrors(errList(x)); } }} />}</td>
              </tr>)}</tbody>
            </table></div>
            <TieOut items={[{ label: 'Every done item has a document', ok: acq.dd.filter((d) => d.status === 'done').every((d) => d.attachments.length > 0), detail: <><Link to="/compliance/vault?q=due%20diligence">{vaultDocs} in the vault</Link></> }]} />
          </Panel>
        </div>
      </div>
      {toast}
      <Help k="growthAcquisitions" />
    </>
  );
}

// ── Capital allocation ──────────────────────────────────────────────────
const BLANK_PROJECT = { name: '', kind: 'remodel' as CapitalProject['kind'], storeId: '', cost: '', ret: '', risk: 'medium' as Risk, strategic: '3', start: '', status: 'idea' as CapitalProject['status'] };
export function CapitalPage() {
  const { state, books, user, version, entries, today, ok, edit, code } = useGrowth();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const p = useMemo(() => capitalAllocation(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(BLANK_PROJECT);
  if (!ok) return <NoAccess title="Capital allocation" />;
  const alloc = new Map(p.allocations.map((a) => [a.use.key, a.amount]));
  const allocated = p.allocations.reduce((a, x) => a + x.amount, 0);
  const header = ['Rank', 'Use', 'Kind', 'Amount', 'Expected return %', 'Risk', 'Risk-adjusted %', 'Payback (years)', 'Strategic (1-5)', 'Allocated', 'Note'];
  const rows = p.uses.map((u, i) => [i + 1, u.label, u.projectKind ? PROJECT_KIND_LABEL[u.projectKind] : u.kind, csvMoney(u.amount), u.expectedReturn === null ? '' : (u.expectedReturn * 100).toFixed(1), u.risk, Number.isFinite(u.riskAdjusted) && u.riskAdjusted >= 0 ? (u.riskAdjusted * 100).toFixed(1) : '', u.paybackYears === null ? '' : u.paybackYears.toFixed(1), u.strategic, csvMoney(alloc.get(u.key) ?? 0), u.note]);
  return (
    <>
      <PageHead eyebrow="Growth" title="Capital allocation" lede="Every competing use of cash on one list: the next store, remodels, a kitchen upgrade, EV or car wash add-ons, debt paydown, owner distributions and the reserve, ranked by risk-adjusted return. Cash above the reserve goes down the list.">
        <ExportButtons name="capital-allocation" header={header} rows={rows.map((x) => x.map(String))} sheet="Capital allocation" print={false} />
      </PageHead>
      <section className="figures" aria-label="Capital" style={{ marginBottom: 20 }}>
        <Figure label="Deployable cash" value={<Money c={Math.max(0, p.deployable)} whole dollar />} note={p.deployable >= 0 ? 'Above the reserve target' : `Reserve short by ${usd(-p.deployable)}`} href="/debt/reserve" />
        <Figure label="Allocated" value={<Money c={allocated} whole dollar />} note={`${p.allocations.length} use${p.allocations.length === 1 ? '' : 's'}; ideas aren't funded until approved`} />
        <Figure label="Top use" value={p.uses[0] ? pc(Number.isFinite(p.uses[0].riskAdjusted) ? p.uses[0].riskAdjusted : null) : '–'} note={p.uses[0]?.label ?? 'Add projects below'} />
        <Figure label="Safe distribution" value={<Money c={p.safe.safe} whole dollar />} href="/growth/owners" />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <Panel id="ca-t" title="Ranked uses" extra="Risk-adjusted = expected return × 1.0 (low), 0.75 (medium) or 0.5 (high)">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">#</th><th scope="col">Use</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Expected return</th><th scope="col">Risk</th><th scope="col" className="num">Risk-adjusted</th><th scope="col" className="num">Payback</th><th scope="col" className="num">Strategic</th><th scope="col" className="num">Allocated</th></tr></thead>
            <tbody>{p.uses.map((u, i) => <tr key={u.key}>
              <td className="num">{i + 1}</td>
              <td><Link to={u.to}>{u.label}</Link><div className="muted small">{u.projectKind ? PROJECT_KIND_LABEL[u.projectKind] : u.kind === 'debt' ? 'Debt paydown' : u.kind === 'distribution' ? 'Owner distributions' : 'Reserve'}{u.status ? ` · ${u.status.replace('_', ' ')}` : ''} · {u.note}</div></td>
              <td className="num"><Money c={u.amount} /></td><td className="num">{pc(u.expectedReturn)}</td><td>{u.risk}</td>
              <td className="num">{Number.isFinite(u.riskAdjusted) && u.riskAdjusted >= 0 ? pc(u.riskAdjusted) : u.riskAdjusted === Infinity ? 'First' : '–'}</td>
              <td className="num">{u.paybackYears === null ? '–' : `${u.paybackYears.toFixed(1)} yrs`}</td><td className="num">{u.strategic}</td>
              <td className="num">{alloc.get(u.key) ? <b><Money c={alloc.get(u.key)!} /></b> : '–'}</td>
            </tr>)}</tbody>
          </table></div>
          <TieOut items={[
            { label: 'Allocated + unallocated = deployable cash', ok: allocated + p.unallocated === Math.max(0, p.deployable), detail: <Money c={Math.max(0, p.deployable)} dollar /> },
            { label: 'Deployable cash is the Phase 12 reserve figure', ok: p.deployable === p.safe.aboveReserve },
          ]} />
        </Panel>
        {edit && <section className="panel panel-pad" aria-labelledby="ca-n">
          <h2 id="ca-n" style={{ marginBottom: 8 }}>Add a capital project</h2>
          <div className="form-grid">
            <Field id="cp-name" label="Project" num={false} value={f.name} onChange={(v) => setF({ ...f, name: v })} />
            <div className="field"><label htmlFor="cp-kind">Kind</label><select id="cp-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CapitalProject['kind'] })}>{Object.entries(PROJECT_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label htmlFor="cp-store">Store</label><select id="cp-store" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Company</option>{state.stores.filter((s) => s.kind === 'operating').map((s) => <option key={s.id} value={s.id}>{code(s.id)}</option>)}</select></div>
            <Field id="cp-cost" label="Cost" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
            <Field id="cp-ret" label="Added cash flow a year" value={f.ret} onChange={(v) => setF({ ...f, ret: v })} />
            <div className="field"><label htmlFor="cp-risk">Risk</label><select id="cp-risk" value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value as Risk })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
            <Field id="cp-str" label="Strategic value (1–5)" value={f.strategic} onChange={(v) => setF({ ...f, strategic: v })} />
            <Field id="cp-start" label="Spend starts (YYYY-MM-DD)" num={false} value={f.start} onChange={(v) => setF({ ...f, start: v })} />
            <div className="field"><label htmlFor="cp-status">Status</label><select id="cp-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CapitalProject['status'] })}><option value="idea">Idea</option><option value="approved">Approved</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="declined">Declined</option></select></div>
          </div>
          <div className="actions" style={{ marginTop: 8 }}><button className="btn primary" onClick={() => { setErrors([]); try { saveProject(books, user, { name: f.name, kind: f.kind, storeId: f.storeId || undefined, cost: moneyIn(f.cost), annualReturn: moneyIn(f.ret), risk: f.risk, strategic: numIn(f.strategic), start: f.start.trim() || undefined, status: f.status }); setF(BLANK_PROJECT); say('Project saved.'); } catch (e) { setErrors(errList(e)); } }}>Save project</button><span className="muted small">Approved or in-progress projects starting within {growthOf(state).settings.capexWindowDays} days come off the safe distribution.</span></div>
        </section>}
      </div>
      {toast}
      <Help k="growthCapital" />
    </>
  );
}

// ── Valuation ────────────────────────────────────────────────────────────
export function ValuationPage() {
  const { state, books, user, version, entries, today, g, ok, edit, code } = useGrowth();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const v = useMemo(() => companyValuation(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = useMemo(() => valuationTrend(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [m, setM] = useState({ lo: String(g.settings.multipleLow / 100), hi: String(g.settings.multipleHigh / 100), glo: dollars(g.settings.perGallonLow), ghi: dollars(g.settings.perGallonHigh) });
  if (!ok) return <NoAccess title="Company valuation" />;
  const loanAccts = ['acct_mortgages', 'acct_notes_equipment', 'acct_loc'];
  const ledgerDebt = v.metrics ? loanAccts.reduce((a, x) => a + -balanceAsOf(state, x, v.metrics!.date), 0) : 0;
  const pv = debtOf(state).propertyValues;
  const header = ['Quarter', 'Date', 'EBITDA', 'Annualized', 'Real estate', 'Debt', 'Equity low', 'Equity mid', 'Equity high', 'Change', 'Source'];
  const rows = trend.map((t) => [t.quarter, t.date, csvMoney(t.ebitda), t.annualized ? 'yes' : 'no', csvMoney(t.realEstate), csvMoney(t.debt), csvMoney(t.equityLow), csvMoney(t.equityMid), csvMoney(t.equityHigh), t.change === null ? '' : csvMoney(t.change), t.entered ? 'Entered' : 'These books']);
  return (
    <>
      <PageHead eyebrow="Growth" title="Company valuation" lede="What the group is worth: EBITDA at a market multiple, the per-gallon method as a cross-check, and store real estate at its appraised value, less every loan against it. Recorded each quarter to show the trend.">
        <ExportButtons name="valuation-trend" header={header} rows={rows} sheet="Valuation" />
        {edit && <button className="btn primary" onClick={() => { try { saveValuationSnapshot(books, user, today); say(`${quarterLabel(v.quarter)} recorded.`); } catch (e) { setErrors(errList(e)); } }}>Record {quarterLabel(v.quarter)}</button>}
      </PageHead>
      <section className="figures" aria-label="Valuation" style={{ marginBottom: 20 }}>
        <Figure label="Equity value (mid)" value={<Money c={v.equityMid} whole dollar />} note={`${usd(v.equityLow)} – ${usd(v.equityHigh)}`} />
        <Figure label="EBITDA" value={<Money c={v.ebitda} whole dollar />} note={v.annualized ? `Annualized from ${v.metrics?.months} months` : 'Trailing twelve months'} />
        <Figure label="Real estate" value={<Money c={v.realEstateTotal} whole dollar />} note={`${v.realEstate.length} stores appraised`} href="/debt/refinance" />
        <Figure label="Debt" value={<Money c={v.debt} whole dollar />} note={`${usd(v.companyDebt)} ours + ${usd(v.debt - v.companyDebt)} property mortgages`} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <div className="grid-2">
          <Panel id="va-m" title="Methods" extra={`As of ${shortDate(today)}`}>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Line</th><th scope="col" className="num">Low</th><th scope="col" className="num">Mid</th><th scope="col" className="num">High</th></tr></thead>
              <tbody>
                <tr><td>Business: EBITDA × {(g.settings.multipleLow / 100).toFixed(1)} / {((g.settings.multipleLow + g.settings.multipleHigh) / 200).toFixed(1)} / {(g.settings.multipleHigh / 100).toFixed(1)}</td><td className="num"><Money c={v.multiple.low} /></td><td className="num"><Money c={v.multiple.mid} /></td><td className="num"><Money c={v.multiple.high} /></td></tr>
                <tr><td>Plus real estate at appraised value</td><td className="num"><Money c={v.realEstateTotal} /></td><td className="num"><Money c={v.realEstateTotal} /></td><td className="num"><Money c={v.realEstateTotal} /></td></tr>
                <tr><td>Less debt</td><td className="num"><Money c={-v.debt} /></td><td className="num"><Money c={-v.debt} /></td><td className="num"><Money c={-v.debt} /></td></tr>
                <tr><td><b>Equity value</b></td><td className="num"><b><Money c={v.equityLow} /></b></td><td className="num"><b><Money c={v.equityMid} /></b></td><td className="num"><b><Money c={v.equityHigh} /></b></td></tr>
                <tr><td>Cross-check: per gallon ({gal(v.gallons)} gal a year × ${(g.settings.perGallonLow / 100).toFixed(2)}–${(g.settings.perGallonHigh / 100).toFixed(2)}) → equity</td><td className="num"><Money c={v.perGallonEquity.low} /></td><td className="num">–</td><td className="num"><Money c={v.perGallonEquity.high} /></td></tr>
              </tbody>
            </table></div>
            <TieOut items={[
              { label: 'Equity = business + real estate − debt', ok: v.equityMid === v.multiple.mid + v.realEstateTotal - v.debt },
              { label: 'Our debt ties to the loan accounts (2300–2320)', ok: ledgerDebt === v.companyDebt, detail: <Money c={ledgerDebt} dollar /> },
              { label: 'Real estate = the latest property values', ok: v.realEstate.every((r) => pv.filter((x) => x.storeId === r.storeId && x.date <= today).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.value === r.value) },
            ]} />
          </Panel>
          <Panel id="va-r" title="Real estate and the debt against it">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Item</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>
                {v.realEstate.map((r) => <tr key={r.storeId}><td>{code(r.storeId)} property <span className="muted small">{r.source}, {shortDate(r.date)}</span></td><td className="num"><Money c={r.value} /></td></tr>)}
                {v.noValue.map((id) => <tr key={id}><td>{code(id)} <span className="muted small">no appraisal on file: not counted</span></td><td className="num">–</td></tr>)}
                <tr><td>Our loans (2300–2320)</td><td className="num"><Money c={-v.companyDebt} /></td></tr>
                {v.propertyDebt.map((x) => <tr key={x.loanId}><td>{x.name} <span className="muted small">carried by a related party</span></td><td className="num"><Money c={-x.balance} /></td></tr>)}
              </tbody>
            </table></div>
          </Panel>
        </div>
        <Panel id="va-t" title="Quarterly snapshots" extra="Entered = carried over from the prior system">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Quarter</th><th scope="col" className="num">EBITDA</th><th scope="col" className="num">Real estate</th><th scope="col" className="num">Debt</th><th scope="col" className="num">Equity (mid)</th><th scope="col" className="num">Change</th><th scope="col">Source</th></tr></thead>
            <tbody>{trend.map((t) => <tr key={t.id}><td>{quarterLabel(t.quarter)}</td><td className="num"><Money c={t.ebitda} />{t.annualized && <div className="muted small">annualized</div>}</td><td className="num"><Money c={t.realEstate} /></td><td className="num"><Money c={t.debt} /></td><td className="num"><b><Money c={t.equityMid} /></b></td><td className="num">{t.change === null ? '–' : <Money c={t.change} signed />}</td><td className="small">{t.entered ? 'Entered' : 'These books'}{t.note ? ` · ${t.note}` : ''}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={[{ label: 'Each change = this quarter − the one before', ok: trend.every((t, i) => i === 0 || t.change === t.equityMid - trend[i - 1].equityMid) }]} />
        </Panel>
        {edit && <section className="panel panel-pad" aria-labelledby="va-s">
          <h2 id="va-s" style={{ marginBottom: 8 }}>Market multiples</h2>
          <div className="form-grid">
            <Field id="vm-lo" label="EBITDA multiple, low" value={m.lo} onChange={(x) => setM({ ...m, lo: x })} />
            <Field id="vm-hi" label="EBITDA multiple, high" value={m.hi} onChange={(x) => setM({ ...m, hi: x })} />
            <Field id="vm-glo" label="$ per annual gallon, low" value={m.glo} onChange={(x) => setM({ ...m, glo: x })} />
            <Field id="vm-ghi" label="$ per annual gallon, high" value={m.ghi} onChange={(x) => setM({ ...m, ghi: x })} />
          </div>
          <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => { setErrors([]); try { saveGrowthSettings(books, user, { multipleLow: Math.round(numIn(m.lo) * 100), multipleHigh: Math.round(numIn(m.hi) * 100), perGallonLow: moneyIn(m.glo), perGallonHigh: moneyIn(m.ghi) }); say('Saved.'); } catch (e) { setErrors(errList(e)); } }}>Save multiples</button></div>
        </section>}
      </div>
      {toast}
      <Help k="growthValuation" />
    </>
  );
}

// ── Owner returns & distributions ────────────────────────────────────────
export function OwnersPage() {
  const { state, books, user, version, entries, today, g, ok, code } = useGrowth();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const sd = useMemo(() => safeDistribution(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hist = useMemo(() => safeDistributionHistory(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const owners = useMemo(() => distributionsByOwner(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cover = useMemo(() => taxDistributionCover(state, today, sd.safe), [state, today, sd.safe, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rets = useMemo(() => returnsByStore(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const above = useMemo(() => reserveHistory(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestion = useMemo(() => (above.monthsAbove >= 2 ? deploySuggestion(state, today) : ''), [above.monthsAbove, state, today]);
  const ownerList = state.parties.filter((p) => p.type === 'owner' && !p.deleted);
  const [f, setF] = useState({ partyId: ownerList[0]?.id ?? '', date: today, amount: '', kind: 'regular' as 'regular' | 'tax', note: '', override: '' });
  if (!ok) return <NoAccess title="Owner returns & distributions" />;
  const tie = distributionTie(state);
  const year = owners.year;
  const draws = ownerDraws(state, { from: `${year}-01-01`, to: today });
  const booksYtd = owners.rows.reduce((a, r) => a + r.drawsYtd + r.distributionsYtd, 0);
  const amt = moneyIn(f.amount);
  const over = Number.isFinite(amt) && amt > sd.safe;
  const header = ['Owner', 'Withdrawals YTD (books)', 'Distributions YTD (books)', 'Before the books YTD', 'YTD', 'Lifetime (books)', 'Lifetime before the books', 'Lifetime'];
  const rows = owners.rows.map((r) => [r.name, csvMoney(r.drawsYtd), csvMoney(r.distributionsYtd), csvMoney(r.priorYtd), csvMoney(r.ytd), csvMoney(r.booksLifetime), csvMoney(r.priorLifetime), csvMoney(r.lifetime)]);
  return (
    <>
      <PageHead eyebrow="Growth" title="Owner returns & distributions" lede="What the owners have taken and what they can safely take: cash above the reserve, less capex coming up, tax estimates due and a debt-service cushion. Tax distributions come from the Phase 11 projections; ROE and ROIC by store from each store's balance sheet.">
        <ExportButtons name={`owner-distributions-${year}`} header={header} rows={rows} sheet="Distributions" />
      </PageHead>
      <section className="figures" aria-label="Owners" style={{ marginBottom: 20 }}>
        <Figure label="Safe distribution today" value={<Money c={sd.safe} whole dollar />} note={sd.raw < 0 ? `Short ${usd(-sd.raw)} after the holdbacks` : 'After the reserve, capex, tax and cushion'} />
        <Figure label={`Taken ${year} to date`} value={<Money c={owners.ytd} whole dollar />} note="Withdrawals and distributions, incl. before these books" href="/intercompany/draws" />
        <Figure label="Lifetime" value={<Money c={owners.lifetime} whole dollar />} />
        <Figure label="Tax distributions still to make" value={<Money c={cover.still} whole dollar />} note={cover.covered ? 'Covered by the safe amount' : 'More than the safe amount'} href="/tax/owners" />
      </section>
      {above.monthsAbove >= 2 && <div className="note" role="status" style={{ marginBottom: 16 }}>Cash has been above the reserve for {above.monthsAbove} month ends in a row. {suggestion} <Link to="/growth/capital">Capital allocation</Link> · <Link to="/debt/paydown">Paydown vs invest</Link></div>}
      <Errors errors={errors} />
      <div className="stack">
        <div className="grid-2">
          <Panel id="ow-s" title="Safe distribution build-up">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Part</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>
                <tr><td>Cash (bank, cash on hand, clearing)</td><td className="num"><Money c={sd.cash} /></td></tr>
                <tr><td>Less the reserve target <Link className="small" to="/debt/reserve">how it builds up</Link></td><td className="num"><Money c={-sd.reserveTarget} /></td></tr>
                <tr><td><b>Cash above the reserve</b></td><td className="num"><b><Money c={sd.aboveReserve} /></b></td></tr>
                {sd.capex.map((c) => <tr key={c.id}><td>Less capex: {c.name} <span className="muted small">{c.start ? `starts ${shortDate(c.start)}` : 'in progress'}</span></td><td className="num"><Money c={-c.amount} /></td></tr>)}
                {!sd.capex.length && <tr><td>Less near-term capex <span className="muted small">none approved within {g.settings.capexWindowDays} days</span></td><td className="num"><Money c={0} /></td></tr>}
                {sd.taxDue.map((t) => <tr key={t.label}><td>Less {t.label} <span className="muted small">due {shortDate(t.dueDate)}</span></td><td className="num"><Money c={-t.amount} /></td></tr>)}
                <tr><td>Less debt-service cushion <span className="muted small">{sd.cushionMonths} months of scheduled payments</span></td><td className="num"><Money c={-sd.cushion} /></td></tr>
                <tr><td><b>Safe distribution</b>{sd.raw < 0 && <span className="muted small"> (never below zero)</span>}</td><td className="num"><b><Money c={sd.safe} /></b></td></tr>
              </tbody>
            </table></div>
            <TieOut items={[
              { label: 'Cash − reserve − capex − tax − cushion = safe distribution', ok: Math.max(0, sd.cash - sd.reserveTarget - sd.capexTotal - sd.taxTotal - sd.cushion) === sd.safe },
              { label: 'Above the reserve = the Phase 12 deployable cash', ok: sd.aboveReserve === sd.reserve.deployable },
            ]} />
          </Panel>
          <Panel id="ow-h" title="Month ends">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Date</th><th scope="col" className="num">Above the reserve</th><th scope="col" className="num">Safe distribution</th></tr></thead>
              <tbody>{hist.map((h) => <tr key={h.date}><td>{shortDate(h.date)}{h.date === today && <span className="pill"> Today</span>}</td><td className="num"><Money c={h.aboveReserve} /></td><td className="num"><Money c={h.safe} /></td></tr>)}</tbody>
            </table></div>
            {can(user, 'growth.distribute') && <div className="panel-pad">
              <h3 style={{ margin: '0 0 8px' }}>Record a distribution</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="ds-o">Owner</label><select id="ds-o" value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}>{ownerList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <Field id="ds-d" label="Date" num={false} value={f.date} onChange={(v) => setF({ ...f, date: v })} />
                <Field id="ds-a" label="Amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
                <div className="field"><label htmlFor="ds-k">Kind</label><select id="ds-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'regular' | 'tax' })}><option value="regular">Distribution</option><option value="tax">Tax distribution</option></select></div>
                <Field id="ds-n" label="Note" num={false} value={f.note} onChange={(v) => setF({ ...f, note: v })} />
                {over && <Field id="ds-r" label="Reason to go above the safe amount" num={false} value={f.override} onChange={(v) => setF({ ...f, override: v })} />}
              </div>
              {over && <p className="note warn small">This is above the safe distribution of {usd(sd.safe)}. Give a reason to go ahead.</p>}
              <div className="actions" style={{ marginTop: 8 }}><button className="btn primary" onClick={() => {
                setErrors([]);
                try { const d = recordDistribution(books, user, { date: f.date, partyId: f.partyId, amount: amt, kind: f.kind, note: f.note.trim() || undefined, override: f.override.trim() || undefined }); setF({ ...f, amount: '', note: '', override: '' }); say(`Posted ${state.transactions.find((t) => t.id === d.txnId)?.ref}.`); } catch (e) { setErrors(errList(e)); }
              }}>Post distribution</button><span className="muted small">Posts Dr 3100 Owner draws / Cr Trustmark at Corporate.</span></div>
            </div>}
          </Panel>
        </div>
        <Panel id="ow-o" title="Distributions by owner" extra={`${year} to date and lifetime`}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Owner</th><th scope="col" className="num">Withdrawals YTD</th><th scope="col" className="num">Distributions YTD</th><th scope="col" className="num">Before the books</th><th scope="col" className="num">YTD</th><th scope="col" className="num">Lifetime</th></tr></thead>
            <tbody>{owners.rows.map((r) => <tr key={r.partyId}><td><Link to={`/intercompany/parties/${r.partyId}`}>{r.name}</Link></td><td className="num"><Money c={r.drawsYtd} /></td><td className="num"><Money c={r.distributionsYtd} /></td><td className="num"><Money c={r.priorYtd} /></td><td className="num"><b><Money c={r.ytd} /></b></td><td className="num"><Money c={r.lifetime} /></td></tr>)}</tbody>
          </table></div>
          <TieOut items={[
            { label: 'Books YTD ties to the owner draws in the ledger', ok: booksYtd === draws.rows.filter((r) => r.ownerId).reduce((a, r) => a + r.amount, 0), detail: <Money c={booksYtd} dollar /> },
            { label: tie.ok ? 'Every recorded distribution is posted to 3100 for its amount' : 'A recorded distribution does not match the ledger', ok: tie.ok, detail: <><Money c={tie.recorded} dollar /> recorded, <Money c={tie.ledger} dollar /> in 3100</> },
          ]} />
          {g.distributions.length > 0 && <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Owner</th><th scope="col">Kind</th><th scope="col" className="num">Amount</th><th scope="col">Entry</th><th scope="col">Note</th></tr></thead>
            <tbody>{[...g.distributions].sort((a, b) => b.date.localeCompare(a.date)).map((d) => { const t = state.transactions.find((x) => x.id === d.txnId); return <tr key={d.id}><td>{shortDate(d.date)}</td><td>{state.parties.find((p) => p.id === d.partyId)?.name}</td><td>{d.kind === 'tax' ? 'Tax distribution' : 'Distribution'}</td><td className="num"><Money c={d.amount} /></td><td>{t ? <Link to={`/books/transactions/${t.id}`}>{t.ref}</Link> : 'missing'}</td><td className="small">{d.override ? `Above the safe amount: ${d.override}` : d.note}</td></tr>; })}</tbody>
          </table></div>}
        </Panel>
        <div className="grid-2">
          <Panel id="ow-t" title="Tax distributions" extra="Projected taxable income × owner rate (Phase 11)">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Return</th><th scope="col">Owner</th><th scope="col" className="num">Tax distribution</th><th scope="col" className="num">Distributed</th><th scope="col" className="num">Still to make</th></tr></thead>
              <tbody>{cover.rows.map((r) => <tr key={r.entityId + r.partyId}><td>{state.entities.find((e) => e.id === r.entityId)?.code}</td><td>{r.name}</td><td className="num"><Money c={r.taxDistribution} /></td><td className="num"><Money c={r.paid} /></td><td className="num"><Money c={r.remaining} /></td></tr>)}</tbody>
            </table></div>
            <TieOut items={[{ label: cover.covered ? 'The safe amount covers the tax still to distribute' : 'The safe amount does not cover the tax still to distribute', ok: cover.covered, detail: <><Money c={sd.safe} dollar /> vs <Money c={cover.still} dollar /></> }]} />
          </Panel>
          <Panel id="ow-r" title="ROE and ROIC by store" extra={`Annualized, at ${shortDate(lastDayOfPeriod(lastCompleteMonth(today)))}`}>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Store</th><th scope="col" className="num">Net income a year</th><th scope="col" className="num">Equity</th><th scope="col" className="num">Loans</th><th scope="col" className="num">ROE</th><th scope="col" className="num">ROIC</th></tr></thead>
              <tbody>{rets.map((r) => <tr key={r.storeId}><td>{code(r.storeId)} <span className="muted small">{r.months} mo</span></td><td className="num"><Money c={r.annualNet} /></td><td className="num"><Money c={r.equity} /></td><td className="num"><Money c={r.debt} /></td><td className="num">{pc(r.roe)}</td><td className="num">{pc(r.roic)}</td></tr>)}</tbody>
            </table></div>
            <p className="panel-pad muted small" style={{ margin: 0 }}>ROE = annualized net income ÷ the store entity's equity. ROIC = annualized (net income + interest) ÷ (equity + loans on its books). Related-party mortgages are not on the stores' books (they pay rent). Stores without a complete month are left out.</p>
          </Panel>
        </div>
      </div>
      {toast}
      <Help k="growthOwners" />
    </>
  );
}

// ── Quarterly CFO review ─────────────────────────────────────────────────
export function QuarterlyReviewPage() {
  const { state, version, entries, today, ok, user } = useGrowth();
  const q = useMemo(() => quarterlyReview(state, today, { entries }), [state, today, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportX = useXlsxBook();
  if (!ok) return <NoAccess title="Quarterly CFO review" />;
  const b = q.budget;
  const top = [...b.rows].filter((r) => r.budget || r.actual).sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect)).slice(0, 8);
  const head = q.monitor.headline;
  return (
    <>
      <PageHead eyebrow="Growth" title="Quarterly CFO review" lede={`${quarterLabel(q.quarter)} to date (${periodLabel(q.from)}${q.from === q.to ? '' : ` – ${periodLabel(q.to)}`}): results against budget, the KPI trend, covenant headroom, refinance and paydown, the expansion scorecard, tax and what the owners can take. Print it for the owners or the bank.`}>
        {can(user, 'export') && <button className="btn" onClick={() => exportX(`quarterly-review-${q.quarter}`, reviewWorkbook(state, q))}>Export Excel</button>}
        <button className="btn" onClick={() => window.print()}>Print owner / bank pack</button>
      </PageHead>
      <section className="figures" aria-label="Quarter" style={{ marginBottom: 20 }}>
        <Figure label="Net income vs budget" value={<Money c={b.actual.netIncome.total} whole dollar />} note={b.available ? `Budget ${usd(b.budget.netIncome.total)}` : 'No budget for these months'} href="/budgets/bva" />
        <Figure label="DSCR" value={ratioX(head?.dscr)} note={head ? `${periodLabel(head.period)}${head.annualized ? ', annualized' : ''}` : ''} href="/debt/covenants" />
        <Figure label="Expansion scorecard" value={<RagPill s={q.scorecard.overall} />} note={`${q.scorecard.checks.filter((c) => c.status === 'green').length} of ${q.scorecard.checks.length} green`} href="/growth/readiness" />
        <Figure label="Safe distribution" value={<Money c={q.safe.safe} whole dollar />} note={`Tax still to distribute ${usd(q.tax.still)}`} href="/growth/owners" />
        <Figure label="Equity value" value={<Money c={q.valuation.equityMid} whole dollar />} href="/growth/valuation" />
      </section>
      <div className="stack">
        <div className="grid-2">
          <Panel id="qr-b" title="Results vs budget" extra="Largest variances by profit effect">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Line</th><th scope="col" className="num">Actual</th><th scope="col" className="num">Budget</th><th scope="col" className="num">Effect</th></tr></thead>
              <tbody>{top.map((r) => <tr key={r.account.id}><td>{r.account.number} {r.account.name}</td><td className="num"><Money c={r.actual} /></td><td className="num"><Money c={r.budget} /></td><td className="num"><Money c={r.effect} signed /></td></tr>)}
                <tr><td><b>Net income</b></td><td className="num"><b><Money c={b.actual.netIncome.total} /></b></td><td className="num"><b><Money c={b.budget.netIncome.total} /></b></td><td className="num"><b><Money c={b.actual.netIncome.total - b.budget.netIncome.total} signed /></b></td></tr></tbody>
            </table></div>
            <TieOut items={[{ label: 'Actual ties to the P&L', ok: b.actualTiesToPnl }, { label: 'Budget ties to its cells', ok: b.budgetTiesToCells }]} />
          </Panel>
          <Panel id="qr-k" title="KPI trend" extra="Booked basis, company">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Month</th><th scope="col" className="num">Sales</th><th scope="col" className="num">GM %</th><th scope="col" className="num">Labor %</th><th scope="col" className="num">Net income</th></tr></thead>
              <tbody>{q.kpis.map((k) => <tr key={k.period}><td>{periodLabel(k.period)}{k.provisional && <span className="muted small"> to date</span>}</td><td className="num"><Money c={k.sales} /></td><td className="num">{pc(k.gmPct)}</td><td className="num">{pc(k.laborPct)}</td><td className="num"><Money c={k.net} /></td></tr>)}</tbody>
            </table></div>
          </Panel>
        </div>
        <div className="grid-2">
          <Panel id="qr-c" title="Covenant headroom">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Loan · covenant</th><th scope="col" className="num">Actual</th><th scope="col" className="num">Headroom</th><th scope="col">Status</th></tr></thead>
              <tbody>{q.monitor.tests.map((t) => <tr key={t.covenant.id}><td>{t.loan?.name} <div className="muted small">{t.covenant.kind.replace('_', ' ')}{t.forecast.date ? ` · forecast breach ${shortDate(t.forecast.date)}` : ''}</div></td><td className="num">{t.actual === null ? '–' : t.covenant.kind === 'min_liquidity' ? usd(t.actual) : ratioX(t.actual)}</td><td className="num">{t.headroomPct === null ? '–' : `${t.headroomPct.toFixed(0)}%`}</td><td><span className={'pill ' + (t.status === 'ok' ? 'ok' : t.status === 'near' ? 'warn' : t.status === 'breach' ? 'bad' : '')}>{t.status === 'ok' ? 'Holds' : t.status === 'near' ? 'Near' : t.status === 'breach' ? 'Breach' : 'No data'}</span></td></tr>)}</tbody>
            </table></div>
          </Panel>
          <Panel id="qr-r" title="Refinance and paydown">
            <div className="panel-pad">
              <p style={{ marginTop: 0 }}><b>Refinance triggers:</b> {q.triggers.length ? q.triggers.map((t) => `${t.loanName}: ${t.title}`).join('; ') : 'none.'} <Link to="/debt/refinance">Analyze</Link></p>
              <p><b>Paydown / deploy:</b> {q.paydown.allocations.length ? q.paydown.allocations.map((a) => `${a.use.label} ${usd(a.amount)}`).join('; ') : q.paydown.reserveMet ? 'nothing to deploy.' : 'rebuild the reserve first.'} <Link to="/debt/paydown">Paydown vs invest</Link></p>
              <p style={{ marginBottom: 0 }}><b>Tax estimates due:</b> {q.estimates.length ? q.estimates.map((e) => `${e.payer} ${e.jurisdiction} Q${e.quarter} ${usd(e.amount)} by ${shortDate(e.dueDate)}`).join('; ') : 'none.'} <Link to="/tax/estimates">Estimates</Link></p>
            </div>
          </Panel>
        </div>
        <Panel id="qr-s" title="Expansion scorecard and distribution capacity">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">Value</th></tr></thead>
            <tbody>{q.scorecard.checks.map((c) => <tr key={c.key}><td>{c.label}</td><td><RagPill s={c.status} /></td><td>{c.value}</td></tr>)}</tbody>
          </table></div>
          <div className="panel-pad"><dl className="kv">
            <dt>Cash above the reserve</dt><dd><Money c={q.safe.aboveReserve} dollar /></dd>
            <dt>Less capex, tax due and cushion</dt><dd><Money c={-(q.safe.capexTotal + q.safe.taxTotal + q.safe.cushion)} dollar /></dd>
            <dt>Safe distribution</dt><dd><b><Money c={q.safe.safe} dollar /></b></dd>
            <dt>Tax distributions still to make</dt><dd><Money c={q.tax.still} dollar /></dd>
          </dl></div>
          <TieOut items={[
            { label: 'Safe distribution components add up', ok: Math.max(0, q.safe.aboveReserve - q.safe.capexTotal - q.safe.taxTotal - q.safe.cushion) === q.safe.safe },
            { label: 'Months in the KPI trend run from the first month on the books', ok: q.kpis.length === periodsBetween(firstBooksPeriod(state) ?? q.from, today.slice(0, 7)).length },
          ]} />
        </Panel>
      </div>
      <Help k="growthReview" />
    </>
  );
}

// ── Evaluate a deal ──────────────────────────────────────────────────────
export function EvaluateDealPage() {
  const { state, version, entries, today, g, ok } = useGrowth();
  const options = [...g.proFormas.map((p) => ({ v: `pf:${p.id}`, label: `${p.name} (${p.mode})` })), ...g.acquisitions.map((a) => ({ v: `acq:${a.id}`, label: `${a.name} (acquisition)` }))];
  const [deal, setDeal] = useParam('deal', options[0]?.v ?? '');
  const ref: DealRef | null = deal.startsWith('pf:') ? { kind: 'proforma', id: deal.slice(3) } : deal.startsWith('acq:') ? { kind: 'acquisition', id: deal.slice(4) } : null;
  const [fin, setFin] = useState<Record<string, { loan: string; rate: string; term: string; amort: string }>>({});
  const base = useMemo(() => (ref ? evaluateDeal(state, today, ref, { entries }) : null), [state, today, deal, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = base ? fin[deal] ?? { loan: dollars(base.pf.financing.loanAmount), rate: String(base.pf.financing.rateBps / 100), term: String(base.pf.financing.termMonths), amort: String(base.pf.financing.amortizationMonths) } : null;
  const override: Financing | undefined = f && base ? { loanAmount: moneyIn(f.loan), rateBps: Math.round(numIn(f.rate) * 100), termMonths: numIn(f.term), amortizationMonths: numIn(f.amort) } : undefined;
  const okFin = !!override && Object.values(override).every((x) => Number.isFinite(x) && x >= 0) && override.amortizationMonths >= 1;
  const e = useMemo(() => (ref && okFin ? evaluateDeal(state, today, ref, { financing: override, entries }) : base), [state, today, deal, f?.loan, f?.rate, f?.term, f?.amort, entries, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <NoAccess title="Evaluate a deal" />;
  const setF = (patch: Partial<NonNullable<typeof f>>) => setFin({ ...fin, [deal]: { ...f!, ...patch } });
  const header = ['Test', 'Pass', 'Critical', 'Detail'];
  const rows = e ? e.checks.map((c) => [c.label, c.pass ? 'yes' : 'no', c.critical ? 'yes' : 'no', c.detail]) : [];
  return (
    <>
      <PageHead eyebrow="Growth" title="Evaluate a deal" lede="Pick a prospect's pro forma or an acquisition, adjust the financing, and see what it does to company DSCR, leverage and cash, with a go / no-go and the reasons.">
        <div className="field" style={{ minWidth: 240 }}><label htmlFor="ev-d" className="sr-only">Deal</label><select id="ev-d" value={deal} onChange={(x) => setDeal(x.target.value)}>{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <ExportButtons name="deal-evaluation" header={header} rows={rows} sheet="Deal" />
      </PageHead>
      {!e ? <p className="muted">Nothing to evaluate yet: add a pro forma or an acquisition.</p> : <>
        <section className="figures" aria-label="Deal figures" style={{ marginBottom: 20 }}>
          <Figure label="Decision" value={<span className={'pill ' + (e.decision === 'go' ? 'ok' : e.decision === 'conditional' ? 'warn' : 'bad')}>{DECISION_LABEL[e.decision]}</span>} note={`${e.checks.filter((c) => c.pass).length} of ${e.checks.length} tests pass`} />
          <Figure label="Levered IRR" value={pc(e.r.leveredIrr)} note={`NPV ${usd(e.r.leveredNpv)}`} />
          <Figure label="Company DSCR" value={ratioX(e.after.dscr)} note={`From ${ratioX(e.before.dscr)}`} />
          <Figure label="Leverage" value={ratioX(e.after.leverage)} note={`From ${ratioX(e.before.leverage)}`} />
          <Figure label="Cash above the reserve after" value={<Money c={e.after.cashAfter} whole dollar />} note={`Equity ${usd(e.r.equity + e.r.preOpeningDebtService)}`} />
        </section>
        <div className={'note' + (e.decision === 'go' ? '' : ' warn')} role="status" style={{ marginBottom: 16 }}><b>{DECISION_LABEL[e.decision]}.</b> <ul>{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="stack">
          <div className="grid-2">
            <Panel id="ev-f" title="Financing">
              <div className="panel-pad">
                <div className="form-grid">
                  <Field id="ev-l" label="Loan amount" value={f!.loan} onChange={(v) => setF({ loan: v })} />
                  <Field id="ev-r" label="Rate %" value={f!.rate} onChange={(v) => setF({ rate: v })} />
                  <Field id="ev-t" label="Term (months)" value={f!.term} onChange={(v) => setF({ term: v })} />
                  <Field id="ev-a" label="Amortization (months)" value={f!.amort} onChange={(v) => setF({ amort: v })} />
                </div>
                {!okFin && <p className="note warn small">Enter the financing as numbers to recalculate.</p>}
                <p className="muted small">Changes here are a what-if; save them on the <Link to={e.ref.kind === 'proforma' ? `/growth/pro-forma?id=${e.ref.id}` : `/growth/acquisitions?id=${e.ref.id}`}>{e.ref.kind === 'proforma' ? 'pro forma' : 'acquisition'}</Link>.</p>
              </div>
            </Panel>
            <Panel id="ev-i" title="Impact on the company" extra="Year-1 debt service and EBITDA added to today's annualized figures">
              <div className="table-wrap"><table className="t">
                <thead><tr><th scope="col">Measure</th><th scope="col" className="num">Today</th><th scope="col" className="num">With the deal</th></tr></thead>
                <tbody>
                  <tr><td>EBITDA a year</td><td className="num"><Money c={e.before.ebitda} /></td><td className="num"><Money c={e.after.ebitda} /></td></tr>
                  <tr><td>Debt service a year</td><td className="num"><Money c={e.before.debtService} /></td><td className="num"><Money c={e.after.debtService} /></td></tr>
                  <tr><td>DSCR</td><td className="num">{ratioX(e.before.dscr)}</td><td className="num">{ratioX(e.after.dscr)}</td></tr>
                  <tr><td>Debt</td><td className="num"><Money c={e.before.debt} /></td><td className="num"><Money c={e.after.debt} /></td></tr>
                  <tr><td>Leverage (debt ÷ EBITDA)</td><td className="num">{ratioX(e.before.leverage)}</td><td className="num">{ratioX(e.after.leverage)}</td></tr>
                  <tr><td>Cash above the reserve</td><td className="num"><Money c={e.before.deployable} /></td><td className="num"><Money c={e.after.cashAfter} /></td></tr>
                </tbody>
              </table></div>
              <TieOut items={[
                { label: 'DSCR after = (EBITDA + deal year 1) ÷ (debt service + deal year 1)', ok: e.after.dscr === null || Math.abs(e.after.dscr - e.after.ebitda / e.after.debtService) < 1e-9 },
                { label: 'Cash after = deployable − equity − debt service before opening', ok: e.after.cashAfter === e.before.deployable - e.r.equity - e.r.preOpeningDebtService },
              ]} />
            </Panel>
          </div>
          <Panel id="ev-c" title="Tests" extra="A failed critical test is a no-go; a failed other test makes it conditional">
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Test</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
              <tbody>{e.checks.map((c) => <tr key={c.label}><td>{c.label}{c.critical && <span className="muted small"> · critical</span>}</td><td><span className={'pill ' + (c.pass ? 'ok' : c.critical ? 'bad' : 'warn')}>{c.pass ? 'Pass' : 'Fail'}</span></td><td className="small">{c.detail}</td></tr>)}</tbody>
            </table></div>
          </Panel>
          <div className="grid-2">
            <Panel id="ev-p" title="Pro forma summary">
              <div className="table-wrap"><table className="t">
                <thead><tr><th scope="col">Year</th><th scope="col" className="num">EBITDA</th><th scope="col" className="num">Debt service</th><th scope="col" className="num">Cash after debt</th><th scope="col" className="num">DSCR</th></tr></thead>
                <tbody>{e.r.years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num"><Money c={y.ebitda} /></td><td className="num"><Money c={y.debtService} /></td><td className="num"><Money c={y.cashAfterDebt} /></td><td className="num">{ratioX(y.dscr)}</td></tr>)}</tbody>
              </table></div>
            </Panel>
            <Panel id="ev-v" title={e.acquisition ? 'Valuation' : 'Site'}>
              <div className="panel-pad">
                {e.acquisition ? <dl className="kv">
                  <dt>Normalized EBITDA</dt><dd><Money c={e.acquisition.normalizedEbitda} dollar /></dd>
                  <dt>Valuation range</dt><dd><Money c={e.acquisition.valuation.low} dollar /> – <Money c={e.acquisition.valuation.high} dollar /></dd>
                  <dt>Offer</dt><dd><Money c={e.acquisition.acq.offerPrice} dollar /></dd>
                  <dt>Due diligence</dt><dd>{e.acquisition.dd.done} of {e.acquisition.dd.total} done</dd>
                </dl> : e.site ? <dl className="kv">
                  <dt>Site</dt><dd>{e.site.site.name}</dd>
                  <dt>Score</dt><dd>{e.site.score.toFixed(1)} ({e.site.rating})</dd>
                  <dt>Traffic</dt><dd>{gal(e.site.site.aadt)} a day</dd>
                </dl> : <p className="muted" style={{ margin: 0 }}>No site linked to this pro forma.</p>}
              </div>
            </Panel>
          </div>
        </div>
      </>}
      <Help k="growthEvaluate" />
    </>
  );
}
