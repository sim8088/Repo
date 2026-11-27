import type { BooksState } from '../core/types';

/**
 * Local persistence in IndexedDB (no size ceiling like localStorage). Every call is wrapped so a
 * private window or blocked storage still gives a working in-memory session.
 */
const DB = 'cfo-portal';
const VERSION = 1;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function loadState(): Promise<BooksState | undefined> {
  return tx<BooksState>('state', 'readonly', (s) => s.get('books') as IDBRequest<BooksState>);
}

let pending: BooksState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Debounced save so bulk edits write once. */
export function saveState(state: BooksState): void {
  pending = state;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const s = pending;
    pending = null;
    if (s) void tx('state', 'readwrite', (st) => st.put(structuredClone(s), 'books'));
  }, 250);
}

export async function clearState(): Promise<void> {
  await tx('state', 'readwrite', (s) => s.delete('books'));
}

export async function putFile(id: string, blob: Blob): Promise<boolean> {
  return (await tx('files', 'readwrite', (s) => s.put(blob, id))) !== undefined;
}

export async function getFile(id: string): Promise<Blob | undefined> {
  return tx<Blob>('files', 'readonly', (s) => s.get(id) as IDBRequest<Blob>);
}
