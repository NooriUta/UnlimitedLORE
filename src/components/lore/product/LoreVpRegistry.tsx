// Экран «Работы · Боли · Ожидания» продуктового слоя (ADR-LORE-022/032, Остервальдер).
// ЕДИНЫЙ реестр jobs/pains/gains: фильтр по типу + master-detail (список + паспорт на тип).
// Это реестр профиля клиента — зеркалит прототипы jobP/painP/gainP forseti-storyline-vp.
import { useTranslation } from 'react-i18next';
import { useState, type ReactNode } from 'react';
import type { LoreJobRow, LorePainRow, LoreGainRow } from '../../../api/lore';
import LoreSkeleton from '../LoreSkeleton';
import { EmptyState } from '../EmptyState';
import {
  type ProductScreenProps,
  productColor,
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
  ListSearch,
} from './shared';
import VpCreateModal, { vpKindOf, type VpKind, type VpDraft } from './VpCreateModal';
import { jobKindLabel, levelLabel, gainRankLabel } from './vocab';

type VpType = 'all' | 'job' | 'pain' | 'gain';
type Unified = { id: string; title: string | null; ty: 'job' | 'pain' | 'gain' };

// Ряд ссылок-чипов (МЕШАЮТ / УСПЕХ / заявили / снимают …).
function ChipRow({ ids, color, onGo, empty = '—' }: {
  ids: string[];
  color: string;
  onGo?: (id: string) => void;
  empty?: string;
}) {
  if (ids.length === 0) return <span style={{ fontSize: 11, color: 'var(--t3)' }}>{empty}</span>;
  return (
    <>
      {ids.map(id => (
        <LinkChip key={id} color={color} onClick={onGo ? () => onGo(id) : undefined}>{id}</LinkChip>
      ))}
    </>
  );
}

// Подпись слева от ряда чипов (как bridgeRow прототипа).
function LabeledChips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', minWidth: 78 }}>{label}</span>
      {children}
    </div>
  );
}

export default function LoreVpRegistry({ selectedId, onSelect, onNavigate, onError, listSearch, onListSearch }: ProductScreenProps) {
  const { t } = useTranslation();
  const [typeFilter, setTypeFilter] = useState<VpType>('all');
  const [creating, setCreating] = useState<VpKind | null>(null);
  const [editing, setEditing] = useState<VpDraft | null>(null);
  // Счётчик перезагрузки: после создания реестр обязан показать новую запись.
  // Без него форма закрывалась бы «успешно» на неизменившемся списке — самый
  // убедительный вид потери данных, какой бывает.
  const [reloadKey, setReloadKey] = useState(0);

  const jobsQ = useSlice<LoreJobRow>('jobs', undefined, onError, [reloadKey]);
  const painsQ = useSlice<LorePainRow>('pains', undefined, onError, [reloadKey]);
  const gainsQ = useSlice<LoreGainRow>('gains', undefined, onError, [reloadKey]);
  const jobs = jobsQ.rows;
  const pains = painsQ.rows;
  const gains = gainsQ.rows;
  const loading = jobsQ.loading || painsQ.loading || gainsQ.loading;

  // Единый массив работ/болей/ожиданий.
  const unified: Unified[] = [
    ...jobs.map<Unified>(j => ({ id: j.job_id, title: j.title, ty: 'job' })),
    ...pains.map<Unified>(p => ({ id: p.pain_id, title: p.title, ty: 'pain' })),
    ...gains.map<Unified>(g => ({ id: g.gain_id, title: g.title, ty: 'gain' })),
  ];

  const q = (listSearch ?? '').trim().toLowerCase();
  const filtered = unified.filter(u => {
    if (typeFilter !== 'all' && u.ty !== typeFilter) return false;
    if (!q) return true;
    return u.id.toLowerCase().includes(q) || (u.title ?? '').toLowerCase().includes(q);
  });

  // ── фильтр по типу (над списком) ──
  const chipDefs: { key: VpType; label: string }[] = [
    { key: 'all', label: t('lore.product.vp.all', 'все') },
    { key: 'job', label: `🎯 ${t('lore.product.vp.jobs', 'работы')}` },
    { key: 'pain', label: `🔴 ${t('lore.product.vp.pains', 'боли')}` },
    { key: 'gain', label: `🟢 ${t('lore.product.vp.gains', 'ожидания')}` },
  ];
  const filterChips = (
    <>
      <ListSearch value={listSearch ?? ''} onChange={v => onListSearch?.(v)} placeholder={t('lore.product.vp.searchPh', 'работа / боль / выгода…')} />
      <FilterChips options={chipDefs} value={typeFilter} onChange={setTypeFilter} />
      <div style={{ display: 'flex', gap: 6, padding: '6px 9px', borderBottom: '1px solid var(--bd)' }}>
        {(['job', 'pain', 'gain'] as VpKind[]).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => { setEditing(null); setCreating(k); }}
            style={{
              flex: 1, fontSize: 11, borderRadius: 4, padding: '3px 0', cursor: 'pointer',
              background: 'transparent', border: '1px dashed var(--bd)', color: 'var(--t2)',
            }}
          >
            {k === 'job' && t('lore.product.vp.newJob', '+ Работа')}
            {k === 'pain' && t('lore.product.vp.newPain', '+ Боль')}
            {k === 'gain' && t('lore.product.vp.newGain', '+ Выгода')}
          </button>
        ))}
      </div>
    </>
  );

  // ── список ──
  let rows: ReactNode;
  if (loading) {
    rows = <LoreSkeleton rows={6} />;
  } else if (filtered.length === 0) {
    rows = <EmptyState message={t('lore.product.vp.empty', 'Реестр пуст')} />;
  } else {
    rows = (
      <>
        {filtered.map(u => {
          let meta: ReactNode = null;
          if (u.ty === 'job') {
            const j = jobs.find(x => x.job_id === u.id);
            meta = <Pill>{levelLabel(t, j?.importance)}</Pill>;
          } else if (u.ty === 'pain') {
            const p = pains.find(x => x.pain_id === u.id);
            meta = <Pill tone="warn">{levelLabel(t, p?.severity)}</Pill>;
          } else {
            const g = gains.find(x => x.gain_id === u.id);
            meta = <Pill tone="ok">{gainRankLabel(t, g?.rank)}</Pill>;
          }
          return (
            <ListRow
              key={u.id}
              id={u.id}
              title={u.title}
              selected={u.id === selectedId}
              onClick={() => onSelect(u.id)}
              meta={meta}
            />
          );
        })}
      </>
    );
  }

  // Карандаш правки — один на все три паспорта. Форма та же, что у создания:
  // поля совпадают дословно, и вторая её копия разъехалась бы с первой.
  const editBtn = (draft: VpDraft) => (
    <button
      type="button"
      title={t('lore.product.vp.edit', 'Правка')}
      aria-label={t('lore.product.vp.edit', 'Правка')}
      onClick={() => { setCreating(null); setEditing(draft); }}
      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 12, padding: 0, marginLeft: 4 }}
    >
      ✎
    </button>
  );

  // ── паспорт по префиксу выбранного id ──
  let detail: ReactNode;
  if (!selectedId) {
    detail = <EmptyDetail text={t('lore.product.vp.pick', 'Выберите работу / боль / ожидание слева')} />;
  } else if (selectedId.startsWith('JOB-')) {
    const j = jobs.find(x => x.job_id === selectedId);
    detail = !j ? <EmptyDetail text={t('lore.product.vp.pick', 'Выберите работу / боль / ожидание слева')} /> : (
      <div>
        <PassportHeader title={j.title ?? j.job_id}>
          <Pill>{t('lore.product.vp.jobOne', 'работа')}</Pill>
          <Pill>{jobKindLabel(t, j.kind)}</Pill>
          {editBtn({ id: j.job_id, title: j.title, body_md: j.body_md, extra: j.importance, jobKind: j.kind })}
        </PassportHeader>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: productColor(j.job_id), marginBottom: 8 }}>{j.job_id}</div>

        <PSection title={t('lore.product.vp.around', 'Что вокруг работы')}>
          <LabeledChips label={t('lore.product.vp.blockers', 'МЕШАЮТ')}>
            <ChipRow ids={asArray(j.blocking_pain_ids)} color="var(--pain)" onGo={id => onNavigate('vpProfile', id)} />
          </LabeledChips>
          <LabeledChips label={t('lore.product.vp.success', 'УСПЕХ')}>
            <ChipRow ids={asArray(j.gain_ids)} color="var(--gain)" onGo={id => onNavigate('vpProfile', id)} />
          </LabeledChips>
        </PSection>

        <PSection title={t('lore.product.vp.performers', '🌊 Кто ВЫПОЛНЯЕТ — US фичи (PERFORMS)')}>
          <div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 5 }}>
            заявили фичи: {asArray(j.claimed_by_ucs).join(', ') || '—'}
          </div>
          {asArray(j.performed_by_ucs).length === 0
            ? <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0' }}>US ещё нет</div>
            : asArray(j.performed_by_ucs).map((uc, i) => (
              <TRow key={uc} first={i === 0}>
                <LinkChip color="var(--g-do)" onClick={() => onNavigate('userStories', uc)}>{uc}</LinkChip>
              </TRow>
            ))}
        </PSection>

        <PSection title={t('lore.product.vp.whose', 'Чья работа')}>
          {asArray(j.actor_ids).length === 0
            ? <span style={{ fontSize: 11, color: 'var(--t3)' }}>—</span>
            : asArray(j.actor_ids).map(id => (
              <LinkChip key={id} color="var(--wrn)" onClick={() => onNavigate('actors', id)}>{id}</LinkChip>
            ))}
        </PSection>
      </div>
    );
  } else if (selectedId.startsWith('PAIN-')) {
    const p = pains.find(x => x.pain_id === selectedId);
    detail = !p ? <EmptyDetail text={t('lore.product.vp.pick', 'Выберите работу / боль / ожидание слева')} /> : (
      <div>
        <PassportHeader title={p.title ?? p.pain_id}>
          <Pill tone="warn">🔴 {t('lore.product.vp.pain', 'боль')}</Pill>
          <Pill>{levelLabel(t, p.severity)}</Pill>
          {editBtn({ id: p.pain_id, title: p.title, body_md: p.body_md, extra: p.severity })}
        </PassportHeader>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: productColor(p.pain_id), marginBottom: 8 }}>{p.pain_id}</div>

        <PSection title={t('lore.product.vp.scoring', 'Скоринг по сегментам (FELT_BY)')}>
          {asArray(p.actor_ids).length === 0
            ? <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0' }}>—</div>
            : asArray(p.actor_ids).map((id, i) => (
              <TRow key={id} first={i === 0}>
                <LinkChip color="var(--wrn)" onClick={() => onNavigate('actors', id)}>{id}</LinkChip>
              </TRow>
            ))}
        </PSection>

        <PSection title={t('lore.product.vp.claimedVsRelieved', 'Заявлено vs снято')}>
          <LabeledChips label={`${t('lore.product.vp.claimed', 'заявили')} ${p.addressed_by ?? 0}`}>
            <ChipRow ids={asArray(p.claimed_by_ucs)} color="var(--g-value)" onGo={id => onNavigate('features', id)} />
          </LabeledChips>
          <LabeledChips label={`${t('lore.product.vp.relieved', 'снимают')} ${p.relieved_by ?? 0}`}>
            <ChipRow ids={asArray(p.relieved_by_ucs)} color="var(--g-do)" onGo={id => onNavigate('userStories', id)} />
          </LabeledChips>
        </PSection>

        <PSection title={t('lore.product.vp.blocksJob', 'Мешает работе')}>
          <ChipRow ids={asArray(p.blocks_job_ids)} color="var(--job)" onGo={id => onNavigate('vpProfile', id)} />
        </PSection>
      </div>
    );
  } else if (selectedId.startsWith('GAIN-')) {
    const g = gains.find(x => x.gain_id === selectedId);
    detail = !g ? <EmptyDetail text={t('lore.product.vp.pick', 'Выберите работу / боль / ожидание слева')} /> : (
      <div>
        <PassportHeader title={g.title ?? g.gain_id}>
          <Pill tone="ok">🟢 {t('lore.product.vp.gain', 'выгода')}</Pill>
          <Pill>{gainRankLabel(t, g.rank)}</Pill>
          {editBtn({ id: g.gain_id, title: g.title, body_md: g.body_md, extra: g.metric_md })}
        </PassportHeader>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: productColor(g.gain_id), marginBottom: 8 }}>{g.gain_id}</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 10px', fontSize: 12, color: 'var(--t2)', marginBottom: 4 }}>
          <span style={{ color: 'var(--t3)' }}>{t('lore.product.vp.metric', 'Метрика')}</span>
          {g.metric_md
            ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{g.metric_md}</span>
            : <span style={{ color: 'var(--t3)', opacity: 0.7 }}>⚠ {t('lore.product.vp.noMetric', 'без метрики — не в fit')}</span>}
          <span style={{ color: 'var(--t3)' }}>{t('lore.product.vp.rank', 'Ранг')}</span>
          <span>{g.rank ?? '—'}</span>
        </div>

        {/* Пара «заявлено vs сделано» — та же, что у боли (PL-18B).
            Была только у боли: у выгоды показывался лишь DELIVERS, то есть
            обещание фичи и его исполнение стояли в разных местах экрана и
            расхождение между ними приходилось замечать самому. */}
        <PSection title={t('lore.product.vp.promisedVsDelivered', 'Обещано vs создано')}>
          <LabeledChips label={`${t('lore.product.vp.promised', 'обещали')} ${g.promised_by ?? 0}`}>
            <ChipRow ids={asArray(g.claimed_by_ucs)} color="var(--g-value)" onGo={id => onNavigate('features', id)} />
          </LabeledChips>
          <LabeledChips label={`${t('lore.product.vp.delivered', 'создают')} ${g.delivered_by ?? 0}`}>
            <ChipRow ids={asArray(g.delivered_by_ucs)} color="var(--g-do)" onGo={id => onNavigate('userStories', id)} />
          </LabeledChips>
        </PSection>

        <PSection title={t('lore.product.vp.deliveredBy', 'Создаётся US (DELIVERS)')}>
          {asArray(g.delivered_by_ucs).length === 0
            ? <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0' }}>US ещё нет</div>
            : asArray(g.delivered_by_ucs).map((uc, i) => (
              <TRow key={uc} first={i === 0}>
                <LinkChip color="var(--g-do)" onClick={() => onNavigate('userStories', uc)}>{uc}</LinkChip>
              </TRow>
            ))}
        </PSection>

        <PSection title={t('lore.product.vp.jobSuccess', 'Успех в работе')}>
          <ChipRow ids={asArray(g.success_of_job_ids)} color="var(--job)" onGo={id => onNavigate('vpProfile', id)} />
        </PSection>

        <PSection title={t('lore.product.vp.desiredBy', 'Желает')}>
          {asArray(g.actor_ids).length === 0
            ? <span style={{ fontSize: 11, color: 'var(--t3)' }}>—</span>
            : asArray(g.actor_ids).map(id => (
              <LinkChip key={id} color="var(--wrn)" onClick={() => onNavigate('actors', id)}>{id}</LinkChip>
            ))}
        </PSection>
      </div>
    );
  } else {
    detail = <EmptyDetail text={t('lore.product.vp.pick', 'Выберите работу / боль / ожидание слева')} />;
  }

  return (
    <>
      <MasterDetail list={<>{filterChips}{rows}</>} detail={detail} />
      {creating && (
        <VpCreateModal
          kind={creating}
          opened
          onClose={() => setCreating(null)}
          onCreated={id => { setReloadKey(k => k + 1); onSelect(id); }}
          onError={onError}
        />
      )}
      {editing && vpKindOf(editing.id) && (
        <VpCreateModal
          kind={vpKindOf(editing.id) as VpKind}
          opened
          initial={editing}
          onClose={() => setEditing(null)}
          onCreated={() => setReloadKey(k => k + 1)}
          onError={onError}
        />
      )}
    </>
  );
}
