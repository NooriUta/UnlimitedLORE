// SeidrKit.mount(el, config, data) — выдача kit для single-file HTML
// (SPRINT_UXR_S10_SEIDR_KIT/K-08, D-2026-UXR-KIT-REACT вариант «б»).
// Это вход ESM-бандла kit/dist/seidr-kit.js: React внутри, CSS рядом
// (kit/dist/seidr-kit.css). Приложение с React импортирует @seidr/kit как пакет
// и mount не нужен.
//
//   <link rel="stylesheet" href="seidr-kit.css">
//   <script type="module">
//     import { SeidrKit } from './seidr-kit.js';
//     const kit = SeidrKit.mount(document.getElementById('app'), KIT_CONFIG, X_DATA);
//     // kit.update(newData); kit.unmount();
//   </script>
//
// data может быть Promise<KitData>: пока он не решён — загрузка, отказ —
// ошибка (не «пусто»).
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentType } from 'react';
import type { KitConfig, KitData } from '../core/contract';
import { registerGameIcons } from '../elements';
import { BUNDLED_ICONS } from './bundledIcons';
import { KitLangProvider, type KitLang } from '../i18n';
import { ErrorBoundary } from '../resilience/ErrorBoundary';
import { SEIDR_KIT_VERSION } from '../version';
import { MountView, type MountState, type MountViewProps } from './MountView';

export { SEIDR_KIT_VERSION };
export type { KitConfig, KitData } from '../core/contract';

export interface MountOptions {
  lang?: KitLang;
  role?: string;
  user?: string;
  /** Экран вместо встроенного MountView (каркас ядра, когда он придёт). */
  view?: ComponentType<MountViewProps>;
  /** Набор иконок (IconifyJSON, можно подмножество game-icons) для слагов из конфига. */
  icons?: unknown;
}

export interface KitHandle {
  update(data: KitData | Promise<KitData>): void;
  unmount(): void;
}

let iconsReady = false;

export function mount(el: Element, config: KitConfig, data: KitData | Promise<KitData>, opts: MountOptions = {}): KitHandle {
  if (!el || typeof (el as Element).appendChild !== 'function') {
    throw new Error('SeidrKit.mount: первый аргумент — DOM-узел, куда рисовать');
  }
  if (!iconsReady && BUNDLED_ICONS) { registerGameIcons(BUNDLED_ICONS); iconsReady = true; }
  if (opts.icons) registerGameIcons(opts.icons);
  const root: Root = createRoot(el);
  const View = opts.view ?? MountView;
  const lang = opts.lang ?? 'ru';
  let seq = 0;
  let alive = true;

  const paint = (state: MountState) => {
    if (!alive) return;
    root.render(
      <KitLangProvider lang={lang}>
        <ErrorBoundary lang={lang} catchGlobal={false}>
          <View config={config} state={state} role={opts.role} user={opts.user} />
        </ErrorBoundary>
      </KitLangProvider>,
    );
  };

  const update = (d: KitData | Promise<KitData>) => {
    const my = ++seq;
    if (d && typeof (d as Promise<KitData>).then === 'function') {
      paint({ kind: 'loading' });
      (d as Promise<KitData>).then(
        (v) => { if (my === seq) paint({ kind: 'ready', data: v }); },
        (e) => { if (my === seq) paint({ kind: 'error', error: e }); },
      );
    } else if (!d || !Array.isArray((d as KitData).records)) {
      paint({ kind: 'error', error: new Error('data.records: нет — данные не получены') });
    } else {
      paint({ kind: 'ready', data: d as KitData });
    }
  };

  update(data);
  return {
    update,
    unmount() { alive = false; root.unmount(); },
  };
}

/** Зарегистрировать набор иконок (IconifyJSON) до или после mount. */
export function registerIcons(set: unknown): void { registerGameIcons(set); }

export const SeidrKit = { version: SEIDR_KIT_VERSION, mount, registerIcons } as const;
export default SeidrKit;
