import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  API_CONNECTOR, FILE_CONNECTOR, acceptSuggestions, buildPayloads, commitPull, connectionStatus, differencesReport, importQboTb, journalCsv, loadQboLists, mappingStatus,
  nameScore, parseQboTb, parseQboTransactions, payloadBalances, portalTbCsv, previewPull, pushPeriod, qboAlerts, qboOf, saveConnection, setMapping, suggestAccount, summaryKindOf, unmappedAccounts,
} from './qbo';
import { createJournal, fromTemplate } from './journals';
import { PermissionError } from './permissions';
import type { User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  b.createTransaction(cfo, { date: '2026-09-01', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  // October activity at HM11: a POS day (sales + card), a fuel invoice paid, a utility bill paid by Corporate.
  b.createTransaction(cfo, { date: '2026-10-10', kind: 'journal', description: 'POS close HM11', tags: ['pos'], lines: [
    { accountId: 'acct_craddock', storeId: 'st_hm11', debit: 300_000, credit: 0 }, { accountId: 'acct_fuel_regular', storeId: 'st_hm11', debit: 0, credit: 250_000 }, { accountId: 'acct_sales_grocery', storeId: 'st_hm11', debit: 0, credit: 50_000 }] });
  b.createTransaction(cfo, { date: '2026-10-12', kind: 'journal', description: 'Craddock notice', tags: ['fuel'], lines: [
    { accountId: 'acct_cogs_fuel', storeId: 'st_hm11', debit: 200_000, credit: 0 }, { accountId: 'acct_card_fees', storeId: 'st_hm11', debit: 6_000, credit: 0 }, { accountId: 'acct_craddock', storeId: 'st_hm11', debit: 0, credit: 206_000 }] });
  b.createTransaction(cfo, { date: '2026-10-31', kind: 'money_out', description: 'ENTERGY HM11', partyId: 'pt_entergy', lines: [
    { accountId: 'acct_utilities', storeId: 'st_hm11', debit: 45_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 45_000 }] });
  loadQboLists(b, cfo, {
    accounts: s.accounts.filter((a) => a.id !== 'acct_over_short').map((a) => ({ name: a.name.replace(/ – /g, ':'), type: a.type as string })).concat([{ name: 'Cash Over/Short', type: 'Expense' }]),
    classes: ['HM11 Gluckstadt', 'HM13 Meadville', 'CORP Corporate'], vendors: ['Entergy Mississippi LLC', 'Craddock Oil'], customers: [],
  });
  return { s, b, cfo, bk: u('bookkeeper'), owner: u('owner'), reviewer: u('reviewer') };
};

describe('connections', () => {
  it('every entity shows "not connected — needs hosted back end"; the API connector refuses, the file connector parses', () => {
    const { s, b, cfo, reviewer } = setup();
    expect(connectionStatus(s).every((c) => /needs hosted back end/.test(c.label) && !c.live)).toBe(true);
    expect(() => API_CONNECTOR.parseTrialBalance('x')).toThrow(/hosted back end/);
    expect(FILE_CONNECTOR.parseTrialBalance(',Debit,Credit\nCash,1.00,\nEquity,,1.00\n').rows.length).toBe(2);
    expect(() => saveConnection(b, reviewer, 'ent_hm11', { companyName: 'x' })).toThrow(PermissionError);
    saveConnection(b, cfo, 'ent_hm11', { companyName: 'HM11 books', closedThrough: '2026-08-31' });
    expect(qboOf(s).log.at(-1)!.kind).toBe('connection');
  });
});

describe('mapping', () => {
  it('suggests by number or by name; flags what is unmapped', () => {
    const { s, b, cfo } = setup();
    expect(nameScore('Cash over / short', 'Cash Over/Short')).toBe(1);
    expect(nameScore('Fuel received, not invoiced', 'Fuel inventory')).toBeLessThan(0.5);
    const os = s.accounts.find((a) => a.id === 'acct_over_short')!;
    expect(suggestAccount(s, os)).toEqual({ name: 'Cash Over/Short', score: 1 });
    expect(unmappedAccounts(s).length).toBe(s.accounts.filter((a) => a.active).length);
    expect(acceptSuggestions(b, cfo, 'accounts')).toBe(s.accounts.filter((a) => a.active).length);
    expect(unmappedAccounts(s)).toEqual([]);
    expect(acceptSuggestions(b, cfo, 'classes')).toBe(3);
    expect(mappingStatus(s).unmappedClasses).toBe(3);
    expect(mappingStatus(s).classes.find((r) => r.item.id === 'st_hm11')!.mapped).toBe('HM11 Gluckstadt');
    acceptSuggestions(b, cfo, 'parties');
    expect(qboOf(s).mappings.parties.pt_entergy?.name).toBe('Entergy Mississippi LLC');
    setMapping(b, cfo, 'accounts', 'acct_over_short', null);
    expect(unmappedAccounts(s).map((a) => a.id)).toEqual(['acct_over_short']);
    expect(() => setMapping(b, cfo, 'accounts', 'acct_over_short', 'Not in QBO')).toThrow(/isn't in the QBO list/);
  });
});

describe('push', () => {
  it('summaries by priority; every payload balances; JE payloads per entity; unmapped accounts block', () => {
    const { s, b, cfo } = setup();
    acceptSuggestions(b, cfo, 'accounts');
    acceptSuggestions(b, cfo, 'classes');
    const pos = s.transactions.find((t) => t.description === 'POS close HM11')!;
    expect(summaryKindOf(s, pos)).toBe('sales');
    expect(summaryKindOf(s, s.transactions.find((t) => t.description === 'Craddock notice')!)).toBe('fuel_cogs');
    expect(summaryKindOf(s, s.transactions.find((t) => t.description === 'ENTERGY HM11')!)).toBeNull();
    createJournal(b, cfo, fromTemplate(s, 'accr_utilities', { date: '2026-10-31', stores: ['st_hm11'], amounts: [13_800] }));
    const ps = buildPayloads(s, 'ent_hm11', { periods: ['2026-10'] });
    expect(ps.map((p) => p.kind)).toEqual(['sales', 'fuel_cogs', 'je']);
    for (const p of ps) expect(payloadBalances(p), p.docNumber).toBe(true);
    expect(ps.every((p) => p.status === 'ready')).toBe(true);
    setMapping(b, cfo, 'accounts', 'acct_accrued_exp', null);
    const blocked = buildPayloads(s, 'ent_hm11', { periods: ['2026-10'] }).find((p) => p.kind === 'je')!;
    expect(blocked.status).toBe('blocked');
    expect(blocked.errors[0]).toMatch(/Map 2120/);
    const r = pushPeriod(b, cfo, 'ent_hm11', '2026-10');
    expect(r.pushed.map((p) => p.kind)).toEqual(['sales', 'fuel_cogs']);
    expect(r.blocked.length).toBe(1);
    expect(r.pushed.every((p) => /^QBO-HM11-\d{5}$/.test(p.push!.qboId))).toBe(true);
    expect(r.csv.split('\n')[0]).toBe('JournalNo,JournalDate,AccountName,Debits,Credits,Description,Name,Class');
    expect(r.csv).toContain('HM11-SALES-2026-10,10/31/2026');
    expect(qboOf(s).log.at(-1)).toMatchObject({ kind: 'push', errors: [expect.stringMatching(/2120/)] });
  });
  it('is idempotent; a changed entry is re-sent under the same QBO id', () => {
    const { s, b, cfo } = setup();
    acceptSuggestions(b, cfo, 'accounts');
    const first = pushPeriod(b, cfo, 'ent_hm11', '2026-10');
    const again = pushPeriod(b, cfo, 'ent_hm11', '2026-10');
    expect(again.pushed).toEqual([]);
    expect(qboOf(s).pushes.length).toBe(first.pushed.length);
    b.createTransaction(cfo, { date: '2026-10-20', kind: 'journal', description: 'POS close HM11 2', tags: ['pos'], lines: [
      { accountId: 'acct_craddock', storeId: 'st_hm11', debit: 10_000, credit: 0 }, { accountId: 'acct_fuel_regular', storeId: 'st_hm11', debit: 0, credit: 10_000 }] });
    const sales = buildPayloads(s, 'ent_hm11', { periods: ['2026-10'] }).find((p) => p.kind === 'sales')!;
    expect(sales.status).toBe('changed');
    const id = sales.push!.qboId;
    const third = pushPeriod(b, cfo, 'ent_hm11', '2026-10');
    expect(third.pushed.map((p) => p.push!.qboId)).toEqual([id]);
    expect(third.log.items![0].detail).toMatch(/Updated/);
  });
  it('never pushes into a locked month or before QBO\'s closing date; needs qbo.sync', () => {
    const { s, b, cfo, owner } = setup();
    acceptSuggestions(b, cfo, 'accounts');
    expect(() => pushPeriod(b, owner, 'ent_hm11', '2026-10')).toThrow(PermissionError);
    b.lockPeriod(cfo, '2026-10');
    expect(() => pushPeriod(b, cfo, 'ent_hm11', '2026-10')).toThrow(/locked/);
    expect(qboOf(s).pushes).toEqual([]);
    expect(qboOf(s).log.at(-1)!.kind).toBe('error');
    b.unlockPeriod(cfo, '2026-10', 'push first');
    saveConnection(b, cfo, 'ent_hm11', { closedThrough: '2026-10-31' });
    expect(() => pushPeriod(b, cfo, 'ent_hm11', '2026-10')).toThrow(/closed through/);
    const csv = journalCsv(s, buildPayloads(s, 'ent_hm11', { periods: ['2026-10'] }));
    expect(csv.split('\n').length).toBeGreaterThan(3);
  });
});

describe('pull', () => {
  const csv = [
    'Transaction List by Date', '',
    'Date,Transaction Type,Num,Name,Memo/Description,Account,Split,Amount',
    '10/31/2026,Expense,,Entergy Mississippi LLC,October power,Trustmark operating,Utilities,-450.00',
    '10/28/2026,Check,4300,Petroleum equipment repair,Pump repair,Trustmark operating,Repairs & maintenance,-612.50',
    '10/29/2026,Bill,B-77,Grocery wholesaler,,Accounts payable,-Split-,-300.00',
    'TOTAL,,,,,,,-1362.50',
  ].join('\n');
  it('parses a QBO export, skipping totals', () => {
    const p = parseQboTransactions(csv);
    expect(p.rows.length).toBe(3);
    expect(p.rows[1]).toMatchObject({ date: '2026-10-28', type: 'Check', num: '4300', amount: -61_250, account: 'Trustmark operating', split: 'Repairs & maintenance' });
  });
  it('de-duplicates against the portal (same date, amount, payee), posts new rows, holds unmappable ones; idempotent', () => {
    const { s, b, cfo } = setup();
    acceptSuggestions(b, cfo, 'accounts');
    acceptSuggestions(b, cfo, 'parties');
    const rows = parseQboTransactions(csv).rows;
    const pv = previewPull(s, 'ent_corp', rows);
    expect(pv.rows.map((r) => r.status)).toEqual(['duplicate', 'new', 'held']);
    expect(pv.rows[0].txnId).toBe(s.transactions.find((t) => t.description === 'ENTERGY HM11')!.id);
    expect(pv.totalOut).toBe(136_250);
    const n = s.transactions.length;
    const r = commitPull(b, cfo, 'ent_corp', { name: 'qbo.csv', rows });
    expect(r.posted.length).toBe(1);
    expect(s.transactions.length).toBe(n + 1);
    const t = r.posted[0];
    expect(t).toMatchObject({ source: 'import', batchId: r.batchId, checkNo: '4300', kind: 'money_out' });
    expect(t.lines.find((l) => l.accountId === 'acct_repairs')!.debit).toBe(61_250);
    expect(qboOf(s).pulled.map((p) => p.status)).toEqual(['duplicate', 'posted', 'held']);
    expect(qboOf(s).pulled.every((p) => p.batchId === r.batchId)).toBe(true);
    const again = commitPull(b, cfo, 'ent_corp', { name: 'qbo.csv', rows });
    expect(again.posted).toEqual([]);
    expect(again.preview.counts.already).toBe(3);
    expect(s.transactions.length).toBe(n + 1);
    // A pulled entry is QBO's own: never pushed back.
    expect(buildPayloads(s, 'ent_corp').some((p) => p.sourceTxnIds.includes(t.id))).toBe(false);
  });
});

describe('QBO trial balance and differences', () => {
  it('imports idempotently, checks it balances, and replaces an earlier version', () => {
    const { s, b, cfo } = setup();
    acceptSuggestions(b, cfo, 'accounts');
    const text = portalTbCsv(s, 'ent_hm11', '2026-10');
    const parsed = parseQboTb(text);
    expect(parsed.asOf).toBe('2026-10-31');
    expect(parsed.totalDebit).toBe(parsed.totalCredit);
    const a = importQboTb(b, cfo, { entityId: 'ent_hm11', period: '2026-10', fileName: 'tb.csv', parsed });
    expect(a.added).toBe(true);
    expect(importQboTb(b, cfo, { entityId: 'ent_hm11', period: '2026-10', fileName: 'tb.csv', parsed }).added).toBe(false);
    expect(qboOf(s).trialBalances.length).toBe(1);
    expect(() => importQboTb(b, cfo, { entityId: 'ent_hm11', period: '2026-09', fileName: 'tb.csv', parsed })).toThrow(/not 2026-09/);
    const bad = parseQboTb(',Debit,Credit\nCash,10.00,\nEquity,,9.00\n');
    expect(() => importQboTb(b, cfo, { entityId: 'ent_hm11', period: '2026-10', fileName: 'x.csv', parsed: bad })).toThrow(/doesn't balance/);
    const v2 = parseQboTb(portalTbCsv(s, 'ent_hm11', '2026-10', (m) => { m.set('Utilities', (m.get('Utilities') ?? 0) + 100); m.set('Accounts payable', (m.get('Accounts payable') ?? 0) - 100); }));
    importQboTb(b, cfo, { entityId: 'ent_hm11', period: '2026-10', fileName: 'tb2.csv', parsed: v2 });
    expect(qboOf(s).trialBalances.filter((t) => !t.superseded).length).toBe(1);
    expect(differencesReport(s, 'ent_hm11', '2026-10').differences.length).toBe(2);
  });
  it('explains differences: unmapped account, entry not pushed, timing', () => {
    const { s, b, cfo } = setup();
    acceptSuggestions(b, cfo, 'accounts');
    pushPeriod(b, cfo, 'ent_hm11', '2026-10');
    createJournal(b, cfo, fromTemplate(s, 'accr_utilities', { date: '2026-10-31', stores: ['st_hm11'], amounts: [13_800] }));
    b.createTransaction(cfo, { date: '2026-10-25', kind: 'journal', description: 'Over/short HM11', lines: [{ accountId: 'acct_over_short', storeId: 'st_hm11', debit: 1_234, credit: 0 }, { accountId: 'acct_cash_registers', storeId: 'st_hm11', debit: 0, credit: 1_234 }] });
    setMapping(b, cfo, 'accounts', 'acct_over_short', null);
    // QBO: has everything except the accrual; cash over/short in its own account; the Entergy bill dated 1 Nov.
    const text = portalTbCsv(s, 'ent_hm11', '2026-10', (m) => {
      m.set('Utilities', (m.get('Utilities') ?? 0) - 13_800 - 45_000);
      m.set('Accrued expenses', (m.get('Accrued expenses') ?? 0) + 13_800);
      m.set('Due to related entities', (m.get('Due to related entities') ?? 0) + 45_000);
      m.set('Cash Over/Short', m.get('6340 Cash over / short')!);
      m.delete('6340 Cash over / short');
    });
    importQboTb(b, cfo, { entityId: 'ent_hm11', period: '2026-10', fileName: 'tb.csv', parsed: parseQboTb(text) });
    const d = differencesReport(s, 'ent_hm11', '2026-10');
    const row = (label: string) => d.differences.find((r) => r.label === label)!;
    expect(row('6340 Cash over / short')).toMatchObject({ cause: 'unmapped', difference: 1_234 });
    expect(row('6340 Cash over / short').explanation).toMatch(/Cash Over\/Short/);
    expect(row('Cash Over/Short')).toMatchObject({ cause: 'unmapped', difference: -1_234 });
    expect(row('Accrued expenses')).toMatchObject({ cause: 'not_pushed', difference: -13_800 });
    expect(row('Due to related entities')).toMatchObject({ cause: 'timing', difference: -45_000 });
    expect(row('Utilities').cause).toBe('unexplained');
    expect(d.over.length).toBe(d.differences.length);
    expect(d.allExplained).toBe(false);
    expect(qboAlerts(s)[0]).toMatchObject({ entityId: 'ent_hm11', period: '2026-10' });
  });
  it('under $5 is not an alert', () => {
    const { s, b, cfo } = setup();
    acceptSuggestions(b, cfo, 'accounts');
    pushPeriod(b, cfo, 'ent_hm11', '2026-10');
    const text = portalTbCsv(s, 'ent_hm11', '2026-10', (m) => { m.set('Utilities', (m.get('Utilities') ?? 0) + 400); m.set('Due to related entities', (m.get('Due to related entities') ?? 0) - 400); });
    importQboTb(b, cfo, { entityId: 'ent_hm11', period: '2026-10', fileName: 'tb.csv', parsed: parseQboTb(text) });
    expect(differencesReport(s, 'ent_hm11', '2026-10').differences.length).toBe(2);
    expect(qboAlerts(s)).toEqual([]);
  });
  it('validation errors are sentences', () => {
    const { b, cfo } = setup();
    expect(() => importQboTb(b, cfo, { entityId: 'nope', period: '2026-10', fileName: 'x', parsed: parseQboTb('') })).toThrow(ValidationError);
  });
});

describe('demo QBO', () => {
  const s = buildDemo();
  it('mostly mapped with two unmapped accounts; September and October pushed except one accrual', () => {
    expect(unmappedAccounts(s).map((a) => a.number)).toEqual(['2130', '6340']);
    const hm11 = buildPayloads(s, 'ent_hm11', { periods: ['2026-09', '2026-10'] });
    expect(hm11.filter((p) => p.status !== 'pushed').map((p) => p.kind)).toEqual(['je']);
    for (const e of s.entities) for (const p of buildPayloads(s, e.id)) expect(payloadBalances(p), p.docNumber).toBe(true);
    expect(qboOf(s).pulled.every((p) => p.status === 'duplicate')).toBe(true);
    expect(qboOf(s).log.some((l) => l.kind === 'push' && l.items!.length)).toBe(true);
  });
  it('HM11 October: two differences, both explained, alerting over $5', () => {
    const d = differencesReport(s, 'ent_hm11', '2026-10');
    expect(d.tb).toBeDefined();
    expect(d.allExplained).toBe(true);
    expect(d.byCause.not_pushed.count).toBe(2);
    expect(d.byCause.unmapped.count).toBe(2);
    expect(d.byCause.not_pushed.amount).toBe(0);
    expect(d.byCause.unmapped.amount).toBe(0);
    expect(qboAlerts(s).map((a) => a.entityId)).toEqual(['ent_hm11']);
  });
});
