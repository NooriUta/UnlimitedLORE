// Экран «Кто где» админки v2 (UC-8, SPEC-ADMIN-LORE-UC 1.2.0).
// Два разворота одних и тех же данных:
//   • «Люди» — в скольких проектах человек, его роль в каждом и его агенты;
//   • «Проекты» — кто в проекте, с какой ролью и чьи агенты там работают,
//     плюс «это вы» для смотрящего.
// Строки свёрнуты (details): в шапке — числа, раскрытие — подробности. Так
// пять человек и двадцать пять проектов помещаются на экран, а не в ленту.
import { useMemo, type SyntheticEvent } from 'react';
import { EmptyState, Forbidden, LoadError, Pill, Skeleton, useLoadState, useUrlParam } from '@seidr/kit';
import { useAppT } from '../i18n';
import { fetchParticipation, filterPeople, filterProjectViews, type Participation } from './participation';
import type { AgentRow } from './agents';
import { EffectiveAccess, MyProjectsChip, PersonAgentsLine, WhoSeesBlock } from './AccessBlocks';
import { PersonOffboard } from './PersonOffboard';
import './Admin.css';

export interface WhoWhereScreenProps {
  fetchImpl?: typeof fetch;
  /** kc_sub смотрящего — для пометки «это вы». */
  meSub?: string | null;
}

export function WhoWhereScreen({ fetchImpl, meSub = null }: WhoWhereScreenProps) {
  const t = useAppT();
  const [by, setBy] = useUrlParam('adm-by');
  const view = by === 'projects' ? 'projects' : 'people';
  // Раскрытая строка — в адресе (?adm-open=kc_sub | slug): ссылка открывает тот же вопрос «почему».
  const [open, setOpen] = useUrlParam('adm-open');
  // S7B-25: поиск — в адресе (?adm-q=…), ссылка открывает ту же выборку.
  const [query, setQuery] = useUrlParam('adm-q');
  // S7B-20 (UC-4): «Отключить…» из карточки человека — кого отключаем, в адресе.
  const [off, setOff] = useUrlParam('adm-off');
  const res = useLoadState<Participation>(signal => fetchParticipation(signal, fetchImpl), [fetchImpl], { rows: d => d.people });
  const data = res.data;
  const agentNames = (list: AgentRow[]) => list.map(a => (
    <Pill key={a.actor_id} variant="id" title={a.harness ?? t('admin.harness.none')}>{a.name ?? a.actor_id}</Pill>
  ));

  const allSlugs = useMemo(() => (data ? data.projects.map(p => p.slug) : []), [data]);
  const body = useMemo(() => {
    if (!data) return null;
    const toggle = (key: string) => (e: SyntheticEvent<HTMLDetailsElement>) => {
      const isOpen = e.currentTarget.open;
      if (isOpen && open !== key) setOpen(key);
      else if (!isOpen && open === key) setOpen(null);
    };
    if (view === 'people') {
      return (
        <ul className="adm-list" data-testid="adm-people">
          {filterPeople(data.people, query).map(p => (
            <li key={p.kc_sub}>
              <details data-testid={`adm-person-${p.kc_sub}`} open={open === p.kc_sub} onToggle={toggle(p.kc_sub)}>
                <summary>
                  <span className="adm-name">{p.name}</span>
                  {p.kc_sub === meSub && <span className="adm-me">{t('admin.who.you')}</span>}
                  {p.kc_sub === meSub && <MyProjectsChip fetchImpl={fetchImpl} />}
                  <span className="adm-count" data-testid="adm-person-projects">{t('admin.who.inProjects', { n: p.projects.length })}</span>
                  <span className="adm-count">{t('admin.who.agents', { n: p.agents.length })}</span>
                </summary>
                <table className="adm-table">
                  <tbody>
                    {p.projects.map(pr => (
                      <tr key={pr.slug}>
                        <th scope="row"><span className="adm-mono">{pr.slug}</span></th>
                        <td><Pill>{pr.role || '—'}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="adm-sub">
                  {t('admin.who.hisAgents')}{' '}
                  {p.agents.length ? agentNames(p.agents) : <span className="adm-missing">{t('admin.who.noAgents')}</span>}
                </p>
                {open === p.kc_sub && (
                  <>
                    <PersonAgentsLine kcSub={p.kc_sub} isMe={p.kc_sub === meSub} fetchImpl={fetchImpl} />
                    <EffectiveAccess kcSub={p.kc_sub} projects={allSlugs} fetchImpl={fetchImpl} />
                    {off === p.kc_sub
                      ? <PersonOffboard person={{ kc_sub: p.kc_sub, name: p.name }} meSub={meSub} fetchImpl={fetchImpl} onClose={() => setOff(null)} />
                      : (
                        <button type="button" className="adm-btn adm-btn--dng" data-testid={`adm-off-open-${p.kc_sub}`}
                          onClick={() => setOff(p.kc_sub)}>{t('admin.off.open')}</button>
                      )}
                  </>
                )}
              </details>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <ul className="adm-list" data-testid="adm-projects">
        {filterProjectViews(data.projects, query).map(pr => (
          <li key={pr.slug}>
            <details data-testid={`adm-project-${pr.slug}`} open={open === pr.slug} onToggle={toggle(pr.slug)}>
              <summary>
                <span className="adm-name adm-mono">{pr.slug}</span>
                <span className="adm-count">{t('admin.who.people', { n: pr.members.length })}</span>
                <span className="adm-count">{t('admin.who.agents', { n: pr.agentCount })}</span>
                {meSub && pr.members.some(m => m.kc_sub === meSub) && (
                  <span className="adm-me">{t('admin.who.youAre', { role: pr.members.find(m => m.kc_sub === meSub)!.role })}</span>
                )}
              </summary>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.col.person')}</th>
                    <th scope="col">{t('admin.col.role')}</th>
                    <th scope="col">{t('admin.col.hisAgents')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pr.members.map(m => (
                    <tr key={m.kc_sub} data-me={m.kc_sub === meSub || undefined}>
                      <th scope="row">{m.name}{m.kc_sub === meSub && <span className="adm-me">{t('admin.who.you')}</span>}</th>
                      <td><Pill>{m.role || '—'}</Pill></td>
                      <td>{m.agents.length ? agentNames(m.agents) : <span className="adm-missing">{t('admin.who.noAgents')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {open === pr.slug && <WhoSeesBlock project={pr.slug} fetchImpl={fetchImpl} />}
            </details>
          </li>
        ))}
      </ul>
    );
  }, [data, view, meSub, t, open, setOpen, fetchImpl, allSlugs, query, off, setOff]);
  const nothing = !!data && !!(query ?? '').trim()
    && (view === 'people' ? filterPeople(data.people, query) : filterProjectViews(data.projects, query)).length === 0;

  let content;
  if (res.state === 'loading' && !data) content = <Skeleton lines={6} label={t('admin.who.loading')} />;
  else if (res.state === 'forbidden') content = <Forbidden reason={res.error instanceof Error ? res.error.message : undefined} />;
  else if (res.state === 'error' || !data) content = <LoadError error={res.error} onRetry={res.reload} />;
  else if (data.people.length === 0) content = <EmptyState title={t('admin.who.empty')} />;
  else {
    content = (
      <>
        {data.truncated && <p className="adm-note" role="status">{t('admin.agents.truncated')}</p>}
        {data.agentsError && <p className="adm-note" role="status" data-testid="adm-agents-error">{t('admin.who.agentsError', { reason: data.agentsError })}</p>}
        {data.orphanAgents.length > 0 && (
          <p className="adm-note" role="status" data-testid="adm-orphans">
            {t('admin.who.orphans', { n: data.orphanAgents.length })} {agentNames(data.orphanAgents)}
          </p>
        )}
        {nothing ? (
          <div data-testid="adm-who-nothing">
            <EmptyState title={t('admin.who.nothing', { q: (query ?? '').trim() })} hint={t('admin.who.nothingHint')}
              action={<button type="button" className="sk-btn" onClick={() => setQuery(null, { replace: true })}>{t('admin.who.qReset')}</button>} />
          </div>
        ) : body}
      </>
    );
  }

  return (
    <section className="adm" aria-labelledby="adm-who-h">
      <h2 id="adm-who-h" className="adm-h">{t('admin.who.title')}</h2>
      <p className="adm-lead">{t('admin.who.lead')}</p>
      <div className="adm-chips" role="radiogroup" aria-label={t('admin.who.by')}>
        <button type="button" role="radio" className="adm-chip" aria-checked={view === 'people'} aria-pressed={view === 'people'}
          data-testid="adm-by-people" onClick={() => setBy(null)}>{t('admin.who.byPeople')}</button>
        <button type="button" role="radio" className="adm-chip" aria-checked={view === 'projects'} aria-pressed={view === 'projects'}
          data-testid="adm-by-projects" onClick={() => setBy('projects')}>{t('admin.who.byProjects')}</button>
      </div>
      <label className="adm-field adm-who__q">
        <span className="adm-field__l">{t('admin.who.q')}</span>
        <input className="adm-input" type="search" value={query ?? ''} data-testid="adm-who-q"
          placeholder={t('admin.who.qHint')} spellCheck={false}
          onChange={e => setQuery(e.target.value === '' ? null : e.target.value, { replace: true })} />
      </label>
      {content}
    </section>
  );
}
