// VP-01: добавление прямо с канвы, без ухода на другой экран.
//
// Две половины канвы наполняются РАЗНЫМ, и палитра это различие держит:
//
//   круг (профиль клиента) — боль / выгода / работа: чьи они, задаёт актор;
//   квадрат (карта ценности) — СЦЕНАРИЙ: чем мы это закрываем.
//
// Смешать их нельзя: боль в «Снимают боль» означала бы «наша работа» вместо
// «боль клиента», и канва выглядела бы исправной при неверной записи. Поэтому
// у каждой карточки палитры ровно один допустимый сектор (см. dropSpot в
// LoreVpCanvas), а вид цели ветвит и сам пикер.
//
// Порядок один для обеих половин: сначала поиск среди уже существующих (не
// плодить дубли), и только если не нашлось — форма создания. Формы
// переиспользуются, а не копируются: PainGainJobModal для ценностей,
// UsFormModal для сценариев.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LorePainRow, LoreGainRow, LoreJobRow, LoreUcRow } from '../../../api/lore';
import { linkLoreFeature, linkLoreVp, linkLoreUc, saveLoreUc } from '../../../api/lore';
import PainGainJobModal, { type PainGainJobKind } from './PainGainJobModal';
import UsFormModal from './UsFormModal';

type ValueRow = { id: string; title: string | null };

/** Сектора КВАДРАТА — то, что наполняется сценариями, а не ценностями. */
export type VpUcSector = 'ps' | 'gc' | 'pr';
/** Что именно тащат: ценность в круг либо сценарий в квадрат. */
export type VpDragTarget = PainGainJobKind | VpUcSector;

const VALUE_KINDS = ['pain', 'gain', 'job'] as const;
const UC_SECTORS = ['ps', 'gc', 'pr'] as const;

export function isUcSector(x: VpDragTarget): x is VpUcSector {
  return (UC_SECTORS as readonly string[]).includes(x);
}

const REL: Record<PainGainJobKind, 'felt_by' | 'desired_by' | 'performed_by'> = {
  pain: 'felt_by', gain: 'desired_by', job: 'performed_by',
};

/**
 * Вид перетаскиваемой карточки кодируется в ИМЕНИ mime-типа, а не в значении.
 *
 * Иначе никак: во время `dragover` браузер отдаёт только `types`, а
 * `getData()` возвращает пустую строку (защита от чтения содержимого до
 * дропа). Без вида на `dragover` нельзя ответить, годится ли сектор под
 * курсором, — а именно это отличает «донёс куда надо» от «бросил куда попало».
 */
const DND_PREFIX = 'application/x-lore-vp-';

export function vpDragKind(types: readonly string[]): VpDragTarget | null {
  for (const ty of types) {
    if (!ty.startsWith(DND_PREFIX)) continue;
    const k = ty.slice(DND_PREFIX.length) as VpDragTarget;
    if ((VALUE_KINDS as readonly string[]).includes(k) || isUcSector(k)) return k;
  }
  return null;
}

function rowsOf(kind: PainGainJobKind, pains: LorePainRow[], gains: LoreGainRow[], jobs: LoreJobRow[]): ValueRow[] {
  if (kind === 'pain') return pains.map(p => ({ id: p.pain_id, title: p.title }));
  if (kind === 'gain') return gains.map(g => ({ id: g.gain_id, title: g.title }));
  return jobs.map(j => ({ id: j.job_id, title: j.title }));
}

/**
 * Палитра — карточки-шаблоны, перетаскиваются на канву (см. onDrop в LoreVpCanvas).
 *
 * Показывается ВСЕГДА, даже когда тащить пока нельзя. Первая редакция прятала
 * её без выбранного сегмента — и владелец справедливо спросила «откуда тащить
 * то?»: пропадала не кнопка, а само знание, что такая возможность есть.
 * Недоступность объясняется подсказкой, а не исчезновением.
 */
export function VpPalette({ noActor }: { noActor?: boolean }) {
  const { t } = useTranslation();
  const items: { target: VpDragTarget; label: string; sub: string; color: string; needsActor: boolean }[] = [
    { target: 'pain', label: t('lore.product.vp.paletteAddPain', '+ Боль'), sub: t('lore.product.vp.paletteAddPainSub', 'мешает работе'), color: 'var(--pain)', needsActor: true },
    { target: 'gain', label: t('lore.product.vp.paletteAddGain', '+ Выгода'), sub: t('lore.product.vp.paletteAddGainSub', 'даёт результат'), color: 'var(--gain)', needsActor: true },
    { target: 'job', label: t('lore.product.vp.paletteAddJob', '+ Работа'), sub: t('lore.product.vp.paletteAddJobSub', 'что делает актор'), color: 'var(--job)', needsActor: true },
    // Сценарий не требует сегмента: он про НАШУ работу, а не про то, чей это
    // клиент. Поэтому доступен и при «все акторы вместе».
    { target: 'ps', label: t('lore.product.vp.paletteAddUc', '+ Сценарий'), sub: t('lore.product.vp.paletteAddUcSub', 'чем закрываем'), color: 'var(--g-do)', needsActor: false },
  ];
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: 5, borderRadius: 7,
        // Оверлей поверх канвы (ReactFlow Panel): свой фон обязателен, иначе
        // карточки сливаются с точечной сеткой холста под ними.
        background: 'color-mix(in srgb, var(--bg1) 88%, transparent)',
        border: '1px solid var(--bd)', backdropFilter: 'blur(2px)',
      }}
    >
      {items.map(it => {
        const off = it.needsActor && noActor;
        return (
          <div
            key={it.target}
            draggable={!off}
            onDragStart={e => {
              e.dataTransfer.setData(DND_PREFIX + it.target, it.target);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title={off
              ? t('lore.product.vp.paletteNeedsActor', 'Сначала выберите сегмент — иначе некому принадлежать')
              : `${it.label} — ${it.sub}. ${t('lore.product.vp.paletteDropHint', 'Бросать только в свой сектор')}`}
            style={{
              border: `1px dashed color-mix(in srgb, ${it.color} 45%, var(--bd))`, borderRadius: 5,
              background: 'var(--bg2)', padding: '3px 7px',
              cursor: off ? 'not-allowed' : 'grab', opacity: off ? .38 : 1,
            }}
          >
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: it.color, whiteSpace: 'nowrap' }}>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface VpPickerRequest {
  target: VpDragTarget;
  /** только для ценностей круга: чьи они */
  actorId?: string;
  actorName?: string;
}

/**
 * Поиск-сначала-потом-создание; привязка к фиче и — для ценностей — к актору.
 *
 * `opened` управляется извне (см. LorePainGainJobRegistry — тот же паттерн:
 * компонент смонтирован всегда, видимость — булевым пропом, а не условным
 * монтированием, иначе Mantine теряет transition).
 */
export default function VpValuePicker({
  request, featureId, pains, gains, jobs, ucs, featurePainIds, featureGainIds,
  onClose, onLinked, onError,
}: {
  request: VpPickerRequest | null;
  featureId: string;
  pains: LorePainRow[];
  gains: LoreGainRow[];
  jobs: LoreJobRow[];
  /** сценарии ЭТОЙ фичи — только они и могут стоять в её квадрате */
  ucs: LoreUcRow[];
  featurePainIds: string[];
  featureGainIds: string[];
  onClose: () => void;
  /** запись найдена/создана И привязана */
  onLinked: (id: string) => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** второй шаг для «снимают боль» / «создают выгоду»: что именно закрывает сценарий */
  const [pickedUc, setPickedUc] = useState<string | null>(null);

  const opened = !!request;
  const target = request?.target ?? 'pain';
  const ucMode = isUcSector(target);
  // ps — просто сценарий фичи; gc/pr требуют второй шаг: ЧТО он закрывает.
  const needsCounterpart = target === 'gc' || target === 'pr';

  const candidates = useMemo(() => {
    const all: ValueRow[] = ucMode
      ? ucs.map(u => ({ id: u.uc_id, title: u.title }))
      : rowsOf(target as PainGainJobKind, pains, gains, jobs);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(r => r.id.toLowerCase().includes(q) || (r.title ?? '').toLowerCase().includes(q));
  }, [ucMode, ucs, target, pains, gains, jobs, query]);

  /** Второй шаг: боли/выгоды ЭТОЙ фичи — закрывать чужую нечем. */
  const counterparts = useMemo((): ValueRow[] => {
    if (target === 'pr') return pains.filter(p => featurePainIds.includes(p.pain_id)).map(p => ({ id: p.pain_id, title: p.title }));
    if (target === 'gc') return gains.filter(g => featureGainIds.includes(g.gain_id)).map(g => ({ id: g.gain_id, title: g.title }));
    return [];
  }, [target, pains, gains, featurePainIds, featureGainIds]);

  const reset = () => { setQuery(''); setCreating(false); setBusy(null); setPickedUc(null); };
  const close = () => { reset(); onClose(); };

  /** Ценность круга: показать на канве (feature) + назвать хозяина (actor). */
  const attachValue = async (id: string) => {
    if (!request?.actorId) return;
    setBusy(id);
    try {
      await linkLoreFeature({ feature_id: featureId, rel: target as PainGainJobKind, target_id: id });
      await linkLoreVp({ source_id: id, rel: REL[target as PainGainJobKind], target_id: request.actorId });
      onLinked(id);
      close();
    } catch (e) { onError(e); } finally { setBusy(null); }
  };

  /** Сценарий квадрата: подчинить фиче и — для gc/pr — связать с тем, что он закрывает. */
  const attachUc = async (ucId: string, counterpartId?: string) => {
    setBusy(ucId);
    try {
      // Родитель — upsert: сценарий, уже стоящий под этой фичей, не меняется.
      await saveLoreUc({ uc_id: ucId, parent_uc_id: featureId });
      if (target === 'pr' && counterpartId) {
        await linkLoreUc({ uc_id: ucId, rel: 'relieves', target_id: counterpartId });
      }
      if (target === 'gc' && counterpartId) {
        await linkLoreUc({ uc_id: ucId, rel: 'delivers', target_id: counterpartId });
      }
      onLinked(ucId);
      close();
    } catch (e) { onError(e); } finally { setBusy(null); }
  };

  const pick = (id: string) => {
    if (!ucMode) return void attachValue(id);
    if (!needsCounterpart) return void attachUc(id);
    setPickedUc(id);   // второй шаг
  };

  const titleOf: Record<VpDragTarget, string> = {
    pain: t('lore.product.vp.pickerTitlePain', 'Боль'),
    gain: t('lore.product.vp.pickerTitleGain', 'Выгода'),
    job: t('lore.product.vp.pickerTitleJob', 'Работа'),
    ps: t('lore.product.vp.pickerTitleUc', 'Сценарий'),
    gc: t('lore.product.vp.pickerTitleUcGain', 'Сценарий — создаёт выгоду'),
    pr: t('lore.product.vp.pickerTitleUcPain', 'Сценарий — снимает боль'),
  };

  const rowBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
    border: '1px solid var(--bd)', background: 'transparent', cursor: 'pointer',
    textAlign: 'left', color: 'var(--t1)', font: 'inherit',
  };

  return (
    <>
      {opened && !creating && (
        <div
          role="dialog" aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
          onClick={e => { if (e.target === e.currentTarget) close(); }}
        >
          <div style={{
            width: 440, maxWidth: '92vw', maxHeight: '80vh', background: 'var(--bg1)',
            border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px',
              background: 'var(--bg0)', borderBottom: '1px solid var(--bd)',
            }}>
              <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, flex: 1 }}>
                {t('lore.product.vp.pickerAdd', 'Добавить: {{kind}}', { kind: titleOf[target] })}
              </span>
              {!ucMode && (
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)' }}>{request?.actorName}</span>
              )}
              <button type="button" onClick={close} style={{
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', color: 'var(--t3)', cursor: 'pointer', borderRadius: 5,
              }}>✕</button>
            </div>

            <div style={{ padding: '12px 14px', overflowY: 'auto' }}>
              {/* ── второй шаг: что именно закрывает выбранный сценарий ── */}
              {pickedUc ? (
                <>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 8 }}>
                    <button type="button" onClick={() => setPickedUc(null)} style={{
                      background: 'transparent', border: 'none', color: 'var(--t3)', cursor: 'pointer',
                      padding: 0, font: 'inherit', textDecoration: 'underline',
                    }}>← {t('lore.product.vp.pickerBack', 'назад')}</button>
                    {' · '}
                    <span style={{ fontFamily: 'var(--mono)' }}>{pickedUc}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-sm)', marginBottom: 8 }}>
                    {target === 'pr'
                      ? t('lore.product.vp.pickerWhichPain', 'Какую боль снимает этот сценарий?')
                      : t('lore.product.vp.pickerWhichGain', 'Какую выгоду создаёт этот сценарий?')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {counterparts.length === 0 && (
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', textAlign: 'center', padding: '10px 0' }}>
                        {t('lore.product.vp.pickerNoCounterpart', 'У фичи пока нет ни одной — сначала заведите её в круге')}
                      </div>
                    )}
                    {counterparts.map(c => (
                      <button key={c.id} type="button" disabled={busy === pickedUc}
                        onClick={() => attachUc(pickedUc, c.id)} style={rowBtn}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', flexShrink: 0 }}>{c.id}</span>
                        <span style={{ fontSize: 'var(--fs-sm)', flex: 1 }}>{c.title ?? c.id}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <input
                    autoFocus
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={t('lore.product.vp.pickerSearchPlaceholder', 'Поиск по всем существующим…')}
                    style={{
                      width: '100%', padding: '7px 9px', background: 'var(--bg2)', border: '1px solid var(--bd)',
                      borderRadius: 6, color: 'var(--t1)', fontSize: 'var(--fs-base)', outline: 'none', marginBottom: 8,
                    }}
                  />
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 8 }}>
                    {ucMode
                      ? t('lore.product.vp.pickerUcHint', 'Сценарии этой фичи — или заведите новый.')
                      : t('lore.product.vp.pickerSearchHint', 'Сначала ищем среди уже заведённых — чтобы не плодить дубли.')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
                    {candidates.length === 0 && (
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', textAlign: 'center', padding: '10px 0' }}>
                        {query
                          ? t('lore.product.vp.pickerNoResults', 'Ничего похожего не нашлось')
                          : t('lore.product.vp.pickerTypeToSearch', 'Начни печатать, чтобы поискать среди существующих')}
                      </div>
                    )}
                    {candidates.map(r => (
                      <button key={r.id} type="button" disabled={busy === r.id}
                        onClick={() => pick(r.id)} style={rowBtn}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', flexShrink: 0 }}>{r.id}</span>
                        <span style={{ fontSize: 'var(--fs-sm)', flex: 1 }}>{r.title ?? r.id}</span>
                        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--acc)' }}>
                          {busy === r.id ? '…' : needsCounterpart
                            ? t('lore.product.vp.pickerNext', 'далее →')
                            : t('lore.product.vp.pickerAttach', 'привязать →')}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', color: 'var(--t3)', fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
                    {t('lore.product.vp.pickerOr', 'или')}
                    <span style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
                  </div>
                  <button
                    type="button" onClick={() => setCreating(true)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 'var(--fs-sm)', fontWeight: 500,
                      background: 'transparent', color: 'var(--acc)',
                      border: '1px solid color-mix(in srgb, var(--acc) 35%, transparent)', cursor: 'pointer',
                    }}
                  >
                    {ucMode
                      ? t('lore.product.vp.pickerCreateUc', 'Завести сценарий')
                      : t('lore.product.vp.pickerCreateNew', 'Создать новую')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Формы создания — существующие, не копии. Созданное тут же проходит
          тот же путь привязки, что и найденное поиском. */}
      <PainGainJobModal
        kind={(ucMode ? 'pain' : target) as PainGainJobKind}
        opened={opened && creating && !ucMode}
        onClose={() => { setCreating(false); close(); }}
        onCreated={id => { void attachValue(id); }}
        onError={onError}
      />
      <UsFormModal
        opened={opened && creating && ucMode}
        parentUcId={featureId}
        onClose={() => { setCreating(false); close(); }}
        onSaved={id => { if (needsCounterpart) { setCreating(false); setPickedUc(id); } else void attachUc(id); }}
        onError={onError}
      />
    </>
  );
}
