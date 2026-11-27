import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useBooks } from '../store';
import { NAV } from './nav';
import { CommandBar } from './CommandBar';
import { buildInbox } from '../inbox';
import { ROLE_LABEL } from '../../core/permissions';

function useTheme(): [string, (t: string) => void] {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cfo.theme') ?? 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('cfo.theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export function Shell({ children }: { children: ReactNode }) {
  const { state, lines, visible, user, setUserId } = useBooks();
  const [cmd, setCmd] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [theme, setTheme] = useTheme();
  const loc = useLocation();
  const nav = useNavigate();
  const inbox = useMemo(() => buildInbox(state, lines, visible), [state, lines, visible]);
  const inboxCount = inbox.filter((i) => !i.review).reduce((a, i) => a + i.count, 0);
  const badge = (k: string) => inbox.filter((i) => i.key === k).reduce((a, i) => a + i.count, 0);

  useEffect(() => setDrawer(false), [loc.pathname, loc.search]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((o) => !o); }
      else if (!typing && e.key === '/') { e.preventDefault(); setCmd(true); }
      else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); nav('/books/new'); }
      else if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  // Tables that scroll sideways (on phones) must be reachable by keyboard: make only those focusable.
  useEffect(() => {
    const mark = () => {
      document.querySelectorAll<HTMLElement>('.table-wrap').forEach((el) => {
        if (el.dataset.static) return;
        const scrolls = el.scrollWidth > el.clientWidth + 1;
        if (scrolls && !el.hasAttribute('tabindex')) {
          const heading = el.closest('section')?.querySelector('h2')?.textContent ?? el.closest('section')?.getAttribute('aria-label') ?? 'Table';
          el.setAttribute('tabindex', '0');
          el.setAttribute('role', 'region');
          el.setAttribute('aria-label', `${heading}, scroll sideways for more columns`);
          el.dataset.auto = '1';
        } else if (!scrolls && el.dataset.auto) {
          el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label'); delete el.dataset.auto;
        }
      });
    };
    mark();
    const id = window.setTimeout(mark, 50);
    window.addEventListener('resize', mark);
    return () => { window.clearTimeout(id); window.removeEventListener('resize', mark); };
  });

  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : ['/bank', '/cash', '/fuel', '/assets', '/budgets', '/close', '/qbo'].includes(to) ? loc.pathname === to : loc.pathname.startsWith(to));

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        {drawer && <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
        <nav className={'side' + (drawer ? ' open' : '')} aria-label="Main">
          <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true" /><b>CFO Portal</b><span className="brand-sub">{state.settings.companyName}</span></Link>
          {NAV.map((g) => (
            <div className="nav-group" key={g.title}>
              <h2>{g.title}</h2>
              {g.items.map((i) => {
                const n = i.badge === 'inbox' ? inboxCount : i.badge === 'uncat' ? badge('uncat') : i.badge === 'unmatched' ? badge('unmatched') : i.badge === 'unclassified' ? badge('unclassified') : i.badge === 'cash' ? badge('cashvar') + badge('overdue') : 0;
                return (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link" aria-current={isActive(i.to) ? 'page' : undefined}>
                    <span>{i.label}</span>
                    {n > 0 && <span className="count" aria-label={`${n} to do`}>{n}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
          <div className="nav-group">
            <h2>Later phases</h2>
            <NavLink to="/roadmap" className="nav-link">Roadmap &amp; build status</NavLink>
            <p className="nav-soon">Budgets, close, tax and the rest arrive phase by phase.</p>
          </div>
        </nav>
        <div className="main">
          <div className="top">
            <button className="btn menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
              <Icon d="M4 7h16M4 12h16M4 17h16" />
            </button>
            <button className="search-btn" onClick={() => setCmd(true)}>
              <Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4.3-4.3" />
              <span className="search-label">Search pages, vendors, amounts…</span><span className="search-short" aria-hidden="true">Search</span>
              <span style={{ marginLeft: 'auto' }} aria-hidden="true"><kbd>⌘</kbd> <kbd>K</kbd></span>
            </button>
            <div className="top-right">
              <label className="sr-only" htmlFor="acting-as">Acting as</label>
              <select id="acting-as" value={user.id} onChange={(e) => setUserId(e.target.value)} style={{ width: 'auto', maxWidth: 220 }} title="Acting as">
                {state.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}
              </select>
              <label className="sr-only" htmlFor="theme">Theme</label>
              <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: 'auto' }} className="hide-phone">
                <option value="system">System theme</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
          <main id="main" className="content" tabIndex={-1}>{children}</main>
        </div>
      </div>
      <nav className="tabbar" aria-label="Quick">
        <NavLink to="/" end aria-current={loc.pathname === '/' ? 'page' : undefined}><Icon d="M3 11 12 4l9 7v9H3z M9 20v-6h6v6" />Today</NavLink>
        <NavLink to="/reports/command" aria-current={loc.pathname.startsWith('/reports') ? 'page' : undefined}><Icon d="M4 20V10m6 10V4m6 16v-7m4 7H2" />Reports</NavLink>
        <NavLink to="/bank" aria-current={loc.pathname.startsWith('/bank') || loc.pathname.startsWith('/cash') ? 'page' : undefined}><Icon d="M3 10 12 4l9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" />Bank</NavLink>
        <NavLink to="/books/transactions" aria-current={loc.pathname.startsWith('/books') ? 'page' : undefined}><Icon d="M5 4h14v16H5z M8 8h8M8 12h8M8 16h5" />Books</NavLink>
        <button onClick={() => setDrawer(true)} aria-expanded={drawer}><Icon d="M5 12h.01M12 12h.01M19 12h.01" />More</button>
      </nav>
      <CommandBar open={cmd} onClose={() => setCmd(false)} />
    </>
  );
}
