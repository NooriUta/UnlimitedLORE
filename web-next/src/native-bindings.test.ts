// Проверка нативных бинарников сразу после `npm ci` в образах фронтов (слово владелицы 28.11:
// «унифицируйтесь» — общий шаг с aida-root). Причина: npm через kkRepo молча пропускает
// optional-пакет под платформу (rolldown/lightningcss под linux-x64-musl), если его нет в кэше,
// а падает уже vite build — у aida-root через 18 минут (v1.7.11, «Cannot find module
// '@rolldown/binding-linux-x64-musl'»). Проверка валит сборку за секунды с понятным текстом.
//
// Строка общая (aida-root 93da508a): пакеты не перечисляются, берутся из package-lock.json по
// os/cpu/libc текущей платформы — новый нативный пакет подхватывается сам.
// v1 (корневой Dockerfile) заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN) — не трогаем.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

const DOCKERFILES = ['web-next/Dockerfile', 'mcp-server/Dockerfile'];
const MARK = 'NATIVE-BINDINGS';

/** Код проверки из Dockerfile: строка RUN node -e "…" сразу после RUN npm ci. */
function checkScript(dockerfile: string): string {
  const lines = read(dockerfile).split('\n');
  const i = lines.findIndex(l => /^RUN npm ci\b/.test(l.trim()));
  expect(i, `${dockerfile}: нет RUN npm ci`).toBeGreaterThanOrEqual(0);
  const next = lines.slice(i + 1).find(l => l.trim() && !l.trim().startsWith('#')) ?? '';
  expect(next, `${dockerfile}: сразу после npm ci должна идти проверка ${MARK}`).toContain(MARK);
  const m = next.match(/^RUN node -e "(.*)"\s*$/);
  expect(m, `${dockerfile}: проверка — одной строкой RUN node -e "…"`).not.toBeNull();
  return m![1];
}

function runIn(dir: string, script: string) {
  return spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8' });
}

/** package-lock с одним нативным пакетом под текущую платформу; installed — лежит ли он в node_modules. */
function fixture(installed: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'native-bindings-'));
  const report = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
  const libc = process.platform !== 'linux' ? undefined : (report?.glibcVersionRuntime ? 'glibc' : 'musl');
  const pkg = 'node_modules/@x/binding-here';
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
    packages: {
      '': { name: 'fx' },
      [pkg]: { version: '1.0.0', optional: true, os: [process.platform], cpu: [process.arch], ...(libc ? { libc: [libc] } : {}) },
      // Чужая платформа: её отсутствие — норма, не ошибка.
      'node_modules/@x/binding-elsewhere': { version: '1.0.0', optional: true, os: ['aix'], cpu: ['ppc64'] },
    },
  }));
  if (installed) mkdirSync(join(dir, pkg), { recursive: true });
  return dir;
}

describe(`${MARK}: проверка после npm ci в образах фронтов`, () => {
  for (const df of DOCKERFILES) {
    it(`${df}: стоит сразу после npm ci; пакет на месте — ok, пропущен — падение с именем пакета`, () => {
      const script = checkScript(df);
      const ok = runIn(fixture(true), script);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain(`${MARK} ok`);
      const bad = runIn(fixture(false), script);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('@x/binding-here');
      expect(bad.stderr).not.toContain('binding-elsewhere');
      expect(bad.stderr).toContain('kkRepo');
    });
  }

  it('строка одна на все образы — расхождение версий проверки ловится здесь', () => {
    const scripts = DOCKERFILES.map(checkScript);
    expect(new Set(scripts).size).toBe(1);
  });
});
