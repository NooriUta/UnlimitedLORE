// Режим «создание» паспорта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24). Владелица 08.11:
// «форма „новая“ открывает ту же форму, что и кнопка „читать целиком“»; 11.11 —
// «да» на прототип s4-24-record-form. Запись `_new` открывается в том же
// RecordView (тот же док, то же место), пустой и в правке.
//
// Что поля и какие обязательны — приложение (K-14): kit не знает, из чего
// состоит новая запись. Запись — hooks.onCreate. Отказ — словами рядом с
// кнопкой, набранное остаётся: тихий откат съел бы работу человека. Пути записи
// нет — так и сказано, а не кнопка, которая ничего не сделает.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { FieldEditor, type FieldEditorProps } from '../fields/FieldEditor';
import { isEmptyValue, type FieldEditorDef } from '../fields/fieldKinds';
import { kitT, useKitLang } from '../i18n';

/** Код новой записи: паспорт с этим id — режим «создание». */
export const KIT_NEW_ID = '_new';

export interface RecordCreateSpec {
  /** Поля новой записи по порядку — словами приложения; `required: 'block'` держит «Сохранить». */
  fields: readonly FieldEditorDef[];
  /** Запись заведена — открыть её (то, что открывает «Читать целиком»). */
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** Замечание над полями от приложения (например «список спринтов не загрузился»). */
  note?: ReactNode;
  /** Редакторы MD и ссылок — слотами приложения, как у FieldEditor. */
  mdEditor?: FieldEditorProps['mdEditor'];
  refEditor?: FieldEditorProps['refEditor'];
  /**
   * AP-PASSPORT-EDIT (2б): подсказка значений по набранному (код из названия). Возвращённые ключи
   * подставляются только в поля, которые человек ещё НЕ правил руками: поправил — подсказка молчит.
   */
  suggest?: (values: Record<string, unknown>) => Record<string, unknown>;
  /**
   * AP-PASSPORT-EDIT (2б): проверка поля ДО записи (свободен ли код). `ok: true` — можно сохранять,
   * `false` — нельзя (занят), `null` — не смогли проверить: тоже нельзя, «не проверено» ≠ «свободно».
   * Сообщение — словами приложения, рядом с полем.
   */
  check?: { key: string; run: (value: unknown, values: Record<string, unknown>) => Promise<{ ok: boolean | null; message: string }> };
}

/** Пауза перед проверкой поля: не спрашивать сервер на каждую букву. */
const CHECK_DELAY_MS = 300;

export function RecordCreate({ record, ctx, spec, className }: { record: KitRecord; ctx: KitCtx; spec: RecordCreateSpec; className?: string }) {
  const lang = useKitLang();
  const titleId = useId();
  const whyId = useId();
  const kindTitle = ctx.config.kinds[record.kind]?.title ?? record.kind;
  const onCreate = ctx.config.hooks?.onCreate;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Поля, которые человек правил руками: подсказка (spec.suggest) их не трогает.
  const touched = useRef(new Set<string>());
  const checkKey = spec.check?.key;
  const checkValue = checkKey ? values[checkKey] : undefined;
  // Исход проверки — для ТОГО значения, что проверялось: ответ на старое значение не выдаётся за новое.
  const [checked, setChecked] = useState<{ value: unknown; ok: boolean | null; message: string } | null>(null);
  const runCheck = spec.check?.run;
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => {
    if (!runCheck || isEmptyValue(checkValue)) { setChecked(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      runCheck(checkValue, valuesRef.current).then(
        r => { if (live) setChecked({ value: checkValue, ...r }); },
        e => { if (live) setChecked({ value: checkValue, ok: null, message: e instanceof Error ? e.message : String(e) }); },
      );
    }, CHECK_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [runCheck, checkValue]);
  const checkFor = checked && checked.value === checkValue ? checked : null;
  const checkBlocks = !!spec.check && !isEmptyValue(checkValue) && checkFor?.ok !== true;

  const onField = (key: string, v: unknown) => {
    touched.current.add(key);
    setValues(prev => {
      const next = { ...prev, [key]: v };
      if (!spec.suggest) return next;
      for (const [k, s] of Object.entries(spec.suggest(next))) if (!touched.current.has(k)) next[k] = s;
      return next;
    });
  };

  const missing = spec.fields.filter(f => f.required === 'block' && isEmptyValue(values[f.key])).map(f => f.label);
  const why = !onCreate ? kitT(lang, 'kit.record.create.noPath')
    : missing.length ? kitT(lang, 'kit.record.create.why', { fields: missing.join(', ') })
    : checkBlocks ? (checkFor ? checkFor.message : kitT(lang, 'kit.record.create.checking')) : null;

  const save = async () => {
    setTried(true);
    if (why || busy || !onCreate) return;
    setBusy(true);
    setFailed(null);
    // В запись идут только заданные значения: пустое поле — «не задано», а не «стёрто».
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmptyValue(v)));
    try {
      const r = await onCreate({ type: record.kind, values: filled });
      spec.onCreated(r.id);
    } catch (e) {
      setFailed(e instanceof Error && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={['sk-rec', 'sk-rec-create', className].filter(Boolean).join(' ')} aria-labelledby={titleId}
      data-kind={record.kind} data-testid="kit-record-create">
      <form className="sk-rec-create__form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <header className="sk-rec-create__head">
          <span className="sk-rec-create__draft">{kitT(lang, 'kit.record.create.draft')}</span>
          <h2 id={titleId} className="sk-rec-create__title">{kitT(lang, 'kit.record.create.title', { kind: kindTitle })}</h2>
        </header>
        {spec.note && <div className="sk-rec-create__note" role="status">{spec.note}</div>}
        <div className="sk-rec-create__fields">
          {spec.fields.map(f => (
            <div key={f.key} className="sk-rec-create__field" data-field={f.key}>
              <FieldEditor def={f} value={values[f.key] ?? null} showRequired={tried}
                onChange={v => onField(f.key, v)}
                mdEditor={spec.mdEditor} refEditor={spec.refEditor} />
              {f.key === checkKey && !isEmptyValue(checkValue) && (
                <p className="sk-rec-create__check" data-testid="kit-create-check" role="status"
                  data-state={!checkFor ? 'pending' : checkFor.ok === true ? 'ok' : checkFor.ok === false ? 'bad' : 'unchecked'}>
                  {checkFor ? checkFor.message : kitT(lang, 'kit.record.create.checking')}
                </p>
              )}
            </div>
          ))}
        </div>
        {failed && <p className="sk-rec-create__err" role="alert">{kitT(lang, 'kit.record.create.failed', { reason: failed })}</p>}
        <footer className="sk-rec-create__foot">
          <button type="submit" className="sk-btn sk-btn--primary" disabled={!!why || busy} aria-describedby={why ? whyId : undefined}>
            {kitT(lang, busy ? 'kit.record.create.saving' : 'kit.record.create.save')}
          </button>
          <button type="button" className="sk-btn" onClick={spec.onCancel} disabled={busy}>{kitT(lang, 'kit.record.create.cancel')}</button>
          {why && <span id={whyId} className="sk-rec-create__why">{why}</span>}
        </footer>
      </form>
    </article>
  );
}
