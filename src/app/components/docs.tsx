import { useId } from 'react';
import { getFile, putFile } from '../../data/storage';
import type { Books } from '../../core/books';
import type { Attachment, ID } from '../../core/types';

/** Keep an uploaded file in IndexedDB and return its attachment record (or a sentence saying why not). */
export async function keepFile(books: Books, userId: ID, f: File): Promise<Attachment | string> {
  if (f.size > 15 * 1024 * 1024) return `${f.name} is over 15 MB. Save a smaller PDF or photo.`;
  const id = books.nextId('att');
  const ok = await putFile(id, f);
  if (!ok) return 'This browser is blocking storage, so the file could not be kept. Allow site data and try again.';
  return { id, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, addedAt: new Date().toISOString(), addedBy: userId };
}

export async function openDoc(a: Pick<Attachment, 'id' | 'name'>, say: (m: string) => void): Promise<void> {
  const blob = await getFile(a.id);
  if (!blob) { say(`${a.name} isn't on this device. Demo documents are records only, and uploads stay on the device that added them until the hosted back end ships.`); return; }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function DocList({ items, say }: { items: Attachment[]; say: (m: string) => void }) {
  if (!items.length) return <span className="muted small">No documents</span>;
  return <span className="small">{items.map((a) => <button key={a.id} className="btn sm ghost" onClick={() => void openDoc(a, say)}>{a.name}</button>)}</span>;
}

/** A labelled file picker that uploads and hands back the attachment. */
export function AttachButton({ books, userId, label, onFile, say }: { books: Books; userId: ID; label: string; onFile: (a: Attachment) => void; say: (m: string) => void }) {
  const id = useId();
  return (
    <span className="attach">
      <label htmlFor={id} className="btn sm">{label}</label>
      <input id={id} type="file" className="sr-only" accept="image/*,application/pdf" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const r = await keepFile(books, userId, f);
        if (typeof r === 'string') say(r); else onFile(r);
      }} />
    </span>
  );
}
