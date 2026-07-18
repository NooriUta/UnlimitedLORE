// Экран «Клиент (сегмент)» продуктового слоя (ADR-LORE-022/032, Остервальдер + Коберн).
// Акторы как сегменты клиентов: master-detail (список слева + профиль сегмента справа).
// Дизайн зеркалит утверждённый прототип actorP. Данные — через useSlice/fetchLoreSlice.
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
} from './shared';

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
  const { rows: actors, loading } = useSlice<LoreActorRow>('actors', undefined, onError, []);
  const { rows: pains } = useSlice<LorePainRow>('pains', undefined, onError, []);
  const { rows: gains } = useSlice<LoreGainRow>('gains', undefined, onError, []);
  const { rows: jobs } = useSlice<LoreJobRow>('jobs', undefined, onError, []);

  // ── список ──
  const q = (listSearch ?? '').trim().toLowerCase();
  const filtered = q
    ? actors.filter(a => a.actor_id.toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q))
    : actors;

  let list;
  if (loading) {
    list = <LoreSkeleton rows={5} />;
  } else if (filtered.length === 0) {
    list = <EmptyState message="Акторов пока нет" />;
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
    detail = <EmptyDetail text="Выберите сегмент слева" />;
  } else {
    const a = actors.find(x => x.actor_id === selectedId);
    if (!a) {
      detail = <EmptyDetail text="Выберите сегмент слева" />;
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

          <PSection title="Профиль сегмента (Остервальдер)">
            <ProfileLine glyph="🎯" label="Работы" items={jobItems} color="var(--job)" onNavigate={onNavigate} />
            <ProfileLine glyph="🔴" label="Боли" items={painItems} color="var(--pain)" onNavigate={onNavigate} />
            <ProfileLine glyph="🟢" label="Ожидания" items={gainItems} color="var(--gain)" onNavigate={onNavigate} />
          </PSection>

          <PSection title="US роли · отсюда строится RBAC">
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
            <PSection title="О роли">
              <div style={{ fontSize: 12, color: 'var(--t2)', whiteSpace: 'pre-wrap' }}>{a.body_md}</div>
            </PSection>
          )}
        </div>
      );
    }
  }

  return <MasterDetail list={list} detail={detail} />;
}
