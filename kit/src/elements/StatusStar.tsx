// StatusStar (S4-00b, D-2026-UXR-STATUS-AXIS): статус внутри списков и записей —
// всегда «звезда»: иконка и постоянный цвет --st-* статуса, категория в
// data-category (по ней группирует доска и палитра).
//
// Три режима:
// - только показ — role=img с именем;
// - onOpen — кнопка, палитру рисует вызывающий (как было в S4-00b);
// - onPick (S4-07) — звезда сама открывает палитру «2 касания»: статусы по
//   категориям в порядке жизненного цикла, для завершающих — третий шаг.
//   Запись — onPick вызывающего (существующий API, от оболочки не зависит):
//   смена оптимистичная, отказ (reject) — откат и role=alert с причиной.
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { KitRecord } from '../core/contract';
import { useStatusChange } from '../core/useStatusChange';
import { kitT, useKitLang } from '../i18n';
import { GameIcon } from './GameIcon';
import { StatusPalette } from './StatusPalette';
import { KNOWN_STATUSES, statusMeta } from './statusMeta';

export interface StatusStarProps {
  status: string | null | undefined;
  /**
   * Имя для чтения, например «Статус: в работе» (локализует вызывающий).
   * С titleOf можно не передавать — имя соберётся из подписи статуса.
   */
  label?: string;
  /** Показать текст label рядом с иконкой. */
  showLabel?: boolean;
  /** Открыть свою палитру смены статуса — делает звезду кнопкой. */
  onOpen?: () => void;
  /**
   * S4-07: записать новый статус (to, from). Делает звезду кнопкой со
   * встроенной палитрой. Promise reject = отказ, статус вернётся.
   */
  onPick?: (to: string, from: string) => void | Promise<void>;
  /** Коды для палитры; по умолчанию — все известные статусы звезды. */
  options?: readonly string[];
  /** Подпись статуса для человека (локализует вызывающий); по умолчанию — код. */
  titleOf?: (code: string) => string;
  /** id записи — для useStatusChange (сброс состояния при смене записи). */
  recordId?: string;
  /** Палитра открыта — aria-expanded у кнопки (только вместе с onOpen). */
  expanded?: boolean;
  /**
   * id всплывашки, которую рисует ВЫЗЫВАЮЩИЙ (вместе с onOpen): им звезда
   * называет связь (aria-controls). По ней же общий Popover узнаёт СВОЙ
   * открыватель и не считает щелчок по звезде «щелчком вне» — иначе
   * кнопка-переключатель закрывала бы меню по mousedown и тут же открывала его
   * по click. Со встроенной палитрой (onPick) id свой, этот не нужен.
   */
  controls?: string;
  size?: number;
  className?: string;
}

interface ViewProps {
  status: string;
  label: string;
  showLabel?: boolean;
  size: number;
  className?: string;
}

function common({ status, className }: { status: string; className?: string }, btn: boolean) {
  const meta = statusMeta(status);
  return {
    meta,
    attrs: {
      className: ['sk-star', btn ? 'sk-star--btn' : '', className].filter(Boolean).join(' '),
      style: { '--star-c': meta.color } as CSSProperties,
      'data-status': meta.code,
      'data-category': meta.category,
    },
  };
}

function Body({ status, label, showLabel, size }: ViewProps) {
  const meta = statusMeta(status);
  return (
    <>
      <GameIcon slug={meta.icon} size={size} />
      {showLabel && <span className="sk-star__label" aria-hidden="true">{label}</span>}
    </>
  );
}

export function StatusStar(props: StatusStarProps) {
  return props.onPick ? <PickableStar {...props} onPick={props.onPick} /> : <PlainStar {...props} />;
}

function PlainStar({ status, label: labelProp, titleOf, showLabel, onOpen, expanded, controls, size = 14, className }: StatusStarProps) {
  const lang = useKitLang();
  const code = status ?? '';
  const label = labelProp ?? kitT(lang, 'kit.status.label', { title: titleOf ? titleOf(code) : code || '—' });
  const { attrs } = common({ status: code, className }, Boolean(onOpen));
  const body = <Body status={code} label={label} showLabel={showLabel} size={size} />;
  if (onOpen) {
    return (
      <button
        type="button"
        {...attrs}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={expanded ?? false}
        aria-controls={expanded ? controls : undefined}
        title={label}
        onClick={onOpen}
      >
        {body}
      </button>
    );
  }
  return (
    <span {...attrs} role="img" aria-label={label} title={label}>
      {body}
    </span>
  );
}

function PickableStar({
  status, label: labelProp, showLabel, onPick, options = KNOWN_STATUSES, titleOf, recordId = '', size = 14, className,
}: StatusStarProps & { onPick: NonNullable<StatusStarProps['onPick']> }) {
  const lang = useKitLang();
  const record = useMemo<KitRecord>(
    () => ({ id: recordId, kind: '', title: '', status: status ?? '', fields: {} }),
    [recordId, status],
  );
  const save = useCallback(async (c: { from: unknown; to: unknown }) => {
    await onPick(String(c.to), String(c.from));
  }, [onPick]);
  const st = useStatusChange(record, save);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popId = useId();

  const title = titleOf ? titleOf(st.status) : st.status || '—';
  // Имя следует за оптимистичным статусом: без titleOf — только переданный label.
  const label = titleOf || !labelProp ? kitT(lang, 'kit.status.label', { title }) : labelProp;
  const { attrs } = common({ status: st.status, className }, true);

  /**
   * Закрыть палитру (S4-MENU-STATES). Щелчок мимо ловит ОБОЛОЧКА (общий
   * Popover), своего mousedown на document здесь больше нет — он и был тем
   * огрызком, который сводится.
   *
   * А фокус на звезду возвращаем САМИ и синхронно, хотя у оболочки есть умный
   * возврат. Причина одна, но железная: при записи звезда становится aria-busy
   * и disabled, а недоступную кнопку сфокусировать уже нельзя — возврат из
   * оболочки (он идёт после перерисовки) в этот момент не срабатывает, и место
   * на странице терялось бы. Для мыши это ничего не ломает: фокус по щелчку
   * браузер ставит ПОСЛЕ обработчиков, поэтому щёлкнутое поле всё равно
   * получает фокус последним.
   */
  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  const pick = (to: string) => {
    close();
    void st.change(to);
  };

  return (
    <span className="sk-star-wrap">
      <button
        ref={btnRef}
        type="button"
        {...attrs}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-busy={st.pending}
        disabled={st.pending}
        onClick={() => setOpen((o) => !o)}
      >
        <Body status={st.status} label={label} showLabel={showLabel} size={size} />
      </button>
      {open && (
        <StatusPalette
          id={popId}
          current={st.status}
          options={options}
          titleOf={titleOf}
          onPick={pick}
          onCancel={close}
        />
      )}
      {st.error && (
        <span role="alert" className="sk-star__err">
          {kitT(lang, 'kit.status.saveFailed', { reason: st.error })}
        </span>
      )}
    </span>
  );
}
