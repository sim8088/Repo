import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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

export function PageHead({ eyebrow, title, lede, icon, children }: { eyebrow?: string; title: string; lede?: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} · CFO Portal`; }, [title]);
  const heading = (
    <div>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
    </div>
  );
  return (
    <header className="page-head">
      {icon ? <div className="head-icon">{icon}{heading}</div> : heading}
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

/** True when the viewer asked the system to reduce motion. */
function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

/**
 * A number that counts up once when it first shows (at most 400 ms). The real, final text is always in the
 * DOM for screen readers and tests; only an aria-hidden visual layer animates, and not at all under reduced motion.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const final = format(value);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (prefersReducedMotion() || value === 0) { setShown(null); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 400);
      if (k >= 1) { setShown(null); return; }
      setShown(format(Math.round(value * (1 - Math.pow(1 - k, 3)))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  if (shown === null) return <span className="countup">{final}</span>;
  return <span className="countup"><span className="sr-only">{final}</span><span aria-hidden="true">{shown}</span></span>;
}

/**
 * A fuel-gauge meter: a semicircle with a needle. `target` draws a tick and splits the arc into a low zone
 * (below target) and a high zone. Exposed as an ARIA meter with a text value, which is also shown.
 */
export function Gauge({ value, max, min = 0, target, label, valueText, width }: { value: number; max: number; min?: number; target?: number; label: string; valueText: string; width?: number }) {
  const span = max - min || 1;
  const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / span));
  const pt = (f: number, r: number) => [60 - r * Math.cos(Math.PI * f), 56 - r * Math.sin(Math.PI * f)].map((n) => Number(n.toFixed(2)));
  const arc = (f0: number, f1: number) => `M ${pt(f0, 44).join(' ')} A 44 44 0 0 1 ${pt(f1, 44).join(' ')}`;
  const t = target === undefined ? undefined : frac(target);
  const [nx, ny] = pt(frac(value), 36);
  const tick = t === undefined ? null : [...pt(t, 53), ...pt(t, 35)];
  return (
    <div className="gauge" role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.min(max, Math.max(min, value))} aria-valuetext={valueText}
      style={width ? ({ '--gauge-w': `${width}px` } as CSSProperties) : undefined}>
      <svg viewBox="0 0 120 62" aria-hidden="true" focusable="false">
        <path className="g-track" d={arc(0, 1)} fill="none" strokeWidth="9" />
        {t !== undefined && t > 0 && <path className="g-low" d={arc(0, t)} fill="none" strokeWidth="9" />}
        {t !== undefined && t < 1 && <path className="g-high" d={arc(t, 1)} fill="none" strokeWidth="9" />}
        {tick && <line className="g-tick" x1={tick[0]} y1={tick[1]} x2={tick[2]} y2={tick[3]} strokeWidth="2.5" />}
        <line className="g-needle" x1="60" y1="56" x2={nx} y2={ny} strokeWidth="3.5" strokeLinecap="round" />
        <circle className="g-hub" cx="60" cy="56" r="5.5" />
      </svg>
      <span className="gauge-text">{valueText}</span>
    </div>
  );
}

/** A cheerful one-line empty state. Pass `colSpan` to render it as a table cell. */
export function Empty({ children, colSpan }: { children: ReactNode; colSpan?: number }) {
  if (colSpan) return <td colSpan={colSpan} className="empty">{children}</td>;
  return <p className="empty">{children}</p>;
}

/** The forecourt pictogram: a canopy over a pump, drawn in tokens. Decorative. */
export function Forecourt() {
  return (
    <svg className="forecourt" viewBox="0 0 64 52" aria-hidden="true" focusable="false">
      <rect className="fc-canopy" x="2" y="3" width="60" height="9" rx="2" />
      <rect className="fc-stripe" x="2" y="10" width="60" height="2.5" />
      <line className="fc-post" x1="9" y1="12" x2="9" y2="48" strokeWidth="2.5" />
      <line className="fc-post" x1="55" y1="12" x2="55" y2="48" strokeWidth="2.5" />
      <rect className="fc-pump" x="22" y="22" width="16" height="26" rx="2" />
      <rect className="fc-screen" x="25" y="25.5" width="10" height="6" rx="1" />
      <path className="fc-hose" d="M38 28 h4 a3 3 0 0 1 3 3 v10 a2.5 2.5 0 0 0 5 0 v-9" strokeWidth="2" strokeLinecap="round" />
      <line className="fc-ground" x1="2" y1="49" x2="62" y2="49" strokeWidth="1.5" />
    </svg>
  );
}
