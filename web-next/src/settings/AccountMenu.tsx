// Меню аватара v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02): кнопка-аватар kit в
// шапке оболочки, за ней — личные настройки и «что LORE помнит». Настройки
// читаются при монтировании оболочки (а не при открытии меню) и сразу
// применяются к корню документа — тема, текст, плотность и прочее действуют
// с первого экрана. Хранение — S2Client (до S2-04 — заглушка api/me.ts).
import { useCallback, useEffect, useState } from 'react';
import { AvatarMenu, KeymapMenuButton, kitT, type AttrTarget } from '@seidr/kit';
import type { UserSettings } from '../api/contracts/s2';
import type { S2Client } from '../api/contracts/s2.stubs';
import { t, type Lang } from '../i18n/messages';
import type { CookieJar } from '../storage/storage';
import { applySettings } from './applySettings';
import { MemoryPanel } from './MemoryPanel';
import { fetchPalettes, type PalettesView } from './palettesSource';
import { PersonalSettings } from './PersonalSettings';
import { ProfileEditor } from './ProfileEditor';
import { useSettings } from './useSettings';
import { usePerson } from '../people/avatars';
import { loreFetch } from '../auth/session';

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
  /** AP-07: kc_sub вошедшего — свой профиль (имя, аватар) он меняет сам. Нет — пункта «Профиль» нет. */
  sub?: string | null;
  /** Подмена загрузки (тесты) — профилю. */
  fetchImpl?: typeof fetch;
  /** Подмена загрузки палитр (тесты); по умолчанию — модель с сервера. */
  loadPalettes?: () => Promise<PalettesView>;
}

export function AccountMenu({ client, lang, root, jar, name, subtitle, navTargetUrl, onLogout, loadPalettes, sub, fetchImpl }: AccountMenuProps) {
  const [view, setView] = useState<'settings' | 'memory' | 'profile'>('settings');
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
  // AP-APPEARANCE: модель принесла токены своих стилей — применить настройки заново (свой стиль мог быть выбран
  // раньше, чем пришла модель, и до того рисовалась база amber forest).
  const settingsNow = state.status === 'ok' ? state.settings : null;
  useEffect(() => { if (palettes && settingsNow) apply(settingsNow); }, [palettes]); // eslint-disable-line react-hooks/exhaustive-deps
  // AP-07: свой аватар и имя профиля — запросом с токеном (people/avatars.ts). Нет входа — ничего не запрашивается.
  const me = usePerson(sub ?? null, fetchImpl ?? loreFetch, view === 'profile' ? 0 : 1);
  const shownName = me.row?.display_name?.trim() || name;

  return (
    <AvatarMenu
      name={shownName}
      avatarSrc={me.src}
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
        : view === 'profile' && sub
          ? (
            <>
              {/* AP-07: свой профиль — имя и аватар; права проверяет сервер. */}
              <ProfileEditor sub={sub} lang={lang} {...(fetchImpl ? { fetchImpl } : {})} />
              <div className="memory-actions">
                <button type="button" className="sk-btn" onClick={() => setView('settings')}>{t(lang, 'settings.backToSettings')}</button>
              </div>
            </>
          )
          : <MemoryPanel client={client} lang={lang} onBack={() => setView('settings')} />}
      {sub && view === 'settings' && (
        <div className="memory-actions">
          <button type="button" className="sk-btn" data-testid="account-profile" onClick={() => setView('profile')}>{t(lang, 'settings.profile')}</button>
        </div>
      )}
      {/* Вход в админку перенесён в левое меню (группа «Личное», после «Настроек»), только для admin/superadmin —
          владелица 21.11.2026; прежняя ссылка здесь вела viewer-а на экран отказа. */}
      {/* S4-11: «Горячие клавиши» — всегда, и на телефоне: к нему или к планшету
          могут подключить клавиатуру (владелица 11.11). Панель — общая, kit. */}
      <div className="memory-actions">
        <KeymapMenuButton />
      </div>
      {onLogout && (
        <div className="memory-actions">
          <button type="button" className="sk-btn" onClick={onLogout}>{kitT(lang, 'kit.auth.logout')}</button>
        </div>
      )}
    </AvatarMenu>
  );
}
