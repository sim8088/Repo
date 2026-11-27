import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Books } from '../core/books';
import { buildDemo, SCHEMA, CFO_ID } from '../data/seed';
import { importStationBooks, isSnapshot, type ImportReport, type SBSnapshot } from '../data/stationbooks';
import type { BooksState } from '../core/types';

/** A StationBooks export bundled into a private build as `window.__STATIONBOOKS__`, if any. */
function bundledSnapshot(): SBSnapshot | null {
  const w = (typeof window !== 'undefined' ? (window as unknown as { __STATIONBOOKS__?: unknown }).__STATIONBOOKS__ : undefined);
  return isSnapshot(w) ? w : null;
}
import { loadState, saveState, clearState } from '../data/storage';
import { flatLines, type FlatLine } from '../core/reports';
import { visibleStoreIds } from '../core/permissions';
import type { User, ID, Store } from '../core/types';

interface Ctx {
  books: Books;
  user: User;
  setUserId: (id: ID) => void;
  resetDemo: () => Promise<void>;
  /** Replace the books with a StationBooks export (real data). Returns the import report. */
  loadStationBooks: (snap: SBSnapshot) => Promise<ImportReport>;
}

const BooksContext = createContext<Ctx | null>(null);

function pref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setPref(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* storage unavailable: preference lasts for this tab only */ }
}

export function BooksProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Books | null>(null);
  const [userId, setUserIdState] = useState<ID>(() => pref('cfo.user') ?? CFO_ID);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadState();
      // A private build can carry a StationBooks export (real data). It wins over saved books from another
      // source or an older export, but books already built from this same export keep their later changes.
      const sb = bundledSnapshot();
      let state: BooksState;
      if (sb) state = saved && saved.schema === SCHEMA && saved.source?.kind === 'stationbooks' && saved.source.exportedAt === sb.exportedAt ? saved : importStationBooks(sb).state;
      else state = saved && saved.schema === SCHEMA ? saved : buildDemo();
      if (cancelled) return;
      const b = new Books(state);
      b.subscribe(() => saveState(b.state));
      if (state !== saved) saveState(state);
      setBooks(b);
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!books) return null;
    const user = books.state.users.find((u) => u.id === userId && u.active) ?? books.state.users.find((u) => u.id === CFO_ID)!;
    return {
      books,
      user,
      setUserId: (id) => { setPref('cfo.user', id); setUserIdState(id); },
      resetDemo: async () => {
        await clearState();
        const fresh = buildDemo();
        books.state = fresh;
        saveState(fresh);
        books.logDataEvent(fresh.users[0], 'Reset to the demo dataset');
      },
      loadStationBooks: async (snap) => {
        const { state, report } = importStationBooks(snap);
        await clearState();
        books.state = state;
        saveState(state);
        books.logDataEvent(state.users.find((u) => u.id === CFO_ID)!, `Loaded the StationBooks export of ${snap.exportedAt.slice(0, 10)}: ${report.posted} transactions`);
        return report;
      },
    };
  }, [books, userId]);

  if (!value) {
    return <div className="boot" role="status">Opening the books…</div>;
  }
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}

/** Re-renders whenever the books change. */
export function useBooks() {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error('useBooks outside provider');
  const version = useSyncExternalStore((cb) => ctx.books.subscribe(cb), () => ctx.books.getVersion());
  const lines = useMemo(() => flatLines(ctx.books.state), [ctx.books, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => visibleStoreIds(ctx.user, ctx.books.state.stores), [ctx.user, ctx.books, version]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Lines this user may see (row-level access by store). */
  const myLines: FlatLine[] = useMemo(() => lines.filter((f) => visible.has(f.l.storeId)), [lines, visible]);
  const stores: Store[] = ctx.books.state.stores.filter((s) => !s.deleted && visible.has(s.id));
  // A fresh top-level snapshot per change, so any useMemo keyed on `state` recomputes. Writes always go through `books`.
  const state = useMemo(() => ({ ...ctx.books.state }), [ctx.books, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...ctx, state, version, lines: myLines, allLines: lines, stores, visible };
}
