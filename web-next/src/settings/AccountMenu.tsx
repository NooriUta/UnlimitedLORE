// Меню аватара v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02): кнопка-аватар kit в
// шапке оболочки, за ней — личные настройки и «что LORE помнит». Настройки
// читаются при монтировании оболочки (а не при открытии меню) и сразу
// применяются к корню документа — тема, текст, плотность и прочее действуют
// с первого экрана. Хранение — S2Client (до S2-04 — заглушка api/me.ts).
import { useCallback, useEffect, useState } from 'react';
import { AvatarMenu, kitT, type AttrTarget } from '@seidr/kit';
import type { UserSettings } from '../api/contracts/s2';
import type { S2Client } from '../api/contracts/s2.stubs';
import { t, type Lang } from '../i18n/messages';
import type { CookieJar } from '../storage/storage';
import { applySettings } from './applySettings';
import { MemoryPanel } from './MemoryPanel';
import { fetchPalettes, type PalettesView } from './palettesSource';
import { PersonalSettings } from './PersonalSettings';
import { useSettings } from './useSettings';

export interface AccountMenuProps {
  client: S2Client;
  lang: Lang;
  /** Куда ложатся атрибуты настроек; по умолчанию — <html>. */
  root?: AttrTarget;
  /** Cookie seer-prefs (тесты); по умолчанию — cookie документа (storage/). */
  jar?: CookieJar;
  /** Имя пользователя; нет — kit честно пишет «пользователь не опознан». */
  name?: string | null;
  subtitle?: string;
  navTargetUrl?: string | null;
  /** Выход (S3-18); нет — вход выключен, кнопки «Выйти» нет. */
  onLogout?: () => void;
  /** Подмена загрузки палитр (тесты); по умолчанию — модель с сервера. */
  loadPalettes?: () => Promise<PalettesView>;
}

export function AccountMenu({ client, lang, root, jar, name, subtitle, navTargetUrl, onLogout, loadPalettes }: AccountMenuProps) {
  const [view, setView] = useState<'settings' | 'memory'>('settings');
  // Список палитр — прикладной словарь, он приходит из модели (K-14 п. 5).
  // Пока не пришёл — панель показывает список темы kit и говорит об этом
  // сама: подставлять молча значило бы выдать умолчание за выбор модели.
  const [palettes, setPalettes] = useState<PalettesView | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = loadPalettes ?? (() => fetchPalettes({ lang }));
    load().then(
      p => { if (live) setPalettes(p); },
      // Сюда попадаем, только если упал сам загрузчик: все ожидаемые отказы
      // fetchPalettes возвращает оговорками, а не исключением.
      e => { if (live) setPalettes({ options: [], default: null, fromModel: false, notes: [String(e)] }); },
    );
    return () => { live = false; };
  }, [loadPalettes, lang]);
  const apply = useCallback((s: UserSettings) => {
    const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
    if (target) applySettings(target, s, jar);
  }, [root, jar]);
  const { state, set, reload } = useSettings(client, apply);

  return (
    <AvatarMenu
      name={name}
      subtitle={subtitle}
      title={t(lang, 'settings.title')}
      onOpenChange={open => { if (!open) setView('settings'); }}
    >
      {view === 'settings'
        ? (
          <PersonalSettings
            lang={lang}
            state={state}
            onChange={patch => { void set(patch); }}
            onRetry={reload}
            onOpenMemory={() => setView('memory')}
            navTargetUrl={navTargetUrl}
            palettes={palettes}
          />
        )
        : <MemoryPanel client={client} lang={lang} onBack={() => setView('settings')} />}
      {/* S7B-01: вход в админку — из меню аватара (прототип v6), модуль ?mod=admin.
          Ссылку видят все: права проверяет сервер, и экран без прав скажет
          «нет прав», а не притворится пустым. */}
      <div className="memory-actions">
        <a className="sk-btn" href="/?mod=admin" data-testid="account-admin">{t(lang, 'settings.admin')}</a>
      </div>
      {onLogout && (
        <div className="memory-actions">
          <button type="button" className="sk-btn" onClick={onLogout}>{kitT(lang, 'kit.auth.logout')}</button>
        </div>
      )}
    </AvatarMenu>
  );
}
