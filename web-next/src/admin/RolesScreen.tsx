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
  EmptyState, Forbidden, LoadError, Matrix, Pill, Skeleton, useKitLang, useLoadState, useUrlParam,
  type MatrixCellState, type MatrixChange,
} from '@seidr/kit';
import { useAppT } from '../i18n';
import { DangerBatch } from './DangerBatch';
import {
  buildChanges, fetchRoleMatrix, filterProjects, groupByRole, PERSON_SOURCES, personSourceCell, PROJECT_ROLES,
  type PersonRoles, type RoleChange, type RolesData,
} from './roles';
import './Admin.css';

export interface RolesScreenProps {
  fetchImpl?: typeof fetch;
}

/** Отмеченные проекты в адресе — через запятую (в slug запятой не бывает: SAFE_ID). */
const SEL_SEP = ',';

export function RolesScreen({ fetchImpl }: RolesScreenProps) {
  const t = useAppT();
  const [personKey, setPerson] = useUrlParam('adm-person');
  const res = useLoadState<RolesData>(signal => fetchRoleMatrix(signal, fetchImpl), [fetchImpl], { rows: d => d.people });
  const data = res.data;
  const [pending, setPending] = useState<{ kc_sub: string; changes: RoleChange[] } | null>(null);

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
  } else {
    const person = personKey ? data.people.find(p => p.kc_sub === personKey) ?? null : null;
    content = (
      <>
        {data.truncated && <p className="adm-note" role="status">{t('admin.agents.truncated')}</p>}
        <div className="adm-chips" role="group" aria-label={t('admin.roles.people')}>
          {data.people.map(p => (
            <button key={p.kc_sub} type="button" className="adm-chip" aria-pressed={p.kc_sub === personKey}
              data-testid={`adm-roles-person-${p.kc_sub}`}
              onClick={() => { setPending(null); setPerson(p.kc_sub === personKey ? null : p.kc_sub); }}>
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
          <PersonCard person={person} data={data}
            onPropose={changes => setPending({ kc_sub: person.kc_sub, changes })} />
        )}
        {person && pending && pending.kc_sub === person.kc_sub && (
          <DangerBatch person={person} changes={pending.changes} fetchImpl={fetchImpl}
            onClose={() => setPending(null)} onChanged={res.reload} />
        )}
      </>
    );
  }

  return (
    <section className="adm" aria-labelledby="adm-roles-h">
      <h2 id="adm-roles-h" className="adm-h">{t('admin.roles.title')}</h2>
      <p className="adm-lead">{t('admin.roles.lead')}</p>
      {content}
    </section>
  );
}

function PersonCard({ person, data, onPropose }: {
  person: PersonRoles;
  data: RolesData;
  onPropose: (changes: RoleChange[]) => void;
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
    </article>
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
