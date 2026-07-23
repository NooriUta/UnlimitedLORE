// Экран «US · Пользовательские истории» продуктового слоя (ADR-LORE-022/032, Коберн).
// Master-detail: список историй слева + паспорт по Коберну справа.
// Нет слайса «все UC» — собираем UC по каждой фиче (use_cases_of_feature) и склеиваем.
// Дизайн зеркалит утверждённый прототип usP. Данные — через useSlice/fetchLoreSlice.
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type { LoreFeatureRow, LoreUcRow } from '../../../api/lore';
import { fetchLoreSlice } from '../../../api/lore';
import type { LoreUcTaskRow } from '../../../api/lore';
import LoreSkeleton from '../LoreSkeleton';
import { EmptyState } from '../EmptyState';
import {
  type ProductScreenProps,
  useSlice,
  asArray,
  Pill,
  PSection,
  LinkChip,
  MasterDetail,
  ListRow,
  PassportHeader,
  EmptyDetail,
  TRow,
  ListSearch,
  Markdown,
  IconPill,
  EditButton,
} from './shared';
import { ucStatusLabel, ucStatusTone, rigorLabel, goalLevelLabel } from './vocab';
import { resolveStatusMeta, taskTick } from '../lore-status';
import { GOAL_LEVEL_ICON, RIGOR_ICON, iconOf } from './icons';
import { GameIcon } from '../GameIcon';
import UsFormModal, { type UsDraft } from './UsFormModal';


export default function LoreUserStories({ selectedId, onSelect, onNavigate, onError, listSearch, onListSearch }: ProductScreenProps) {
  const { t } = useTranslation();
  // Нет слайса «все UC» → тянем фичи, затем UC каждой фичи и склеиваем (дедуп по uc_id).
  const { rows: features, loading: featLoading } = useSlice<LoreFeatureRow>('features', undefined, onError, []);

  const [ucs, setUcs] = useState<LoreUcRow[]>([]);
  // PL-17: форма создания/правки US.
  const [creating, setCreating] = useState(false);
  const [editingUs, setEditingUs] = useState<UsDraft | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Задачи выбранного сценария (PL-43). В паспорте фичи дерево US→задачи было,
  // а в паспорте самой US — нет: чтобы увидеть, чем она делается, приходилось
  // возвращаться к корню и раскрывать её там.
  const [ucTasks, setUcTasks] = useState<LoreUcTaskRow[]>([]);
  useEffect(() => {
    if (!selectedId) { setUcTasks([]); return; }
    const ctrl = new AbortController();
    fetchLoreSlice<LoreUcTaskRow>('tasks_of_uc', { id: selectedId }, ctrl.signal)
      .then(setUcTasks)
      .catch(() => { /* задачи справочны — паспорт остаётся рабочим */ });
    return () => ctrl.abort();
  }, [selectedId]);
  const [ucsLoading, setUcsLoading] = useState(true);
  const featKey = features.map(f => f.uc_id).join('|');

  useEffect(() => {
    if (features.length === 0) {
      // Пока фичи не пришли — не сбрасываем в «загрузка» после их отсутствия.
      if (!featLoading) { setUcs([]); setUcsLoading(false); }
      return;
    }
    const ctrl = new AbortController();
    setUcsLoading(true);
    Promise.all(
      features.map(f => fetchLoreSlice<LoreUcRow>('use_cases_of_feature', { id: f.uc_id }, ctrl.signal)),
    )
      .then(chunks => {
        if (ctrl.signal.aborted) return;
        const byId = new Map<string, LoreUcRow>();
        for (const chunk of chunks) {
          for (const uc of chunk) {
            if (!byId.has(uc.uc_id)) byId.set(uc.uc_id, uc);
          }
        }
        setUcs(Array.from(byId.values()));
        setUcsLoading(false);
      })
      .catch(e => { if (!ctrl.signal.aborted) { onError(e); setUcsLoading(false); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featKey, featLoading, reloadKey]);

  const loading = featLoading || ucsLoading;

  // ── список ──
  const q = (listSearch ?? '').trim().toLowerCase();
  const filtered = q
    ? ucs.filter(u => u.uc_id.toLowerCase().includes(q) || (u.title ?? '').toLowerCase().includes(q))
    : ucs;

  let list;
  if (loading) {
    list = <LoreSkeleton rows={6} />;
  } else if (filtered.length === 0) {
    list = <EmptyState message={t('lore.product.us.empty', 'Пользовательских историй пока нет')} />;
  } else {
    list = (
      <>
        {filtered.map(uc => {
          const statusShort = ucStatusLabel(t, uc.status);
          return (
            <ListRow
              key={uc.uc_id}
              id={uc.uc_id}
              title={uc.title}
              selected={uc.uc_id === selectedId}
              onClick={() => onSelect(uc.uc_id)}
              meta={<IconPill icon={iconOf(GOAL_LEVEL_ICON, uc.goal_level)} tone={ucStatusTone(uc.status)}>{statusShort}</IconPill>}
            />
          );
        })}
      </>
    );
  }

  // ── паспорт (по Коберну) ──
  let detail;
  if (!selectedId) {
    detail = <EmptyDetail text={t('lore.product.us.pick', 'Выберите историю слева')} />;
  } else {
    const uc = ucs.find(x => x.uc_id === selectedId);
    if (!uc) {
      detail = <EmptyDetail text={t('lore.product.us.pick', 'Выберите историю слева')} />;
    } else {
      const painIds = asArray(uc.relieves_pain_ids);
      const gainIds = asArray(uc.delivers_gain_ids);
      const jobIds = asArray(uc.performs_job_ids);
      const includes = asArray(uc.includes_uc);
      const extendsUc = asArray(uc.extends_uc);
      const actorIds = asArray(uc.actor_ids);
      const actorNames = asArray(uc.actor_names);


      detail = (
        <div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 6 }}>
            US · Пользовательская история (User Story) — тело по Коберну
          </div>

          <PassportHeader title={uc.title ?? uc.uc_id}>
            <Pill tone={ucStatusTone(uc.status)}>{ucStatusLabel(t, uc.status)}</Pill>
            {uc.goal_level && <IconPill icon={iconOf(GOAL_LEVEL_ICON, uc.goal_level)}>{goalLevelLabel(t, uc.goal_level)}</IconPill>}
            {uc.rigor && <IconPill icon={iconOf(RIGOR_ICON, uc.rigor)}>{rigorLabel(t, uc.rigor)}</IconPill>}
            {/* Правка той же формой, что и создание: линтер обязан работать и
                при доводке тела — именно там он полезнее всего. */}
            <EditButton onClick={() => { setCreating(false); setEditingUs({
                uc_id: uc.uc_id, title: uc.title, scenario_md: uc.scenario_md,
                acceptance_md: uc.acceptance_md, goal_level: uc.goal_level, rigor: uc.rigor,
                status: uc.status, parent_uc_id: uc.parent_uc_id,
              }); }} title={t('lore.product.us.edit', 'Правка')} />
          </PassportHeader>

          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--g-do)', marginBottom: 8 }}>{uc.uc_id}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 10px', fontSize: 'var(--fs-base)', color: 'var(--t2)', marginBottom: 4 }}>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.us.feature', 'Фича')}</span>
            <span>{uc.parent_uc_id
              ? <LinkChip color="var(--g-value)" onClick={() => onNavigate('features', uc.parent_uc_id ?? undefined)}>{uc.parent_uc_id}</LinkChip>
              : <span style={{ color: 'var(--t3)' }}>—</span>}</span>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.us.primaryActor', 'Primary-актор')}</span>
            <span>{actorNames.length > 0
              ? <LinkChip color="var(--wrn)" onClick={() => onNavigate('actors', actorIds[0])}>{actorNames[0]}</LinkChip>
              : <span style={{ color: 'var(--t3)' }}>—</span>}</span>
          </div>

          <PSection title={t('lore.product.us.doesWhat', 'Что закрывает на деле')}>
            {painIds.length + gainIds.length + jobIds.length === 0
              ? <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>—</span>
              : (
                <>
                  {painIds.map(id => (
                    <LinkChip key={`p-${id}`} color="var(--pain)" onClick={() => onNavigate('vpProfile', id)}>{t('lore.product.us.relieves', 'снимает')} · {id}</LinkChip>
                  ))}
                  {gainIds.map(id => (
                    <LinkChip key={`g-${id}`} color="var(--gain)" onClick={() => onNavigate('vpProfile', id)}>{t('lore.product.us.delivers', 'даёт')} · {id}</LinkChip>
                  ))}
                  {jobIds.map(id => (
                    <LinkChip key={`j-${id}`} color="var(--job)" onClick={() => onNavigate('vpProfile', id)}>{t('lore.product.us.performs', 'выполняет')} · {id}</LinkChip>
                  ))}
                </>
              )}
          </PSection>

          <PSection title={t('lore.product.us.scenario', 'Сценарий (Коберн)')}>
            {(uc.scenario_md ?? '').trim()
              ? <Markdown md={uc.scenario_md} />
              : <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>— {t('lore.product.us.noScenario', 'сценарий не заполнен')}</span>}
          </PSection>

          {(uc.acceptance_md ?? '').trim() && (
            <PSection title={t('lore.product.us.acceptance', 'Приёмка')}>
              <Markdown md={uc.acceptance_md} />
            </PSection>
          )}

          {includes.length + extendsUc.length > 0 && (
            <PSection title={t('lore.product.us.graph', 'Связанные сценарии')}>
              {includes.map(id => (
                <LinkChip key={`inc-${id}`} color="var(--g-do)" onClick={() => onNavigate('userStories', id)}>{t('lore.product.us.includes', 'включает')} · {id}</LinkChip>
              ))}
              {extendsUc.map(id => (
                <LinkChip key={`ext-${id}`} color="var(--g-do)" onClick={() => onNavigate('userStories', id)}>{t('lore.product.us.extends', 'расширяет')} · {id}</LinkChip>
              ))}
            </PSection>
          )}

          {/* Задачи со спринтами — как в паспорте фичи. Раньше, чтобы увидеть,
              чем сценарий делается, приходилось возвращаться к корню и
              раскрывать его там. Статус задачи и статус СПРИНТА показываются
              оба: «сделано» в отменённом спринте и «сделано» в живом — разные
              новости, по статусу задачи неразличимые. */}
          <PSection title={t('lore.product.us.tasks', 'Чем делается')}>
            {ucTasks.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', padding: '2px 0' }}>
                {t('lore.product.us.noTasks', 'задач пока нет')}
              </div>
            ) : ucTasks.map((task, i) => (
              <TRow key={task.task_uid} first={i === 0}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{task.task_id}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title ?? ''}</span>
                {/* Статус — иконкой и цветом ИЗ СПРАВОЧНИКА (KnowDictEntry),
                    как в спринтах: свой набор значков разошёлся бы с общим при
                    первом же пополнении словаря. */}
                {(() => { const m = resolveStatusMeta(task.status_raw); return (
                  <span title={task.status_raw ?? undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <GameIcon slug={m.icon} size={12} style={{ color: m.color }} />
                    <span style={{ fontSize: 'var(--fs-2xs)', color: m.color }}>{taskTick(task.status_raw).status}</span>
                  </span>
                ); })()}
                {task.sprint_id && (() => { const sm = resolveStatusMeta(task.sprint_status_raw); return (
                  <LinkChip
                    color="var(--acc)"
                    onClick={() => onNavigate('sprints', task.sprint_id ?? undefined)}
                    title={task.sprint_status_raw ?? undefined}
                  >
                    <GameIcon slug={sm.icon} size={11} style={{ color: sm.color }} />
                    {task.sprint_id}
                  </LinkChip>
                ); })()}
              </TRow>
            ))}
          </PSection>
        </div>
      );
    }
  }

  const createBar = (
    <div style={{ padding: '6px 9px', borderBottom: '1px solid var(--bd)' }}>
      <button
        type="button"
        onClick={() => { setEditingUs(null); setCreating(true); }}
        style={{ width: '100%', fontSize: 'var(--fs-sm)', borderRadius: 4, padding: '3px 0', cursor: 'pointer', background: 'transparent', border: '1px dashed var(--bd)', color: 'var(--t2)' }}
      >
        {t('lore.product.us.new', '+ История')}
      </button>
    </div>
  );

  return (
    <>
      <MasterDetail list={<><ListSearch value={listSearch ?? ''} onChange={v => onListSearch?.(v)} placeholder={t('lore.product.us.searchPh', 'история…')} />{createBar}{list}</>} detail={detail} />
      {(creating || editingUs) && (
        <UsFormModal
          opened
          initial={editingUs ?? undefined}
          onClose={() => { setCreating(false); setEditingUs(null); }}
          onSaved={id => { setReloadKey(k => k + 1); onSelect(id); }}
          onError={onError}
        />
      )}
    </>
  );
}
