import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { BooksProvider } from './app/store';
import { Shell } from './app/components/Shell';
import { Today } from './app/pages/Today';
import { Transactions } from './app/pages/Transactions';
import { TransactionForm } from './app/pages/TransactionForm';
import { TransactionDetail } from './app/pages/TransactionDetail';
import { Accounts, AccountDetailPage } from './app/pages/Accounts';
import { PnlPage, TrialBalancePage } from './app/pages/Reports';
import { Periods } from './app/pages/Periods';
import { AuditPage, EntitiesPage, PartiesPage, RulesPage, SettingsPage, StoresPage, UsersPage } from './app/pages/Setup';
import { Roadmap } from './app/pages/Roadmap';
import { BankPage, ChecksPage, DepositsPage } from './app/pages/Bank';
import { CashPage } from './app/pages/Cash';
import { ForecastPage } from './app/pages/Forecast';
import { FuelMarginPage, PricingPage, TanksPage } from './app/pages/Fuel';
import { FuelInvoicesPage, SettlementPage, TruckLanePage } from './app/pages/FuelSettlement';
import { PageHead } from './app/components/ui';
import { PayrollRunsPage, WeeklyReviewPage } from './app/pages/Payroll';
import { CashPayPage, EmployeesPage, LaborPage, PayrollTaxPage } from './app/pages/People';
import { DrawsPage, EliminationsPage, IntercompanyPage, PartyStatementPage, RentTemplatesPage } from './app/pages/Intercompany';
import { ApAgingPage, BillDetailPage, BillsInboxPage, BillsPage, PaymentCalendarPage, Ten99Page, UtilitiesPage, VendorStatementsPage } from './app/pages/Payables';
import { OtherReceivablesPage, RentRollPage } from './app/pages/Receivables';
import { ApprovalsPage } from './app/pages/Approvals';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function App() {
  return (
    <HashRouter>
      <ScrollTop />
      <BooksProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/books/transactions" element={<Transactions />} />
            <Route path="/books/transactions/:id" element={<TransactionDetail />} />
            <Route path="/books/transactions/:id/edit" element={<TransactionForm key="edit" />} />
            <Route path="/books/new" element={<TransactionForm key="new" />} />
            <Route path="/books/accounts" element={<Accounts />} />
            <Route path="/books/accounts/:id" element={<AccountDetailPage />} />
            <Route path="/reports/pnl" element={<PnlPage />} />
            <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
            <Route path="/close/periods" element={<Periods />} />
            <Route path="/setup/stores" element={<StoresPage />} />
            <Route path="/setup/entities" element={<EntitiesPage />} />
            <Route path="/setup/parties" element={<PartiesPage />} />
            <Route path="/setup/rules" element={<RulesPage />} />
            <Route path="/setup/users" element={<UsersPage />} />
            <Route path="/setup/audit" element={<AuditPage />} />
            <Route path="/setup/settings" element={<SettingsPage />} />
            <Route path="/bank" element={<BankPage />} />
            <Route path="/bank/checks" element={<ChecksPage />} />
            <Route path="/bank/deposits" element={<DepositsPage />} />
            <Route path="/cash" element={<CashPage />} />
            <Route path="/cash/forecast" element={<ForecastPage />} />
            <Route path="/people/runs" element={<PayrollRunsPage />} />
            <Route path="/people/review" element={<WeeklyReviewPage />} />
            <Route path="/people/employees" element={<EmployeesPage />} />
            <Route path="/people/cash-pay" element={<CashPayPage />} />
            <Route path="/people/labor" element={<LaborPage />} />
            <Route path="/people/taxes" element={<PayrollTaxPage />} />
            <Route path="/fuel" element={<FuelMarginPage />} />
            <Route path="/fuel/invoices" element={<FuelInvoicesPage />} />
            <Route path="/fuel/settlement" element={<SettlementPage />} />
            <Route path="/fuel/truck" element={<TruckLanePage />} />
            <Route path="/fuel/tanks" element={<TanksPage />} />
            <Route path="/fuel/pricing" element={<PricingPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/intercompany/parties" element={<IntercompanyPage />} />
            <Route path="/intercompany/parties/:id" element={<PartyStatementPage />} />
            <Route path="/intercompany/draws" element={<DrawsPage />} />
            <Route path="/intercompany/eliminations" element={<EliminationsPage />} />
            <Route path="/intercompany/rent" element={<RentTemplatesPage />} />
            <Route path="/payables/bills" element={<BillsPage />} />
            <Route path="/payables/bills/:id" element={<BillDetailPage />} />
            <Route path="/payables/inbox" element={<BillsInboxPage />} />
            <Route path="/payables/aging" element={<ApAgingPage />} />
            <Route path="/payables/calendar" element={<PaymentCalendarPage />} />
            <Route path="/payables/utilities" element={<UtilitiesPage />} />
            <Route path="/payables/statements" element={<VendorStatementsPage />} />
            <Route path="/payables/1099" element={<Ten99Page />} />
            <Route path="/receivables/rent" element={<RentRollPage />} />
            <Route path="/receivables/other" element={<OtherReceivablesPage />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="*" element={<PageHead title="Page not found" lede="Use ⌘K to jump anywhere." />} />
          </Routes>
        </Shell>
      </BooksProvider>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
