import type {
  BooksState, Transaction, User, ID, Line, Account, Store, Entity, Party, Rule, Settings, AuditEntry, Attachment,
} from './types';
import { balanceEntities, validateDraft, SYS, type TxnDraft } from './ledger';
import { can, PermissionError, type Permission } from './permissions';
import { periodOf } from './dates';
import { ruleKey, suggest } from './rules';
import { pairKey } from './duplicates';

export class ValidationError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(' '));
    this.name = 'ValidationError';
  }
}

type Listener = () => void;

/**
 * The books: one in-memory state with every write validated, permission-checked and audited.
 * Storage is pluggable (see data/storage.ts). Nothing is ever hard-deleted.
 */
export class Books {
  private listeners = new Set<Listener>();
  private version = 0;

  constructor(public state: BooksState, public clock: () => string = () => new Date().toISOString()) {}

  // ── plumbing ────────────────────────────────────────────────────────────
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  getVersion(): number {
    return this.version;
  }
  changed(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }
  nextId(prefix: string): ID {
    this.state.seq += 1;
    return `${prefix}_${this.state.seq.toString(36)}`;
  }
  require(actor: User, p: Permission, what: string): void {
    if (!can(actor, p)) throw new PermissionError(`Your role can't ${what}. Ask the CFO to do it or to change your role.`);
  }
  audit(actor: User, e: Omit<AuditEntry, 'id' | 'at' | 'userId'>): void {
    this.state.audit.push({ id: this.nextId('aud'), at: this.clock(), userId: actor.id, ...e });
  }
  private assertStoreAccess(actor: User, lines: { storeId: ID }[]): void {
    if (can(actor, 'view.all_stores')) return;
    const allowed = new Set(actor.storeIds ?? []);
    if (lines.some((l) => !allowed.has(l.storeId) && !this.isCorpBankLine(l))) {
      throw new PermissionError('You can only enter transactions for your own store.');
    }
  }
  private isCorpBankLine(l: { storeId: ID; accountId?: ID }): boolean {
    const a = l.accountId ? this.account(l.accountId) : undefined;
    const s = this.state.stores.find((x) => x.id === l.storeId);
    return !!a && (a.subtype === 'bank' || a.subtype === 'cash') && s?.kind === 'corporate';
  }

  account(id: ID): Account | undefined {
    return this.state.accounts.find((a) => a.id === id);
  }
  store(id: ID): Store | undefined {
    return this.state.stores.find((s) => s.id === id);
  }
  isLocked(period: string): boolean {
    return this.state.periods[period]?.status === 'locked';
  }

  // ── transactions ────────────────────────────────────────────────────────
  private build(draft: TxnDraft): Line[] {
    const lines: Line[] = draft.lines.map((l) => ({
      id: l.id ?? this.nextId('ln'),
      accountId: l.accountId,
      storeId: l.storeId,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo?.trim() || undefined,
      partyId: l.partyId || undefined,
    }));
    return balanceEntities(this.state, lines, () => this.nextId('ln'));
  }

  createTransaction(actor: User, draft: TxnDraft, opts: { source?: Transaction['source']; batchId?: string; attachments?: Attachment[] } = {}): Transaction {
    this.require(actor, draft.kind === 'journal' ? 'journal.create' : 'txn.create', draft.kind === 'journal' ? 'post journal entries' : 'enter transactions');
    this.assertStoreAccess(actor, draft.lines);
    const errs = validateDraft(this.state, draft);
    if (errs.length) throw new ValidationError(errs);
    const now = this.clock();
    const id = this.nextId('tx');
    const count = this.state.transactions.length + 1;
    const t: Transaction = {
      id,
      ref: 'TX-' + String(count).padStart(6, '0'),
      date: draft.date,
      kind: draft.kind,
      description: draft.description.trim(),
      memo: draft.memo?.trim() || undefined,
      tags: (draft.tags ?? []).map((x) => x.trim()).filter(Boolean),
      partyId: draft.partyId || undefined,
      checkNo: draft.checkNo?.trim() || undefined,
      docNo: draft.docNo?.trim() || undefined,
      lines: this.build(draft),
      attachments: opts.attachments ?? [],
      source: opts.source ?? 'manual',
      batchId: opts.batchId,
      createdAt: now,
      createdBy: actor.id,
      updatedAt: now,
      updatedBy: actor.id,
    };
    this.state.transactions.push(t);
    this.audit(actor, { action: 'create', objectType: 'transaction', objectId: id, summary: `Created ${t.ref} · ${t.description}`, after: t });
    this.changed();
    return t;
  }

  getTransaction(id: ID): Transaction | undefined {
    return this.state.transactions.find((t) => t.id === id || t.ref === id);
  }

  updateTransaction(actor: User, id: ID, draft: TxnDraft, reason?: string): Transaction {
    this.require(actor, draft.kind === 'journal' ? 'journal.create' : 'txn.edit', 'edit transactions');
    const t = this.getTransaction(id);
    if (!t) throw new ValidationError(['That transaction no longer exists.']);
    if (t.deleted) throw new ValidationError(['This transaction was deleted. Restore it before editing.']);
    if (this.isLocked(periodOf(t.date))) throw new ValidationError([`${periodOf(t.date)} is locked. Unlock it from Close › Periods before editing.`]);
    this.assertStoreAccess(actor, [...t.lines.filter((l) => !l.system), ...draft.lines]);
    const errs = validateDraft(this.state, draft);
    if (errs.length) throw new ValidationError(errs);
    const before = structuredClone(t);
    Object.assign(t, {
      date: draft.date,
      kind: draft.kind,
      description: draft.description.trim(),
      memo: draft.memo?.trim() || undefined,
      tags: (draft.tags ?? []).map((x) => x.trim()).filter(Boolean),
      partyId: draft.partyId || undefined,
      checkNo: draft.checkNo?.trim() || undefined,
      docNo: draft.docNo?.trim() || undefined,
      lines: this.build(draft),
      updatedAt: this.clock(),
      updatedBy: actor.id,
    });
    this.audit(actor, { action: 'update', objectType: 'transaction', objectId: t.id, summary: `Edited ${t.ref}`, before, after: structuredClone(t), reason });
    this.changed();
    return t;
  }

  deleteTransaction(actor: User, id: ID, reason: string): void {
    this.require(actor, 'txn.delete', 'delete transactions');
    if (!reason.trim()) throw new ValidationError(['Say why you are deleting this. The reason goes in the audit log.']);
    const t = this.getTransaction(id);
    if (!t || t.deleted) return;
    if (this.isLocked(periodOf(t.date))) throw new ValidationError([`${periodOf(t.date)} is locked. Unlock it before deleting.`]);
    t.deleted = { at: this.clock(), by: actor.id, reason: reason.trim() };
    this.audit(actor, { action: 'delete', objectType: 'transaction', objectId: t.id, summary: `Deleted ${t.ref} · ${t.description}`, reason });
    this.changed();
  }

  restoreTransaction(actor: User, id: ID): void {
    this.require(actor, 'txn.delete', 'restore transactions');
    const t = this.getTransaction(id);
    if (!t?.deleted) return;
    if (this.isLocked(periodOf(t.date))) throw new ValidationError([`${periodOf(t.date)} is locked. Unlock it before restoring.`]);
    const before = t.deleted;
    delete t.deleted;
    this.audit(actor, { action: 'restore', objectType: 'transaction', objectId: t.id, summary: `Restored ${t.ref}`, before });
    this.changed();
  }

  addAttachment(actor: User, id: ID, att: Attachment): void {
    this.require(actor, 'txn.create', 'attach documents');
    const t = this.getTransaction(id);
    if (!t) throw new ValidationError(['That transaction no longer exists.']);
    this.assertStoreAccess(actor, t.lines.filter((l) => !l.system));
    t.attachments.push(att);
    this.audit(actor, { action: 'attach', objectType: 'transaction', objectId: t.id, summary: `Attached ${att.name} to ${t.ref}` });
    this.changed();
  }

  removeAttachment(actor: User, id: ID, attId: ID): void {
    this.require(actor, 'txn.edit', 'remove attachments');
    const t = this.getTransaction(id);
    const a = t?.attachments.find((x) => x.id === attId);
    if (!t || !a) return;
    t.attachments = t.attachments.filter((x) => x.id !== attId);
    this.audit(actor, { action: 'detach', objectType: 'transaction', objectId: t.id, summary: `Removed ${a.name} from ${t.ref}`, before: a });
    this.changed();
  }

  /**
   * Re-categorize one line (the inbox's one-click fix). Learns a rule from the bank description:
   * a matching rule that agreed gains a hit, one that disagreed gains an override and is retargeted
   * once overrides outnumber hits.
   */
  categorizeLine(actor: User, txnId: ID, lineId: ID, accountId: ID, storeId: ID, opts: { learn?: boolean } = {}): void {
    this.require(actor, 'txn.edit', 'categorize transactions');
    const t = this.getTransaction(txnId);
    const line = t?.lines.find((l) => l.id === lineId);
    if (!t || !line) throw new ValidationError(['That line no longer exists.']);
    const draft: TxnDraft = {
      ...t,
      lines: t.lines.filter((l) => !l.system).map((l) => (l.id === lineId ? { ...l, accountId, storeId } : l)),
    };
    this.updateTransaction(actor, t.id, draft, 'Categorized from inbox');
    if (opts.learn === false) return;
    this.learnRule(actor, t.description, accountId, storeId, t.partyId);
    this.changed();
  }

  /**
   * Learn from a categorization: a matching rule that agreed gains a hit, one that disagreed gains
   * an override and is retargeted once overrides outnumber hits; with no rule, a new one is learned.
   */
  learnRule(actor: User, description: string, accountId: ID, storeId: ID, partyId?: ID): void {
    const match = suggest(this.state, description);
    if (match) {
      const r = match.rule;
      if (r.accountId === accountId && r.storeId === storeId) r.hits += 1;
      else {
        r.overrides += 1;
        if (r.overrides > r.hits) {
          r.accountId = accountId;
          r.storeId = storeId;
          r.hits = 1;
          r.overrides = 0;
        }
      }
    } else {
      const key = ruleKey(description);
      if (key) {
        const rule: Rule = { id: this.nextId('rule'), contains: key, accountId, storeId, partyId, origin: 'learned', hits: 1, overrides: 0, createdAt: this.clock(), active: true };
        this.state.rules.push(rule);
        this.audit(actor, { action: 'learn', objectType: 'rule', objectId: rule.id, summary: `Learned rule: "${key}" → ${this.account(accountId)?.name}`, after: rule });
      }
    }
    this.changed();
  }

  dismissDuplicate(actor: User, a: ID, b: ID): void {
    this.require(actor, 'txn.edit', 'clear duplicate flags');
    const k = pairKey(a, b);
    if (!this.state.dismissedDuplicates.includes(k)) this.state.dismissedDuplicates.push(k);
    this.audit(actor, { action: 'not_duplicate', objectType: 'transaction', objectId: a, summary: `Marked ${this.getTransaction(a)?.ref} and ${this.getTransaction(b)?.ref} as not duplicates` });
    this.changed();
  }

  // ── periods ─────────────────────────────────────────────────────────────
  lockPeriod(actor: User, period: string): void {
    this.require(actor, 'period.lock', 'lock a month');
    const before = this.state.periods[period];
    this.state.periods[period] = { id: period, status: 'locked', lockedAt: this.clock(), lockedBy: actor.id };
    this.audit(actor, { action: 'lock', objectType: 'period', objectId: period, summary: `Locked ${period}`, before });
    this.changed();
  }

  unlockPeriod(actor: User, period: string, reason: string): void {
    this.require(actor, 'period.unlock', 'unlock a month');
    if (!reason.trim()) throw new ValidationError(['Give a reason for unlocking. It is kept in the audit log.']);
    const before = this.state.periods[period];
    this.state.periods[period] = { id: period, status: 'open', unlockReason: reason.trim() };
    this.audit(actor, { action: 'unlock', objectType: 'period', objectId: period, summary: `Unlocked ${period}`, before, reason });
    this.changed();
  }

  // ── setup records (generic upsert with audit) ───────────────────────────
  private upsert<T extends { id: ID }>(actor: User, list: T[], item: T, type: AuditEntry['objectType'], label: string): T {
    this.require(actor, type === 'user' ? 'users.edit' : 'setup.edit', `change ${type} setup`);
    const i = list.findIndex((x) => x.id === item.id);
    const before = i >= 0 ? structuredClone(list[i]) : undefined;
    if (i >= 0) list[i] = item;
    else list.push(item);
    this.audit(actor, { action: before ? 'update' : 'create', objectType: type, objectId: item.id, summary: `${before ? 'Updated' : 'Added'} ${type} ${label}`, before, after: structuredClone(item) });
    this.changed();
    return item;
  }

  saveAccount(actor: User, a: Account): Account {
    const errs: string[] = [];
    if (!/^\d{3,6}$/.test(a.number)) errs.push('Account numbers are 3 to 6 digits.');
    if (!a.name.trim()) errs.push('Give the account a name.');
    if (this.state.accounts.some((x) => x.number === a.number && x.id !== a.id)) errs.push(`Number ${a.number} is already used. Pick another.`);
    const existing = this.account(a.id);
    if (existing?.system && (existing.type !== a.type || !a.active)) errs.push('System accounts keep their type and stay active.');
    if (errs.length) throw new ValidationError(errs);
    return this.upsert(actor, this.state.accounts, a, 'account', `${a.number} ${a.name}`);
  }
  saveStore(actor: User, s: Store): Store {
    const errs: string[] = [];
    if (!s.code.trim()) errs.push('Give the store a short code, like HM19.');
    if (!s.name.trim()) errs.push('Give the store a name.');
    if (!this.state.entities.some((e) => e.id === s.entityId)) errs.push('Choose which entity owns this store.');
    if (this.state.stores.some((x) => x.code.toUpperCase() === s.code.toUpperCase() && x.id !== s.id && !x.deleted)) errs.push(`Code ${s.code} is already used.`);
    if (errs.length) throw new ValidationError(errs);
    return this.upsert(actor, this.state.stores, s, 'store', s.code);
  }
  saveEntity(actor: User, e: Entity): Entity {
    if (!e.name.trim() || !e.code.trim()) throw new ValidationError(['Entities need a code and a legal name.']);
    if (e.isHub) for (const x of this.state.entities) if (x.id !== e.id) x.isHub = false;
    return this.upsert(actor, this.state.entities, e, 'entity', e.code);
  }
  saveParty(actor: User, p: Party): Party {
    if (!p.name.trim()) throw new ValidationError(['Give the vendor or party a name.']);
    return this.upsert(actor, this.state.parties, p, 'party', p.name);
  }
  saveRule(actor: User, r: Rule): Rule {
    if (r.contains.trim().length < 3) throw new ValidationError(['Rule text must be at least 3 characters so it does not match everything.']);
    return this.upsert(actor, this.state.rules, r, 'rule', `"${r.contains}"`);
  }
  saveUser(actor: User, u: User): User {
    if (!u.name.trim()) throw new ValidationError(['Give the user a name.']);
    if (u.role === 'store_manager' && !(u.storeIds?.length)) throw new ValidationError(['Store managers need at least one store.']);
    if (u.id === actor.id && u.role !== 'cfo' && actor.role === 'cfo') {
      const others = this.state.users.filter((x) => x.id !== u.id && x.role === 'cfo' && x.active);
      if (!others.length) throw new ValidationError(['You are the only CFO. Add another CFO before changing your own role.']);
    }
    return this.upsert(actor, this.state.users, u, 'user', u.name);
  }
  saveSettings(actor: User, s: Settings): void {
    this.require(actor, 'setup.edit', 'change settings');
    const before = structuredClone(this.state.settings);
    this.state.settings = s;
    this.audit(actor, { action: 'update', objectType: 'settings', objectId: 'settings', summary: 'Updated settings', before, after: s });
    this.changed();
  }

  logExport(actor: User, what: string): void {
    this.require(actor, 'export', 'export data');
    this.audit(actor, { action: 'export', objectType: 'export', objectId: what, summary: `Exported ${what}` });
    this.changed();
  }

  logDataEvent(actor: User, summary: string): void {
    this.audit(actor, { action: 'data', objectType: 'data', objectId: 'books', summary });
    this.changed();
  }
}

export { SYS };
