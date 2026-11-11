// Общий выключатель технических сведений (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TECH-NOTES).
//
// Настройка `show_tech` ложится атрибутом на корень документа (applySettings),
// как остальные личные настройки: экраны живут далеко от панели настроек и её
// состояния не получают (см. applied.ts — «что применено, то и прочитано»).
// Здесь атрибут превращается в проп провайдера kit: kit знает только механизм
// (тег tech, скрытие, кнопка «тех.»), а значение выключателя даёт приложение.
import { useSyncExternalStore, type ReactNode } from 'react';
import { TechVisibilityProvider } from '@seidr/kit';
import { appliedShowTech } from './applied';

type Root = HTMLElement | null;

function defaultRoot(): Root {
  return typeof document === 'undefined' ? null : document.documentElement;
}

export function ShowTechFromSettings({ children, root }: { children: ReactNode; root?: Root }) {
  const el = root === undefined ? defaultRoot() : root;
  const show = useSyncExternalStore(
    notify => {
      if (!el || typeof MutationObserver === 'undefined') return () => {};
      const mo = new MutationObserver(notify);
      mo.observe(el, { attributes: true, attributeFilter: ['data-show-tech'] });
      return () => mo.disconnect();
    },
    () => appliedShowTech(el),
    () => false,
  );
  return <TechVisibilityProvider show={show}>{children}</TechVisibilityProvider>;
}
