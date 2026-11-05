import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { iconLoaded } from '@iconify/react';
import gameIconsData from '@iconify-json/game-icons/icons.json';
import { loreMutate } from '../../../api/lore';
import { GameIcon } from '../GameIcon';
import type { DictRow } from './types';
import { S } from './adminStyles';
import { Toolbar } from './adminWidgets';

const CANON_TYPES = new Set(['adr_status', 'sprint_status', 'task_status', 'priority']);

// ── Словари (AL-34/41/42) ────────────────────────────────────────────────────
const COLOR_TOKENS: [string, string][] = [
  ['var(--acc)', 'акцент · --acc'], ['var(--suc)', 'успех · --suc'], ['var(--inf)', 'инфо · --inf'],
  ['var(--wrn)', 'внимание · --wrn'], ['var(--dng)', 'опасность · --dng'], ['var(--t2)', 'приглушённый · --t2'],
];
const GAME_ICON_NAMES: string[] = Object.keys((gameIconsData as { icons: Record<string, unknown> }).icons);

export function DictsTab({ rows, areaUsage, usageUnknown, onError, reload }: {
  rows: DictRow[]; areaUsage: Record<string, number>; usageUnknown?: boolean; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const types = useMemo(() => [...new Set(rows.map(r => r.dict_type))].sort(), [rows]);
  const dt = params.get('dict') ?? 'area';
  const setDt = (v: string) => {
    const p = new URLSearchParams(params); p.set('dict', v); setParams(p, { replace: true });
  };
  const [q, setQ] = useState('');
  const [active, setActive] = useState<'active' | 'all'>('active');
  const [edit, setEdit] = useState<DictRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmCanon, setConfirmCanon] = useState(false);
  const [confirmDeact, setConfirmDeact] = useState(false);
  const [saving, setSaving] = useState(false);

  const all = rows.filter(r => r.dict_type === dt);
  const shown = all
    .filter(r => active === 'all' || r.is_active)
    .filter(r => !q || r.code.includes(q.toLowerCase()) || (r.label_ru ?? '').toLowerCase().includes(q.toLowerCase()));
  const canon = CANON_TYPES.has(dt);
  // AH-07: сбой загрузки компонентов — счёт неизвестен (н/д), а не «0 использований».
  const usage = (code: string): number | null => (dt === 'area' && !usageUnknown ? (areaUsage[code] ?? 0) : null);

  async function save(activeOverride?: boolean) {
    if (!edit || !edit.code.trim()) { onError(new Error('code обязателен')); return; }
    if (canon && !confirmCanon) return;
    setSaving(true);
    try {
      await loreMutate('/dict/entry', {
        dict_type: dt, code: edit.code.trim(),
        label_ru: edit.label_ru ?? null, label_en: edit.label_en || null,
        color: edit.color || null, icon: edit.icon || null,
        sort_order: edit.sort_order ?? null,
        is_active: activeOverride ?? edit.is_active, is_extensible: null,
      });
      setEdit(null); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false); reload();
    } catch (e) { onError(e); } finally { setSaving(false); }
  }

  const iconOk = !edit?.icon || iconLoaded(`game-icons:${edit.icon}`);
  const iconSuggestions = edit?.icon && !iconOk
    ? GAME_ICON_NAMES.filter(n => n.includes(edit.icon!.toLowerCase())).slice(0, 6)
    : [];
  const editUsage = edit ? usage(edit.code) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {types.map(x => <button key={x} style={S.chip(dt === x)} onClick={() => { setDt(x); setEdit(null); }}>{x}</button>)}
      </div>
      {canon && <div style={S.warn}>{t('lore.admin.canonWarn', '⚠ Канон-словарь (ADR-LORE-010): значения зашиты в статусы всего корпуса. Правка label/color/icon безопасна; коды здесь не правятся вовсе.')}</div>}
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={all.length}
        seg={{ options: [['active', t('lore.admin.fltActive', 'Активные')], ['all', t('lore.admin.fltAll', 'Все')]], value: active, set: v => setActive(v as 'active' | 'all') }} />
      <div style={S.tw}>
        <table style={S.table}>
          <thead><tr>{['код', 'подпись', 'вид', 'использований', 'поряд.', 'акт.', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map(r => {
              const u = usage(r.code);
              return (
                <tr key={r.code} style={r.is_active ? undefined : { opacity: 0.55 }}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.code}</td>
                  <td style={S.td}>{r.label_ru ?? '—'}</td>
                  <td style={S.td}>
                    {/* AL-34: готовый чип вместо «квадратик + сырой CSS-текст» */}
                    <span style={S.live(r.color ?? 'var(--t3)')}>
                      {r.icon ? <GameIcon slug={r.icon} size={13} style={{ color: 'inherit' }} /> : null}
                      {r.label_ru ?? r.code}
                    </span>
                  </td>
                  <td style={{ ...S.td, ...S.num }} title={u === null ? t('lore.admin.usageNA', 'подсчёт для этого словаря появится с AL-30/SV-10') : undefined}>
                    {u === null ? <span style={{ color: 'var(--t3)' }}>н/д</span> : <span style={{ color: u ? 'var(--t2)' : 'var(--t3)' }}>{u}</span>}
                  </td>
                  <td style={{ ...S.td, ...S.num }}>{r.sort_order ?? '—'}</td>
                  <td style={S.td}>{r.is_active ? '✓' : '✗'}</td>
                  <td style={S.td}><button style={S.btn} onClick={() => { setEdit({ ...r }); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false); }}>{t('lore.admin.edit', 'Править')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8 }}>
        <button style={S.btn} onClick={() => { setEdit({ dict_type: dt, code: '', label_ru: '', label_en: null, color: null, icon: null, sort_order: (all.length + 1) * 10, is_active: true, is_extensible: true }); setIsNew(true); }}>
          {t('lore.admin.addValue', '+ значение')}
        </button>
      </div>
      {edit && (
        <div style={S.form}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fCode', 'Код')}
              {/* AL-41: code — ключ, которым связаны данные; правится только при создании */}
              <input style={{ ...S.input, fontFamily: 'var(--mono)', ...(isNew ? {} : { background: 'var(--bg3)', color: 'var(--t2)', cursor: 'not-allowed' }) }}
                value={edit.code} readOnly={!isNew}
                title={isNew ? undefined : t('lore.admin.codeLocked', 'Ключ — правке не подлежит (OQ-ADMIN-DICT-CODE)')}
                onChange={e => isNew && setEdit(f => f && ({ ...f, code: e.target.value }))} />
              {!isNew && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{t('lore.admin.codeLockedHint', 'ключ — правке не подлежит')}</span>}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fLabel', 'Подпись')}
              <input style={S.input} value={edit.label_ru ?? ''} onChange={e => setEdit(f => f && ({ ...f, label_ru: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fColor', 'Цвет')}
              {/* AL-42: выбор токена темы; смесь/произвольный CSS — в «расширенном» поле */}
              <select style={S.select} value={COLOR_TOKENS.some(([v]) => v === edit.color) ? edit.color! : '_custom'}
                onChange={e => { if (e.target.value !== '_custom') setEdit(f => f && ({ ...f, color: e.target.value })); }}>
                {COLOR_TOKENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                <option value="_custom">{t('lore.admin.colorCustom', 'расширенный (CSS)…')}</option>
              </select>
              <input style={{ ...S.input, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }} placeholder="color-mix(in srgb, var(--acc) 55%, var(--inf))"
                value={edit.color ?? ''} onChange={e => setEdit(f => f && ({ ...f, color: e.target.value || null }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fIcon', 'Иконка (game-icons)')}
              <input style={{ ...S.input, fontFamily: 'var(--mono)' }} placeholder="tied-scroll" list="gi-suggest"
                value={edit.icon ?? ''} onChange={e => setEdit(f => f && ({ ...f, icon: e.target.value || null }))} />
              <datalist id="gi-suggest">
                {(edit.icon ? GAME_ICON_NAMES.filter(n => n.includes(edit.icon!.toLowerCase())).slice(0, 20) : []).map(n => <option key={n} value={n} />)}
              </datalist>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fOrder', 'Порядок')}
              <input style={{ ...S.input, width: 70 }} type="number" value={edit.sort_order ?? 0} onChange={e => setEdit(f => f && ({ ...f, sort_order: Number(e.target.value) }))} />
            </label>
          </div>

          {/* AL-42: живое превью — цвет и иконка вместе, как они встанут в UI */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)' }}>
            <span style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>{t('lore.admin.preview', 'Так это будет выглядеть')}</span>
            <span style={S.live(edit.color ?? 'var(--t3)')}>
              {edit.icon && iconOk ? <GameIcon slug={edit.icon} size={14} style={{ color: 'inherit' }} /> : null}
              {edit.label_ru || edit.code || '—'}
            </span>
            {!iconOk && (
              <span style={{ color: 'var(--dng)', fontSize: 'var(--fs-xs)' }}>
                ✕ {t('lore.admin.iconBad', 'иконки с таким именем нет — будет пусто.')}{' '}
                {iconSuggestions.length > 0 && <>{t('lore.admin.iconMaybe', 'Похожие:')} {iconSuggestions.join(', ')}</>}
              </span>
            )}
          </div>

          {editUsage !== null && editUsage > 0 && (
            <div style={S.warn}>
              <b>{t('lore.admin.usageWarn', '{{n}} сущностей несут этот код.', { n: editUsage })}</b>{' '}
              {t('lore.admin.usageWarn2', 'Изменение цвета/иконки поменяет их вид во всём LORE; деактивация потребует подтверждения.')}
            </div>
          )}
          {canon && (
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--wrn)' }}>
              <input type="checkbox" checked={confirmCanon} onChange={e => setConfirmCanon(e.target.checked)} />{' '}
              {t('lore.admin.canonConfirm', 'Понимаю: это канон-словарь, изменение затрагивает весь корпус')}
            </label>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={S.primary} disabled={saving || (canon && !confirmCanon)} onClick={() => save()}>{saving ? '…' : t('lore.admin.save', 'Сохранить')}</button>
            <button style={S.btn} onClick={() => { setEdit(null); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false); }}>{t('lore.admin.cancel', 'Отмена')}</button>
            {!isNew && edit.is_active && (
              <span style={{ marginLeft: 'auto' }}>
                {confirmDeact
                  ? <button style={S.danger} disabled={saving || (canon && !confirmCanon)} onClick={() => save(false)}>
                      {t('lore.admin.deactConfirm', 'Точно деактивировать{{u}}?', { u: editUsage ? ` (${editUsage} использований)` : '' })}
                    </button>
                  : <button style={S.danger} onClick={() => setConfirmDeact(true)}>{t('lore.admin.deact', 'Деактивировать…')}</button>}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
