// Экран «Клиент (сегмент)» продуктового слоя (ADR-LORE-022/032, Остервальдер + Коберн).
// Акторы как сегменты клиентов: master-detail (список слева + профиль сегмента справа).
// Дизайн зеркалит утверждённый прототип actorP. Данные — через useSlice/fetchLoreSlice.
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type {
  LoreActorRow,
  LorePainRow,
  LoreGainRow,
  LoreJobRow,
} from '../../../api/lore';
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
  FilterChips,
} from './shared';

export type ActorKind = 'all' | 'human-role' | 'agent' | 'system';

/**
 * Отбор строк реестра акторов: вид + текст (PL-18).
 *
 * Вынесено из компонента отдельной функцией, потому что тестировать здесь
 * нужно именно СОЧЕТАНИЕ двух условий, а react-рендер в проекте не поднимается
 * (testing-library не подключена). Условия связаны конъюнкцией: «агенты» плюс
 * набранный текст обязаны сужать выборку вместе, иначе фильтр вида молча
 * перебивал бы поиск — самая правдоподобная ошибка при склейке этих двух.
 */
export function filterActors<T extends { actor_id: string; name?: string | null; kind?: string | null }>(
  rows: T[], kind: ActorKind, search: string,
): T[] {
  const q = search.trim().toLowerCase();
  return rows.filter(a => {
    if (kind !== 'all' && a.kind !== kind) return false;
    if (!q) return true;
    return a.actor_id.toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q);
  });
}

// Строка профиля Остервальдера: жирный uppercase-лейбл + чипы (или «— нет»).
function ProfileLine({
  glyph,
  label,
  items,
  color,
  onNavigate,
}: {
  glyph: string;
  label: string;
  items: { id: string; text: string }[];
  color: string;
  onNavigate: (section: string, id?: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--t3)', minWidth: 96 }}>
        {glyph} {label}
      </span>
      {items.length === 0 ? (
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>— нет</span>
      ) : (
        items.map(it => (
          <LinkChip key={it.id} color={color} onClick={() => onNavigate('vpProfile', it.id)} title={it.id}>
            {it.text}
          </LinkChip>
        ))
      )}
    </div>
  );
}

export default function LoreActors({ selectedId, onSelect, onNavigate, onError, listSearch }: ProductScreenProps) {
  const { t } = useTranslation();
  const [kindFilter, setKindFilter] = useState<ActorKind>('all');
  const { rows: actors, loading } = useSlice<LoreActorRow>('actors', undefined, onError, []);
  const { rows: pains } = useSlice<LorePainRow>('pains', undefined, onError, []);
  const { rows: gains } = useSlice<LoreGainRow>('gains', undefined, onError, []);
  const { rows: jobs } = useSlice<LoreJobRow>('jobs', undefined, onError, []);

  // ── фильтр по виду актора (PL-18) ──
  //
  // Набор видов ЖЁСТКИЙ, а не собранный из данных: словарь задаёт бэкенд
  // (`kind must be human-role|system|agent`, LoreProductResource). Собери мы
  // чипы из встреченных значений — вид, которого сейчас нет ни у кого, пропал
  // бы из фильтра ровно тогда, когда его ищут: «агентов нет» — это ответ, а
  // отсутствие чипа выглядит так, будто вопрос и не задавали.
  const kindDefs: { key: ActorKind; label: string }[] = [
    { key: 'all', label: t('lore.product.actor.kindAll', 'все') },
    { key: 'human-role', label: `🧑 ${t('lore.product.actor.kindHuman', 'люди')}` },
    { key: 'agent', label: `🤖 ${t('lore.product.actor.kindAgent', 'агенты')}` },
    { key: 'system', label: `⚙ ${t('lore.product.actor.kindSystem', 'системы')}` },
  ];

  // ── список ──
  const filtered = filterActors(actors, kindFilter, listSearch ?? '');

  let list;
  if (loading) {
    list = <LoreSkeleton rows={5} />;
  } else if (filtered.length === 0) {
    list = <EmptyState message={t('lore.product.actor.empty', 'Акторов пока нет')} />;
  } else {
    list = (
      <>
        {filtered.map(a => (
          <ListRow
            key={a.actor_id}
            id={a.actor_id}
            title={a.name ?? a.actor_id}
            selected={a.actor_id === selectedId}
            onClick={() => onSelect(a.actor_id)}
            meta={<Pill tone={a.kind === 'agent' ? 'act' : 'muted'}>{a.kind ?? '—'} · {a.uc_count ?? 0} US</Pill>}
          />
        ))}
      </>
    );
  }

  // ── паспорт (профиль сегмента) ──
  let detail;
  if (!selectedId) {
    detail = <EmptyDetail text={t('lore.product.actor.pick', 'Выберите сегмент слева')} />;
  } else {
    const a = actors.find(x => x.actor_id === selectedId);
    if (!a) {
      detail = <EmptyDetail text={t('lore.product.actor.pick', 'Выберите сегмент слева')} />;
    } else {
      const actorId = a.actor_id;

      const jobItems = jobs
        .filter(j => asArray(j.actor_ids).includes(actorId))
        .map(j => ({ id: j.job_id, text: j.title ?? j.job_id }));
      const painItems = pains
        .filter(p => asArray(p.actor_ids).includes(actorId))
        .map(p => ({ id: p.pain_id, text: p.title ?? p.pain_id }));
      const gainItems = gains
        .filter(g => asArray(g.actor_ids).includes(actorId))
        .map(g => ({ id: g.gain_id, text: g.title ?? g.gain_id }));

      const ucIds = asArray(a.uc_ids);

      detail = (
        <div>
          <PassportHeader title={a.name ?? a.actor_id}>
            <Pill tone={a.kind === 'agent' ? 'act' : 'muted'}>{a.kind ?? '—'}</Pill>
            <Pill>сегмент клиента</Pill>
          </PassportHeader>

          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--wrn)', marginBottom: 8 }}>{a.actor_id}</div>

          <PSection title={t('lore.product.actor.profile', 'Профиль сегмента (Остервальдер)')}>
            <ProfileLine glyph="🎯" label={t('lore.product.actor.jobs', 'Работы')} items={jobItems} color="var(--job)" onNavigate={onNavigate} />
            <ProfileLine glyph="🔴" label={t('lore.product.actor.pains', 'Боли')} items={painItems} color="var(--pain)" onNavigate={onNavigate} />
            <ProfileLine glyph="🟢" label={t('lore.product.actor.gains', 'Ожидания')} items={gainItems} color="var(--gain)" onNavigate={onNavigate} />
          </PSection>

          <PSection title={t('lore.product.actor.ucRbac', 'US роли · отсюда строится RBAC')}>
            {ucIds.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0' }}>US ещё нет</div>
            ) : (
              ucIds.map((ucId, i) => (
                <TRow key={ucId} first={i === 0}>
                  <LinkChip color="var(--g-do)" onClick={() => onNavigate('userStories', ucId)}>{ucId}</LinkChip>
                </TRow>
              ))
            )}
          </PSection>

          {a.body_md && (
            <PSection title={t('lore.product.actor.about', 'О роли')}>
              <div style={{ fontSize: 12, color: 'var(--t2)', whiteSpace: 'pre-wrap' }}>{a.body_md}</div>
            </PSection>
          )}
        </div>
      );
    }
  }

  return (
    <MasterDetail
      list={<><FilterChips options={kindDefs} value={kindFilter} onChange={setKindFilter} />{list}</>}
      detail={detail}
    />
  );
}
