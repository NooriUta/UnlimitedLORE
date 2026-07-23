// Экран «Фичи» продуктового слоя (ADR-LORE-022/032, Остервальдер + Коберн).
// Master-detail: список фич слева + паспорт справа (мост в профиль VP + реализация US).
// Дизайн зеркалит утверждённый прототип featureP. Данные — через useSlice/fetchLoreSlice.
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type { LoreFeatureRow, LoreUcRow, LoreUcTaskRow } from '../../../api/lore';
import { fetchLoreSlice } from '../../../api/lore';
import LoreSkeleton from '../LoreSkeleton';
import { EmptyState } from '../EmptyState';
import {
  type ProductScreenProps,
  useSlice,
  asArray,
  Pill,
  PSection,
  TRow,
  LinkChip,
  MasterDetail,
  ListRow,
  PassportHeader,
  EmptyDetail,
  ListSearch,
} from './shared';
import { ucStatusLabel, goalLevelLabel } from './vocab';
import UsFormModal, { type UsDraft } from './UsFormModal';

// Уровень цели (Коберн, D1): облако / воздушный змей.
// Хелпер модульного уровня — `t` здесь недоступен, поэтому отдаём КЛЮЧ, а
// разрешает его вызывающий компонент. Для неизвестного уровня ключа нет:
// показываем сырое значение из данных как есть.
function goalOf(level: string | null | undefined): { glyph: string; labelKey: string | null; raw: string } {
  const v = (level ?? '').toLowerCase();
  if (v.includes('cloud') || v.includes('☁')) return { glyph: '☁', labelKey: 'lore.product.goal.cloud', raw: 'облако' };
  if (v.includes('kite') || v.includes('🪁')) return { glyph: '🪁', labelKey: 'lore.product.goal.kite', raw: 'змей' };
  return { glyph: '', labelKey: null, raw: level ?? '' };
}

// Глиф статуса US.
function ucGlyph(status: string | null | undefined): string {
  const v = (status ?? '').toLowerCase();
  if (v === 'shipped') return '✅';
  if (v === 'active') return '🔄';
  return '⚡';
}

/**
 * Тон спринт-чипа задачи (PL-16).
 *
 * Красит статус СПРИНТА, а не задачи: «сделано» в отменённом спринте и
 * «сделано» в живом — разные новости, а по статусу самой задачи неразличимы.
 * Строки статусов приходят с эмодзи-префиксом (`✅ DONE`), поэтому сверяем
 * вхождением, а не равенством.
 */
export function sprintTone(sprintStatus: string | null | undefined): 'ok' | 'act' | 'warn' | 'muted' {
  const v = (sprintStatus ?? '').toLowerCase();
  if (v.includes('cancel')) return 'warn';
  if (v.includes('done')) return 'ok';
  if (v.includes('progress') || v.includes('active')) return 'act';
  return 'muted';
}

export default function LoreFeatures({ selectedId, onSelect, onNavigate, onError, listSearch, onListSearch, expandedUc, onExpandUc }: ProductScreenProps) {
  const { t } = useTranslation();
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [creatingChild, setCreatingChild] = useState<string | null>(null);
  const [editingRoot, setEditingRoot] = useState<UsDraft | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { rows, loading } = useSlice<LoreFeatureRow>('features', undefined, onError, [reloadKey]);

  // Задачи раскрытого сценария (PL-16). Грузим ТОЛЬКО раскрытый узел, а не все
  // разом: фича с двумя десятками US дала бы столько же запросов на открытие
  // паспорта, из которых посмотрят один.
  const [ucTasks, setUcTasks] = useState<LoreUcTaskRow[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  useEffect(() => {
    if (!expandedUc) { setUcTasks([]); return; }
    const ctrl = new AbortController();
    setTasksLoading(true);
    fetchLoreSlice<LoreUcTaskRow>('tasks_of_uc', { id: expandedUc }, ctrl.signal)
      .then(r => { setUcTasks(r); setTasksLoading(false); })
      .catch(e => { if (!ctrl.signal.aborted) { onError(e); setTasksLoading(false); } });
    return () => ctrl.abort();
  }, [expandedUc, onError]);

  // Use cases выбранной фичи (замыкают fit-мост).
  const [ucs, setUcs] = useState<LoreUcRow[]>([]);
  useEffect(() => {
    if (!selectedId) { setUcs([]); return; }
    const ctrl = new AbortController();
    fetchLoreSlice<LoreUcRow>('use_cases_of_feature', { id: selectedId }, ctrl.signal)
      .then(r => setUcs(r))
      .catch(e => { if (!ctrl.signal.aborted) onError(e); });
    return () => ctrl.abort();
  }, [selectedId, onError]);

  // ── список ──
  const q = (listSearch ?? '').trim().toLowerCase();
  const filtered = q
    ? rows.filter(f => f.uc_id.toLowerCase().includes(q) || (f.title ?? '').toLowerCase().includes(q))
    : rows;

  let list;
  if (loading) {
    list = <LoreSkeleton rows={6} />;
  } else if (filtered.length === 0) {
    list = <EmptyState message={t('lore.product.feat.empty', 'Фичей пока нет')} hint={t('lore.product.feat.emptyHint', 'Заводятся через MCP feature_new')} />;
  } else {
    list = (
      <>
        {filtered.map(f => {
          const g = goalOf(f.goal_level).glyph;
          return (
            <ListRow
              key={f.uc_id}
              id={f.uc_id}
              title={f.title}
              selected={f.uc_id === selectedId}
              onClick={() => onSelect(f.uc_id)}
              meta={<Pill>{g} · {f.uc_shipped ?? 0}/{f.uc_total ?? 0} US</Pill>}
            />
          );
        })}
      </>
    );
  }

  // ── паспорт ──
  let detail;
  if (!selectedId) {
    detail = <EmptyDetail text={t('lore.product.feat.pick', 'Выберите фичу слева')} />;
  } else {
    const f = rows.find(x => x.uc_id === selectedId);
    if (!f) {
      detail = <EmptyDetail text={t('lore.product.feat.pick', 'Выберите фичу слева')} />;
    } else {
      const status = (f.status ?? '').toLowerCase();

      // Заявлено фичей.
      const jobIds = asArray(f.job_ids);
      const painIds = asArray(f.pain_ids);
      const gainIds = asArray(f.gain_ids);
      const claimedCount = jobIds.length + painIds.length + gainIds.length;

      // Покрыто UC — что реально замкнуто (RELIEVES/DELIVERS/PERFORMS).
      const coveredPains = new Set<string>();
      const coveredGains = new Set<string>();
      const coveredJobs = new Set<string>();
      for (const uc of ucs) {
        for (const p of asArray(uc.relieves_pain_ids)) coveredPains.add(p);
        for (const gg of asArray(uc.delivers_gain_ids)) coveredGains.add(gg);
        for (const j of asArray(uc.performs_job_ids)) coveredJobs.add(j);
      }
      const relievedCount =
        painIds.filter(p => coveredPains.has(p)).length +
        gainIds.filter(g2 => coveredGains.has(g2)).length +
        jobIds.filter(j => coveredJobs.has(j)).length;

      const bridgeRow = (
        label: string,
        ids: string[],
        color: string,
        covered: Set<string>,
      ) => (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--t3)', minWidth: 78 }}>{label}</span>
          {ids.length === 0
            ? <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>—</span>
            : ids.map(id => {
              const ok = covered.has(id);
              return (
                <LinkChip
                  key={id}
                  color={color}
                  onClick={() => onNavigate('vpProfile', id)}
                  dim={!ok}
                  title={ok ? t('lore.product.feat.covered', 'замкнуто US') : t('lore.product.feat.uncovered', 'заявлено, но не покрыто US')}
                >
                  {id} {ok ? '✓' : '⚠'}
                </LinkChip>
              );
            })}
        </div>
      );

      detail = (
        <div>
          <PassportHeader title={f.title ?? f.uc_id}>
            <Pill tone={status === 'active' ? 'act' : status === 'shipped' ? 'ok' : 'muted'}>{ucStatusLabel(t, f.status)}</Pill>
            {f.goal_level && <Pill>{goalLevelLabel(t, f.goal_level)}</Pill>}
            <Pill tone={relievedCount >= claimedCount && claimedCount > 0 ? 'ok' : 'warn'}>fit {relievedCount}/{claimedCount}</Pill>
            <button
              type="button"
              title={t('lore.product.us.edit', 'Правка')}
              aria-label={t('lore.product.us.edit', 'Правка')}
              onClick={() => { setCreatingRoot(false); setEditingRoot({ uc_id: f.uc_id, title: f.title, goal_level: f.goal_level }); }}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 'var(--fs-base)', padding: 0, marginLeft: 4 }}
            >
              ✎
            </button>
          </PassportHeader>

          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--g-value)', marginBottom: 8 }}>{f.uc_id}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 10px', fontSize: 'var(--fs-base)', color: 'var(--t2)', marginBottom: 4 }}>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.feat.readiness', 'Готовность')}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{f.uc_shipped ?? 0}/{f.uc_total ?? 0} US</span>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.feat.milestone', 'Веха')}</span>
            <span>{f.milestone_id
              ? <LinkChip color="var(--acc)" onClick={() => onNavigate('milestones', f.milestone_id ?? undefined)}>{f.milestone_id}</LinkChip>
              : <span style={{ color: 'var(--t3)' }}>—</span>}</span>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.feat.component', 'Компонент')}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}>{f.component_id ?? '—'}</span>
          </div>

          <PSection title={t('lore.product.feat.bridge', '🌉 Мост в профиль (что ЗАЯВЛЯЕТ фича)')}>
            {bridgeRow(t('lore.product.feat.jobs', 'РАБОТЫ'), jobIds, 'var(--job)', coveredJobs)}
            {bridgeRow(t('lore.product.feat.pains', 'БОЛИ'), painIds, 'var(--pain)', coveredPains)}
            {bridgeRow(t('lore.product.feat.gains', 'ОЖИДАНИЯ'), gainIds, 'var(--gain)', coveredGains)}
          </PSection>

          <PSection title={t('lore.product.feat.impl', '🌊 Реализация — US (что СДЕЛАНО)')}>
            {/* Завести сценарий ПРЯМО под этим корнем: иначе после создания на
                соседнем экране пришлось бы отдельным действием привязывать
                родителя, и про этот шаг забывали бы — сценарий висел бы сиротой. */}
            <button
              type="button"
              onClick={() => setCreatingChild(f.uc_id)}
              style={{ fontSize: 10.5, padding: '2px 8px', marginBottom: 4, borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px dashed var(--bd)', color: 'var(--t2)' }}
            >
              {t('lore.product.feat.addUs', '+ US сюда')}
            </button>
            {ucs.length === 0
              ? <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', padding: '2px 0' }}>US ещё нет</div>
              : ucs.map((uc, i) => {
                const open = expandedUc === uc.uc_id;
                return (
                  <div key={uc.uc_id}>
                    <TRow first={i === 0}>
                      {/* Треугольник раскрытия — отдельная кнопка от чипа id:
                          чип уводит на паспорт US, и совмести мы их, «посмотреть
                          задачи» уносило бы с экрана фичи, ради которого сюда и
                          пришли. */}
                      <button
                        type="button"
                        onClick={() => onExpandUc?.(open ? null : uc.uc_id)}
                        aria-expanded={open}
                        aria-label={t('lore.product.feat.tasksToggle', 'Задачи сценария')}
                        style={{ width: 16, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 'var(--fs-2xs)', padding: 0 }}
                      >
                        {open ? '▼' : '▶'}
                      </button>
                      <span style={{ width: 16, textAlign: 'center' }}>{ucGlyph(uc.status)}</span>
                      <LinkChip color="var(--g-do)" onClick={() => onNavigate('userStories', uc.uc_id)}>{uc.uc_id}</LinkChip>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uc.title ?? ''}</span>
                      <Pill tone={(uc.status ?? '').toLowerCase() === 'shipped' ? 'ok' : (uc.status ?? '').toLowerCase() === 'active' ? 'act' : 'muted'} style={{ marginLeft: 'auto' }}>{ucStatusLabel(t, uc.status)}</Pill>
                    </TRow>

                    {open && (
                      <div style={{ marginLeft: 20, borderLeft: '1px solid var(--bd)', paddingLeft: 8 }}>
                        {tasksLoading && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', padding: '3px 0' }}>…</div>}
                        {!tasksLoading && ucTasks.length === 0 && (
                          // Отличаем «нет задач» от «не раскрывали»: пустой узел
                          // без подписи читается как сбой загрузки.
                          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', padding: '3px 0' }}>
                            {t('lore.product.feat.noTasks', 'Задач, реализующих этот сценарий, нет')}
                          </div>
                        )}
                        {!tasksLoading && ucTasks.map(task => (
                          <div key={task.task_uid} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11.5, color: 'var(--t2)' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--t3)' }}>{task.task_id}</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title ?? ''}</span>
                            <Pill tone="muted">{task.status_raw ?? '—'}</Pill>
                            {task.sprint_id && (
                              <LinkChip color="var(--acc)" onClick={() => onNavigate('sprints', task.sprint_id ?? undefined)} title={task.sprint_status_raw ?? undefined}>
                                <Pill tone={sprintTone(task.sprint_status_raw)}>{task.sprint_id}</Pill>
                              </LinkChip>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </PSection>
        </div>
      );
    }
  }

  const bar = (
    <>
      <ListSearch value={listSearch ?? ''} onChange={v => onListSearch?.(v)} placeholder={t('lore.product.feat.searchPh', 'фича…')} />
      <div style={{ padding: '6px 9px', borderBottom: '1px solid var(--bd)' }}>
        <button
          type="button"
          onClick={() => { setEditingRoot(null); setCreatingRoot(true); }}
          style={{ width: '100%', fontSize: 'var(--fs-sm)', borderRadius: 4, padding: '3px 0', cursor: 'pointer', background: 'transparent', border: '1px dashed var(--bd)', color: 'var(--t2)' }}
        >
          {t('lore.product.us.newRoot', '+ Фича')}
        </button>
      </div>
    </>
  );

  return (
    <>
      <MasterDetail list={<>{bar}{list}</>} detail={detail} />
      {(creatingRoot || editingRoot) && (
        <UsFormModal
          opened
          root
          initial={editingRoot ?? undefined}
          onClose={() => { setCreatingRoot(false); setEditingRoot(null); }}
          onSaved={id => { setReloadKey(k => k + 1); onSelect(id); }}
          onError={onError}
        />
      )}
      {creatingChild && (
        <UsFormModal
          opened
          parentUcId={creatingChild}
          onClose={() => setCreatingChild(null)}
          onSaved={() => setReloadKey(k => k + 1)}
          onError={onError}
        />
      )}
    </>
  );
}
