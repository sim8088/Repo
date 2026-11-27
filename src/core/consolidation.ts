import type { Books } from './books';
import { ValidationError } from './books';
import type { Account, BooksState, ConsolidationRecord, EliminationEntry, Entity, ID, User } from './types';
import { SYS } from './ledger';
import { flatLines, trialBalance, type FlatLine } from './reports';
import { eliminations, type PairCheck } from './intercompany';
import { glOf, glWrite } from './journals';
import { formatMoney, type Cents } from './money';

/** Intercompany P&L accounts: what one group entity charges another. Eliminated in consolidation. */
export const IC_PNL = { income: 'acct_ic_fee_income', expense: 'acct_ic_fees' } as const;

export interface ConsRow {
  account: Account;
  /** Debit − credit by entity id. */
  byEntity: Record<ID, number>;
  combined: number;
  elimination: number;
  consolidated: number;
}

export interface Consolidation {
  asOf: string;
  entities: Entity[];
  rows: ConsRow[];
  entries: EliminationEntry[];
  /** Per entity column: debits − credits (each must be zero). */
  entityDifference: Record<ID, number>;
  combinedDifference: number;
  /** Debits − credits of the elimination column; must be zero. */
  eliminationNet: number;
  consolidatedDifference: number;
  /** Every elimination entry balances on its own. */
  entriesBalance: boolean;
  /** Due-to / due-from and intercompany P&L are zero after eliminating. */
  icCleared: boolean;
  /** Phase 5: each pair of entities agrees on what they owe each other. */
  pairs: PairCheck[];
  pairsAgree: boolean;
  netIncome: { combined: number; consolidated: number };
  ok: boolean;
}

const ELIM_ACCOUNTS = new Set<ID>([SYS.dueFrom, SYS.dueTo]);

/**
 * Consolidated trial balance: each entity's books side by side, the eliminations, and the group.
 * Eliminations net the automatic due-to / due-from lines pair by pair (reusing the Phase 5 pair
 * check) and the intercompany management fee income against the expense. Nothing is posted.
 */
export function consolidate(state: BooksState, opts: { asOf: string; lines?: FlatLine[] }): Consolidation {
  const lines = opts.lines ?? flatLines(state);
  const entities = state.entities.filter((e) => !e.deleted);
  const m = new Map<ID, ConsRow>();
  const entityDifference: Record<ID, number> = {};
  for (const e of entities) {
    const tb = trialBalance(state, { asOf: opts.asOf, entityId: e.id, lines });
    entityDifference[e.id] = tb.difference;
    for (const r of tb.rows) {
      let row = m.get(r.account.id);
      if (!row) { row = { account: r.account, byEntity: {}, combined: 0, elimination: 0, consolidated: 0 }; m.set(r.account.id, row); }
      row.byEntity[e.id] = r.net;
      row.combined += r.net;
    }
  }
  // Due-to / due-from positions by entity and counter-entity, from the automatic lines.
  const entOf = new Map(state.stores.map((s) => [s.id, s.entityId]));
  const pos = new Map<string, number>();
  for (const f of lines) {
    if (f.date > opts.asOf || f.l.system !== 'intercompany' || !f.l.counterEntityId || !ELIM_ACCOUNTS.has(f.l.accountId)) continue;
    const k = `${entOf.get(f.l.storeId)}|${f.l.counterEntityId}|${f.l.accountId}`;
    pos.set(k, (pos.get(k) ?? 0) + f.l.debit - f.l.credit);
  }
  const code = (id: ID) => entities.find((e) => e.id === id)?.code ?? id;
  const pairEntries = new Map<string, EliminationEntry>();
  for (const [k, v] of pos) {
    if (!v) continue;
    const [ent, counter, accountId] = k.split('|');
    const pk = [ent, counter].sort().join('|');
    let entry = pairEntries.get(pk);
    if (!entry) {
      const [a, b] = pk.split('|');
      entry = { key: 'pair:' + pk, label: `Eliminate due to / due from: ${code(a)} ↔ ${code(b)}`, lines: [] };
      pairEntries.set(pk, entry);
    }
    entry.lines.push({ entityId: ent, accountId, debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0 });
  }
  const entries: EliminationEntry[] = [...pairEntries.values()].sort((a, b) => a.label.localeCompare(b.label));
  // Intercompany management fees: income at the charging entity against expense at the one charged.
  const icLines: EliminationEntry['lines'] = [];
  for (const id of [IC_PNL.income, IC_PNL.expense]) {
    const row = m.get(id);
    if (!row) continue;
    for (const [ent, net] of Object.entries(row.byEntity)) if (net) icLines.push({ entityId: ent, accountId: id, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 });
  }
  if (icLines.length) entries.push({ key: 'icpnl', label: 'Eliminate intercompany management fees (income against expense)', lines: icLines });
  for (const e of entries) for (const l of e.lines) {
    const row = m.get(l.accountId);
    if (row) row.elimination += l.debit - l.credit;
  }
  const rows = [...m.values()].sort((a, b) => a.account.number.localeCompare(b.account.number));
  let combinedDifference = 0, eliminationNet = 0, consolidatedDifference = 0;
  for (const r of rows) {
    r.consolidated = r.combined + r.elimination;
    combinedDifference += r.combined;
    eliminationNet += r.elimination;
    consolidatedDifference += r.consolidated;
  }
  const entriesBalance = entries.every((e) => e.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0);
  const icIds = [SYS.dueFrom, SYS.dueTo, IC_PNL.income, IC_PNL.expense];
  const icCleared = rows.filter((r) => icIds.includes(r.account.id as typeof icIds[number])).every((r) => r.consolidated === 0);
  const elim = eliminations(state, opts.asOf);
  const pairsAgree = elim.pairs.every((p) => p.net === 0);
  const pnlNet = (k: 'combined' | 'consolidated') => -rows.filter((r) => ['revenue', 'contra_revenue', 'cogs', 'expense'].includes(r.account.type)).reduce((a, r) => a + r[k], 0);
  return {
    asOf: opts.asOf, entities, rows, entries, entityDifference, combinedDifference, eliminationNet, consolidatedDifference, entriesBalance, icCleared,
    pairs: elim.pairs, pairsAgree,
    netIncome: { combined: pnlNet('combined'), consolidated: pnlNet('consolidated') },
    ok: eliminationNet === 0 && consolidatedDifference === 0 && entriesBalance && icCleared && pairsAgree && Object.values(entityDifference).every((d) => d === 0),
  };
}

export function entryTotal(e: EliminationEntry): Cents {
  return e.lines.reduce((a, l) => a + l.debit, 0);
}

/** Record the consolidation (its elimination entries as they stand) in the elimination entry log. Nothing posts to the ledger. */
export function recordConsolidation(books: Books, actor: User, asOf: string, note?: string): ConsolidationRecord {
  books.require(actor, 'journal.create', 'record a consolidation');
  const c = consolidate(books.state, { asOf });
  if (!c.entriesBalance || c.eliminationNet !== 0) throw new ValidationError(['The eliminations don\'t net to zero. Fix the entity that disagrees (see the pair check) before recording.']);
  const rec: ConsolidationRecord = { id: books.nextId('cons'), asOf, by: actor.id, at: books.clock(), entries: structuredClone(c.entries), eliminationNet: c.eliminationNet, ok: c.ok, note: note?.trim() || undefined };
  glWrite(books.state).consolidations.push(rec);
  const total = c.entries.reduce((a, e) => a + entryTotal(e), 0);
  books.audit(actor, { action: 'consolidate', objectType: 'journal', objectId: rec.id, summary: `Recorded the consolidation as of ${asOf}: ${c.entries.length} elimination entries, ${formatMoney(total, { dollarSign: true })}`, after: rec });
  books.changed();
  return rec;
}

export function consolidationLog(state: BooksState): ConsolidationRecord[] {
  return [...glOf(state).consolidations].sort((a, b) => b.at.localeCompare(a.at));
}
