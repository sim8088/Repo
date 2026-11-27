import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooks } from '../store';
import { parseMoney, formatMoney } from '../../core/money';
import { txnTotal } from '../../core/duplicates';
import { NAV } from './nav';
import { shortDate } from '../../core/dates';

interface Item { id: string; label: string; kind: string; to: string; }

/** ⌘K: jump to any page, store, account, party, reference, check number or amount. */
export function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, stores, visible } = useBooks();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement;
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    } else prevFocus.current?.focus?.();
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const pages: Item[] = NAV.flatMap((g) => g.items.map((i) => ({ id: 'p' + i.to, label: i.label, kind: g.title, to: i.to })));
    if (!needle) return pages.slice(0, 12);
    const out: Item[] = [];
    const amount = /\d/.test(needle) ? parseMoney(needle) : null;
    const amountLike = amount !== null && /[.$,]/.test(needle);
    for (const p of pages) if (p.label.toLowerCase().includes(needle)) out.push(p);
    for (const s of stores) {
      if (s.code.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)) {
        out.push({ id: 's' + s.id, label: `${s.code} · ${s.name}`, kind: 'Store transactions', to: `/books/transactions?store=${s.id}` });
        out.push({ id: 'sp' + s.id, label: `${s.code} profit & loss`, kind: 'Report', to: `/reports/pnl?store=${s.id}` });
      }
    }
    for (const a of state.accounts) {
      if (a.number.startsWith(needle) || a.name.toLowerCase().includes(needle)) out.push({ id: 'a' + a.id, label: `${a.number} · ${a.name}`, kind: 'Account', to: `/books/accounts/${a.id}` });
    }
    for (const p of state.parties) {
      if (!p.deleted && p.name.toLowerCase().includes(needle)) out.push({ id: 'pt' + p.id, label: p.name, kind: 'Party transactions', to: `/books/transactions?party=${p.id}` });
    }
    let n = 0;
    const txns = [...state.transactions].reverse();
    for (const t of txns) {
      if (n >= 12) break;
      if (t.deleted || !t.lines.some((l) => visible.has(l.storeId))) continue;
      const hit = amountLike
        ? Math.abs(amount!) === txnTotal(t) || t.lines.some((l) => l.debit === Math.abs(amount!) || l.credit === Math.abs(amount!))
        : t.ref.toLowerCase() === needle || t.checkNo === needle || t.docNo?.toLowerCase() === needle || (needle.length > 2 && t.description.toLowerCase().includes(needle));
      if (hit) {
        out.push({ id: 't' + t.id, label: `${t.ref} · ${t.description} · ${formatMoney(txnTotal(t), { dollarSign: true })}`, kind: shortDate(t.date), to: `/books/transactions/${t.id}` });
        n += 1;
      }
    }
    if (amountLike) out.unshift({ id: 'amt', label: `All transactions for ${formatMoney(Math.abs(amount!), { dollarSign: true })}`, kind: 'Search', to: `/books/transactions?q=${encodeURIComponent(needle)}` });
    else if (needle.length > 1) out.push({ id: 'q', label: `Search transactions for “${q.trim()}”`, kind: 'Search', to: `/books/transactions?q=${encodeURIComponent(q.trim())}` });
    return out.slice(0, 40);
  }, [q, state, stores, visible]);

  if (!open) return null;
  const go = (i?: Item) => {
    if (!i) return;
    onClose();
    nav(i.to);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Command bar">
        <input
          ref={input}
          className="cmd-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={items[sel] ? 'cmd-' + items[sel].id : undefined}
          aria-label="Search pages, stores, accounts, parties, references or amounts"
          placeholder="Jump to a page, store, vendor, TX-ref, check # or $ amount"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <ul className="cmd-list" id="cmd-list" role="listbox" aria-label="Results">
          {items.length === 0 && <li aria-disabled="true" className="muted">Nothing matches. Try a store code, a vendor or an amount like 4,077.40.</li>}
          {items.map((i, idx) => (
            <li key={i.id} id={'cmd-' + i.id} role="option" aria-selected={idx === sel} onMouseEnter={() => setSel(idx)} onClick={() => go(i)}>
              <span>{i.label}</span>
              <span className="kind">{i.kind}</span>
            </li>
          ))}
        </ul>
        <div className="cmd-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span><kbd>N</kbd> new entry</span><span><kbd>/</kbd> or <kbd>⌘K</kbd> search</span>
        </div>
      </div>
    </div>
  );
}
