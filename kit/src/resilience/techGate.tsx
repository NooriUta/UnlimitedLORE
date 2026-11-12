// Адресат сообщения и скрытие технического (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TECH-NOTES).
//
// Повод — владелица 11.11.2026: пользователя пугают сообщения, с которыми он
// ничего не может сделать (коды источников, сырые метрики, оговорки разбора).
// Правило «честные состояния» при этом не отменяется: скрывается ДИАГНОСТИКА,
// а не факт неполноты — для него у блока есть `hiddenNote`, одна человеческая
// строка без кодов.
//
// Kit здесь — только механизм: признак `audience` на сообщении, общий
// выключатель (проп провайдера) и кнопка «тех.» на месте. Что именно считать
// техническим, kit не знает и знать не должен: тег ставит тот, кто сообщение
// рождает (сервер или приложение), и передаёт данными.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';

export { audienceOf, isTech, type Audience } from './audience';

const ShowTechCtx = createContext(false);

/** Общий выключатель: показывать ли техническое. Хранит его приложение (личная настройка). */
export function TechVisibilityProvider({ show, children }: { show: boolean; children: ReactNode }) {
  return <ShowTechCtx.Provider value={show}>{children}</ShowTechCtx.Provider>;
}

/** Включено ли техническое общим выключателем. Без провайдера — нет. */
export function useShowTech(): boolean {
  return useContext(ShowTechCtx);
}

export interface TechGateProps {
  children: ReactNode;
  /**
   * Что видит человек, пока диагностика скрыта, — если скрытое означает
   * неполноту данных. Не передано — на месте блока только кнопка «тех.».
   */
  hiddenNote?: ReactNode;
  className?: string;
  /**
   * Подпись кнопки: без пропа — общая «тех.». Рядом стоящим тех-блокам
   * (оговорки модели, состояние данных) — своя: «тех. модели», «тех. данных»,
   * иначе две одинаковые кнопки на экране неотличимы. Подпись добавляется и к
   * aria-label/title, а не только к видимому тексту.
   */
  label?: string;
}

/**
 * Техническое содержимое: скрыто, пока его не включили общим выключателем
 * или кнопкой «тех.» на месте. Кнопка раскрывает только этот блок и
 * настройку не меняет.
 */
export function TechGate({ children, hiddenNote, className, label }: TechGateProps) {
  const lang = useKitLang();
  const global = useShowTech();
  const [local, setLocal] = useState(false);
  if (global) return <>{children}</>;
  const cls = ['sk-tech', className].filter(Boolean).join(' ');
  const action = kitT(lang, local ? 'kit.tech.hide' : 'kit.tech.show');
  const call = label ? `${action} (${label})` : action;
  return (
    <div className={cls} data-tech={local ? 'shown' : 'hidden'}>
      <div className="sk-tech__bar">
        {!local && hiddenNote != null && <span className="sk-tech__note" data-testid="tech-hidden-note">{hiddenNote}</span>}
        <button
          type="button"
          className="sk-tech__btn"
          aria-expanded={local}
          aria-label={call}
          title={call}
          onClick={() => setLocal(v => !v)}
        >
          {label ?? kitT(lang, 'kit.tech.btn')}
        </button>
      </div>
      {local && children}
    </div>
  );
}
