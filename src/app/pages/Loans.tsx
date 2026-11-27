import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import { DocList, AttachButton } from '../components/docs';
import { LOAN_KIND_LABEL, loanAccountTie, loanStatus, loansOf, passThroughCover, postLoanPayment, ratePct, recordDraw, type LoanStatus } from '../../core/loans';
import { attachToAsset } from '../../core/assets';
import { daysBetween, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import type { ID } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);

function NoAccess({ title }: { title: string }) {
  return <PageHead eyebrow="Assets & debt" title={title} lede="Your role doesn't include fixed assets, prepaids or debt." />;
}

export function LoansPage() {
  const { state, books, user, visible, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const today = todayInChicago();
  const all = useMemo(() => loansOf(state).filter((l) => visible.has(l.storeId)).map((l) => loanStatus(state, l, today)), [state, visible, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tie = useMemo(() => loanAccountTie(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(user, 'view.reports')) return <NoAccess title="Loans" />;
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const ours = all.filter((s) => s.loan.heldBy === 'company');
  const theirs = all.filter((s) => s.loan.heldBy === 'related_party');
  const debt = ours.reduce((a, s) => a + s.scheduleBalance, 0);
  const yr = today.slice(0, 4);
  const interestYtd = state.transactions.filter((t) => !t.deleted && t.date.startsWith(yr) && t.date <= today).reduce((a, t) => a + t.lines.filter((l) => l.accountId === 'acct_interest').reduce((x, l) => x + l.debit - l.credit, 0), 0);
  const nexts = ours.map((s) => s.next).filter(Boolean).sort((a, b) => a!.date.localeCompare(b!.date));
  const nextPay = ours.filter((s) => s.next && s.next.date === nexts[0]?.date);
  const unposted = ours.flatMap((s) => s.unposted.map((r) => ({ s, r })));
  const accounts = tie.filter((t) => t.loans || t.ledger);
  const name = (id?: ID) => state.parties.find((p) => p.id === id)?.name ?? '';
  const row = (s: LoanStatus) => (
    <tr key={s.loan.id}><td><Link to={`/assets/loans/${s.loan.id}`}>{s.loan.name}</Link><div className="muted small">{LOAN_KIND_LABEL[s.loan.kind]} · {s.loan.lender}{s.loan.heldBy === 'related_party' ? ` · carried by ${name(s.loan.holderPartyId)}` : ''}</div></td>
      <td>{code(s.loan.storeId)}</td><td>{ratePct(s.loan.rateBps)} {s.loan.rateType === 'variable' ? <span className="muted small">{s.loan.index} + {ratePct(s.loan.marginBps ?? 0)}</span> : <span className="muted small">fixed</span>}</td>
      <td className="num">{s.loan.interestOnly ? <span className="muted small">Interest only</span> : <Money c={s.loan.payment} />}</td><td className="num"><Money c={s.scheduleBalance} /></td>
      <td>{s.next ? <>{shortDate(s.next.date)} <span className="muted small"><Money c={s.next.payment} dollar /></span></> : '—'}</td><td>{shortDate(s.loan.maturity)}{s.rows.some((r) => r.balloon) && <div className="muted small">Balloon</div>}</td></tr>
  );
  const head = <thead><tr><th scope="col">Loan</th><th scope="col">Store</th><th scope="col">Rate</th><th scope="col" className="num">Payment</th><th scope="col" className="num">Balance</th><th scope="col">Next due</th><th scope="col">Maturity</th></tr></thead>;
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Loans" lede="Every loan and mortgage with its terms, amortization and payoff date. Company loans post their payments (principal vs interest) through the ledger; store mortgages carried by related parties are shown for information, since we only book the rent that reimburses them.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('loans', ['Loan', 'Kind', 'Lender', 'Held by', 'Store', 'Original', 'Rate %', 'Rate type', 'Payment', 'Balance', 'Next due', 'Maturity', 'Payoff', 'Collateral', 'Guarantor', 'Prepayment penalty', 'Covenants'], all.map((s) => [s.loan.name, LOAN_KIND_LABEL[s.loan.kind], s.loan.lender, s.loan.heldBy === 'company' ? 'Company' : name(s.loan.holderPartyId), code(s.loan.storeId), csvMoney(s.loan.original), (s.loan.rateBps / 100).toFixed(2), s.loan.rateType, csvMoney(s.loan.payment), csvMoney(s.scheduleBalance), s.next?.date ?? '', s.loan.maturity, s.payoffDate, s.loan.collateral, s.loan.guarantor, s.loan.prepaymentPenalty, s.loan.covenants.join(' | ')]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Debt" style={{ marginBottom: 20 }}>
        <Figure label="Company debt on the books" value={<Money c={debt} whole dollar />} note={`${ours.length} loans`} />
        <Figure label={`Interest expense ${yr} (6500)`} value={<Money c={interestYtd} whole dollar />} note="Booked in these books" />
        <Figure label="Next payment" value={nexts[0] ? shortDate(nexts[0].date) : '—'} note={nextPay.map((s) => `${s.loan.name} ${formatMoney(s.next!.payment, { dollarSign: true })}`).join(", ") || "Nothing scheduled"} />
        <Figure label="Related-party mortgages (info)" value={<Money c={theirs.reduce((a, s) => a + s.scheduleBalance, 0)} whole dollar />} note={`${theirs.length} carried by Dhunna / SKD`} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        {unposted.length > 0 && can(user, 'assets.edit') && (
          <section className="panel" aria-labelledby="lu-h">
            <div className="panel-head"><h2 id="lu-h">Payments to post</h2></div>
            <ul className="cards">{unposted.map(({ s, r }) => (
              <li key={s.loan.id + r.date} className="panel-pad"><b>{s.loan.name}</b> due {shortDate(r.date)}: <Money c={r.payment} dollar /> (principal <Money c={r.principal} dollar />, interest <Money c={r.interest} dollar />){' '}
                <button className="btn sm primary" onClick={() => { setErrors([]); try { const t = postLoanPayment(books, user, s.loan.id, r.date); say(`Posted ${t.ref}.`); } catch (e) { setErrors(errList(e)); } }}>Post payment</button></li>
            ))}</ul>
          </section>
        )}
        <section className="panel" aria-labelledby="lo-h">
          <div className="panel-head"><h2 id="lo-h">On our books</h2></div>
          <div className="table-wrap"><table className="t">{head}<tbody>{ours.map(row)}</tbody></table></div>
          <TieOut items={accounts.map((t) => {
            const a = state.accounts.find((x) => x.id === t.accountId)!;
            return { label: t.loans === t.ledger ? `${a.number} ${a.name} ties to its loans` : `${a.number} ${a.name} is off from its loans`, ok: t.loans === t.ledger, detail: <><Money c={t.ledger} dollar /> in the ledger{t.loans !== t.ledger ? <> vs <Money c={t.loans} dollar /> by the schedules</> : ''}</> };
          })} />
        </section>
        <section className="panel" aria-labelledby="lr-h">
          <div className="panel-head"><h2 id="lr-h">Carried by related parties (information only)</h2></div>
          <div className="table-wrap"><table className="t">{head}<tbody>{theirs.map(row)}</tbody></table></div>
          <TieOut items={[
            { label: (tie.find((t) => t.accountId === 'acct_mortgages')?.ledger ?? 0) === 0 ? '2300 Notes payable – mortgages holds nothing: these mortgages are not double-booked' : '2300 has a balance: check that a related-party mortgage was not booked as ours', ok: (tie.find((t) => t.accountId === 'acct_mortgages')?.ledger ?? 0) === 0 },
            ...theirs.map((s) => { const c = passThroughCover(state, s.loan, today)!; return { label: c.covered ? `${s.loan.name}: the rent pass-through covers the payment` : `${s.loan.name}: the rent pass-through is short of the payment`, ok: c.covered, detail: <>rent <Money c={c.rent} dollar /> vs payment <Money c={c.payment} dollar /></> }; }),
          ]} />
        </section>
      </div>
      {toast}
      <Help k="loans" />
    </>
  );
}

export function LoanDetailPage() {
  const { id } = useParams();
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const [errors, setErrors] = useState<string[]>([]);
  const today = todayInChicago();
  const loan = loansOf(state).find((l) => l.id === id);
  const st = useMemo(() => (loan ? loanStatus(state, loan, today) : null), [state, loan, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draw, setDraw] = useState({ date: today, amount: '' });
  if (!can(user, 'view.reports')) return <NoAccess title="Loan" />;
  if (!loan || !st) return <PageHead eyebrow="Assets & debt" title="Loan not found" lede={<Link to="/assets/loans">Back to loans</Link>} />;
  const code = state.stores.find((s) => s.id === loan.storeId)?.code ?? '';
  const ref = (txnId?: ID) => state.transactions.find((t) => t.id === txnId)?.ref;
  const principal = st.rows.reduce((a, r) => a + r.principal, 0);
  const sumPay = st.rows.reduce((a, r) => a + r.payment, 0);
  const holder = state.parties.find((p) => p.id === loan.holderPartyId)?.name;
  const cover = passThroughCover(state, loan, today);
  const edit = can(user, 'assets.edit') && loan.heldBy === 'company';
  const balloon = st.rows.find((r) => r.balloon);
  return (
    <>
      <PageHead eyebrow="Assets & debt · Loans" title={loan.name} lede={`${LOAN_KIND_LABEL[loan.kind]} from ${loan.lender}${holder ? `, carried by ${holder} and reimbursed through rent` : ''}.`}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`amortization-${loan.id}`, ['#', 'Due', 'Opening', 'Payment', 'Interest', 'Principal', 'Closing', 'Posted'], st.rows.map((r) => [r.n, r.date, csvMoney(r.opening), csvMoney(r.payment), csvMoney(r.interest), csvMoney(r.principal), csvMoney(r.closing), r.before ? 'opening balance' : ref(r.txnId) ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Loan" style={{ marginBottom: 20 }}>
        <Figure label="Balance" value={<Money c={st.scheduleBalance} whole dollar />} note={st.ledgerBalance !== null ? `Ledger ${st.ties ? 'agrees' : 'differs'}` : 'Not on our books'} />
        <Figure label="Next payment" value={st.next ? <Money c={st.next.payment} dollar /> : '—'} note={st.next ? `${shortDate(st.next.date)}: principal ${(st.next.principal / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}, interest ${(st.next.interest / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}` : ''} />
        <Figure label="Payoff date" value={shortDate(st.payoffDate)} note={balloon ? `Balloon of ${(balloon.payment / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}` : `${Math.round(daysBetween(today, st.payoffDate) / 30.4)} months`} />
        <Figure label="Interest over the life" value={<Money c={st.totalInterest} whole dollar />} note={`${st.rows.length} payments`} />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel panel-pad" aria-labelledby="lt-h">
          <h2 id="lt-h" style={{ marginBottom: 8 }}>Terms</h2>
          <dl className="kv">
            <dt>Lender</dt><dd>{loan.lenderPartyId ? <Link to={`/intercompany/parties/${loan.lenderPartyId}`}>{loan.lender}</Link> : loan.lender}</dd>
            <dt>Held by</dt><dd>{loan.heldBy === 'company' ? `Us (${code})` : `${holder} (related party), for ${code}`}</dd>
            <dt>{loan.interestOnly ? 'Credit limit' : 'Original amount'}</dt><dd><Money c={loan.creditLimit ?? loan.original} dollar /></dd>
            <dt>Rate</dt><dd>{ratePct(loan.rateBps)} {loan.rateType === 'variable' ? `variable (${loan.index} + ${ratePct(loan.marginBps ?? 0)})` : 'fixed'}</dd>
            <dt>Term / amortization</dt><dd>{loan.termMonths} months{loan.interestOnly ? ', interest only' : ` / ${loan.amortizationMonths} months`}</dd>
            <dt>Payment</dt><dd>{loan.interestOnly ? 'Interest only, monthly (actual/365 on the daily balance)' : <><Money c={loan.payment} dollar /> a month (30/360)</>}</dd>
            <dt>Start · first payment · maturity</dt><dd>{shortDate(loan.start)} · {shortDate(loan.firstPayment)} · {shortDate(loan.maturity)}</dd>
            <dt>Collateral</dt><dd>{loan.collateral || '—'}</dd>
            <dt>Guarantor</dt><dd>{loan.guarantor || '—'}</dd>
            <dt>Prepayment penalty</dt><dd>{loan.prepaymentPenalty}</dd>
            <dt>Covenants</dt><dd>{loan.covenants.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{loan.covenants.map((c) => <li key={c}>{c}</li>)}</ul> : 'None'}<div className="muted small"><Link to="/debt/covenants">Covenant monitor</Link></div></dd>
            {loan.notes && <><dt>Notes</dt><dd>{loan.notes}</dd></>}
            <dt>Documents</dt><dd><DocList items={loan.attachments} say={say} />{can(user, 'assets.edit') && <AttachButton books={books} userId={user.id} label="Attach" say={say} onFile={(a) => { attachToAsset(books, user, { kind: 'loan', id: loan.id }, a); say(`Attached ${a.name}.`); }} />}</dd>
          </dl>
        </section>
        {loan.interestOnly && edit && (
          <section className="panel panel-pad" aria-labelledby="ld-h">
            <h2 id="ld-h" style={{ marginBottom: 8 }}>Draw or pay down</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="ld-d">Date</label><input id="ld-d" type="date" value={draw.date} onChange={(e) => setDraw({ ...draw, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="ld-a">Amount</label><input id="ld-a" className="num" inputMode="decimal" value={draw.amount} onChange={(e) => setDraw({ ...draw, amount: e.target.value })} /><span className="hint">Positive draws, negative (or in parentheses) pays down</span></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setErrors([]); try { const t = recordDraw(books, user, loan.id, { date: draw.date, amount: parseMoney(draw.amount) ?? NaN }); setDraw({ ...draw, amount: '' }); say(`Posted ${t.ref}.`); } catch (e) { setErrors(errList(e)); } }}>Post</button></div>
          </section>
        )}
        <section className="panel" aria-labelledby="la-h">
          <div className="panel-head"><h2 id="la-h">Amortization table</h2><span className="muted small">{loan.interestOnly ? 'Future interest assumes today\'s balance' : 'Principal vs interest each month'}</span></div>
          <div className="table-wrap" data-static="1" tabIndex={0} role="region" aria-label="Amortization table, scrolls" style={{ maxHeight: 520, overflowY: 'auto' }}><table className="t">
            <thead><tr><th scope="col" className="num">#</th><th scope="col">Due</th><th scope="col" className="num">Opening</th><th scope="col" className="num">Payment</th><th scope="col" className="num">Interest</th><th scope="col" className="num">Principal</th><th scope="col" className="num">Closing</th><th scope="col">Posted</th></tr></thead>
            <tbody>{st.rows.map((r) => (
              <tr key={r.n}><td className="num">{r.n}</td><td>{shortDate(r.date)}{r.balloon && <span className="pill warn"> Balloon</span>}</td><td className="num"><Money c={r.opening} /></td><td className="num"><Money c={r.payment} /></td><td className="num"><Money c={r.interest} /></td><td className="num"><Money c={r.principal} /></td><td className="num"><Money c={r.closing} /></td>
                <td>{loan.heldBy !== 'company' ? <span className="muted small">Not ours</span> : r.before ? <span className="muted small">Opening balance</span> : r.txnId ? <Link to={`/books/transactions/${r.txnId}`}>{ref(r.txnId)}</Link> : r.date <= today && r.payment > 0 ? (edit ? <button className="btn sm primary" onClick={() => { setErrors([]); try { const t = postLoanPayment(books, user, loan.id, r.date); say(`Posted ${t.ref}.`); } catch (e) { setErrors(errList(e)); } }}>Post</button> : <span className="pill warn">Not posted</span>) : <span className="muted small">Scheduled</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            ...(loan.interestOnly ? [] : [{ label: principal === loan.original ? 'Principal across the table repays the original amount' : 'Principal across the table does not add to the original amount', ok: principal === loan.original, detail: <>payments <Money c={sumPay} dollar /> = principal <Money c={principal} dollar /> + interest <Money c={st.totalInterest} dollar /></> }]),
            ...(st.ledgerBalance !== null ? [{ label: st.ties ? `Balance ties to ${state.accounts.find((a) => a.id === loan.liabilityAccountId)?.number} for ${loan.lender}` : 'Balance does not tie to the ledger: post the missing payments', ok: !!st.ties, detail: <><Money c={st.ledgerBalance} dollar /> in the ledger</> }] : []),
            ...(cover ? [{ label: cover.covered ? 'The rent pass-through covers the payment' : 'The rent pass-through is short of the payment', ok: cover.covered, detail: <>rent <Money c={cover.rent} dollar /> a month vs <Money c={cover.payment} dollar /></> }] : []),
          ]} />
        </section>
      </div>
      {toast}
      <Help k="loanDetail" />
    </>
  );
}
