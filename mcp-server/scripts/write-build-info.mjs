// SE-10: отметка сборки MCP-сервера — dist/build-info.json.
//
// MCP-сервер сессий собирается из основного чекаута руками и живёт своей
// жизнью: 10.09.2026 он оказался на 281 коммит позади develop, и правки схем
// инструментов до агентов не доходили. Чтобы расхождение стало ВИДНЫМ,
// сервер обязан знать, из чего собран.
//
// Пишется в dist, а не в src: генерируемый исходник либо мешал бы tsc/vitest
// до первой сборки, либо шумел бы в git после каждой. tsc dist не чистит,
// поэтому файл переживает сборку; в git dist не попадает.
//
// Коммит: аргумент сборки LORE_BUILD_COMMIT (CI/CD) → git (локально) → unknown.
// «unknown» — честное значение, а не отсутствие файла: отсутствие неотличимо
// от «сервер не умеет отвечать».
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let commit = (process.env.LORE_BUILD_COMMIT ?? '').trim();
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    commit = '';
  }
}
if (!commit) commit = 'unknown';

const out = { commit, built_at: new Date().toISOString() };
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'build-info.json'), JSON.stringify(out, null, 2) + '\n');
console.error(`[aida-lore-mcp] build-info: ${out.commit} @ ${out.built_at}`);
