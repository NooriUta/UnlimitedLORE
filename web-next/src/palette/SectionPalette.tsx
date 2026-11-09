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
import { useMemo } from 'react';
import { useKitShell, useKitLang, type KitConfig, type SafeStorage } from '@seidr/kit';
import { appT } from '../i18n';
import { v2Config } from '../shell/v2Config';
import { LorePalette } from './LorePalette';
import { shellRecentList } from './shellRecent';

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

  return <LorePalette storage={storage} ctx={ctx} recent={recent} fetchImpl={fetchImpl} trigger />;
}
