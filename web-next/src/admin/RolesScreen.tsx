// Раздел «Роли» админки v2: роли одного человека по всем его проектам.
//
//   • S7B-09 — карточка на объёме: у omiloreadmin 23 проекта, и плоский список
//     «проект + select + Снять» занимал 2,5 экрана телефона с 23 красными
//     кнопками подряд. Здесь — группы по роли (свёрнуто), поиск, мультивыбор и
//     ОДНА панель «Сменить роль / Снять» с одним подтверждением на N;
//   • S7B-05 — матрица ролей человека по проектам (kit Matrix): «задать всей
//     строке» — массовая правка;
//   • S7B-03 — любая правка идёт через DangerBatch: дифф → логин → пачка →
//     «Отменить» → запись в журнале.
//
// Выбор — в адресе: человек (adm-person), вид (adm-view), поиск (adm-q),
// отмеченные проекты (adm-sel). Ссылка открывает ту же карточку с тем же выбором.
import { useMemo, useState } from 'react';
import {
  EmptyState, Forbidden, LoadError, Matrix, Pill, Skeleton, setUrlParams, useKitLang, useLoadState, useUrlParam,
  type MatrixCellState, type MatrixChange,
} from '@seidr/kit';
import { useAppT } from '../i18n';
import { DangerBatch } from './DangerBatch';
import { EffectiveAccess, PersonAgentsLine } from './AccessBlocks';
import {
  buildChanges, countAssignments, fetchRoleMatrix, filterProjects, groupByRole, PERSON_SOURCES, personSourceCell,
  projectPersonCell, PROJECT_ROLES, roleCanWrite, roleHolders, roleSummary, splitByPerson,
  type PersonChanges, type PersonRoles, type RoleChange, type RolesData,
} from './roles';
import './Admin.css';

export interface RolesScreenProps {
  fetchImpl?: typeof fetch;
}

/** Отмеченные проекты в адресе — через запятую (в slug запятой не бывает: SAFE_ID). */
const SEL_SEP = ',';

/** Разрез экрана в адресе: null — по человеку, all — все проекты × все люди, role — по ролям. */
const BY_PARAM = 'adm-roles-by';
type RolesBy = 'person' | 'all' | 'role';

export function RolesScreen({ fetchImpl }: RolesScreenProps) {
  const t = useAppT();
  const [personKey, setPerson] = useUrlParam('adm-person');
  const [byRaw, setBy] = useUrlParam(BY_PARAM);
  const by: RolesBy = byRaw === 'all' ? 'all' : byRaw === 'role' ? 'role' : 'person';
  const res = useLoadState<RolesData>(signal => fetchRoleMatrix(signal, fetchImpl), [fetchImpl], { rows: d => d.people });
  const data = res.data;
  // Очередь пачек: у пачки сервера один человек, а правка общей матрицы может
  // задеть нескольких — тогда пачки идут по одной (S7B-11).
  const [queue, setQueue] = useState<PersonChanges[]>([]);
  const [seq, setSeq] = useState(0);
  const enqueue = (items: PersonChanges[]) => { setQueue(items.filter(i => i.changes.length > 0)); setSeq(n => n + 1); };
  const pending = queue[0] ?? null;
  const pendingPerson = pending && data ? data.people.find(p => p.kc_sub === pending.kc_sub) ?? null : null;
  const batch = pending && pendingPerson && (
    <>
      {queue.length > 1 && (
        <p className="adm-note" data-tone="inf" role="status" data-testid="adm-roles-queue">
          {t('admin.roles.queue', { n: queue.length - 1 })}
        </p>
      )}
      <DangerBatch key={`${seq}-${pending.kc_sub}-${queue.length}`} person={pendingPerson} changes={pending.changes} fetchImpl={fetchImpl}
        onClose={() => setQueue(q => q.slice(1))} onChanged={res.reload} />
    </>
  );

  let content;
  if (res.state === 'loading' && !data) content = <Skeleton lines={6} label={t('admin.roles.loading')} />;
  else if (res.state === 'forbidden') {
    content = (
      <Forbidden title={t('admin.roles.forbidden')} hint={t('admin.roles.forbiddenHint')}
        reason={res.error instanceof Error ? res.error.message : undefined} />
    );
  } else if (res.state === 'error' || !data) content = <LoadError error={res.error} onRetry={res.reload} />;
  else if (data.people.length === 0) {
    content = <div data-testid="adm-roles-empty"><EmptyState title={t('admin.roles.empty')} hint={t('admin.roles.emptyHint')} /></div>;
  } else if (by === 'all') {
    content = (
      <>
        {data.truncated && <p className="adm-note" role="status">{t('admin.agents.truncated')}</p>}
        <AllMatrix data={data} onPropose={enqueue} />
        {batch}
      </>
    );
  } else if (by === 'role') {
    content = (
      <>
        {data.truncated && <p className="adm-note" role="status">{t('admin.agents.truncated')}</p>}
        <RoleCards data={data} />
      </>
    );
  } else {
    const person = personKey ? data.people.find(p => p.kc_sub === personKey) ?? null : null;
    content = (
      <>
        {data.truncated && <p className="adm-note" role="status">{t('admin.agents.truncated')}</p>}
        <div className="adm-chips" role="group" aria-label={t('admin.roles.people')}>
          {data.people.map(p => (
            <button key={p.kc_sub} type="button" className="adm-chip" aria-pressed={p.kc_sub === personKey}
              data-testid={`adm-roles-person-${p.kc_sub}`}
              onClick={() => { setQueue([]); setPerson(p.kc_sub === personKey ? null : p.kc_sub); }}>
              {p.name} <b>{p.cells.length}</b>
            </button>
          ))}
        </div>
        {!personKey && <p className="adm-hint">{t('admin.roles.pick')}</p>}
        {personKey && !person && (
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-roles-notfound">
            {t('admin.roles.notFound', { id: personKey })}
          </p>
        )}
        {person && (
          <PersonCard person={person} data={data} fetchImpl={fetchImpl}
            onPropose={changes => enqueue([{ kc_sub: person.kc_sub, changes }])} />
        )}
        {person && pending && pending.kc_sub === person.kc_sub && batch}
      </>
    );
  }

  const byChip = (key: RolesBy, label: string) => (
    <button type="button" role="radio" className="adm-chip" aria-checked={by === key} aria-pressed={by === key}
      data-testid={`adm-roles-by-${key}`}
      onClick={() => { setQueue([]); setBy(key === 'person' ? null : key); }}>{label}</button>
  );

  return (
    <section className="adm" aria-labelledby="adm-roles-h">
      <h2 id="adm-roles-h" className="adm-h">{t('admin.roles.title')}</h2>
      <p className="adm-lead">{t('admin.roles.lead')}</p>
      <div className="adm-chips" role="radiogroup" aria-label={t('admin.roles.by')}>
        {byChip('person', t('admin.roles.by.person'))}
        {byChip('all', t('admin.roles.by.all'))}
        {byChip('role', t('admin.roles.by.role'))}
      </div>
      {content}
    </section>
  );
}

function PersonCard({ person, data, onPropose, fetchImpl }: {
  person: PersonRoles;
  data: RolesData;
  onPropose: (changes: RoleChange[]) => void;
  fetchImpl?: typeof fetch;
}) {
  const t = useAppT();
  const [view, setView] = useUrlParam('adm-view');
  const isMatrix = view === 'matrix';
  return (
    <article className="adm-card" data-testid="adm-roles-card" aria-label={person.name}>
      <header className="adm-card__head">
        <span className="adm-name">{person.name}</span>
        <span className="adm-count">{t('admin.who.inProjects', { n: person.cells.length })}</span>
        {person.state !== 'checked' && (
          <span className="adm-missing" data-testid="adm-roles-unverified">{t('admin.roles.rowUnverified')}</span>
        )}
      </header>
      <div className="adm-chips" role="radiogroup" aria-label={t('admin.roles.view')}>
        <button type="button" role="radio" className="adm-chip" aria-checked={!isMatrix} aria-pressed={!isMatrix}
          data-testid="adm-roles-view-groups" onClick={() => setView(null)}>{t('admin.roles.view.groups')}</button>
        <button type="button" role="radio" className="adm-chip" aria-checked={isMatrix} aria-pressed={isMatrix}
          data-testid="adm-roles-view-matrix" onClick={() => setView('matrix')}>{t('admin.roles.view.matrix')}</button>
      </div>
      <PersonSources person={person} sourcesAsked={data.sourcesAsked} />
      {isMatrix
        ? <PersonMatrix person={person} data={data} onPropose={onPropose} />
        : <PersonGroups person={person} onPropose={onPropose} />}
      {/* S7B-04: «почему видит / не видит» — тот же разбор сервера, что в «Кто где»
          (GET /lore/admin/access, S7B-10), и скоуп его агентов (S7B-12). */}
      <section className="adm-why" aria-label={t('admin.roles.why')} data-testid="adm-roles-why">
        <PersonAgentsLine kcSub={person.kc_sub} isMe={false} fetchImpl={fetchImpl} />
        <EffectiveAccess kcSub={person.kc_sub} projects={data.projects} fetchImpl={fetchImpl} />
      </section>
    </article>
  );
}

/**
 * S7B-11: все проекты × все люди одной матрицей. Строка — проект (их много,
 * строки листаются), колонка — человек. Ячейки на человека (Keycloak, Forgejo)
 * — отдельной матрицей только на чтение: это не роль проекта.
 */
function AllMatrix({ data, onPropose }: { data: RolesData; onPropose: (items: PersonChanges[]) => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const notAsked = t('admin.roles.notAsked');
  const people = data.people.map(p => ({ key: p.kc_sub, title: p.name }));
  const sources = useMemo(() => {
    const s: string[] = [...PERSON_SOURCES];
    for (const p of data.people) for (const c of p.personCells) if (c.source && !s.includes(c.source)) s.push(c.source);
    return s;
  }, [data]);
  const propose = (changes: readonly MatrixChange[]) => {
    if (changes.length > 0) onPropose(splitByPerson(changes));
  };
  return (
    <div data-testid="adm-roles-all">
      <p className="adm-count" data-testid="adm-roles-all-total">
        {t('admin.roles.all.total', { p: data.projects.length, n: data.people.length, a: countAssignments(data) })}
      </p>
      <div data-testid="adm-roles-all-matrix">
        <Matrix
          rows={data.projects.map(p => ({ key: p, title: p }))}
          cols={people}
          cell={(row, col) => projectPersonCell(data, row, col, notAsked)}
          options={PROJECT_ROLES.map(r => ({ value: r, title: r }))}
          labels={{ rows: t('admin.roles.col.project'), cols: t('admin.col.person') }}
          onPropose={propose}
          lang={lang}
        />
      </div>
      <p className="adm-hint">{t('admin.roles.all.hint')}</p>
      <div data-testid="adm-roles-all-sources" role="group" aria-label={t('admin.roles.all.sources')}>
        <h3 className="adm-access__h">{t('admin.roles.all.sources')}</h3>
        <Matrix
          rows={sources.map(s => ({ key: s, title: SOURCE_TITLE[s] ?? s }))}
          cols={people}
          cell={(src, kc) => {
            const person = data.people.find(p => p.kc_sub === kc);
            return personSourceCell(person?.personCells.find(c => (c.source ?? '') === src), data.sourcesAsked, src);
          }}
          options={[]}
          labels={{ rows: t('admin.roles.sources.col'), cols: t('admin.col.person') }}
          lang={lang}
        />
        <p className="adm-hint">{t('admin.roles.sources.hint')}</p>
      </div>
    </div>
  );
}

/** S7B-04: карточка роли — что даёт и у кого есть. Выбор роли — в адресе (adm-role). */
function RoleCards({ data }: { data: RolesData }) {
  const t = useAppT();
  const [role, setRole] = useUrlParam('adm-role');
  const summary = useMemo(() => roleSummary(data), [data]);
  const byRole = new Map(summary.map(s => [s.role, s]));
  // Закрытый список ролей плюс роли из данных, которых в нём нет (не прячем чужое).
  const roles = [...PROJECT_ROLES, ...summary.map(s => s.role).filter(r => !(PROJECT_ROLES as readonly string[]).includes(r))];
  const holders = role ? roleHolders(data, role) : [];
  const allChecked = data.people.every(p => p.state === 'checked') && data.sourcesAsked.length > 0;
  const open = (kc: string) => setUrlParams({ [BY_PARAM]: null, 'adm-role': null, 'adm-person': kc });
  return (
    <>
      <div className="adm-chips" role="group" aria-label={t('admin.roles.role.list')}>
        {roles.map(r => {
          const s = byRole.get(r);
          return (
            <button key={r} type="button" className="adm-chip" aria-pressed={r === role} data-testid={`adm-role-${r}`}
              onClick={() => setRole(r === role ? null : r)}>
              {r} <b>{s ? s.assignments : 0}</b>
            </button>
          );
        })}
      </div>
      {!role && <p className="adm-hint">{t('admin.roles.role.pick')}</p>}
      {role && (
        <article className="adm-card" data-testid="adm-role-card" aria-label={role}>
          <header className="adm-card__head">
            <Pill>{role}</Pill>
            {byRole.get(role) && (
              <span className="adm-count">{t('admin.roles.role.count', { people: byRole.get(role)!.people, a: byRole.get(role)!.assignments })}</span>
            )}
          </header>
          <p className="adm-verdict" data-testid="adm-role-grants" data-write={String(roleCanWrite(role))}>
            {t(roleCanWrite(role) ? 'admin.roles.role.grantsWrite' : 'admin.roles.role.grantsRead', { role })}
          </p>
          <p className="adm-hint">{t('admin.roles.role.bypass')}</p>
          <h3 className="adm-access__h">{t('admin.roles.role.holders')}</h3>
          {holders.length === 0
            ? (
              <p className="adm-note" data-tone={allChecked ? 'inf' : 'wrn'} role="status" data-testid="adm-role-nobody">
                {t(allChecked ? 'admin.roles.role.nobody' : 'admin.roles.role.nobodyUnverified', { role })}
              </p>
            )
            : (
              <ul className="adm-list">
                {holders.map(h => (
                  <li key={h.kc_sub} data-testid={`adm-role-holder-${h.kc_sub}`}>
                    <details>
                      <summary>
                        <span className="adm-name">{h.name}</span>
                        <span className="adm-count">{t('admin.roles.role.inProjects', { n: h.projects.length })}</span>
                        <button type="button" className="adm-btn" data-testid={`adm-role-open-${h.kc_sub}`}
                          onClick={e => { e.preventDefault(); open(h.kc_sub); }}>{t('admin.roles.role.open')}</button>
                      </summary>
                      <ul className="adm-plist">
                        {h.projects.map(p => <li key={p}><span className="adm-mono">{p}</span></li>)}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
        </article>
      )}
    </>
  );
}

/** Имена источников — собственные имена систем, не переводятся. */
const SOURCE_TITLE: Record<string, string> = { kc: 'Keycloak', forgejo: 'Forgejo' };

/**
 * S7B-11: ячейки на человека — Keycloak (realm-роли) и Forgejo. Только на
 * чтение (kit Matrix без onPropose): это не роль проекта, и правится она не здесь.
 */
function PersonSources({ person, sourcesAsked }: { person: PersonRoles; sourcesAsked: readonly string[] }) {
  const t = useAppT();
  const lang = useKitLang();
  const sources = useMemo(() => {
    const s: string[] = [...PERSON_SOURCES];
    for (const c of person.personCells) if (c.source && !s.includes(c.source)) s.push(c.source);
    return s;
  }, [person]);
  const bySource = useMemo(() => new Map(person.personCells.map(c => [c.source ?? '', c])), [person]);
  return (
    <div data-testid="adm-roles-sources" aria-label={t('admin.roles.sources')} role="group">
      <Matrix
        rows={[{ key: person.kc_sub, title: person.name }]}
        cols={sources.map(s => ({ key: s, title: SOURCE_TITLE[s] ?? s }))}
        cell={(_r, col) => personSourceCell(bySource.get(col), sourcesAsked, col)}
        options={[]}
        labels={{ rows: t('admin.col.person'), cols: t('admin.roles.sources.col') }}
        lang={lang}
      />
      <p className="adm-hint">{t('admin.roles.sources.hint')}</p>
    </div>
  );
}

/** S7B-09: группы по роли, поиск, мультивыбор, одна панель на всё выбранное. */
function PersonGroups({ person, onPropose }: { person: PersonRoles; onPropose: (changes: RoleChange[]) => void }) {
  const t = useAppT();
  const [q, setQ] = useUrlParam('adm-q');
  const [selRaw, setSelRaw] = useUrlParam('adm-sel');
  const [role, setRole] = useState('');
  const own = useMemo(() => new Set(person.cells.map(c => c.project)), [person]);
  // Отмеченное, которого у человека нет (ссылка устарела), — не в счёт.
  const selected = useMemo(
    () => (selRaw ?? '').split(SEL_SEP).filter(s => s !== '' && own.has(s)),
    [selRaw, own],
  );
  const selSet = new Set(selected);
  const visible = filterProjects(person.cells, q ?? '');
  const groups = groupByRole(visible);

  const setSel = (next: readonly string[]) => setSelRaw(next.length ? [...next].sort().join(SEL_SEP) : null, { replace: true });
  const toggle = (projects: readonly string[], on: boolean) => {
    const s = new Set(selected);
    projects.forEach(p => (on ? s.add(p) : s.delete(p)));
    setSel([...s]);
  };

  if (person.cells.length === 0) {
    return <p className="adm-note" data-tone="inf" role="status" data-testid="adm-roles-none">{t('admin.roles.none')}</p>;
  }

  return (
    <>
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.roles.search')}</span>
        <input className="adm-input adm-roles__search" type="search" value={q ?? ''} data-testid="adm-roles-search"
          onChange={e => setQ(e.target.value === '' ? null : e.target.value, { replace: true })} />
      </label>
      {visible.length === 0 && (
        <p className="adm-note" role="status" data-testid="adm-roles-nomatch">{t('admin.roles.noMatch')}</p>
      )}
      <ul className="adm-list" data-testid="adm-roles-groups">
        {groups.map(g => {
          const all = g.projects.every(p => selSet.has(p));
          return (
            <li key={g.role}>
              <details data-testid={`adm-roles-group-${g.role || 'none'}`}>
                <summary>
                  <input type="checkbox" checked={all} aria-label={t('admin.roles.group.select', { role: g.role || '—' })}
                    data-testid={`adm-roles-groupsel-${g.role || 'none'}`}
                    onClick={e => e.stopPropagation()} onChange={e => toggle(g.projects, e.target.checked)} />
                  <Pill>{g.role || '—'}</Pill>
                  <span className="adm-count">{g.projects.length}</span>
                </summary>
                <ul className="adm-plist">
                  {g.projects.map(p => (
                    <li key={p} data-testid={`adm-roles-row-${p}`}>
                      <label className="adm-roles__row">
                        <input type="checkbox" checked={selSet.has(p)} onChange={e => toggle([p], e.target.checked)} />
                        <span className="adm-mono">{p}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      <div className="adm-filters adm-roles__panel" role="group" aria-label={t('admin.roles.panel')}>
        <span className="adm-count" data-testid="adm-roles-selected">{t('admin.roles.selected', { n: selected.length })}</span>
        <button type="button" className="adm-btn" data-testid="adm-roles-selectall"
          onClick={() => toggle(visible.map(c => c.project), true)}>{t('admin.roles.selectAll')}</button>
        <button type="button" className="adm-btn" data-testid="adm-roles-clearsel" disabled={selected.length === 0}
          onClick={() => setSel([])}>{t('admin.roles.clearSel')}</button>
        <select className="adm-select" value={role} data-testid="adm-roles-setrole" aria-label={t('admin.roles.newRole')}
          onChange={e => setRole(e.target.value)}>
          <option value="">{t('admin.roles.newRole')}</option>
          {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="adm-btn" data-testid="adm-roles-apply-set"
          disabled={selected.length === 0 || role === ''}
          onClick={() => onPropose(buildChanges(selected, { kind: 'set', role }))}>{t('admin.roles.set')}</button>
        <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-roles-apply-remove"
          disabled={selected.length === 0}
          onClick={() => onPropose(buildChanges(selected, { kind: 'remove' }))}>{t('admin.roles.remove')}</button>
        <p className="adm-hint">{t('admin.roles.panelHint')}</p>
      </div>
    </>
  );
}

/** S7B-05: матрица ролей человека по проектам; правка — предложение, применяет DangerBatch. */
function PersonMatrix({ person, data, onPropose }: {
  person: PersonRoles;
  data: RolesData;
  onPropose: (changes: RoleChange[]) => void;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const byProject = useMemo(() => new Map(person.cells.map(c => [c.project, c])), [person]);
  // «Роли нет» утверждаем, только если строка проверена И сервер назвал опрошенные источники.
  const noneIsKnown = person.state === 'checked' && data.sourcesAsked.length > 0;
  const cell = (_row: string, col: string): MatrixCellState => {
    const c = byProject.get(col);
    if (!c) return noneIsKnown ? { state: 'none' } : { state: 'unverified', reason: t('admin.roles.notAsked') };
    if (c.state === 'forbidden') return { state: 'forbidden', reason: c.source ?? undefined };
    if (c.state === 'unavailable') return { state: 'unverified', reason: c.source ?? t('admin.roles.notAsked') };
    return c.role ? { state: 'value', value: c.role } : { state: 'none' };
  };
  const propose = (changes: readonly MatrixChange[]) => {
    if (changes.length === 0) return;
    onPropose(changes.map(ch => (ch.value === null ? { project: ch.col, action: 'remove' as const } : { project: ch.col, role: ch.value })));
  };
  return (
    <div data-testid="adm-roles-matrix">
      <Matrix
        rows={[{ key: person.kc_sub, title: person.name }]}
        cols={data.projects.map(p => ({ key: p, title: p }))}
        cell={cell}
        options={PROJECT_ROLES.map(r => ({ value: r, title: r }))}
        labels={{ rows: t('admin.col.person'), cols: t('admin.roles.col.project') }}
        onPropose={propose}
        lang={lang}
      />
      <p className="adm-hint">{t('admin.roles.matrixHint')}</p>
    </div>
  );
}
