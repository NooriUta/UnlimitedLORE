// Экраны «Люди и их проекты» и «Проекты» админки v2 (UC-8, SPEC-ADMIN-LORE-UC 1.2.0).
// Два разворота одних и тех же данных — два раздела меню (S7B-28, владелица
// 11.11: «люди и проекты будут двумя разделами»; раньше — один раздел «Кто где»
// с переключателем осей ?adm-by=…):
//   • adm-who «Люди и их проекты» — в скольких проектах человек, его роль в
//     каждом и его агенты;
//   • adm-projects «Проекты» — кто в проекте, с какой ролью и чьи агенты там
//     работают, плюс «вы: роль» для смотрящего. Точка роста раздела проектов.
// Строки свёрнуты (details): в шапке — числа, раскрытие — подробности. Так
// пять человек и двадцать пять проектов помещаются на экран, а не в ленту.
import { useMemo, useState, type SyntheticEvent } from 'react';
import { Drawer, EmptyState, Forbidden, ListView, LoadError, Pill, Skeleton, useKitLang, useLoadState, useUrlParam } from '@seidr/kit';
import { useAppT } from '../i18n';
import { fetchParticipation, filterProjectViews, type Participation, type Person } from './participation';
import { peopleListConfig, peopleRecords } from './peopleList';
import { PersonWizard } from './WizardsScreen';
import { loreFetch } from '../auth/session';
import type { AgentRow } from './agents';
import { EffectiveAccess, MyProjectsChip, PersonAgentsLine, WhoSeesBlock } from './AccessBlocks';
import { PersonMachines } from './MachinesScreen';
import { PersonOffboard } from './PersonOffboard';
import './Admin.css';

/** Ось экрана: раздел «Люди и их проекты» или раздел «Проекты». */
export type WhoWhereView = 'people' | 'projects';

export interface WhoWhereScreenProps {
  /** Какой раздел рисуем; по умолчанию — «Люди и их проекты». */
  view?: WhoWhereView;
  fetchImpl?: typeof fetch;
  /** kc_sub смотрящего — для пометки «это вы». */
  meSub?: string | null;
}

export function WhoWhereScreen({ view = 'people', fetchImpl, meSub = null }: WhoWhereScreenProps) {
  const t = useAppT();
  // Раскрытая строка — в адресе (?adm-open=kc_sub | slug): ссылка открывает тот же вопрос «почему».
  const [open, setOpen] = useUrlParam('adm-open');
  // S7B-25: поиск — в адресе (?adm-q=…), ссылка открывает ту же выборку.
  const [query, setQuery] = useUrlParam('adm-q');
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
    // S7B-28: люди — стандартный список kit (PeoplePanel), не details.
    if (view === 'people') return null;
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
  }, [data, view, meSub, t, open, setOpen, fetchImpl, allSlugs, query]);
  // У «Людей» поиск — в самом списке kit; «ничего не нашли» — его честное состояние.
  const nothing = view === 'projects' && !!data && !!(query ?? '').trim()
    && filterProjectViews(data.projects, query).length === 0;

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
        ) : view === 'people' ? (
          <PeoplePanel data={data} meSub={meSub} fetchImpl={fetchImpl} allSlugs={allSlugs} />
        ) : body}
      </>
    );
  }

  return (
    <section className="adm" aria-labelledby="adm-who-h" data-view={view}>
      <h2 id="adm-who-h" className="adm-h">{t(view === 'projects' ? 'admin.projects.title' : 'admin.who.title')}</h2>
      <p className="adm-lead">{t(view === 'projects' ? 'admin.projects.lead' : 'admin.who.lead')}</p>
      {view === 'projects' && <label className="adm-field adm-who__q">
        <span className="adm-field__l">{t('admin.who.q')}</span>
        <input className="adm-input" type="search" value={query ?? ''} data-testid="adm-who-q"
          placeholder={t('admin.who.qHint')} spellCheck={false}
          onChange={e => setQuery(e.target.value === '' ? null : e.target.value, { replace: true })} />
      </label>}
      {content}
    </section>
  );
}

// ── S7B-28: «Люди и их проекты» — стандартный список, строка открывает паспорт ──
//
// Владелица 11.11.2026: «Люди должны быть табличным стандартным значением, а тот
// экран, который собран сейчас, должен стать паспортом». Паспорт — всё, что
// было в раскрытой строке: проекты и роли, агенты, «Все мои», агенты машины,
// эффективный доступ. Открытый человек — в адресе (?adm-open=kc_sub).
function PeoplePanel({ data, meSub, fetchImpl, allSlugs }: {
  data: Participation; meSub: string | null; fetchImpl?: typeof fetch; allSlugs: string[];
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [open, setOpen] = useUrlParam('adm-open');
  const [q] = useUrlParam('adm-q');
  const [adding, setAdding] = useState(false);
  const config = useMemo(() => peopleListConfig(lang), [lang]);
  const records = useMemo(() => peopleRecords(data, meSub, t('admin.who.you')), [data, meSub, t]);
  const kitData = useMemo(() => ({
    records, edges: [], journal: [],
    meta: { generated_at: new Date().toISOString(), returned: records.length, ...(data.truncated ? { truncated: true } : {}) },
  }), [records, data.truncated]);
  const person = open ? data.people.find(p => p.kc_sub === open) ?? null : null;
  return (
    <>
      <div className="adm-people__bar">
        <button type="button" className="sk-btn" onClick={() => setAdding(true)}>{t('admin.people.add')}</button>
      </div>
      {/* Старые ссылки ?adm-q=… (S7B-25) открывают ту же выборку — текстом поиска списка. */}
      <ListView config={config} data={kitData} onOpen={id => setOpen(id)} initial={q ? { text: q } : undefined} />
      {person && (
        <Drawer open onClose={() => setOpen(null)} title={person.name}>
          <PersonPassport person={person} meSub={meSub} fetchImpl={fetchImpl} allSlugs={allSlugs} />
        </Drawer>
      )}
      {adding && (
        <Drawer open onClose={() => setAdding(false)} title={t('admin.wiz.person.title')}>
          <PersonWizard fetchImpl={fetchImpl ?? loreFetch} onDone={() => setAdding(false)} />
        </Drawer>
      )}
    </>
  );
}

/** Паспорт человека — содержимое прежней раскрытой строки, без потерь. */
function PersonPassport({ person: p, meSub, fetchImpl, allSlugs }: { person: Person; meSub: string | null; fetchImpl?: typeof fetch; allSlugs: string[] }) {
  const t = useAppT();
  const isMe = p.kc_sub === meSub;
  // S7B-20 (UC-4): «Отключить…» — действие паспорта; кого отключаем — в адресе (?adm-off=kc_sub).
  const [off, setOff] = useUrlParam('adm-off');
  return (
    <div className="adm-passport" data-testid={`adm-person-${p.kc_sub}`}>
      <p className="adm-sub">
        {isMe && <span className="adm-me">{t('admin.who.you')}</span>}
        {isMe && <MyProjectsChip fetchImpl={fetchImpl} />}
        <span className="adm-count" data-testid="adm-person-projects">{t('admin.who.inProjects', { n: p.projects.length })}</span>
        <span className="adm-count">{t('admin.who.agents', { n: p.agents.length })}</span>
      </p>
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
        {p.agents.length
          ? p.agents.map(a => <Pill key={a.actor_id} variant="id" title={a.harness ?? t('admin.harness.none')}>{a.name ?? a.actor_id}</Pill>)
          : <span className="adm-missing">{t('admin.who.noAgents')}</span>}
      </p>
      <PersonAgentsLine kcSub={p.kc_sub} isMe={isMe} fetchImpl={fetchImpl} />
      <EffectiveAccess kcSub={p.kc_sub} projects={allSlugs} fetchImpl={fetchImpl} />
      {/* S7B-ACL-3: машины, которыми человек владеет и к которым допущен. */}
      <PersonMachines kcSub={p.kc_sub} fetchImpl={fetchImpl} />
      {/* S7B-20: инвентаризация «за человеком числится» и снятие по блокам — в самом паспорте. */}
      {off === p.kc_sub
        ? <PersonOffboard person={{ kc_sub: p.kc_sub, name: p.name }} meSub={meSub} fetchImpl={fetchImpl} onClose={() => setOff(null)} />
        : (
          <div className="adm-filters">
            <button type="button" className="adm-btn adm-btn--dng" data-testid={`adm-off-open-${p.kc_sub}`}
              onClick={() => setOff(p.kc_sub)}>{t('admin.off.open')}</button>
          </div>
        )}
    </div>
  );
}
