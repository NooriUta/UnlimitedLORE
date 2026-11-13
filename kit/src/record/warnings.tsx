// Технические сообщения записи — под одним значком warnings (MP2-08,
// SPRINT_UXR_MOBILE_POLISH; владелица 13.11.2026: «все технические сообщения
// убрать и в мобильном и в desktop виде — вниз под значок warnings с открытием
// попап-сообщения; если в нескольких компонентах несколько — агрегировать все
// такие сообщения и не ломать остальной дизайн»).
//
// Что здесь механизм, а что нет. Kit не знает, какие сообщения считать
// техническими: их рождают источники (состояние данных паспорта, оговорки
// разбора модели, замечания графа) и приносят сюда готовыми строками со своей
// подписью и тоном. Kit собирает их в один список, группирует по источнику и
// рисует ОДИН значок «⚠ N» с поповером. Значка нет, когда сообщений нет:
// пустой значок обещал бы предупреждение, которого не существует.
//
// Почему два контекста, а не один. Сборщик (set) обязан быть СТАБИЛЬНЫМ:
// источники регистрируют строки в эффекте, и если бы ссылка на API менялась
// на каждое новое сообщение, эффект перезапускался бы по кругу (регистрация →
// новое состояние → новый API → снова регистрация). Поэтому API и список
// разведены: эффект источника зависит только от своего содержимого.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import { Popover } from '../shell/Popover';
import { useShowTech } from '../resilience/techGate';

/** Тон сообщения: сбой (ждать починки), предупреждение (знать), сведение. */
export type WarningTone = 'dng' | 'wrn' | 'inf';

export interface WarningItem {
  /** Источник: блок данных, компонент, «модель», «граф» — по нему группируем. */
  source: string;
  /** Подпись вида сообщения, уже словами человека (её даёт источник). */
  label: string;
  /** Текст сообщения. */
  text: string;
  tone: WarningTone;
}

interface WarningsApi { set: (key: string, items: WarningItem[]) => void }

const ApiCtx = createContext<WarningsApi | null>(null);
const ItemsCtx = createContext<WarningItem[]>([]);

const same = (a: WarningItem[], b: WarningItem[]): boolean =>
  a.length === b.length && a.every((x, i) => x.source === b[i].source && x.label === b[i].label && x.text === b[i].text && x.tone === b[i].tone);

/**
 * Сборщик технических сообщений экрана. Ставится ОДИН раз вокруг паспорта и
 * всего, что о нём говорит (оговорки модели рисуются рядом с паспортом, а не
 * внутри него, — поэтому сборщик выше обоих).
 */
export function WarningsProvider({ children }: { children: ReactNode }) {
  const [byKey, setByKey] = useState<Record<string, WarningItem[]>>({});
  const set = useCallback((key: string, items: WarningItem[]) => {
    setByKey(prev => {
      const had = prev[key];
      if (items.length === 0) {
        if (!had) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (had && same(had, items)) return prev;
      return { ...prev, [key]: items };
    });
  }, []);
  const api = useMemo(() => ({ set }), [set]);
  const items = useMemo(() => Object.keys(byKey).sort().flatMap(k => byKey[k]), [byKey]);
  return (
    <ApiCtx.Provider value={api}>
      <ItemsCtx.Provider value={items}>{children}</ItemsCtx.Provider>
    </ApiCtx.Provider>
  );
}

/**
 * Источник отдаёт свои сообщения сборщику. Возвращает, есть ли сборщик:
 * без него источнику некуда деть строки, и он рисует их прежним блоком
 * (витрина kit без приложения не должна молчать о неполноте данных).
 */
export function useWarningsSource(key: string, items: WarningItem[]): boolean {
  const api = useContext(ApiCtx);
  const payload = useMemo(() => items, [JSON.stringify(items)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!api) return;
    api.set(key, payload);
    return () => api.set(key, []);
  }, [api, key, payload]);
  return api !== null;
}

/** Все собранные сообщения (порядок источников стабилен). */
export function useWarnings(): WarningItem[] {
  return useContext(ItemsCtx);
}

/** Есть ли на экране сборщик — источнику нужно знать, прятать ли свой блок. */
export function useHasWarningsCollector(): boolean {
  return useContext(ApiCtx) !== null;
}

function groupBySource(items: WarningItem[]): { source: string; items: WarningItem[] }[] {
  const out: { source: string; items: WarningItem[] }[] = [];
  for (const it of items) {
    const g = out.find(x => x.source === it.source);
    if (g) g.items.push(it);
    else out.push({ source: it.source, items: [it] });
  }
  return out;
}

/**
 * Значок «⚠ N» и поповер со всеми техническими сообщениями экрана.
 * Нет сообщений — нет и значка. Поповер — общий слой kit (.sk-pop), вид —
 * в языке поповеров фильтров: та же рамка, фон, скругление и прокрутка.
 */
export function RecordWarnings({ className }: { className?: string }) {
  const lang = useKitLang();
  const items = useWarnings();
  const showTech = useShowTech();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (items.length === 0) return null;
  const title = kitT(lang, 'kit.ds.title');
  const call = `${title}: ${items.length}`;
  // S4-TECH-NOTES остаётся в силе и внутри поповера: коды источников —
  // диагностика, их показывает включённая настройка «технические сведения».
  // Без неё список один и человеческий (вид сообщения + текст), с ней —
  // группировка по источникам с их кодами: агрегация не теряется ни так, ни так.
  const groups = showTech ? groupBySource(items) : [{ source: title, items }];
  return (
    <span className={['sk-warn', className].filter(Boolean).join(' ')} data-testid="kit-rec-warnings">
      <button
        type="button"
        className="sk-warn__btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={call}
        title={call}
        onClick={() => setOpen(v => !v)}
      >
        <span aria-hidden="true">⚠</span> {items.length}
      </button>
      {open && (
        <Popover
          id={id}
          role="group"
          label={title}
          align="end"
          walk="focusable"
          arrows={false}
          onClose={() => setOpen(false)}
          className="sk-warn__pop"
        >
          <h3 className="sk-warn__title">{title}</h3>
          <div className="sk-warn__body">
            {groups.map(g => (
              <section key={g.source} className="sk-warn__group" aria-label={g.source} data-source={g.source}>
                <h4 className="sk-warn__src">{g.source}</h4>
                <ul className="sk-warn__list">
                  {g.items.map((it, i) => (
                    <li key={`${it.label}:${it.text}:${i}`} className="sk-warn__item" data-tone={it.tone}>
                      <span className="sk-warn__kind">{it.label}</span>
                      <span className="sk-warn__text">{it.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}
