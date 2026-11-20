// Публикация kit в хранилище пакетов (SPRINT_UXR_S14_KIT5/K5-PACKAGE-DELIVERY). Только из CI.
//
// Хранилище — npm-реестр Forgejo организации AIDA (publishConfig.registry в package.json).
// Токен — секрет CI `KIT_NPM_TOKEN` (токен Forgejo с правом write:package). Скрипт его не печатает
// и не пишет в файл: во временный .npmrc уходит ссылка ${KIT_NPM_TOKEN}, npm подставляет её сам.
//
// Нет токена — громкий отказ BLOCKED с тем, что нужно и кто даёт, а не тихий пропуск.
// После публикации версия читается обратно из реестра: код выхода npm publish — не доказательство.
//
// --dry: всё, кроме записи (npm publish --dry-run), токен не нужен.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const registry = pkg.publishConfig?.registry;
const dry = process.argv.includes('--dry');
if (!registry) { console.error('::error::в package.json нет publishConfig.registry'); process.exit(1); }

const token = process.env.KIT_NPM_TOKEN;
if (!dry && !token) {
  console.error([
    '::error::BLOCKED — публикация kit: нет секрета KIT_NPM_TOKEN.',
    `Что нужно: токен Forgejo с правом write:package для организации AIDA (реестр ${registry}),`,
    'положить секретом репозитория AIDA/UnlimitedLORE под именем KIT_NPM_TOKEN.',
    'Кто даёт: владелица / сессия CICDGitHub (настройки инфраструктуры).',
  ].join('\n'));
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'kit-publish-'));
const npmrc = join(dir, '.npmrc');
const host = registry.replace(/^https?:/, '');
// Ссылка на переменную, а не значение: npm раскрывает ${…} сам, токен в файл не попадает.
writeFileSync(npmrc, `@seidr:registry=${registry}\n${host}:_authToken=\${KIT_NPM_TOKEN}\n`);
const npm = (args) => execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args,
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, KIT_NPM_TOKEN: token ?? '' }, shell: process.platform === 'win32' });
try {
  const out = npm(['publish', '--userconfig', npmrc, '--registry', registry, ...(dry ? ['--dry-run'] : [])]);
  console.log(out.trim().split('\n').slice(-3).join('\n'));
  if (dry) { console.log(`kit ${pkg.version}: пробная публикация — ок, запись не делалась`); process.exit(0); }
  const seen = npm(['view', `${pkg.name}@${pkg.version}`, 'version', '--userconfig', npmrc, '--registry', registry]).trim();
  if (seen !== pkg.version) { console.error(`::error::после публикации реестр отдаёт версию «${seen}», ждали ${pkg.version}`); process.exit(1); }
  console.log(`kit ${pkg.version} опубликован и читается из ${registry}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
