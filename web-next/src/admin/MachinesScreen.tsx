// «Доступ к машинам» (SPRINT_UXR_S7B_ADMIN/S7B-ACL-3). Раскладка — прототип
// docs/prototypes/s7b-acl3-machine-access-v3.html, утверждена владелицей 11.11
// («ок давай пока такой интерфейс»). Собрано только из блоков kit:
//   • вкладки — Tabs; цифры сверху — Pill;
//   • «Машины» — ListView (поиск, фильтры проект/harness, группы по владельцу
//     или проекту, «показано N из M»); строка открывает паспорт в Drawer;
//   • паспорт: шапка — Pill + ValueChips; «Допуски» — ListView по проекту,
//     perGroup 8 и «ещё N» (S9-11), rowActions «Изменить / Снять», bulkActions
//     «Сменить роль / Снять»; «Допустить» — ScopePicker (люди), «вся команда
//     проекта», Segmented (роль), FieldEditor enum multi (проекты, harness),
//     DiffPreview по dry_run, BatchUndo после применения;
//   • «Матрица проекта» — Matrix (прокрутка вбок внутри контейнера kit).
// Блок «Машины» паспорта человека (S7B-28) — PersonMachines, ListView.
//
// Писать может только владелец машины или admin — решает сервер: поле can_write
// среза machine_acl (то же правило, что проверка записи); нет поля — dry_run-проба
// (machines.ts probeWrite). Остальным — только чтение с причиной словами;
// «не смогли проверить» — отдельно от «нельзя» и от «никого нет».
// Применение — одна серверная пачка на машину (batch_id), отмена — undo_of.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BatchUndo, DiffPreview, Drawer, EmptyState, FieldEditor, Forbidden, ListView, LoadError, Matrix, Pill,
  ScopePicker, Segmented, Skeleton, Tabs, useKitLang, useLoadState, useUrlParam,
  type BatchItemFail, type BatchResult, type DiffRow, type KitConfig, type KitLang, type ListBulkAction, type ListRowAction,
  type MatrixChange, type ScopeOption,
} from '@seidr/kit';
import { ValueChips } from '@seidr/kit/record';
import { useAppT, appT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { useAdminNav } from './adminNav';
import {
  batchesByMachine, fetchMachineAcl, fetchMachinesData, grantRecords, grantRequests, machineRecords, matrixCell,
  parsePlan, personMachines, postMachineAccess, postMachineAccessBatch, probeWrite, projectMatrix, removeProjectsRequests,
  revokeRequests, roleRequests, sliceWriteRight, enrichMachines,
  type AccessPlan, type AccessRequest, type Machine, type MachineBatch, type MachinesData, type PlanView, type WriteRight,
} from './machines';
import './Admin.css';

type T = ReturnType<typeof useAppT>;
const ROLES = ['viewer', 'actor'] as const;
const projectHref = (slug: string) => `?mod=admin&sec=adm-projects&adm-open=${encodeURIComponent(slug)}`;

function roleWord(t: T, role: string): string {
  return role === 'actor' ? t('admin.macl.role.actor') : role === 'viewer' ? t('admin.macl.role.viewer')
    : role === 'owner' ? t('admin.macl.role.owner') : role || '—';
}
const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);

// ── конфиги списков kit ───────────────────────────────────────────────────

function machinesConfig(lang: KitLang): KitConfig {
  const t = (k: AppKey) => appT(lang, k);
  return {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    kinds: {
      machine: {
        title: t('admin.macl.kind.machine'), icon: 'laptop',
        fields: [
          { key: 'owner', title: t('admin.macl.col.owner'), type: 'enum' },
          { key: 'harness', title: t('admin.macl.col.harness'), type: 'enum' },
          { key: 'projects', title: t('admin.macl.col.projects'), type: 'enum' },
          { key: 'granted', title: t('admin.macl.col.granted'), type: 'number' },
        ],
      },
    },
    list: {
      views: ['list', 'cards'],
      filters: ['fields.projects', 'fields.harness'],
      // «По проекту» — kit режет по массиву projects: машина в каждой своей группе.
      groupings: ['owner', 'projects'],
      columns: ['title', 'owner', 'harness', 'projects', 'granted'],
    },
  };
}

function grantsConfig(lang: KitLang): KitConfig {
  const t = (k: AppKey) => appT(lang, k);
  return {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    kinds: {
      grant: {
        title: t('admin.macl.kind.grant'), icon: 'key',
        fields: [
          { key: 'role', title: t('admin.macl.col.role'), type: 'enum' },
          { key: 'projects', title: t('admin.macl.col.projects'), type: 'enum' },
          { key: 'harness', title: t('admin.macl.col.harness'), type: 'enum' },
          { key: 'by', title: t('admin.macl.col.by'), type: 'text' },
        ],
      },
    },
    list: { views: ['list'], filters: ['fields.role'], groupings: ['projects'], columns: ['title', 'role', 'projects', 'harness', 'by'] },
  };
}

function personMachinesConfig(lang: KitLang): KitConfig {
  const t = (k: AppKey) => appT(lang, k);
  return {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    kinds: {
      machine: {
        title: t('admin.macl.kind.machine'), icon: 'laptop',
        fields: [
          { key: 'role', title: t('admin.macl.col.role'), type: 'enum' },
          { key: 'owner', title: t('admin.macl.col.owner'), type: 'enum' },
          { key: 'projects', title: t('admin.macl.col.projectsGrant'), type: 'enum' },
          { key: 'harness', title: t('admin.macl.col.harness'), type: 'enum' },
        ],
      },
    },
    list: { views: ['list'], groupings: ['role'], columns: ['title', 'role', 'owner', 'projects', 'harness'] },
  };
}

const kitData = (records: ReturnType<typeof machineRecords>, truncated = false) => ({
  records, edges: [], journal: [],
  meta: { generated_at: new Date().toISOString(), returned: records.length, ...(truncated ? { truncated: true } : {}) },
});

// ── экран ─────────────────────────────────────────────────────────────────

export interface MachinesScreenProps {
  fetchImpl?: typeof fetch;
  /** kc_sub смотрящего: владелец машины пишет без пробы. */
  meSub?: string | null;
}

export function MachinesScreen({ fetchImpl, meSub = null }: MachinesScreenProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [tab, setTab] = useUrlParam('adm-macl-tab');
  const res = useLoadState<MachinesData>(signal => fetchMachinesData(signal, fetchImpl, lang), [fetchImpl, lang], { rows: d => d.machines });
  const data = res.data;
  const current = tab === 'matrix' ? 'matrix' : 'machines';

  let content;
  if (res.state === 'loading' && !data) content = <Skeleton lines={6} label={t('admin.macl.loading')} />;
  else if (res.state === 'forbidden') content = <div data-testid="adm-macl-forbidden"><Forbidden reason={reasonOf(res.error)} /></div>;
  else if (res.state === 'error' || !data) content = <LoadError error={res.error} onRetry={res.reload} />;
  else if (data.machines.length === 0) content = <div data-testid="adm-macl-empty"><EmptyState title={t('admin.macl.empty')} hint={t('admin.macl.emptyHint')} /></div>;
  else {
    const grants = data.machines.reduce((n, m) => n + m.grants.length, 0);
    content = (
      <>
        <p className="adm-sub">
          <Pill>{t('admin.macl.stat.machines', { n: data.machines.length })}</Pill>{' '}
          <Pill>{t('admin.macl.stat.grants', { n: grants })}</Pill>
        </p>
        {data.truncated && <p className="adm-note" data-tone="wrn" role="status">{t('admin.macl.truncated')}</p>}
        {data.participationError && (
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-macl-partial">
            {t('admin.macl.partial', { reason: data.participationError })}
          </p>
        )}
        <Tabs label={t('admin.macl.tabs')} value={current} onChange={id => setTab(id === 'machines' ? null : id)}
          items={[{ id: 'machines', label: t('admin.macl.tab.machines') }, { id: 'matrix', label: t('admin.macl.tab.matrix') }]}>
          {current === 'machines'
            ? <MachinesList data={data} meSub={meSub} fetchImpl={fetchImpl} onChanged={res.reload} />
            : <ProjectMatrixView data={data} fetchImpl={fetchImpl} onChanged={res.reload} />}
        </Tabs>
      </>
    );
  }

  return (
    <section className="adm" aria-labelledby="adm-macl-h" data-testid="adm-macl">
      <h2 id="adm-macl-h" className="adm-h">{t('admin.macl.title')}</h2>
      <p className="adm-lead">{t('admin.macl.lead')}</p>
      {content}
    </section>
  );
}

// ── вкладка «Машины» ──────────────────────────────────────────────────────

function MachinesList({ data, meSub, fetchImpl, onChanged }: { data: MachinesData; meSub: string | null; fetchImpl?: typeof fetch; onChanged: () => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const [open, setOpen] = useUrlParam('adm-macl-m');
  const config = useMemo(() => machinesConfig(lang), [lang]);
  const labelled = useMemo(() => data.machines.map(m => ({ ...m, harness: m.harness.map(h => data.harnessLabels[h] ?? h) })), [data]);
  const records = useMemo(() => machineRecords(labelled), [labelled]);
  const machine = open ? data.machines.find(m => m.machine_id === open) ?? null : null;
  return (
    <>
      <ListView config={config} data={kitData(records, data.truncated)} initial={{ group: 'owner' }} onOpen={id => setOpen(id)} />
      {open && (
        <Drawer open onClose={() => setOpen(null)} title={open}>
          {machine
            ? <MachinePassport machine={machine} data={data} meSub={meSub} fetchImpl={fetchImpl} onChanged={onChanged} />
            : <EmptyState title={t('admin.macl.notFound', { id: open })} hint={t('admin.macl.notFoundHint')} />}
        </Drawer>
      )}
    </>
  );
}

// ── паспорт машины ────────────────────────────────────────────────────────

interface Draft { who: string[]; role: string; projects: string[]; harnesses: string[] }
const EMPTY_DRAFT: Draft = { who: [], role: 'viewer', projects: [], harnesses: [] };

function MachinePassport({ machine: m, data, meSub, fetchImpl, onChanged }: {
  machine: Machine; data: MachinesData; meSub: string | null; fetchImpl?: typeof fetch; onChanged: () => void;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [probed, setRight] = useState<WriteRight | null>(null);
  const [probe, setProbe] = useState(0);
  const [pending, setPending] = useState<{ key: number; requests: AccessRequest[] } | null>(null);
  const [bulkRole, setBulkRole] = useState<{ subs: string[]; role: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const seq = useRef(0);
  const propose = (requests: AccessRequest[]) => { seq.current += 1; setPending({ key: seq.current, requests }); };

  // can_write среза — ответ сервера по тому же правилу, что запись; пробный dry_run —
  // только когда поля нет (старый сервер).
  const fromSlice = sliceWriteRight(m, t('admin.macl.right.noSlice'), t('admin.macl.right.unknownSlice'));
  useEffect(() => {
    if (fromSlice) return;
    let alive = true;
    setRight(null);
    probeWrite(m, meSub, fetchImpl).then(r => { if (alive) setRight(r); });
    return () => { alive = false; };
  }, [m.machine_id, meSub, fetchImpl, probe, fromSlice === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const right: WriteRight | null = fromSlice ?? probed;

  const canWrite = right?.state === 'yes';
  const config = useMemo(() => grantsConfig(lang), [lang]);
  const records = useMemo(() => grantRecords(m).map(r => ({
    ...r,
    fields: {
      ...r.fields,
      role: roleWord(t, String(r.fields.role ?? '')),
      ...(Array.isArray(r.fields.harness) ? { harness: (r.fields.harness as string[]).map(h => data.harnessLabels[h] ?? h) } : {}),
    },
  })), [m, data.harnessLabels, t]);
  const nameOf = (kc: string) => data.participation?.people.find(p => p.kc_sub === kc)?.name ?? m.grants.find(g => g.kc_sub === kc)?.name ?? kc;

  const rowActions: ListRowAction[] = canWrite ? [
    { id: 'edit', title: t('admin.macl.act.edit'), icon: 'quill', run: ([id]) => {
      const g = m.grants.find(x => x.kc_sub === id);
      if (g) setDraft({ who: [g.kc_sub], role: g.role || 'viewer', projects: g.projects, harnesses: g.harnesses });
    } },
    // Запись — человек целиком (группа «по проекту» режется kit по массиву), поэтому
    // «Снять» снимает допуск; убрать один проект — «Изменить» или матрица проекта.
    { id: 'revoke', title: t('admin.macl.act.revoke'), icon: 'lucide:circle-x', run: ids => { setBulkRole(null); propose(revokeRequests(m, ids)); } },
  ] : [];
  const bulkActions: ListBulkAction[] = canWrite ? [
    { id: 'role', title: t('admin.macl.act.role'), run: ids => {
      const subs = [...new Set(ids)];
      const first = m.grants.find(g => g.kc_sub === subs[0]);
      const role = first?.role === 'actor' ? 'viewer' : 'actor';
      setBulkRole({ subs, role });
      propose(roleRequests(m, subs, role));
    } },
    { id: 'revoke', title: t('admin.macl.act.revokeSel'), run: ids => { setBulkRole(null); propose(revokeRequests(m, ids)); } },
  ] : [];

  return (
    <div className="adm-passport" data-testid={`adm-macl-passport-${m.machine_id}`}>
      <p className="adm-sub">
        <span className="adm-mono">{m.machine_id}</span>{' '}
        <Pill variant="id">{m.client_id}</Pill>{' '}
        <span className="adm-dim">{t('admin.macl.col.owner')}</span>{' '}
        {m.owner_name ? <Pill tone="acc">{m.owner_name}</Pill> : <span className="adm-missing">{t('admin.macl.noOwner')}</span>}{' '}
        <span className="adm-dim">{t('admin.macl.col.harness')}</span>{' '}
        {m.harness.length ? m.harness.map(h => <Pill key={h}>{data.harnessLabels[h] ?? h}</Pill>) : <span className="adm-missing">{t('admin.macl.harnessUnknown')}</span>}
      </p>
      <p className="adm-sub">
        <span className="adm-dim">{t('admin.macl.col.projects')}</span>{' '}
        <ValueChips value={m.projects} href={projectHref} />
      </p>

      <h3 className="adm-h">{t('admin.macl.grants.title', { n: m.grants.length })}</h3>
      <p className="adm-note">{t('admin.macl.grants.note')}</p>
      <div data-testid="adm-macl-grants">
        {m.grants.length === 0
          ? <EmptyState title={t('admin.macl.grants.empty')} hint={t('admin.macl.grants.emptyHint')} />
          : <ListView config={config} data={kitData(records)} urlState={false} initial={{ group: 'projects' }}
              budget={{ perGroup: 8 }} rowActions={rowActions} bulkActions={bulkActions} />}
      </div>

      {bulkRole && pending && (
        <Segmented label={t('admin.macl.form.role')} value={bulkRole.role}
          options={ROLES.map(r => ({ value: r, label: roleWord(t, r) }))}
          onChange={role => { setBulkRole({ ...bulkRole, role }); propose(roleRequests(m, bulkRole.subs, role)); }} />
      )}
      {pending && (
        <AccessChange key={pending.key} requests={pending.requests} nameOf={nameOf} harnessLabels={data.harnessLabels}
          fetchImpl={fetchImpl} onChanged={onChanged} onClose={() => { setPending(null); setBulkRole(null); }} />
      )}

      <h3 className="adm-h">{t('admin.macl.form.title')}</h3>
      {right === null && <Skeleton lines={2} label={t('admin.macl.right.checking')} />}
      {right?.state === 'no' && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-macl-readonly">
          {t('admin.macl.right.no', { reason: right.reason })}
        </p>
      )}
      {right?.state === 'unknown' && (
        <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-macl-readonly">
          {t('admin.macl.right.unknown', { reason: right.reason })}{' '}
          <button type="button" className="adm-btn" onClick={() => (fromSlice ? onChanged() : setProbe(p => p + 1))}>{t('admin.macl.retry')}</button>
        </p>
      )}
      {canWrite && (
        <GrantForm machine={m} data={data} draft={draft} setDraft={setDraft}
          onPreview={reqs => { setBulkRole(null); propose(reqs); }} nameOf={nameOf} />
      )}
    </div>
  );
}

function GrantForm({ machine: m, data, draft, setDraft, onPreview, nameOf }: {
  machine: Machine; data: MachinesData; draft: Draft; setDraft: (d: Draft) => void;
  onPreview: (reqs: AccessRequest[]) => void; nameOf: (kc: string) => string;
}) {
  const t = useAppT();
  const people = data.participation?.people ?? [];
  const inMachine = (kc: string) => people.find(p => p.kc_sub === kc)?.projects.some(pr => m.projects.includes(pr.slug)) ?? false;
  const options: ScopeOption[] = people.filter(p => p.kc_sub !== m.owner_kc_sub).map(p => {
    const mine = inMachine(p.kc_sub);
    const has = m.grants.some(g => g.kc_sub === p.kc_sub);
    const where = p.projects.filter(pr => m.projects.includes(pr.slug)).map(pr => pr.slug).join(', ');
    return {
      id: p.kc_sub, title: p.name, mine,
      hint: has ? t('admin.macl.form.already') : mine ? where : t('admin.macl.form.notInMachine'),
    };
  });
  // Подписанные группы и слова пикера — про людей, а не про проекты (kit #1249: labels;
  // в many kit подставляет {n}).
  const groups = { mine: t('admin.macl.form.groupMine'), other: t('admin.macl.form.groupOther') };
  const labels = { all: t('admin.macl.form.pickAll'), search: t('admin.macl.form.pickSearch'), many: t('admin.macl.form.pickMany') };
  const mineCount = options.filter(o => o.mine).length;
  const team = (slug: string) => {
    const members = data.participation?.projects.find(p => p.slug === slug)?.members.map(x => x.kc_sub).filter(kc => kc !== m.owner_kc_sub) ?? [];
    setDraft({ ...draft, who: [...new Set([...draft.who, ...members])], projects: draft.projects.includes(slug) ? draft.projects : [...draft.projects, slug] });
  };
  const harnessOptions = (m.harness.length ? m.harness : data.harnessRegistry ?? []).map(h => ({ value: h, label: data.harnessLabels[h] ?? h }));
  const ready = draft.who.length > 0 && draft.projects.length > 0;
  return (
    <div className="adm-field" data-testid="adm-macl-grant">
      <ScopePicker groups={groups} labels={labels} label={t('admin.macl.form.who')} icon="person" options={options} value={draft.who}
        onChange={who => setDraft({ ...draft, who })}
        state={data.participation ? 'ok' : 'error'} error={data.participationError ?? undefined}
        mine={data.participation ? 'known' : 'unknown'} mineHint={data.participationError ?? undefined} mineCount={mineCount} />
      <p className="adm-sub" data-testid="adm-macl-who">
        {draft.who.length
          ? draft.who.map(kc => <Pill key={kc} tone="acc">{nameOf(kc)}</Pill>)
          : <span className="adm-missing">{t('admin.macl.form.nobody')}</span>}
      </p>
      <p className="adm-sub">
        <span className="adm-dim">{t('admin.macl.form.team')}</span>{' '}
        {m.projects.map(slug => (
          <button key={slug} type="button" className="adm-btn" data-testid={`adm-macl-team-${slug}`} onClick={() => team(slug)}>{slug}</button>
        ))}
      </p>
      <Segmented label={t('admin.macl.form.role')} value={draft.role}
        options={ROLES.map(r => ({ value: r, label: roleWord(t, r) }))} onChange={role => setDraft({ ...draft, role })} />
      <FieldEditor def={{ key: 'projects', label: t('admin.macl.form.projects'), kind: 'enum', multi: true, required: 'block', options: m.projects }}
        value={draft.projects} onChange={v => setDraft({ ...draft, projects: Array.isArray(v) ? v.map(String) : [] })} showRequired={draft.who.length > 0} />
      <FieldEditor def={{ key: 'harnesses', label: t('admin.macl.form.harness'), kind: 'enum', multi: true, options: harnessOptions }}
        value={draft.harnesses} onChange={v => setDraft({ ...draft, harnesses: Array.isArray(v) ? v.map(String) : [] })} />
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" data-testid="adm-macl-preview" disabled={!ready}
          onClick={() => onPreview(grantRequests(m, draft.who.map(kc => ({ kc_sub: kc, name: nameOf(kc) })), draft.role, draft.projects, draft.harnesses))}>
          {t('admin.macl.form.preview')}
        </button>
        <button type="button" className="adm-btn" onClick={() => setDraft(EMPTY_DRAFT)}>{t('admin.macl.form.reset')}</button>
      </div>
    </div>
  );
}

// ── изменение: план (dry_run) → DiffPreview → пачка → BatchUndo ───────────

type Planned = { req: AccessRequest; plan: AccessPlan | null; error: { forbidden: boolean; reason: string } | null };

function summary(t: T, v: PlanView | null, labels: Record<string, string>): string {
  if (!v) return '';
  const harn = v.harnesses.length ? v.harnesses.map(h => labels[h] ?? h).join(', ') : t('admin.macl.allHarness');
  return `${roleWord(t, v.role)} · ${v.projects.join(', ') || '—'} · ${harn}`;
}

function toDiff(t: T, items: readonly Planned[], labelOf: (req: AccessRequest) => string, labels: Record<string, string>): DiffRow[] {
  return items.map((it, i) => {
    const id = String(i);
    const text = labelOf(it.req);
    if (it.error) {
      return { id, kind: 'same', text, check: it.error.forbidden ? { state: 'forbidden', reason: it.error.reason } : { state: 'unverified', reason: it.error.reason } };
    }
    const p = it.plan!;
    const before = summary(t, p.before, labels);
    const after = summary(t, p.after, labels);
    if (p.kind === 'grant') return { id, kind: 'add', text, detail: after, check: { state: 'checked' } };
    if (p.kind === 'revoke') return { id, kind: 'remove', text, detail: before, check: { state: 'checked' } };
    if (p.kind === 'update') return { id, kind: 'change', text, from: before, to: after, check: { state: 'checked' } };
    return { id, kind: 'same', text, detail: before || after, check: { state: 'checked' } };
  });
}

/**
 * План → дифф → пачка → отмена для запросов допуска. Экспортирован для UC-4
 * (S7B-20, PersonOffboard): там все строки — один человек, и строку называет
 * машина (`labelOf`), а не имя человека.
 */
export function AccessChange({ requests, nameOf, labelOf, harnessLabels, fetchImpl, onChanged, onClose }: {
  requests: readonly AccessRequest[]; nameOf: (kc: string) => string; harnessLabels: Record<string, string>;
  /** Подпись строки диффа; по умолчанию — имя человека (nameOf). */
  labelOf?: (req: AccessRequest) => string;
  fetchImpl?: typeof fetch; onChanged: () => void; onClose: () => void;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [items, setItems] = useState<Planned[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<{ result: BatchResult; batches: MachineBatch[] } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(requests.map(req => postMachineAccess({ ...req, dry_run: true }, fetchImpl).then(
      body => ({ req, plan: parsePlan(body), error: null }),
      (e: unknown) => ({ req, plan: null, error: { forbidden: e instanceof LoreHttpError && (e.status === 401 || e.status === 403), reason: reasonOf(e) } }),
    ))).then(r => { if (alive) setItems(r); });
    return () => { alive = false; };
  }, [requests, fetchImpl]);

  const rows = useMemo(
    () => (items ? toDiff(t, items, labelOf ?? (req => nameOf(req.kc_sub)), harnessLabels) : []),
    [items, t, nameOf, labelOf, harnessLabels],
  );

  const apply = async (picked: readonly DiffRow[]) => {
    if (!items || busy) return;
    setBusy(true);
    const chosen = picked.map(r => items[Number(r.id)]);
    const failed: BatchItemFail[] = [];
    const done: MachineBatch[] = [];
    // Серверная пачка на машину: одна запись журнала с batch_id, отмена — undo_of.
    for (const group of batchesByMachine(chosen.map(it => it.req))) {
      try {
        const b = await postMachineAccessBatch(group, fetchImpl);
        done.push(b);
        for (const it of b.items) {
          if (it.result === 'failed') failed.push({ id: it.kc_sub, text: nameOf(it.kc_sub), reason: it.reason ?? String(it.status ?? '') });
        }
      } catch (e) {
        for (const it of group.items) failed.push({ id: it.kc_sub, text: nameOf(it.kc_sub), reason: reasonOf(e) });
      }
    }
    const undoable = done.filter(b => b.batch_id && b.undo.length);
    const until = undoable.map(b => b.undo_until).filter((x): x is number => x !== null);
    setBatch({
      result: {
        id: done.map(b => b.batch_id).filter(Boolean).join(',') || `macl-${Date.now()}`,
        applied: chosen.length - failed.length, total: chosen.length, failed,
        undoUntil: undoable.length && until.length ? Math.min(...until) : null,
      },
      batches: undoable,
    });
    setBusy(false);
    onChanged();
  };

  const runUndo = async () => {
    if (!batch || undoing) return;
    setUndoing(true);
    setUndoError(null);
    const fails: string[] = [];
    for (const b of batch.batches) {
      try {
        const r = await postMachineAccessBatch({ machine_id: b.machine_id, items: b.undo, undo_of: b.batch_id! }, fetchImpl);
        for (const it of r.items) if (it.result === 'failed') fails.push(`${nameOf(it.kc_sub)}: ${it.reason ?? it.status ?? ''}`);
      } catch (e) { fails.push(`${b.machine_id}: ${reasonOf(e)}`); }
    }
    setUndoing(false);
    if (fails.length) setUndoError(t('admin.macl.undoFailed', { reason: fails.join('; ') }));
    else setUndone(true);
    onChanged();
  };

  return (
    <section className="adm-danger" data-testid="adm-macl-change" aria-label={t('admin.macl.change.title')}>
      <h3 className="adm-danger__h">{t('admin.macl.change.title')}</h3>
      {!items && <Skeleton lines={3} label={t('admin.macl.change.loading')} />}
      {items && !batch && <DiffPreview rows={rows} onApply={r => { void apply(r); }} busy={busy} label={t('admin.macl.change.diff')} lang={lang} />}
      {batch && <BatchUndo batch={batch.result} onUndo={() => { void runUndo(); }} undoing={undoing} undone={undone} undoError={undoError} lang={lang} />}
      {batch && <p className="adm-note">{t('admin.macl.change.undoNote')}</p>}
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" data-testid="adm-macl-change-close" onClick={onClose}>
          {batch ? t('admin.macl.change.done') : t('admin.macl.change.cancel')}
        </button>
      </div>
    </section>
  );
}

// ── матрица проекта ───────────────────────────────────────────────────────

function ProjectMatrixView({ data, fetchImpl, onChanged }: { data: MachinesData; fetchImpl?: typeof fetch; onChanged: () => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const [xp, setXp] = useUrlParam('adm-macl-xp');
  const [pending, setPending] = useState<{ key: number; requests: AccessRequest[] } | null>(null);
  const seq = useRef(0);
  const projects = useMemo(() => [...new Set(data.machines.flatMap(m => m.projects))].sort(), [data.machines]);
  if (!data.participation) {
    return <LoadError error={new Error(t('admin.macl.matrix.noTeams', { reason: data.participationError ?? '—' }))} />;
  }
  if (projects.length === 0) return <EmptyState title={t('admin.macl.matrix.noProjects')} />;
  const project = xp && projects.includes(xp) ? xp : projects[0];
  const mx = projectMatrix(data.machines, data.participation, project);
  const ownerWord = t('admin.macl.role.owner');
  const nameOf = (kc: string) => mx.people.find(p => p.kc_sub === kc)?.name ?? kc;
  const onPropose = (changes: readonly MatrixChange[]) => {
    const reqs: AccessRequest[] = [];
    for (const c of changes) {
      const m = mx.machines.find(x => x.machine_id === c.col);
      if (!m || m.owner_kc_sub === c.row) continue; // владельцу допуск не выдаётся
      const g = m.grants.find(x => x.kc_sub === c.row);
      if (c.value === null) reqs.push(...removeProjectsRequests(m, [[c.row, project]]));
      else reqs.push({
        machine_id: m.machine_id, kc_sub: c.row, display_name: nameOf(c.row), action: 'grant', role: c.value,
        projects: g ? [...new Set([...g.projects, project])] : [project], harnesses: g?.harnesses ?? [],
      });
    }
    if (reqs.length) { seq.current += 1; setPending({ key: seq.current, requests: reqs }); }
  };
  return (
    <div data-testid="adm-macl-matrix">
      <FieldEditor def={{ key: 'project', label: t('admin.macl.matrix.project'), kind: 'enum', options: projects }}
        value={project} onChange={v => setXp(typeof v === 'string' && v ? v : null)} />
      <p className="adm-sub">
        <Pill>{t('admin.macl.matrix.size', { people: mx.people.length, machines: mx.machines.length })}</Pill>{' '}
        <span data-testid="adm-macl-noaccess"><Pill tone={mx.noAccess.length ? 'wrn' : undefined}>{t('admin.macl.matrix.noAccess', { n: mx.noAccess.length })}</Pill></span>
      </p>
      <Matrix
        rows={mx.people.map(p => ({ key: p.kc_sub, title: mx.noAccess.includes(p.kc_sub) ? `${p.name} · ${t('admin.macl.matrix.noAccessMark')}` : p.name }))}
        cols={mx.machines.map(m => ({ key: m.machine_id, title: m.machine_id }))}
        cell={(r, c) => matrixCell(mx.mark(r, c), ownerWord)}
        options={ROLES.map(r => ({ value: r, title: roleWord(t, r) }))}
        labels={{ rows: t('admin.macl.matrix.rows'), cols: t('admin.macl.matrix.cols') }}
        onPropose={onPropose} lang={lang} />
      <p className="adm-note">{t('admin.macl.matrix.note')}</p>
      {pending && (
        <AccessChange key={pending.key} requests={pending.requests} nameOf={nameOf} harnessLabels={data.harnessLabels}
          fetchImpl={fetchImpl} onChanged={onChanged} onClose={() => setPending(null)} />
      )}
    </div>
  );
}

// ── блок «Машины» в паспорте человека (S7B-28) ────────────────────────────

export function PersonMachines({ kcSub, fetchImpl }: { kcSub: string; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const lang = useKitLang();
  const nav = useAdminNav();
  const res = useLoadState(signal => fetchMachineAcl(signal, fetchImpl), [fetchImpl], { rows: d => d.machines });
  const config = useMemo(() => personMachinesConfig(lang), [lang]);
  const records = useMemo(() => {
    if (!res.data) return [];
    const { owned, granted } = personMachines(enrichMachines(res.data.machines, null, []), kcSub);
    return [...owned, ...granted].map(x => {
      const fields: Record<string, unknown> = { role: roleWord(t, x.role), owner: x.machine.owner_name ?? '' };
      if (x.projects.length) fields.projects = x.projects;
      if (x.harnesses.length) fields.harness = x.harnesses;
      return { id: x.machine.machine_id, kind: 'machine', title: x.machine.machine_id, status: '', fields, search: x.machine.client_id };
    });
  }, [res.data, kcSub, t]);
  const owned = res.data ? res.data.machines.filter(m => m.owner_kc_sub === kcSub).length : 0;
  let body;
  if (res.state === 'loading' && !res.data) body = <Skeleton lines={2} label={t('admin.macl.loading')} />;
  else if (res.state === 'forbidden') body = <div data-testid="adm-person-machines-error"><Forbidden reason={reasonOf(res.error)} /></div>;
  else if (res.state === 'error' || !res.data) body = <div data-testid="adm-person-machines-error"><LoadError error={res.error} onRetry={res.reload} /></div>;
  else if (records.length === 0) body = <p className="adm-missing">{t('admin.macl.person.none')}</p>;
  else body = <ListView config={config} data={kitData(records)} urlState={false} onOpen={id => nav.go('machines', { 'adm-macl-m': id })} />;
  return (
    <div data-testid="adm-person-machines">
      <h3 className="adm-h">{t('admin.macl.person.title', { owned, granted: Math.max(0, records.length - owned) })}</h3>
      {body}
    </div>
  );
}
