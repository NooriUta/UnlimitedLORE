// Оболочка LORE v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-01): KitShell из Seiðr-kit
// по конфигу v2Config — приложения наверху, меню по смыслу со сворачиванием
// групп, drawer на телефоне, модуль/раздел/вид в URL (mod/sec/view). Своей
// разметки меню и drawer здесь нет — только выбор экрана раздела.
//
// Экраны разделов подключаются в SCREENS своими задачами S4 (списки спринтов,
// ADR…). Раздел без экрана честно говорит «экран не собран» (NotBuilt kit), а
// не рисует «пусто»: данных он не запрашивал.
import { useMemo, type ComponentType, type ReactNode } from 'react';
import { KitShell, NotBuilt, useKitLang, useKitShell, type SafeStorage, type UrlWindow } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { switchNavUrl } from '../nav/navVersion';
import { ListScreen } from '../pages/ListScreen';
import { NavSwitch } from '../settings/NavSwitch';
import { V2_SECTIONS, v2Config, type V2Section } from './v2Config';

/** Экраны разделов: ключ — id пункта меню. Нет ключа — «экран не собран». */
const SCREENS: Partial<Record<V2Section, ComponentType>> = {
  // Списки на движке kit (S4-04); заголовок — у раздела оболочки.
  sprint: () => <ListScreen screen="sprints" heading={false} />,
  adr: () => <ListScreen screen="adrs" heading={false} />,
  // Ссылка на витрину kit (S4-00d) и переключатель «новая навигация» (S3-07) —
  // раздел «Настройки» (S4-01). Сами личные настройки — под аватаром в шапке
  // (S4-02, AccountMenu в слоте account): здесь на них только указатель.
  settings: function SettingsScreen() {
    const lang = useKitLang();
    const targetUrl = typeof location === 'undefined' ? null : switchNavUrl(location, 'v1');
    return (
      <>
        <p className="setting-hint">{appT(lang, 'shell.settings.hint')}</p>
        <NavSwitch lang={lang} targetUrl={targetUrl} />
        <a className="shell-link" href="/kit">Seiðr-kit</a>
      </>
    );
  },
};

export interface V2ShellProps {
  storage?: SafeStorage;
  win?: UrlWindow;
  narrow?: boolean;
  /** Метка после имени в шапке (версия v2). */
  brandTag?: ReactNode;
  /** Правый край шапки — выбор проектов (S4-03). */
  topEnd?: ReactNode;
  /** Слот аккаунта справа в шапке (меню аватара, S4-02). */
  account?: ReactNode;
}

export function V2Shell({ storage, win, narrow, brandTag, topEnd, account }: V2ShellProps) {
  const lang = useKitLang();
  const config = useMemo(() => v2Config(lang), [lang]);
  return (
    <KitShell
      config={config}
      brand={appT(lang, 'shell.brand')}
      brandIcon="compass"
      brandTag={brandTag}
      topEnd={topEnd}
      account={account}
      storage={storage}
      storageKey="lore-v2.shell"
      win={win}
      narrow={narrow}
    >
      <SectionScreen />
    </KitShell>
  );
}

function isSection(id: string | null): id is V2Section {
  return id !== null && (V2_SECTIONS as readonly string[]).includes(id);
}

function SectionScreen() {
  const lang = useKitLang();
  const { nav } = useKitShell();
  if (!isSection(nav.item)) return null;
  const section = nav.item;
  const title = appT(lang, `shell.sec.${section}` as AppKey);
  const Screen = SCREENS[section];
  return (
    <section className="v2-screen" data-section={section} aria-labelledby="v2-screen-title">
      <h1 id="v2-screen-title" className="v2-screen__title">{title}</h1>
      {Screen ? <Screen /> : <NotBuilt hint={appT(lang, 'shell.unbuilt.hint', { section: title })} />}
    </section>
  );
}
