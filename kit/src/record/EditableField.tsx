// Правка характеристики записи на месте — в «Свойствах» паспорта
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24, часть «правка характеристик»).
//
// Владелица 11.11.2026: «S4-FIELD-EDITORS нужны, а то как редактировать
// характеристики». Редактор — тот же FieldEditor по виду поля, что и везде:
// один код на правку поля. Здесь только обвязка: ✎ → редактор →
// «Сохранить» / «Отмена», и честные состояния записи — идёт, сбой с причиной.
// Сбой не закрывает редактор: набранное остаётся, иначе правка пропала бы
// молча и выглядела бы сохранённой.
import { useState, type ReactNode } from 'react';
import { kitT, useKitLang, type KitKey } from '../i18n';
import { FieldEditor } from '../fields/FieldEditor';
import type { FieldEditorDef } from '../fields/fieldKinds';

export interface EditableFieldProps {
  def: FieldEditorDef;
  value: unknown;
  /** Показ значения вне правки — тот же, что у поля без права правки. */
  view: ReactNode;
  /** Запись было → стало. Отказ — исключение с причиной. */
  onSave: (to: unknown) => Promise<void>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function EditableField({ def, value, view, onSave }: EditableFieldProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [draft, setDraft] = useState<{ v: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  if (!draft) {
    return (
      <span className="sk-rec-fields__edit">
        {view}
        <button type="button" className="sk-btn sk-rec-fields__pen"
          aria-label={t('kit.mdedit.edit', { field: def.label })} title={t('kit.mdedit.edit', { field: def.label })}
          onClick={() => { setFail(null); setDraft({ v: value }); }}>✎</button>
      </span>
    );
  }

  const changed = !same(draft.v, value);
  const save = async () => {
    setBusy(true);
    setFail(null);
    try {
      await onSave(draft.v);
      setDraft(null);
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sk-rec-fields__editor">
      <FieldEditor def={def} value={draft.v} onChange={v => setDraft({ v })} showRequired />
      {fail !== null && <p className="sk-field__err" role="alert">{t('kit.field.saveFailed', { reason: fail })}</p>}
      <span className="sk-mdedit__actions">
        <button type="button" className="sk-btn" disabled={!changed || busy} onClick={save}>
          {busy ? t('kit.mdedit.saving') : t('kit.mdedit.save')}
        </button>
        <button type="button" className="sk-btn" disabled={busy} onClick={() => { setDraft(null); setFail(null); }}>
          {t('kit.mdedit.cancel')}
        </button>
      </span>
    </div>
  );
}
