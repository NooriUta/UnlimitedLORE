// VP-01: добавление боли/выгоды/работы прямо с канвы, без ухода на другой экран.
//
// Два входа в один и тот же поток: перетащить карточку из палитры (VpPalette)
// ИЛИ нажать пустую карточку-приглашение на самой канве (см. LoreVpCanvas).
// Оба открывают VpValuePicker — сначала поиск среди уже существующих (не
// плодить дубли), и только если ничего не нашлось — форма создания
// (переиспользует PainGainJobModal, а не копирует её).
//
// Найденная/созданная запись получает ДВЕ связи, не одну: `linkLoreFeature`
// (иначе канва её не увидит — painIds/gainIds/jobIds берутся из feature.*_ids,
// не из общего списка боли/выгоды/работы) и `linkLoreVp` (иначе она осталась
// бы «ничьей», ровно та дыра, из-за которой в профиле не хватало акторов).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LorePainRow, LoreGainRow, LoreJobRow } from '../../../api/lore';
import { linkLoreFeature, linkLoreVp } from '../../../api/lore';
import PainGainJobModal, { type PainGainJobKind } from './PainGainJobModal';

type ValueRow = { id: string; title: string | null };

const REL: Record<PainGainJobKind, 'felt_by' | 'desired_by' | 'performed_by'> = {
  pain: 'felt_by', gain: 'desired_by', job: 'performed_by',
};

function rowsOf(kind: PainGainJobKind, pains: LorePainRow[], gains: LoreGainRow[], jobs: LoreJobRow[]): ValueRow[] {
  if (kind === 'pain') return pains.map(p => ({ id: p.pain_id, title: p.title }));
  if (kind === 'gain') return gains.map(g => ({ id: g.gain_id, title: g.title }));
  return jobs.map(j => ({ id: j.job_id, title: j.title }));
}

/** Палитра — три карточки-шаблона, перетаскиваются на канву (см. onDrop в LoreVpCanvas). */
export function VpPalette({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const items: { kind: PainGainJobKind; label: string; sub: string; color: string }[] = [
    { kind: 'pain', label: t('lore.product.vp.paletteAddPain', '+ Боль'), sub: t('lore.product.vp.paletteAddPainSub', 'мешает работе'), color: 'var(--pain)' },
    { kind: 'gain', label: t('lore.product.vp.paletteAddGain', '+ Выгода'), sub: t('lore.product.vp.paletteAddGainSub', 'даёт результат'), color: 'var(--gain)' },
    { kind: 'job', label: t('lore.product.vp.paletteAddJob', '+ Работа'), sub: t('lore.product.vp.paletteAddJobSub', 'что делает актор'), color: 'var(--job)' },
  ];
  return (
    <div
      // Компактный оверлей (замечание владельца: крупные карточки закрывали
      // канву). Подпись «что это» — в title, не в теле карточки.
      title={t('lore.product.vp.paletteLabel', 'Палитра — тащи на канву')}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, opacity: disabled ? .4 : 1,
        padding: 5, borderRadius: 7,
        // Оверлей поверх канвы (ReactFlow Panel): свой фон обязателен, иначе
        // карточки сливаются с точечной сеткой холста под ними.
        background: 'color-mix(in srgb, var(--bg1) 88%, transparent)',
        border: '1px solid var(--bd)', backdropFilter: 'blur(2px)',
      }}
    >
      {items.map(it => (
        <div
          key={it.kind}
          draggable={!disabled}
          onDragStart={e => { e.dataTransfer.setData('application/x-lore-vp-kind', it.kind); e.dataTransfer.effectAllowed = 'copy'; }}
          title={`${it.label} — ${it.sub}`}
          style={{
            border: `1px dashed color-mix(in srgb, ${it.color} 45%, var(--bd))`, borderRadius: 5,
            background: 'var(--bg2)', padding: '3px 7px', cursor: disabled ? 'default' : 'grab',
          }}
        >
          <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: it.color, whiteSpace: 'nowrap' }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface VpPickerRequest {
  kind: PainGainJobKind;
  actorId: string;
  actorName: string;
}

/**
 * Поиск-сначала-потом-создание, привязка к актору и к текущей фиче.
 *
 * `opened` управляется извне (см. LorePainGainJobRegistry — тот же паттерн:
 * компонент смонтирован всегда, видимость — булевым пропом, а не условным
 * монтированием, иначе Mantine теряет transition).
 */
export default function VpValuePicker({
  request, featureId, pains, gains, jobs, onClose, onLinked, onError,
}: {
  request: VpPickerRequest | null;
  featureId: string;
  pains: LorePainRow[];
  gains: LoreGainRow[];
  jobs: LoreJobRow[];
  onClose: () => void;
  /** запись найдена/создана И привязана и к фиче, и к актору */
  onLinked: (id: string) => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const opened = !!request;
  const kind = request?.kind ?? 'pain';

  const candidates = useMemo(() => {
    const all = rowsOf(kind, pains, gains, jobs);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(r => r.id.toLowerCase().includes(q) || (r.title ?? '').toLowerCase().includes(q));
  }, [kind, pains, gains, jobs, query]);

  const reset = () => { setQuery(''); setCreating(false); setLinking(null); };
  const close = () => { reset(); onClose(); };

  const attach = async (id: string) => {
    if (!request) return;
    setLinking(id);
    try {
      await linkLoreFeature({ feature_id: featureId, rel: kind, target_id: id });
      await linkLoreVp({ source_id: id, rel: REL[kind], target_id: request.actorId });
      onLinked(id);
      close();
    } catch (e) {
      onError(e);
    } finally {
      setLinking(null);
    }
  };

  const kindTitle: Record<PainGainJobKind, string> = {
    pain: t('lore.product.vp.pickerTitlePain', 'Боль'),
    gain: t('lore.product.vp.pickerTitleGain', 'Выгода'),
    job: t('lore.product.vp.pickerTitleJob', 'Работа'),
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
                {t('lore.product.vp.pickerAdd', 'Добавить: {{kind}}', { kind: kindTitle[kind] })}
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)' }}>{request?.actorName}</span>
              <button type="button" onClick={close} style={{
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', color: 'var(--t3)', cursor: 'pointer', borderRadius: 5,
              }}>✕</button>
            </div>
            <div style={{ padding: '12px 14px', overflowY: 'auto' }}>
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
                {t('lore.product.vp.pickerSearchHint', 'Сначала ищем среди уже заведённых — чтобы не плодить дубли.')}
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
                  <button
                    key={r.id} type="button" disabled={linking === r.id}
                    onClick={() => attach(r.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                      border: '1px solid var(--bd)', background: 'transparent', cursor: 'pointer',
                      textAlign: 'left', color: 'var(--t1)', font: 'inherit',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', flexShrink: 0 }}>{r.id}</span>
                    <span style={{ fontSize: 'var(--fs-sm)', flex: 1 }}>{r.title ?? r.id}</span>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--acc)' }}>
                      {linking === r.id ? '…' : t('lore.product.vp.pickerAttach', 'привязать →')}
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
                {t('lore.product.vp.pickerCreateNew', 'Создать новую')}
              </button>
            </div>
          </div>
        </div>
      )}
      <PainGainJobModal
        kind={kind}
        opened={opened && creating}
        onClose={() => { setCreating(false); close(); }}
        onCreated={id => { void attach(id); }}
        onError={onError}
      />
    </>
  );
}
