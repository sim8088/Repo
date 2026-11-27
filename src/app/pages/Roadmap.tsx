import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui';

const PHASES: { n: number; name: string; status: 'built' | 'next' | 'planned'; items: string }[] = [
  { n: 1, name: 'Foundation', status: 'built', items: 'Entities, stores, chart of accounts, double-entry ledger with automatic intercompany, transactions with splits and attachments, rules engine, duplicate detection, period lock, audit log, roles, ⌘K, the Ledger design system.' },
  { n: 2, name: 'Bank & cash', status: 'built', items: 'Bank import (CSV/OFX/QFX; PDF statements later) and reconciliation, checks register, cash chain store → HQ → bank, deposit classification, cash position and 13-week forecast.' },
  { n: 3, name: 'Fuel', status: 'next', items: 'Invoices and BOLs, Craddock notice import and netting, Dash clearing, truck lane (Comdata, Mudflap, Fiserv), gallons and margin, tank variance.' },
  { n: 4, name: 'Reports', status: 'planned', items: 'P&L on cash and accrual with the bridge, balance sheet, cash flow, command center, store scorecards, PDF and Excel exports.' },
  { n: 5, name: 'Intercompany & payables', status: 'planned', items: 'Party ledgers and statements, bills inbox, AP aging, utilities tracker, payment calendar.' },
  { n: 6, name: 'People', status: 'planned', items: 'Gusto import, cash payroll, week-over-week review, labor %, payroll tax tracker.' },
  { n: 7, name: 'Inside & kitchen', status: 'planned', items: 'POS import, department margin, purchasing budgets, inventory counts, food cost and waste.' },
  { n: 8, name: 'Budgets & close', status: 'planned', items: 'Budgets, forecasts and scenarios; month-end checklist, period lock gate, close binder.' },
  { n: 9, name: 'Compliance, assets & ask', status: 'planned', items: 'Tax calendar, licenses, document vault, fixed assets and loans, natural-language questions with proof.' },
  { n: 10, name: 'GL & QuickBooks', status: 'planned', items: 'Journal entry suite with approvals and reversals, account reconciliations, consolidation with eliminations, two-way QBO sync.' },
  { n: 11, name: 'Tax', status: 'planned', items: 'Entity map, return tracker, sales tax tie-out, book-to-tax, book vs tax depreciation, estimates, K-1/basis, CPA package.' },
  { n: 12, name: 'Debt & treasury', status: 'planned', items: 'Debt dashboard, covenant monitor, refinance analyzer, paydown vs invest, reserve policy.' },
  { n: 13, name: 'Growth & owners', status: 'planned', items: 'Expansion scorecard, site scorecard, new-store pro forma, buy/build/lease, acquisition model, valuation, distributions.' },
  { n: 14, name: 'Controls & risk', status: 'planned', items: 'Approval limits, segregation of duties, fraud signals, insurance and UST registers.' },
];

export function Roadmap() {
  return (
    <>
      <PageHead eyebrow="Build status" title="Roadmap" lede="The portal ships in fourteen phases. Each one is usable on its own and builds on the ledger underneath." />
      <section className="panel">
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col" className="num">Phase</th><th scope="col">Module</th><th scope="col">Status</th><th scope="col">What it adds</th></tr></thead>
          <tbody>{PHASES.map((p) => (
            <tr key={p.n}><td className="num">{p.n}</td><td><b>{p.name}</b></td><td><span className={'pill ' + (p.status === 'built' ? 'ok' : p.status === 'next' ? 'warn' : '')}>{p.status === 'built' ? 'Built' : p.status === 'next' ? 'Next' : 'Planned'}</span></td><td>{p.items}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>Phase 1 screens: <Link to="/">My day</Link>, <Link to="/books/transactions">Transactions</Link>, <Link to="/reports/trial-balance">Trial balance</Link>, <Link to="/reports/pnl">Profit &amp; loss by store</Link>, <Link to="/close/periods">Periods</Link>, <Link to="/setup/stores">Setup</Link>. Phase 2: <Link to="/bank">Bank feed &amp; reconciliation</Link>, <Link to="/bank/checks">Checks</Link>, <Link to="/bank/deposits">Deposits</Link>, <Link to="/cash">Cash chain</Link>, <Link to="/cash/forecast">13-week forecast</Link>.</p>
    </>
  );
}
