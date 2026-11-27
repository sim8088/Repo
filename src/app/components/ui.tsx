import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../core/money';
import { HELP, type HelpKey } from '../help';
import { useBooks } from '../store';
import type { Account, ID } from '../../core/types';
import { ACCOUNT_TYPE_LABEL } from '../../core/coa';

export function Money({ c, signed, whole, dollar, className }: { c: number; signed?: boolean; whole?: boolean; dollar?: boolean; className?: string }) {
  const cls = [signed ? (c < 0 ? 'neg' : c > 0 ? 'pos' : '') : '', className ?? ''].join(' ').trim();
  return <span className={cls || undefined}>{formatMoney(c, { whole, dollarSign: dollar })}</span>;
}

export function PageHead({ eyebrow, title, lede, children }: { eyebrow?: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} · CFO Portal`; }, [title]);
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

/** The footer every report carries: does this total tie to its source? */
export function TieOut({ items }: { items: { label: string; ok: boolean; detail?: ReactNode }[] }) {
  return (
    <div className="tieout" aria-label="Tie-out">
      {items.map((i) => (
        <span key={i.label}>
          <span className={'tie ' + (i.ok ? 'ok' : 'bad')}>
            <span aria-hidden>{i.ok ? '✓' : '✗'}</span>
            {i.label}
          </span>{' '}
          {i.detail && <span className="muted">{i.detail}</span>}
        </span>
      ))}
    </div>
  );
}

export function Help({ k }: { k: HelpKey }) {
  const h: { purpose: string; steps: string[]; tips?: string[] } = HELP[k];
  return (
    <details className="help">
      <summary>How to use this screen</summary>
      <div className="help-body">
        <p>{h.purpose}</p>
        <ol>{h.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        {h.tips && <ul>{h.tips.map((s) => <li key={s}>{s}</li>)}</ul>}
      </div>
    </details>
  );
}

export function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="note err" role="alert">
      <b>Not saved yet.</b>
      <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}

export function StoreSelect({ id, value, onChange, allowAll, label = 'Store' }: { id: string; value: ID; onChange: (v: ID) => void; allowAll?: boolean; label?: string }) {
  const { stores } = useBooks();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">All stores</option>}
        {stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
      </select>
    </div>
  );
}

export function AccountOptions({ filter }: { filter?: (a: Account) => boolean }) {
  const { state } = useBooks();
  const groups = new Map<string, Account[]>();
  for (const a of [...state.accounts].sort((x, y) => x.number.localeCompare(y.number))) {
    if (!a.active || (filter && !filter(a))) continue;
    const g = ACCOUNT_TYPE_LABEL[a.type];
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  return (
    <>
      {[...groups].map(([g, list]) => (
        <optgroup key={g} label={g}>
          {list.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

export function PartyOptions() {
  const { state } = useBooks();
  return (
    <>
      {[...state.parties].filter((p) => !p.deleted).sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </>
  );
}

export function Figure({ label, value, note, href }: { label: string; value: ReactNode; note?: ReactNode; href?: string }) {
  return (
    <div className="figure">
      <div className="label">{label}</div>
      {href ? <Link className="value" to={href}>{value}</Link> : <div className="value">{value}</div>}
      {note && <div className="fig-note">{note}</div>}
    </div>
  );
}

/** Download rows as CSV (opens in Excel) and log the export. */
export function useExport() {
  const { books, user } = useBooks();
  return (name: string, header: string[], rows: (string | number)[][]) => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { books.logExport(user, name + '.csv'); } catch { /* role without export never sees the button */ }
  };
}

/** True below the phone breakpoint; follows resizes. */
export function useIsPhone(): boolean {
  const q = '(max-width: 900px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

/** Plain decimal dollars for CSV cells. */
export const csvMoney = (c: number) => (c / 100).toFixed(2);
