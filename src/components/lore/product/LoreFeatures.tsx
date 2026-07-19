// Экран «Фичи» продуктового слоя (ADR-LORE-022/032, Остервальдер + Коберн).
// Master-detail: список фич слева + паспорт справа (мост в профиль VP + реализация US).
// Дизайн зеркалит утверждённый прототип featureP. Данные — через useSlice/fetchLoreSlice.
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type { LoreFeatureRow, LoreUcRow } from '../../../api/lore';
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
} from './shared';

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

export default function LoreFeatures({ selectedId, onSelect, onNavigate, onError, listSearch }: ProductScreenProps) {
  const { t } = useTranslation();
  const { rows, loading } = useSlice<LoreFeatureRow>('features', undefined, onError, []);

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
    ? rows.filter(f => f.feature_id.toLowerCase().includes(q) || (f.title ?? '').toLowerCase().includes(q))
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
              key={f.feature_id}
              id={f.feature_id}
              title={f.title}
              selected={f.feature_id === selectedId}
              onClick={() => onSelect(f.feature_id)}
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
    const f = rows.find(x => x.feature_id === selectedId);
    if (!f) {
      detail = <EmptyDetail text={t('lore.product.feat.pick', 'Выберите фичу слева')} />;
    } else {
      const goal = goalOf(f.goal_level);
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
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', minWidth: 78 }}>{label}</span>
          {ids.length === 0
            ? <span style={{ fontSize: 11, color: 'var(--t3)' }}>—</span>
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
          <PassportHeader title={f.title ?? f.feature_id}>
            <Pill tone={status === 'active' ? 'act' : status === 'shipped' ? 'ok' : 'muted'}>{f.status ?? '—'}</Pill>
            {goal.glyph && <Pill>{goal.glyph} {goal.labelKey ? t(goal.labelKey, goal.raw) : goal.raw}</Pill>}
            <Pill tone={relievedCount >= claimedCount && claimedCount > 0 ? 'ok' : 'warn'}>fit {relievedCount}/{claimedCount}</Pill>
          </PassportHeader>

          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--g-value)', marginBottom: 8 }}>{f.feature_id}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 10px', fontSize: 12, color: 'var(--t2)', marginBottom: 4 }}>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.feat.readiness', 'Готовность')}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{f.uc_shipped ?? 0}/{f.uc_total ?? 0} US</span>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.feat.milestone', 'Веха')}</span>
            <span>{f.milestone_id
              ? <LinkChip color="var(--acc)" onClick={() => onNavigate('milestones', f.milestone_id ?? undefined)}>{f.milestone_id}</LinkChip>
              : <span style={{ color: 'var(--t3)' }}>—</span>}</span>
            <span style={{ color: 'var(--t3)' }}>{t('lore.product.feat.component', 'Компонент')}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{f.component_id ?? '—'}</span>
          </div>

          <PSection title={t('lore.product.feat.bridge', '🌉 Мост в профиль (что ЗАЯВЛЯЕТ фича)')}>
            {bridgeRow(t('lore.product.feat.jobs', 'РАБОТЫ'), jobIds, 'var(--job)', coveredJobs)}
            {bridgeRow(t('lore.product.feat.pains', 'БОЛИ'), painIds, 'var(--pain)', coveredPains)}
            {bridgeRow(t('lore.product.feat.gains', 'ОЖИДАНИЯ'), gainIds, 'var(--gain)', coveredGains)}
          </PSection>

          <PSection title={t('lore.product.feat.impl', '🌊 Реализация — US (что СДЕЛАНО)')}>
            {ucs.length === 0
              ? <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0' }}>US ещё нет</div>
              : ucs.map((uc, i) => (
                <TRow key={uc.uc_id} first={i === 0}>
                  <span style={{ width: 16, textAlign: 'center' }}>{ucGlyph(uc.status)}</span>
                  <LinkChip color="var(--g-do)" onClick={() => onNavigate('userStories', uc.uc_id)}>{uc.uc_id}</LinkChip>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uc.title ?? ''}</span>
                  <Pill tone={(uc.status ?? '').toLowerCase() === 'shipped' ? 'ok' : (uc.status ?? '').toLowerCase() === 'active' ? 'act' : 'muted'} style={{ marginLeft: 'auto' }}>{uc.status ?? '—'}</Pill>
                </TRow>
              ))}
          </PSection>
        </div>
      );
    }
  }

  return <MasterDetail list={list} detail={detail} />;
}
