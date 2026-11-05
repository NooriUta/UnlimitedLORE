import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { iconLoaded } from '@iconify/react';
import gameIconsData from '@iconify-json/game-icons/icons.json';
import { loreMutate } from '../../../api/lore';
import { GameIcon } from '../GameIcon';
import type { DictRow } from './types';
import { S } from './adminStyles';
import { RespTable, Toolbar, rowBtn } from './adminWidgets';
import { useIsNarrow } from './useIsNarrow';
import type { Col } from './adminCards';
import { checkNewDictType } from './dictTypeInput';

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
  const narrow = useIsNarrow();
  const [params, setParams] = useSearchParams();
  const types = useMemo(() => [...new Set(rows.map(r => r.dict_type))].sort(), [rows]);
  const typeCount = useMemo(() => rows.reduce<Record<string, number>>((m, r) => { m[r.dict_type] = (m[r.dict_type] ?? 0) + 1; return m; }, {}), [rows]);
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
  // RM-P11: вход для нового типа. Тип не существует отдельно от записей, поэтому
  // «Завести» сразу открывает форму ПЕРВОЙ записи — иначе остался бы пустой тип,
  // которого снова не видно (тот же дефект под другим именем).
  const [newType, setNewType] = useState('');
  const newTypeCheck = checkNewDictType(newType, types);
  function startNewValue(forType: string, count: number) {
    setEdit({ dict_type: forType, code: '', label_ru: '', label_en: null, color: null, icon: null, sort_order: (count + 1) * 10, is_active: true, is_extensible: true });
    setIsNew(true); setConfirmCanon(false); setConfirmDeact(false);
  }
  function applyNewType() {
    if (newTypeCheck.kind === 'exists') { setDt(newTypeCheck.code); closeEdit(); setNewType(''); return; }
    if (newTypeCheck.kind !== 'new') return;
    setDt(newTypeCheck.code); setNewType(''); startNewValue(newTypeCheck.code, 0);
  }

  const all = rows.filter(r => r.dict_type === dt);
  const ql = q.toLowerCase();
  const shown = all
    .filter(r => active === 'all' || r.is_active)
    // D-03: код тоже без учёта регистра.
    .filter(r => !ql || r.code.toLowerCase().includes(ql) || (r.label_ru ?? '').toLowerCase().includes(ql));
  const canon = CANON_TYPES.has(dt);
  // AH-07: сбой загрузки компонентов — счёт неизвестен (н/д), а не «0 использований».
  const usage = (code: string): number | null => (dt === 'area' && !usageUnknown ? (areaUsage[code] ?? 0) : null);

  async function save(activeOverride?: boolean) {
    if (!edit || !edit.code.trim()) { onError(new Error(t('lore.admin.codeRequired', 'code обязателен'))); return; }
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
      closeEdit(); reload();
    } catch (e) { onError(e); } finally { setSaving(false); }
  }
  function closeEdit() { setEdit(null); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false); }
  // D-19: «Включить» у неактивного значения — та же форма правки с is_active=true
  // (канон-словарь по-прежнему требует подтверждения).
  function openEdit(r: DictRow, reactivate = false) {
    setEdit({ ...r, is_active: reactivate ? true : r.is_active }); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false);
  }

  const iconOk = !edit?.icon || iconLoaded(`game-icons:${edit.icon}`);
  const iconSuggestions = edit?.icon && !iconOk
    ? GAME_ICON_NAMES.filter(n => n.includes(edit.icon!.toLowerCase())).slice(0, 6)
    : [];
  const editUsage = edit ? usage(edit.code) : null;
  const naT = t('lore.admin.na', 'н/д');

  const cols: Col[] = [
    { key: 'code', label: t('lore.admin.thCode', 'код'), kind: 'title' },
    { key: 'label', label: t('lore.admin.thLabel', 'подпись') },
    { key: 'look', label: t('lore.admin.thLook', 'вид') },
    { key: 'uses', label: t('lore.admin.thUses', 'использований'), num: true },
    { key: 'order', label: t('lore.admin.thOrder', 'поряд.'), num: true },
    { key: 'on', label: t('lore.admin.thActive', 'акт.') },
    { key: 'act', label: '', kind: 'act' },
  ];
  const cell = (r: DictRow, k: string) => {
    switch (k) {
      case 'code': return r.code;
      case 'label': return r.label_ru ?? '—';
      // AL-34: готовый чип вместо «квадратик + сырой CSS-текст»
      case 'look': return (
        <span style={S.live(r.color ?? 'var(--t3)')}>
          {r.icon ? <GameIcon slug={r.icon} size={13} style={{ color: 'inherit' }} /> : null}
          {r.label_ru ?? r.code}
        </span>
      );
      case 'uses': {
        const u = usage(r.code);
        return u === null
          ? <span style={{ color: 'var(--t3)' }} title={t('lore.admin.usageNA', 'подсчёт для этого словаря появится с AL-30/SV-10')}>{naT}</span>
          : <span style={{ color: u ? 'var(--t2)' : 'var(--t3)' }}>{u}</span>;
      }
      case 'order': return r.sort_order ?? '—';
      case 'on': return r.is_active
        ? <GameIcon slug="tick" size={13} style={{ color: 'var(--suc)' }} />
        : <span style={{ color: 'var(--t3)' }}>{t('lore.admin.inactive', 'откл.')}</span>;
      case 'act': return (
        <>
          <button style={rowBtn(narrow)} aria-expanded={edit?.code === r.code && !isNew}
            onClick={() => (edit?.code === r.code && !isNew ? closeEdit() : openEdit(r))}>
            {edit?.code === r.code && !isNew ? t('lore.admin.collapse', 'Свернуть') : t('lore.admin.edit', 'Править')}
          </button>
          {!r.is_active && <button style={rowBtn(narrow)} onClick={() => openEdit(r, true)}>{t('lore.admin.reactivate', 'Включить')}</button>}
        </>
      );
    }
    return null;
  };

  const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', flex: narrow ? '1 1 100%' : undefined, minWidth: 0 };
  const inp = { ...S.input, minHeight: S.tap(narrow).minHeight, width: narrow ? '100%' : undefined, boxSizing: 'border-box' as const };
  const form = edit && (
    <div style={{ ...S.form, margin: 0 }}>
      {!isNew && !all.find(r => r.code === edit.code)?.is_active && edit.is_active && (
        <div style={S.note}>{t('lore.admin.reactivateNote', 'Значение сейчас отключено — «Сохранить» включит его обратно.')}</div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={lbl}>
          {t('lore.admin.fCode', 'Код')}
          {/* AL-41: code — ключ, которым связаны данные; правится только при создании */}
          <input style={{ ...inp, fontFamily: 'var(--mono)', ...(isNew ? {} : { background: 'var(--bg3)', color: 'var(--t2)', cursor: 'not-allowed' }) }}
            value={edit.code} readOnly={!isNew}
            title={isNew ? undefined : t('lore.admin.codeLocked', 'Ключ — правке не подлежит (OQ-ADMIN-DICT-CODE)')}
            onChange={e => isNew && setEdit(f => f && ({ ...f, code: e.target.value }))} />
          {!isNew && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{t('lore.admin.codeLockedHint', 'ключ — правке не подлежит')}</span>}
        </label>
        <label style={lbl}>
          {t('lore.admin.fLabel', 'Подпись')}
          <input style={inp} value={edit.label_ru ?? ''} onChange={e => setEdit(f => f && ({ ...f, label_ru: e.target.value }))} />
        </label>
        <label style={lbl}>
          {t('lore.admin.fColor', 'Цвет')}
          {/* AL-42: выбор токена темы; смесь/произвольный CSS — в «расширенном» поле */}
          <select style={{ ...inp, fontFamily: 'var(--mono)' }} value={COLOR_TOKENS.some(([v]) => v === edit.color) ? edit.color! : '_custom'}
            onChange={e => { if (e.target.value !== '_custom') setEdit(f => f && ({ ...f, color: e.target.value })); }}>
            {COLOR_TOKENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value="_custom">{t('lore.admin.colorCustom', 'расширенный (CSS)…')}</option>
          </select>
          <input style={{ ...inp, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }} placeholder="color-mix(in srgb, var(--acc) 55%, var(--inf))"
            value={edit.color ?? ''} onChange={e => setEdit(f => f && ({ ...f, color: e.target.value || null }))} />
        </label>
        <label style={lbl}>
          {t('lore.admin.fIcon', 'Иконка (game-icons)')}
          <input style={{ ...inp, fontFamily: 'var(--mono)' }} placeholder="tied-scroll" list="gi-suggest"
            value={edit.icon ?? ''} onChange={e => setEdit(f => f && ({ ...f, icon: e.target.value || null }))} />
          <datalist id="gi-suggest">
            {(edit.icon ? GAME_ICON_NAMES.filter(n => n.includes(edit.icon!.toLowerCase())).slice(0, 20) : []).map(n => <option key={n} value={n} />)}
          </datalist>
        </label>
        <label style={lbl}>
          {t('lore.admin.fOrder', 'Порядок')}
          <input style={{ ...inp, width: narrow ? '100%' : 70 }} type="number" value={edit.sort_order ?? 0} onChange={e => setEdit(f => f && ({ ...f, sort_order: Number(e.target.value) }))} />
        </label>
      </div>

      {/* AL-42: живое превью — цвет и иконка вместе, как они встанут в UI */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)' }}>
        <span style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>{t('lore.admin.preview', 'Так это будет выглядеть')}</span>
        <span style={S.live(edit.color ?? 'var(--t3)')}>
          {edit.icon && iconOk ? <GameIcon slug={edit.icon} size={14} style={{ color: 'inherit' }} /> : null}
          {edit.label_ru || edit.code || '—'}
        </span>
        {!iconOk && (
          <span style={{ color: 'var(--dng)', fontSize: 'var(--fs-xs)', display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <GameIcon slug="cross-mark" size={11} style={{ color: 'inherit' }} />
            {t('lore.admin.iconBad', 'иконки с таким именем нет — будет пусто.')}{' '}
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
        <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--wrn)', display: 'flex', alignItems: 'center', gap: 6, minHeight: S.tap(narrow).minHeight }}>
          <input type="checkbox" checked={confirmCanon} onChange={e => setConfirmCanon(e.target.checked)} />
          {t('lore.admin.canonConfirm', 'Понимаю: это канон-словарь, изменение затрагивает весь корпус')}
        </label>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={rowBtn(narrow, S.primary)} disabled={saving || (canon && !confirmCanon)} onClick={() => save()}>{saving ? '…' : t('lore.admin.save', 'Сохранить')}</button>
        <button style={rowBtn(narrow)} onClick={closeEdit}>{t('lore.admin.cancel', 'Отмена')}</button>
        {!isNew && edit.is_active && all.find(r => r.code === edit.code)?.is_active && (
          <span style={{ marginLeft: narrow ? 0 : 'auto', flex: narrow ? '1 1 100%' : undefined, display: 'flex' }}>
            {confirmDeact
              ? <button style={rowBtn(narrow, S.danger)} disabled={saving || (canon && !confirmCanon)} onClick={() => save(false)}>
                  {t('lore.admin.deactConfirm', 'Точно деактивировать{{u}}?', { u: editUsage ? ` (${editUsage} использований)` : '' })}
                </button>
              : <button style={rowBtn(narrow, S.danger)} onClick={() => setConfirmDeact(true)}>{t('lore.admin.deact', 'Деактивировать…')}</button>}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {types.map(x => (
          <button key={x} aria-pressed={dt === x}
            style={{ ...S.chip(dt === x), minHeight: narrow ? 36 : undefined, ...(CANON_TYPES.has(x) ? { borderStyle: 'dashed' } : null), fontFamily: 'var(--mono)' }}
            title={CANON_TYPES.has(x) ? t('lore.admin.canonChip', 'канон-словарь') : undefined}
            onClick={() => { setDt(x); closeEdit(); }}>
            {x} <span style={{ color: 'var(--t3)' }}>{typeCount[x]}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input style={{ ...S.input, fontFamily: 'var(--mono)', minHeight: S.tap(narrow).minHeight, width: narrow ? '100%' : 200, boxSizing: 'border-box' }}
          aria-label={t('lore.admin.newTypeLabel', 'Новый тип справочника')}
          placeholder={t('lore.admin.newTypePlaceholder', 'новый тип: release_kind')}
          value={newType} onChange={e => setNewType(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyNewType(); }} />
        <button style={rowBtn(narrow)} disabled={newTypeCheck.kind === 'empty' || newTypeCheck.kind === 'bad'} onClick={applyNewType}>
          {newTypeCheck.kind === 'exists' ? t('lore.admin.newTypeOpen', 'Открыть') : t('lore.admin.newTypeCreate', 'Завести тип')}
        </button>
        {newTypeCheck.kind === 'bad' && (
          <span style={{ color: 'var(--dng)', fontSize: 'var(--fs-xs)' }}>
            {t('lore.admin.newTypeBad', 'код — строчная латиница, цифры и «_», с буквы в начале')}
          </span>
        )}
        {newTypeCheck.kind === 'new' && (
          <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-xs)' }}>
            {t('lore.admin.newTypeHint', 'тип появится вместе с первой записью')}
          </span>
        )}
      </div>
      {canon && <div style={S.warn}>{t('lore.admin.canonWarn', '⚠ Канон-словарь (ADR-LORE-010): значения зашиты в статусы всего корпуса. Правка label/color/icon безопасна; коды здесь не правятся вовсе.')}</div>}
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={all.length} placeholder={t('lore.admin.dictSearch', 'код или подпись…')}
        seg={{ options: [['active', t('lore.admin.fltActive', 'Активные')], ['all', t('lore.admin.fltAll', 'Все')]], value: active, set: v => setActive(v as 'active' | 'all') }} />
      {shown.length > 0 && (
        // D-07: форма правки раскрывается под своей строкой (на телефоне — в карточке), а не под всей таблицей.
        <RespTable cols={cols} rows={shown} rowKey={r => r.code} cell={cell} narrow={narrow}
          rowStyle={r => (r.is_active ? undefined : { opacity: 0.6 })}
          selected={r => !isNew && edit?.code === r.code}
          expand={r => (!isNew && edit?.code === r.code ? form : null)} />
      )}
      {shown.length === 0 && types.length > 0 && (
        // D-05: пустой словарь — честное пустое состояние (сбой загрузки рисует оболочка отдельно).
        <div style={S.state('neutral')}>
          <div style={S.stateH('neutral')}>
            {active === 'active'
              ? t('lore.admin.dictEmptyActiveH', 'В словаре «{{dt}}» нет активных значений', { dt })
              : t('lore.admin.dictEmptyH', 'В словаре «{{dt}}» нет значений', { dt })}
          </div>
          <div>{q ? t('lore.admin.dictEmptyQ', 'Под поиск ничего не подошло.') : t('lore.admin.dictEmptyB', 'Слайс ответил, строк нет.')}</div>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button style={rowBtn(narrow)} onClick={() => startNewValue(dt, all.length)}>
          {t('lore.admin.addValue', '+ значение')}
        </button>
      </div>
      {isNew && <div style={{ marginTop: 8 }}>{form}</div>}
    </div>
  );
}
