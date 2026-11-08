// Меню аватара v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02): кнопка-аватар kit в
// шапке оболочки, за ней — личные настройки и «что LORE помнит». Настройки
// читаются при монтировании оболочки (а не при открытии меню) и сразу
// применяются к корню документа — тема, текст, плотность и прочее действуют
// с первого экрана. Хранение — S2Client (до S2-04 — заглушка api/me.ts).
import { useCallback, useState } from 'react';
import { AvatarMenu, type AttrTarget } from '@seidr/kit';
import type { UserSettings } from '../api/contracts/s2';
import type { S2Client } from '../api/contracts/s2.stubs';
import { t, type Lang } from '../i18n/messages';
import type { CookieJar } from '../storage/storage';
import { applySettings } from './applySettings';
import { MemoryPanel } from './MemoryPanel';
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
}

export function AccountMenu({ client, lang, root, jar, name, subtitle, navTargetUrl }: AccountMenuProps) {
  const [view, setView] = useState<'settings' | 'memory'>('settings');
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
          />
        )
        : <MemoryPanel client={client} lang={lang} onBack={() => setView('settings')} />}
    </AvatarMenu>
  );
}
