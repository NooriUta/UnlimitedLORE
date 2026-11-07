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
import { PersonalSettings } from '../settings/PersonalSettings';
import { V2_SECTIONS, v2Config, type V2Section } from './v2Config';

/** Экраны разделов: ключ — id пункта меню. Нет ключа — «экран не собран». */
const SCREENS: Partial<Record<V2Section, ComponentType>> = {
  // Личные настройки (S3-07) и ссылка на витрину kit (S4-00d) — раньше жили
  // на заглушке корня, с S4-01 — раздел «Настройки».
  settings: () => (
    <>
      <PersonalSettings />
      <a className="shell-link" href="/kit">Seiðr-kit</a>
    </>
  ),
};

export interface V2ShellProps {
  storage?: SafeStorage;
  win?: UrlWindow;
  narrow?: boolean;
  /** Метка после имени в шапке (версия v2). */
  brandTag?: ReactNode;
}

export function V2Shell({ storage, win, narrow, brandTag }: V2ShellProps) {
  const lang = useKitLang();
  const config = useMemo(() => v2Config(lang), [lang]);
  return (
    <KitShell
      config={config}
      brand={appT(lang, 'shell.brand')}
      brandIcon="compass"
      brandTag={brandTag}
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
