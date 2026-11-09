// Палитра с командами разделов (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14).
//
// Аудит навигации 08.11.2026 нашёл палитру пустой: «"Недавних пока нет" — ни
// команд, ни разделов». Пусто было честно — конфиг, который v2 передавал
// палитре, не содержал ни одной команды. Первое, что палитра обязана уметь, —
// то же, что меню: перейти в раздел.
//
// Разделы берутся из v2Config, из того же места, что и меню: один источник —
// одна правда, и новый раздел появляется в палитре сам. Переход — через
// navigate оболочки (useKitShell), а не через правку адреса руками: иначе
// оболочка не узнает о смене раздела, потому что pushState не поднимает
// popstate.
//
// Компонент обязан рисоваться ВНУТРИ <KitShell> (слот topEnd подходит):
// useKitShell вне оболочки честно падает, а не возвращает пустую навигацию.
import { useCallback, useMemo, useState } from 'react';
import { pushUrlState, urlStateHref, useKitLang, useKitShell, type KitConfig, type KitRecord, type SafeStorage } from '@seidr/kit';
import { appT } from '../i18n';
import { v2Config, type V2Section } from '../shell/v2Config';
import { LorePalette } from './LorePalette';
import { shellRecentList } from './shellRecent';
import './SectionPalette.css';

/**
 * Тип записи LORE → раздел v2, где она живёт (D-01).
 *
 * Перечень явный, а не «тип = раздел»: разделов в v2 пока пять, а типов в
 * корпусе больше. Нет в списке — значит открыть негде, и об этом говорится
 * словами, а не уводом в раздел по умолчанию. Список растёт вместе с
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS.
 */
const SECTION_OF_TYPE: Readonly<Record<string, V2Section>> = {
  sprint: 'sprint',
  adr: 'adr',
  task: 'task',
};

export interface SectionPaletteProps {
  storage: SafeStorage;
  /** Подмена сети для серверного поиска (тесты). */
  fetchImpl?: typeof fetch;
}

export function SectionPalette({ storage, fetchImpl }: SectionPaletteProps) {
  const lang = useKitLang();
  const api = useKitShell();
  const { navigate } = api;
  const config = useMemo(() => v2Config(lang), [lang]);

  const ctx = useMemo(() => {
    const commands = config.menu.groups.flatMap(g => g.items.map(i => ({
      id: `go:${i.id}`,
      title: appT(lang, 'palette.goSection', { section: i.title }),
      run: () => navigate({ item: i.id, view: i.view ?? null }),
    })));
    const withCommands: KitConfig = { ...config, palette: { commands } };
    return { config: withCommands };
  }, [config, lang, navigate]);

  // «Недавнее» палитры — список оболочки: открытое из списка видно и там, и
  // тут. Аудит 08.11 нашёл обе половины по отдельности; это вторая.
  const recent = useMemo(() => shellRecentList(api, storage), [api, storage]);

  // Причина, по которой найденную запись не открыли. Пусто — открыли.
  const [note, setNote] = useState<string | null>(null);

  /**
   * Открыть найденную запись (аудит 09.11, P0 D-01).
   *
   * Было: палитра вела на `?rec=<id>`, а такого маршрута в v2 нет — экран
   * показывал раздел по умолчанию, то есть «Новости». Поиск находил, а
   * открыть найденное было нельзя.
   *
   * Запись живёт в своём разделе и открывается параметром `?open=<id>`
   * (его читает `ListScreen`), поэтому порядок такой:
   *   1. переход в раздел ТИПА записи — оболочкой, иначе она не узнает о
   *      смене раздела (pushState не поднимает popstate);
   *   2. только после этого `open` — при смене раздела оболочка снимает
   *      параметры прежнего (`sectionScopedPatch`), и написанный заранее
   *      `open` был бы стёрт;
   *   3. второй записью истории не пушим, а ЗАМЕНЯЕМ: иначе «назад» пришлось
   *      бы жать дважды, чтобы вернуться к тому, откуда искали.
   */
  const openRecord = useCallback((r: KitRecord) => {
    const section = SECTION_OF_TYPE[r.kind];
    if (!section) {
      // Разделов в v2 пока пять. Молча никуда не уводим и в «Новости» тем
      // более: запись найдена, и об этом надо сказать правду.
      setNote(appT(lang, 'palette.noSection', { type: r.kind || '—', id: r.id }));
      return;
    }
    setNote(null);
    navigate({ item: section, view: null });
    // Окно берём у ОБОЛОЧКИ, а не глобальное: она держит состояние в своём, и
    // запись в глобальное просто не доходит (поймано тестом).
    const win = api.win;
    if (win) pushUrlState({ open: r.id, place: null }, { replace: true, win, anchor: null });
    // «Недавнее» ведёт оболочка — пусть узнает и об открытом из поиска.
    api.openRecord(r.id, { title: r.title, ...(win ? { href: urlStateHref(win, { open: r.id }, { anchor: null }) } : {}) });
  }, [api, lang, navigate]);

  return (
    <>
      <LorePalette storage={storage} ctx={ctx} recent={recent} fetchImpl={fetchImpl} onOpenRecord={openRecord} trigger />
      {note && <p className="section-palette__note" role="status">{note}</p>}
    </>
  );
}
