// Черновик новой записи в доке записи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
// Логика записи — recordCreate.ts; здесь только форма. Редакторы полей — kit
// (FieldEditor), MD — только TipTapField (инвариант MD-полей).
import { useEffect, useMemo, useState } from 'react';
import { FieldEditor, useKitLang } from '@seidr/kit';
import { TipTapField } from '@seidr/kit/content';
import { useAppT, type AppKey } from '../i18n';
import { fetchTypeStatuses } from './passportStatuses';
import {
  createFields, fetchSprintOptions, missingRequired, saveCreate, type CreateType, type CreateValues, type StatusOption,
} from './recordCreate';
import './RecordCreateForm.css';

export interface RecordCreateProps {
  type: CreateType;
  fetchImpl?: typeof fetch;
  /** Запись заведена — открыть её полную запись (то, что открывает «Читать целиком»). */
  onCreated: (id: string) => void;
  onCancel: () => void;
}

const KIND_KEY: Record<CreateType, AppKey> = {
  sprint: 'create.kind.sprint', adr: 'create.kind.adr', task: 'create.kind.task',
};

export function RecordCreate({ type, fetchImpl, onCreated, onCancel }: RecordCreateProps) {
  const lang = useKitLang();
  const t = useAppT();
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  useEffect(() => {
    let live = true;
    fetchTypeStatuses(type, fetchImpl ? { fetchImpl } : {}).then(
      r => { if (live) setStatusOptions(r.items.map(s => ({ value: s.code, label: s.title }))); },
      () => { /* без цикла статус ставит сервер по умолчанию */ },
    );
    return () => { live = false; };
  }, [type, fetchImpl]);
  // Спринт задачи — ребро, выбирается из списка (слово владелицы 11.11). Пока
  // список не пришёл — null: «загружается» не равно «пусто».
  const [sprints, setSprints] = useState<{ options: StatusOption[]; note?: string } | null>(null);
  useEffect(() => {
    if (type !== 'task') return;
    let live = true;
    fetchSprintOptions(fetchImpl).then(r => { if (live) setSprints(r); });
    return () => { live = false; };
  }, [type, fetchImpl]);
  const fields = useMemo(
    () => createFields(type, lang, { status: statusOptions, sprints: sprints?.options ?? [] }),
    [type, lang, statusOptions, sprints],
  );
  const sprintNote = type !== 'task' || !sprints ? null
    : sprints.options.length === 0
      ? (sprints.note ? t('create.sprints.failed', { reason: sprints.note }) : t('create.sprints.empty'))
      : sprints.note === 'cut' ? t('create.sprints.cut') : null;
  const [values, setValues] = useState<CreateValues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const missing = missingRequired(type, values);
  const missingLabels = fields.filter(f => missing.includes(f.key)).map(f => f.label);
  const blocked = missing.length > 0;

  const save = async () => {
    setTried(true);
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    const r = await saveCreate(type, values, { fetchImpl, lang });
    setBusy(false);
    // Отказ — словами, набранное остаётся в форме.
    if (r.ok) onCreated(r.id);
    else setError(r.reason);
  };

  return (
    <form className="rec-create" data-testid="record-create" data-type={type}
      aria-labelledby="rec-create-title" onSubmit={e => { e.preventDefault(); void save(); }}>
      <header className="rec-create__head">
        <span className="rec-create__draft">{t('create.draft')}</span>
        <h2 id="rec-create-title" className="rec-create__title">{t('create.title', { kind: t(KIND_KEY[type]) })}</h2>
      </header>
      <p className="rec-create__note">{t('create.note')}</p>
      {sprintNote && <p className="rec-create__warn" role="status" data-testid="create-sprints-note">{sprintNote}</p>}
      <div className="rec-create__fields">
        {fields.map(f => (
          <div key={f.key} className="rec-create__field" data-field={f.key}>
            <FieldEditor def={f} value={values[f.key] ?? null} showRequired={tried}
              onChange={v => setValues(prev => ({ ...prev, [f.key]: v }))}
              mdEditor={({ value, onChange, label }) => (
                <TipTapField value={value} onChange={onChange} ariaLabel={label} minHeight={80} />
              )} />
          </div>
        ))}
      </div>
      {error && <p className="rec-create__err" role="alert">{error}</p>}
      <footer className="rec-create__foot">
        <button type="submit" className="sk-btn sk-btn--primary" disabled={blocked || busy} aria-describedby={blocked ? 'rec-create-why' : undefined}>
          {busy ? t('create.saving') : t('create.save')}
        </button>
        <button type="button" className="sk-btn" onClick={onCancel} disabled={busy}>{t('create.cancel')}</button>
        {blocked && (
          // Почему «Сохранить» неактивно — текстом рядом, а не догадкой.
          <span id="rec-create-why" className="rec-create__why">{t('create.why', { fields: missingLabels.join(', ') })}</span>
        )}
      </footer>
    </form>
  );
}

export default RecordCreate;
