// SPRINT_UXR_S3_V2_INFRA/S3-01: v2 собирается своей сборкой в свой образ, и
// CI этот образ собирает. Гварды на файлах — потому что поломка здесь не видна
// ни tsc, ни рендер-тестам: образ просто перестаёт собираться или начинает
// тащить в себя v1.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webNext = resolve(here, '..');
const repo = resolve(webNext, '..');
const read = (p: string) => readFileSync(p, 'utf8');

describe('web-next: отдельная сборка', () => {
  it('свой package.json с build/test и свой lock-файл', () => {
    const pkg = JSON.parse(read(resolve(webNext, 'package.json')));
    expect(pkg.name).toBe('lore-app-next');
    expect(pkg.scripts.build).toMatch(/vite build/);
    expect(pkg.scripts.test).toMatch(/vitest/);
    expect(existsSync(resolve(webNext, 'package-lock.json'))).toBe(true);
  });

  it('свой vite.config, тесты только из web-next/src', () => {
    const cfg = read(resolve(webNext, 'vite.config.ts'));
    expect(cfg).toMatch(/include:\s*\['src\/\*\*/);
  });
});

describe('web-next/Dockerfile: свой образ', () => {
  const dockerfile = resolve(webNext, 'Dockerfile');
  const df = () => read(dockerfile);

  it('существует рядом с каталогом v2', () => {
    expect(existsSync(dockerfile)).toBe(true);
  });

  it('собирает именно web-next и не копирует v1 (src/, корневой package.json)', () => {
    const text = df();
    expect(text).toMatch(/COPY web-next\/package\.json web-next\/package-lock\.json/);
    expect(text).toMatch(/npm run build/);
    // v1 в образ v2 не попадает: ни корневых исходников, ни корневых зависимостей.
    expect(text).not.toMatch(/^COPY \. /m);
    expect(text).not.toMatch(/^COPY (\.\/)?src[ /]/m);
    expect(text).not.toMatch(/^COPY (\.\/)?package(-lock)?\.json/m);
  });

  // PR #882 (08.11): правка kit/src сбросила кэш слоя `npm ci` — он стоял ПОСЛЕ
  // `COPY kit/src`. Свежая установка в образе прошла без optional-модуля
  // @rolldown/binding-linux-x64-musl, и `vite build` упал «Cannot find native
  // binding». Установка зависимостей не должна зависеть от исходников.
  // С K5-PACKAGE-DELIVERY (25.11) kit — пакет из реестра: исходников kit в образе нет вовсе,
  // а слой установки меняется лишь при смене манифестов (package.json, lock, .npmrc).
  it('npm ci — по одним манифестам, до копирования исходников; kit/ в образ не копируется', () => {
    const lines = df().split('\n');
    const at = (re: RegExp) => lines.findIndex(l => re.test(l));
    const ci = lines.findIndex(l => /\bnpm ci\b/.test(l) && !/^\s*#/.test(l));
    expect(ci, 'npm ci').toBeGreaterThan(-1);
    expect(at(/^COPY web-next\/package\.json web-next\/package-lock\.json web-next\/\.npmrc /)).toBeLessThan(ci);
    expect(at(/^COPY web-next\/src /)).toBeGreaterThan(ci);
    expect(at(/^COPY kit\//)).toBe(-1);
  });

  it('отдаётся nginx с тем же прокси /lore/, что у v1 (MCP и телефон ходят через него)', () => {
    const text = df();
    expect(text).toMatch(/FROM nginx:alpine/);
    expect(text).toMatch(/COPY nginx\.conf\.template \/etc\/nginx\/templates\/default\.conf\.template/);
    expect(text).toMatch(/NGINX_ENVSUBST_FILTER="\^LORE_"/);
  });
});

describe('CI: образ v2 собирается', () => {
  const ci = () => read(resolve(repo, '.github/workflows/frontend-ci.yml'));

  it('frontend-ci содержит отдельный job web-next', () => {
    expect(ci()).toMatch(/^ {2}web-next:\s*$/m);
  });

  it('job ставит, проверяет, тестирует и собирает web-next', () => {
    const job = ci().split(/^ {2}web-next:\s*$/m)[1] ?? '';
    expect(job).toMatch(/working-directory: web-next/);
    expect(job).toMatch(/npm run typecheck/);
    expect(job).toMatch(/npm test/);
    expect(job).toMatch(/npm run build/);
    expect(job).toMatch(/docker build \$ARGS --secret id=npm_token,env=KIT_NPM_READ_TOKEN -f web-next\/Dockerfile -t lore-app-next:ci \./);
  });

  // S4-00a, D-2026-UXR-KIT-REACT → K5-PACKAGE-DELIVERY (25.11): kit — пакет @seidr/kit из
  // AIDA/lorekit; его типы, тесты, CSS-слой и паритет i18n гоняет kit-ci.yml того репозитория.
  // Здесь — только ключ чтения реестра до установки web-next, и никакого шага над kit/.
  it('job не гоняет kit/ (он в AIDA/lorekit) и до установки web-next даёт ключ чтения реестра', () => {
    const job = ci().split(/^ {2}web-next:\s*$/m)[1] ?? '';
    expect(job).not.toMatch(/working-directory: kit\b/);
    const steps = job.split(/- name: /);
    const key = steps.findIndex(s => /KIT_NPM_READ_TOKEN:\s*\$\{\{\s*secrets\./.test(s));
    const install = steps.findIndex(s => /working-directory: web-next/.test(s) && /npm-retry\.sh ci/.test(s));
    expect(key, 'нет шага с ключом чтения реестра').toBeGreaterThan(-1);
    expect(key).toBeLessThan(install);
    expect(steps[key]).toMatch(/BLOCKED/);
  });
});
