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
import { PageHead } from './app/components/ui';

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
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="*" element={<PageHead title="Page not found" lede="Use ⌘K to jump anywhere." />} />
          </Routes>
        </Shell>
      </BooksProvider>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
