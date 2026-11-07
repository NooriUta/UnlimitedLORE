// Иконки, которые бандл kit/dist/seidr-kit.js кладёт в себя (K-08). Весь набор
// game-icons — 6 МБ JSON, single-file HTML за него платить не должен. В
// исходниках здесь null; при сборке бандла (vite.bundle.config.ts) модуль
// подменяется подмножеством: слаги, которые kit упоминает в своём коде
// (состояния, разделы, статусы). Иконки из конфига приложения — опцией
// mount(..., { icons }) или SeidrKit.registerIcons(json). Незарегистрированный
// слаг честно рисуется заглушкой с data-missing, а не пустотой.
export const BUNDLED_ICONS: unknown = null;
