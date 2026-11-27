import { useMemo } from 'react';
import { useBooks } from '../store';
import { useExport } from './ui';
import { can } from '../../core/permissions';
import { basisEntries, type BasisEntry } from '../../core/statements';
import { xlsx, type Cell } from '../../core/xlsx';
import type { ReportBasis } from '../../core/types';

/** Every P&L line on both bases, recomputed when the books change. */
export function useEntries(): BasisEntry[] {
  const { state, version } = useBooks();
  return useMemo(() => basisEntries(state), [state, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Download rows as a real .xlsx workbook and log the export. */
export function useExportXlsx() {
  const { books, user } = useBooks();
  return (name: string, header: string[], rows: Cell[][], sheet = name) => {
    const data = xlsx([{ name: sheet, rows: [header, ...rows] }]);
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name + '.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { books.logExport(user, name + '.xlsx'); } catch { /* role without export never sees the button */ }
  };
}

/** CSV + Excel + Print / PDF, for the page head of every report. */
export function ExportButtons({ name, header, rows, sheet, print = true }: { name: string; header: string[]; rows: (string | number)[][]; sheet?: string; print?: boolean }) {
  const { user } = useBooks();
  const csv = useExport();
  const x = useExportXlsx();
  return (
    <>
      {can(user, 'export') && <button className="btn" onClick={() => csv(name, header, rows)}>Export CSV</button>}
      {can(user, 'export') && <button className="btn" onClick={() => x(name, header, rows, sheet)}>Export Excel</button>}
      {print && <button className="btn" onClick={() => window.print()}>Print / PDF</button>}
    </>
  );
}

export const BASES: { v: ReportBasis; label: string }[] = [{ v: 'booked', label: 'Booked' }, { v: 'cash', label: 'Cash' }, { v: 'accrual', label: 'Accrual' }];

export function BasisSeg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  );
}

export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`);
export const ratioPct = (v: number, base: number, d = 1) => (base ? pct(v / base, d) : '–');
