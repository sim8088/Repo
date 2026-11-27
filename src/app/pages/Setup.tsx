import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { isSnapshot } from '../../data/stationbooks';
import { AccountOptions, Errors, Help, PageHead, PartyOptions, useToast } from '../components/ui';
import { ValidationError } from '../../core/books';
import { can, ROLE_LABEL, ROLE_SUMMARY, permissionsFor } from '../../core/permissions';
import { ruleConfidence } from '../../core/rules';
import { parseMoney, formatMoney } from '../../core/money';
import type { Entity, Party, PartyType, Role, Rule, Store, TaxClass, User } from '../../core/types';
import type { HelpKey } from '../help';

/** Shared edit-panel scaffolding for setup records. */
function useEditor<T>(save: (v: T) => void) {
  const [item, setItem] = useState<T | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, say] = useToast();
  const commit = (label: string) => {
    if (!item) return;
    try { save(item); setItem(null); setErrors([]); say(`Saved ${label}.`); } catch (e) { setErrors(e instanceof ValidationError ? e.errors : [(e as Error).message]); }
  };
  return { item, setItem, errors, setErrors, toast, commit, say };
}

function EditPanel({ title, errors, onSave, onCancel, children }: { title: string; errors: string[]; onSave: () => void; onCancel: () => void; children: ReactNode }) {
  return (
    <section className="panel panel-pad" style={{ marginBottom: 20 }} aria-label={title}>
      <h2 style={{ marginBottom: 12 }}>{title}</h2>
      <Errors errors={errors} />
      <div className="form-grid" style={{ marginTop: errors.length ? 12 : 0 }}>{children}</div>
      <div className="actions" style={{ marginTop: 14 }}><button className="btn primary" onClick={onSave}>Save</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </section>
  );
}

function Page({ title, lede, help, action, children }: { title: string; lede: string; help: HelpKey; action?: ReactNode; children: ReactNode }) {
  return (<><PageHead eyebrow="Setup" title={title} lede={lede}>{action}</PageHead>{children}<Help k={help} /></>);
}

const TAX: Record<TaxClass, string> = { partnership_1065: 'Partnership (1065)', s_corp_1120s: 'S corp (1120-S)', c_corp_1120: 'C corp (1120)', disregarded: 'Disregarded entity' };

export function StoresPage() {
  const { state, books, user } = useBooks();
  const ed = useEditor<Store>((s) => books.saveStore(user, s));
  const s = ed.item;
  const ent = (id: string) => state.entities.find((e) => e.id === id);
  return (
    <Page title="Stores" lede="Locations and how each one runs. Add a store here; nothing else needs to change." help="stores"
      action={can(user, 'setup.edit') && <button className="btn primary" onClick={() => ed.setItem({ id: books.nextId('st'), code: '', name: '', entityId: state.entities[0]?.id ?? '', kind: 'operating', fuelSupplier: 'craddock', payroll: 'gusto', hasKitchen: false, hasTruckLane: false })}>Add store</button>}>
      {s && (
        <EditPanel title={s.code ? `Edit ${s.code}` : 'New store'} errors={ed.errors} onSave={() => ed.commit(s.code)} onCancel={() => ed.setItem(null)}>
          <div className="field"><label htmlFor="s-code">Code</label><input id="s-code" value={s.code} onChange={(e) => ed.setItem({ ...s, code: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label htmlFor="s-name">Name</label><input id="s-name" value={s.name} onChange={(e) => ed.setItem({ ...s, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="s-ent">Owning entity</label><select id="s-ent" value={s.entityId} onChange={(e) => ed.setItem({ ...s, entityId: e.target.value })}>{state.entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></div>
          <div className="field"><label htmlFor="s-kind">Kind</label><select id="s-kind" value={s.kind} onChange={(e) => ed.setItem({ ...s, kind: e.target.value as Store['kind'] })}><option value="operating">Operating store</option><option value="leased_out">Leased out (rent only)</option><option value="corporate">Corporate</option></select></div>
          <div className="field"><label htmlFor="s-fuel">Fuel supplier</label><select id="s-fuel" value={s.fuelSupplier} onChange={(e) => ed.setItem({ ...s, fuelSupplier: e.target.value as Store['fuelSupplier'] })}><option value="craddock">Craddock (netted EFT notices)</option><option value="dash">Dash Oil (clearing)</option><option value="none">None</option></select></div>
          <div className="field"><label htmlFor="s-pay">Payroll</label><select id="s-pay" value={s.payroll} onChange={(e) => ed.setItem({ ...s, payroll: e.target.value as Store['payroll'] })}><option value="gusto">Gusto</option><option value="cash">Cash</option><option value="mixed">Gusto + cash/check</option><option value="none">None</option></select></div>
          <div className="field"><label htmlFor="s-open">Opened</label><input id="s-open" type="date" value={s.openedOn ?? ''} onChange={(e) => ed.setItem({ ...s, openedOn: e.target.value || undefined })} /></div>
          <label className="check"><input type="checkbox" checked={s.hasKitchen} onChange={(e) => ed.setItem({ ...s, hasKitchen: e.target.checked })} /> Kitchen</label>
          <label className="check"><input type="checkbox" checked={s.hasTruckLane} onChange={(e) => ed.setItem({ ...s, hasTruckLane: e.target.checked })} /> Truck lane</label>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="s-notes">Notes</label><input id="s-notes" value={s.notes ?? ''} onChange={(e) => ed.setItem({ ...s, notes: e.target.value })} /></div>
        </EditPanel>
      )}
      <section className="panel"><div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Entity</th><th scope="col">Kind</th><th scope="col">Fuel</th><th scope="col">Payroll</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
        <tbody>{state.stores.filter((x) => !x.deleted).map((x) => (
          <tr key={x.id}><td><b>{x.code}</b></td><td><Link to={`/reports/pnl?store=${x.id}`}>{x.name}</Link></td><td>{ent(x.entityId)?.code}</td><td>{x.kind.replace('_', ' ')}</td><td>{x.fuelSupplier}</td><td>{x.payroll}</td><td className="trunc" title={x.notes}>{x.notes}</td>
            <td>{can(user, 'setup.edit') && <button className="btn sm ghost" aria-label={`Edit ${x.code}`} onClick={() => ed.setItem({ ...x })}>Edit</button>}</td></tr>
        ))}</tbody>
      </table></div></section>
      {ed.toast}
    </Page>
  );
}

export function EntitiesPage() {
  const { state, books, user } = useBooks();
  const ed = useEditor<Entity>((e) => books.saveEntity(user, e));
  const e = ed.item;
  return (
    <Page title="Entities" lede="Each LLC keeps its own books. Store entities settle intercompany through the hub." help="entities"
      action={can(user, 'setup.edit') && <button className="btn primary" onClick={() => ed.setItem({ id: books.nextId('ent'), code: '', name: '', taxClass: 'disregarded' })}>Add entity</button>}>
      {e && (
        <EditPanel title={e.code ? `Edit ${e.code}` : 'New entity'} errors={ed.errors} onSave={() => ed.commit(e.code)} onCancel={() => ed.setItem(null)}>
          <div className="field"><label htmlFor="e-code">Code</label><input id="e-code" value={e.code} onChange={(x) => ed.setItem({ ...e, code: x.target.value.toUpperCase() })} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="e-name">Legal name</label><input id="e-name" value={e.name} onChange={(x) => ed.setItem({ ...e, name: x.target.value })} /></div>
          <div className="field"><label htmlFor="e-tax">Tax classification</label><select id="e-tax" value={e.taxClass} onChange={(x) => ed.setItem({ ...e, taxClass: x.target.value as TaxClass })}>{Object.entries(TAX).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="e-ein">EIN</label><input id="e-ein" value={e.ein ?? ''} placeholder="12-3456789" onChange={(x) => ed.setItem({ ...e, ein: x.target.value })} /></div>
          <label className="check"><input type="checkbox" checked={!!e.isHub} onChange={(x) => ed.setItem({ ...e, isHub: x.target.checked })} /> Intercompany hub</label>
        </EditPanel>
      )}
      <section className="panel"><div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Code</th><th scope="col">Legal name</th><th scope="col">Tax classification</th><th scope="col">Stores</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
        <tbody>{state.entities.filter((x) => !x.deleted).map((x) => (
          <tr key={x.id}><td><b>{x.code}</b>{x.isHub && <span className="pill" style={{ marginLeft: 6 }}>hub</span>}</td><td><Link to={`/reports/trial-balance?entity=${x.id}`}>{x.name}</Link></td><td>{TAX[x.taxClass]}</td><td>{state.stores.filter((s) => s.entityId === x.id && !s.deleted).map((s) => s.code).join(', ')}</td>
            <td>{can(user, 'setup.edit') && <button className="btn sm ghost" aria-label={`Edit ${x.code}`} onClick={() => ed.setItem({ ...x })}>Edit</button>}</td></tr>
        ))}</tbody>
      </table></div></section>
      {ed.toast}
    </Page>
  );
}

const PARTY_TYPES: Record<PartyType, string> = { vendor: 'Vendor', related_company: 'Related company', owner: 'Owner', tenant: 'Tenant', lender: 'Lender', customer: 'Customer' };

export function PartiesPage() {
  const { state, books, user, stores } = useBooks();
  const ed = useEditor<Party>((p) => books.saveParty(user, p));
  const [filter, setFilter] = useState('');
  const p = ed.item;
  return (
    <Page title="Vendors & parties" lede="Everyone money moves to or from: vendors, related companies, owners, tenants and lenders." help="parties"
      action={can(user, 'setup.edit') && <button className="btn primary" onClick={() => ed.setItem({ id: books.nextId('pt'), name: '', type: 'vendor' })}>Add party</button>}>
      {p && (
        <EditPanel title={p.name ? `Edit ${p.name}` : 'New party'} errors={ed.errors} onSave={() => ed.commit(p.name)} onCancel={() => ed.setItem(null)}>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="p-name">Name</label><input id="p-name" value={p.name} onChange={(e) => ed.setItem({ ...p, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="p-type">Type</label><select id="p-type" value={p.type} onChange={(e) => ed.setItem({ ...p, type: e.target.value as PartyType })}>{Object.entries(PARTY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="p-acct">Default account</label><select id="p-acct" value={p.defaultAccountId ?? ''} onChange={(e) => ed.setItem({ ...p, defaultAccountId: e.target.value || undefined })}><option value="">None</option><AccountOptions /></select></div>
          <div className="field"><label htmlFor="p-store">Default store</label><select id="p-store" value={p.defaultStoreId ?? ''} onChange={(e) => ed.setItem({ ...p, defaultStoreId: e.target.value || undefined })}><option value="">None</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
          <label className="check"><input type="checkbox" checked={!!p.is1099} onChange={(e) => ed.setItem({ ...p, is1099: e.target.checked })} /> Gets a 1099</label>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="p-notes">Notes</label><input id="p-notes" value={p.notes ?? ''} onChange={(e) => ed.setItem({ ...p, notes: e.target.value })} /></div>
        </EditPanel>
      )}
      <section className="panel">
        <div className="filters"><div className="field"><label htmlFor="p-filter">Type</label><select id="p-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All</option>{Object.entries(PARTY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Default account</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
          <tbody>{state.parties.filter((x) => !x.deleted && (!filter || x.type === filter)).sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
            <tr key={x.id}><td><Link to={`/books/transactions?party=${x.id}`}>{x.name}</Link>{x.is1099 && <span className="pill" style={{ marginLeft: 6 }}>1099</span>}</td><td>{PARTY_TYPES[x.type]}</td><td>{state.accounts.find((a) => a.id === x.defaultAccountId)?.name}</td><td className="trunc" title={x.notes}>{x.notes}</td>
              <td>{can(user, 'setup.edit') && <button className="btn sm ghost" aria-label={`Edit ${x.name}`} onClick={() => ed.setItem({ ...x })}>Edit</button>}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      {ed.toast}
    </Page>
  );
}

export function RulesPage() {
  const { state, books, user, stores } = useBooks();
  const ed = useEditor<Rule>((r) => books.saveRule(user, r));
  const r = ed.item;
  return (
    <Page title="Rules" lede="If a bank description contains this text, suggest this category and store. Rules learn from every correction." help="rules"
      action={can(user, 'setup.edit') && <button className="btn primary" onClick={() => ed.setItem({ id: books.nextId('rule'), contains: '', accountId: '', storeId: 'st_corp', origin: 'manual', hits: 0, overrides: 0, createdAt: new Date().toISOString(), active: true })}>Add rule</button>}>
      {r && (
        <EditPanel title={r.contains ? `Edit “${r.contains}”` : 'New rule'} errors={ed.errors} onSave={() => (r.accountId ? ed.commit(`rule “${r.contains}”`) : ed.setErrors(['Choose the category this rule should suggest.']))} onCancel={() => ed.setItem(null)}>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="r-text">Description contains</label><input id="r-text" value={r.contains} onChange={(e) => ed.setItem({ ...r, contains: e.target.value.toUpperCase() })} placeholder="ENTERGY MS 4410" /></div>
          <div className="field"><label htmlFor="r-acct">Category</label><select id="r-acct" value={r.accountId} onChange={(e) => ed.setItem({ ...r, accountId: e.target.value })}><option value="">Choose…</option><AccountOptions /></select></div>
          <div className="field"><label htmlFor="r-store">Store</label><select id="r-store" value={r.storeId} onChange={(e) => ed.setItem({ ...r, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
          <div className="field"><label htmlFor="r-party">Party</label><select id="r-party" value={r.partyId ?? ''} onChange={(e) => ed.setItem({ ...r, partyId: e.target.value || undefined })}><option value="">None</option><PartyOptions /></select></div>
          <label className="check"><input type="checkbox" checked={r.active} onChange={(e) => ed.setItem({ ...r, active: e.target.checked })} /> Active</label>
        </EditPanel>
      )}
      <section className="panel"><div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Contains</th><th scope="col">Category</th><th scope="col">Store</th><th scope="col">Origin</th><th scope="col" className="num">Accepted</th><th scope="col" className="num">Changed</th><th scope="col" className="num">Confidence</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
        <tbody>{state.rules.map((x) => {
          const c = ruleConfidence(x);
          return (
            <tr key={x.id}><td><code>{x.contains}</code>{!x.active && <span className="pill" style={{ marginLeft: 6 }}>off</span>}</td><td>{state.accounts.find((a) => a.id === x.accountId)?.name}</td><td>{state.stores.find((s) => s.id === x.storeId)?.code}</td><td>{x.origin}</td><td className="num">{x.hits}</td><td className="num">{x.overrides}</td>
              <td className="num"><span className={'pill ' + (c >= 0.75 ? 'ok' : 'warn')}>{Math.round(c * 100)}%</span></td>
              <td>{can(user, 'setup.edit') && <button className="btn sm ghost" aria-label={`Edit rule ${x.contains}`} onClick={() => ed.setItem({ ...x })}>Edit</button>}</td></tr>
          );
        })}</tbody>
      </table></div></section>
      {ed.toast}
    </Page>
  );
}

export function UsersPage() {
  const { state, books, user, stores } = useBooks();
  const ed = useEditor<User>((u) => books.saveUser(user, u));
  const u = ed.item;
  const roles = Object.keys(ROLE_LABEL) as Role[];
  return (
    <Page title="Users & roles" lede="Who can do what. Store managers see only their own store." help="users"
      action={can(user, 'users.edit') && <button className="btn primary" onClick={() => ed.setItem({ id: books.nextId('usr'), name: '', role: 'bookkeeper', active: true })}>Add user</button>}>
      {u && (
        <EditPanel title={u.name ? `Edit ${u.name}` : 'New user'} errors={ed.errors} onSave={() => ed.commit(u.name)} onCancel={() => ed.setItem(null)}>
          <div className="field"><label htmlFor="u-name">Name</label><input id="u-name" value={u.name} onChange={(e) => ed.setItem({ ...u, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-role">Role</label><select id="u-role" value={u.role} onChange={(e) => ed.setItem({ ...u, role: e.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select><span className="hint">{ROLE_SUMMARY[u.role]}</span></div>
          {u.role === 'store_manager' && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Stores</legend>
              {stores.filter((s) => s.kind !== 'corporate').map((s) => <label key={s.id} className="check" style={{ marginRight: 12 }}><input type="checkbox" checked={u.storeIds?.includes(s.id) ?? false} onChange={(e) => ed.setItem({ ...u, storeIds: e.target.checked ? [...(u.storeIds ?? []), s.id] : (u.storeIds ?? []).filter((x) => x !== s.id) })} />{s.code}</label>)}
            </fieldset>
          )}
          <label className="check"><input type="checkbox" checked={u.active} onChange={(e) => ed.setItem({ ...u, active: e.target.checked })} /> Active</label>
        </EditPanel>
      )}
      <section className="panel"><div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Stores</th><th scope="col">Can</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
        <tbody>{state.users.map((x) => (
          <tr key={x.id}><td>{x.name}{!x.active && <span className="pill" style={{ marginLeft: 6 }}>inactive</span>}{x.id === user.id && <span className="pill ok" style={{ marginLeft: 6 }}>you</span>}</td><td>{ROLE_LABEL[x.role]}</td><td>{x.role === 'store_manager' ? x.storeIds?.map((id) => state.stores.find((s) => s.id === id)?.code).join(', ') : 'All'}</td><td className="small">{ROLE_SUMMARY[x.role]}</td>
            <td>{can(user, 'users.edit') && <button className="btn sm ghost" aria-label={`Edit ${x.name}`} onClick={() => ed.setItem({ ...x })}>Edit</button>}</td></tr>
        ))}</tbody>
      </table></div></section>
      <section className="panel" style={{ marginTop: 20 }} aria-labelledby="perm-h"><div className="panel-head"><h2 id="perm-h">Permission matrix</h2></div><div className="table-wrap"><table className="t">
        <thead><tr><th scope="col">Permission</th>{roles.map((r) => <th scope="col" key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
        <tbody>{permissionsFor('cfo').map((p) => <tr key={p}><td><code>{p}</code></td>{roles.map((r) => <td key={r}>{permissionsFor(r).includes(p) ? <span className="pos" aria-label="yes">✓</span> : <span className="muted" aria-label="no">–</span>}</td>)}</tr>)}</tbody>
      </table></div></section>
      {ed.toast}
    </Page>
  );
}

export function AuditPage() {
  const { state } = useBooks();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => [...state.audit].reverse().filter((a) => (!type || a.objectType === type) && (!q || `${a.summary} ${a.reason ?? ''}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 500), [state.audit, q, type]);
  const userName = (id: string) => state.users.find((u) => u.id === id)?.name ?? id;
  const types = [...new Set(state.audit.map((a) => a.objectType))].sort();
  return (
    <Page title="Audit log" lede="Every change, who made it, when, the before and after, and why. Entries can't be edited or removed." help="audit">
      <section className="panel">
        <div className="filters">
          <div className="field wide"><label htmlFor="au-q">Search</label><input id="au-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field"><label htmlFor="au-t">Type</label><select id="au-t" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        </div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Why</th><th scope="col"><span className="sr-only">Detail</span></th></tr></thead>
          <tbody>{rows.map((a) => (
            <Fragment key={a.id}>
              <tr><td style={{ whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</td><td>{userName(a.userId)}</td>
                <td>{a.objectType === 'transaction' ? <Link to={`/books/transactions/${a.objectId}`}>{a.summary}</Link> : a.summary}</td><td>{a.reason}</td>
                <td>{(a.before !== undefined || a.after !== undefined) && <button className="btn sm ghost" aria-expanded={openId === a.id} onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? 'Hide' : 'Before / after'}</button>}</td></tr>
              {openId === a.id && <tr><td colSpan={5}><div className="grid-2"><div><b className="small">Before</b><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(a.before, null, 1) ?? '—'}</pre></div><div><b className="small">After</b><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(a.after, null, 1) ?? '—'}</pre></div></div></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
        <div className="tieout"><span className="muted">{state.audit.length.toLocaleString('en-US')} entries{rows.length === 500 && ' · showing the latest 500'}</span></div>
      </section>
    </Page>
  );
}

export function SettingsPage() {
  const { state, books, user, resetDemo, loadStationBooks } = useBooks();
  const [s, setS] = useState(state.settings);
  const [toast, say] = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const edit = can(user, 'setup.edit');
  return (
    <Page title="Settings" lede="Company-wide rules the books follow." help="settings">
      <section className="panel panel-pad">
        <div className="form-grid">
          <div className="field"><label htmlFor="st-name">Company name</label><input id="st-name" disabled={!edit} value={s.companyName} onChange={(e) => setS({ ...s, companyName: e.target.value })} /></div>
          <div className="field"><label htmlFor="st-fy">Fiscal year starts</label><select id="st-fy" disabled={!edit} value={s.fiscalYearStartMonth} onChange={(e) => setS({ ...s, fiscalYearStartMonth: Number(e.target.value) })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(Date.UTC(2026, i, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}</option>)}</select></div>
          <div className="field"><label htmlFor="st-mat">Materiality</label><input id="st-mat" disabled={!edit} className="num" value={(s.materialityCents / 100).toFixed(2)} onChange={(e) => setS({ ...s, materialityCents: parseMoney(e.target.value) ?? s.materialityCents })} /><span className="hint">Differences under this are ignored; at or above are flagged.</span></div>
          <div className="field"><label htmlFor="st-je">Journal approval above</label><input id="st-je" disabled={!edit} className="num" value={(s.jeApprovalLimitCents / 100).toFixed(2)} onChange={(e) => setS({ ...s, jeApprovalLimitCents: parseMoney(e.target.value) ?? s.jeApprovalLimitCents })} /><span className="hint">Enforced when approvals ship (phase 10).</span></div>
          <div className="field"><label htmlFor="st-own">Owner withdrawals post as</label><select id="st-own" disabled={!edit} value={s.ownerWithdrawalPolicy} onChange={(e) => setS({ ...s, ownerWithdrawalPolicy: e.target.value as 'expense' | 'draw' })}><option value="expense">Corporate expense</option><option value="draw">Owner draws (equity)</option></select><span className="hint">Choosing an owner on a new entry fills in {s.ownerWithdrawalPolicy === 'draw' ? 'Owner draws' : `Corporate · ${state.accounts.find((a) => a.id === s.ownerWithdrawalExpenseAccountId)?.name}`}.</span></div>
          <div className="field"><label htmlFor="st-tz">Time zone</label><input id="st-tz" value="America/Chicago" disabled /></div>
        </div>
        {edit && <div className="actions" style={{ marginTop: 14 }}><button className="btn primary" onClick={() => { books.saveSettings(user, s); say('Settings saved.'); }}>Save settings</button></div>}
      </section>
      <section className="panel panel-pad" style={{ marginTop: 20 }} aria-labelledby="data-h">
        <h2 id="data-h" style={{ marginBottom: 8 }}>Data on this device</h2>
        <p>
          {state.source?.kind === 'stationbooks'
            ? <><span className="pill ok">Real data</span> From the StationBooks export of {new Date(state.source.exportedAt ?? '').toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })}.</>
            : <><span className="pill">Demo data</span> Illustrative figures, not your books.</>}
        </p>
        {can(user, 'users.edit') && (
          <p>
            <label className="btn" style={{ margin: 0 }}>Load a StationBooks export…
              <input type="file" accept=".json,application/json" className="sr-only" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const json: unknown = JSON.parse(await f.text());
                  if (!isSnapshot(json)) { say('That file is not a StationBooks export. Export it from StationBooks again and load that file.'); return; }
                  const r = await loadStationBooks(json);
                  setS(books.state.settings);
                  say(`Loaded ${r.posted.toLocaleString('en-US')} transactions (${r.from} to ${r.to})${r.skippedOtherBusinesses.length ? `; left out ${r.skippedOtherBusinesses.map((x) => `${x.code} ${x.txns}`).join(', ')} from other businesses` : ''}.`);
                } catch (err) { say((err as Error).message); }
              }} />
            </label>
            <span className="muted small" style={{ marginLeft: 8 }}>Replaces the books on this device. The export is read, never sent anywhere.</span>
          </p>
        )}
        <p className="muted">This phase keeps the books in this browser (IndexedDB). The hosted, multi-user back end with 2FA, encryption at rest and daily backups replaces this before real data is loaded.</p>
        <p>{state.transactions.length.toLocaleString('en-US')} transactions · materiality {formatMoney(state.settings.materialityCents, { dollarSign: true })}</p>
        {can(user, 'users.edit') && (confirmReset
          ? <div className="actions"><span className="neg">This replaces everything on this device with the demo dataset.</span><button className="btn danger" onClick={async () => { await resetDemo(); setConfirmReset(false); setS(books.state.settings); say('Demo data restored.'); }}>Reset to demo data</button><button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button></div>
          : <button className="btn" onClick={() => setConfirmReset(true)}>Reset to demo data…</button>)}
      </section>
      {toast}
    </Page>
  );
}
