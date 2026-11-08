// Выбор колонок списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35) — раздел
// «Колонки» меню «Вид», по прототипу владелицы s4-35-columns.html.
//
// kit показывает и отдаёт выбор наружу; где он хранится, решает приложение.
// Решение владелицы 08.11.2026: набор колонок — командный (сохранённый вид),
// ширины — личные. И отдельно: «у дочек свои колонки, у родителя свои —
// см. модель», то есть набор колонок есть свойство типа, а не списка вообще.
//
// Порядок меняется кнопками «выше/ниже», а не только перетаскиванием:
// перетаскивание недоступно с клавиатуры, а доступность у нас обязательна
// (S4-12). Перетаскивание добавится сверху, не вместо.
import { kitT, useKitLang } from '../i18n';

export interface ColumnChoice {
  key: string;
  title: string;
  /** Нельзя выключить и нельзя увести с первого места (название записи). */
  locked?: boolean;
}

export interface ColumnsChoiceProps {
  /** Все колонки типа — из конфигурации, позже из модели. */
  all: readonly ColumnChoice[];
  /** Выбранные, в порядке показа. */
  chosen: readonly string[];
  onChange: (cols: string[]) => void;
}

export function ColumnsChoice({ all, chosen, onChange }: ColumnsChoiceProps) {
  const lang = useKitLang();
  const t = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => kitT(lang, k, v);
  const titleOf = (key: string) => all.find(c => c.key === key)?.title ?? key;
  const lockedKey = all.find(c => c.locked)?.key;

  const toggle = (key: string, on: boolean) => {
    if (key === lockedKey) return;
    if (on) {
      // Включённая колонка встаёт на своё место по порядку типа, а не в конец:
      // иначе набор колонок зависит от того, в каком порядке их включали.
      const order = all.map(c => c.key);
      const next = [...chosen, key].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      onChange(next);
    } else {
      onChange(chosen.filter(k => k !== key));
    }
  };

  const move = (key: string, dir: -1 | 1) => {
    const i = chosen.indexOf(key);
    const j = i + dir;
    // Запертая колонка держит первое место: меняться местами с ней нельзя.
    if (i < 0 || j < 0 || j >= chosen.length) return;
    if (chosen[j] === lockedKey || key === lockedKey) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="sk-cols">
      <h3 className="sk-cols__head">{t('kit.list.cols.title')}</h3>
      <p className="sk-cols__hint">{t('kit.list.cols.hint')}</p>
      <ul className="sk-cols__list" data-testid="cols-list">
        {/* Сначала выбранные в их порядке, потом остальные — так видно, что
            именно показывается и в каком порядке. */}
        {[...chosen, ...all.map(c => c.key).filter(k => !chosen.includes(k))].map((key, idx) => {
          const on = chosen.includes(key);
          const locked = key === lockedKey;
          return (
            <li key={key} className={`sk-cols__row${locked ? ' is-locked' : ''}`}>
              <label className="sk-cols__label">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={e => toggle(key, e.target.checked)}
                />
                <span>{titleOf(key)}</span>
              </label>
              {on && !locked && (
                <span className="sk-cols__moves">
                  {idx > 0 && chosen[idx - 1] !== lockedKey && (
                    <button type="button" className="sk-cols__move" onClick={() => move(key, -1)}
                      aria-label={t('kit.list.cols.up', { title: titleOf(key) })}>↑</button>
                  )}
                  {idx < chosen.length - 1 && (
                    <button type="button" className="sk-cols__move" onClick={() => move(key, 1)}
                      aria-label={t('kit.list.cols.down', { title: titleOf(key) })}>↓</button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
