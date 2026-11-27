import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Books } from '../core/books';
import { buildDemo, SCHEMA, CFO_ID } from '../data/seed';
import { loadState, saveState, clearState } from '../data/storage';
import { flatLines, type FlatLine } from '../core/reports';
import { visibleStoreIds } from '../core/permissions';
import type { User, ID, Store } from '../core/types';

interface Ctx {
  books: Books;
  user: User;
  setUserId: (id: ID) => void;
  resetDemo: () => Promise<void>;
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
      const state = saved && saved.schema === SCHEMA ? saved : buildDemo();
      if (cancelled) return;
      const b = new Books(state);
      b.subscribe(() => saveState(b.state));
      if (!saved) saveState(state);
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
  return { ...ctx, state: ctx.books.state, version, lines: myLines, allLines: lines, stores, visible };
}
