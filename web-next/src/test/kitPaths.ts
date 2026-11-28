// SPRINT_UXR_S14_KIT5/K5-PACKAGE-DELIVERY: kit больше не соседняя папка ../kit, а пакет @seidr/kit
// из реестра (репозиторий AIDA/lorekit). Сторожа web-next, которые сверяют свои правила с CSS-слоем
// kit, читают его ИЗ УСТАНОВЛЕННОГО ПАКЕТА — то есть ровно то, что уедет в бандл, — а не исходник.
// Путь берётся разрешением входа пакета (exports «./styles/seidr.css»), а не склейкой строки:
// сменится раскладка dist — сторож упадёт на разрешении, а не прочитает чужой файл.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

/** Единый CSS-слой kit из установленного пакета (dist/src/styles/seidr.css). */
export const KIT_CSS = require.resolve('@seidr/kit/styles/seidr.css');

/** Корень установленного пакета @seidr/kit (там его package.json и dist). */
export const KIT_PKG_DIR = resolve(dirname(KIT_CSS), '..', '..', '..');
