import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { putFile, getFile } from '../../data/storage';
import type { Books } from '../../core/books';
import type { Attachment, ID } from '../../core/types';

/** Keep an uploaded file on this device and describe it as an attachment. */
export async function keepFile(books: Books, userId: ID, f: File): Promise<Attachment | string> {
  if (f.size > 15 * 1024 * 1024) return `${f.name} is over 15 MB. Save a smaller PDF or photo.`;
  const id = books.nextId('att');
  const ok = await putFile(id, f);
  if (!ok) return 'This browser is blocking storage, so the file could not be kept. Allow site data and try again.';
  return { id, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, addedAt: new Date().toISOString(), addedBy: userId };
}

export async function openAttachment(a: Attachment, say: (m: string) => void): Promise<void> {
  const blob = await getFile(a.id);
  if (!blob) { say(`${a.name} isn't on this device. Attachments live where they were uploaded until the hosted back end ships.`); return; }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Read and write one query-string parameter (empty removes it). */
export function useParam(key: string, fallback = ''): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  const v = sp.get(key) ?? fallback;
  return [v, (x: string) => { const n = new URLSearchParams(sp); if (x && x !== fallback) n.set(key, x); else n.delete(key); setSp(n, { replace: true }); }];
}

/** A row of tab buttons that wraps on phones. */
export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { v: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label} style={{ marginBottom: 16, flexWrap: 'wrap', maxWidth: '100%' }}>
      {options.map((o) => <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  );
}

export function Pill({ tone, children }: { tone?: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={'pill' + (tone ? ' ' + tone : '')}>{children}</span>;
}

/** Download text (CSV) as a file. */
export function downloadText(name: string, text: string, mime = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const userName = (users: { id: ID; name: string }[], id?: ID) => (id ? users.find((u) => u.id === id)?.name ?? id : '');
