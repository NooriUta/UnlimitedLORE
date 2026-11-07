// SPRINT_UXR_S3_V2_INFRA/S3-10 (D-2026-UXR-V2-FOLDER-V1-FROZEN): ветки выкатки.
//
//   * v1 (src/, сервис lore-app) ЗАМОРОЖЕН: CD его образ не пересобирает,
//     а работающий образ закреплён тегом и сверяется после каждой выкатки;
//   * CI и CD — по путям: правка web-next/ гоняет и выкатывает только v2,
//     правка backend/ / mcp-server/ / контрактов — бэкенд, контракты S0 и тесты
//     ОБОИХ вебов;
//   * src/** в PR без метки v1-hotfix — красный PR.
//
// Почему тест: решение «что гонять» принимает скрипт, и ошибка в нём молчит —
// пропущенные тесты выглядят как зелёные. Поэтому проверяется и разбор путей
// (что включается), и то, что при НЕвозможности разобрать гоняется всё.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

// ── разбор workflow (текстом: YAML-парсера в зависимостях v2 нет и не нужно) ──

/** Блок job'а `name:` (отступ 2) до следующего job'а. */
function job(file: string, name: string): string {
  const lines = read(file).split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i]) || /^\S/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

/** Шаги job'а: имя → тело без комментариев. Безымянные (`- uses:`) — с именем uses. */
function steps(block: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  let cur: { name: string; body: string } | null = null;
  for (const line of block.split('\n')) {
    const m = /^ {6}- (name|uses): (.+)$/.exec(line);
    if (m) {
      cur = { name: m[1] === 'name' ? m[2].trim() : `uses ${m[2].trim()}`, body: line + '\n' };
      out.push(cur);
      continue;
    }
    if (cur && !/^\s*#/.test(line)) cur.body += line + '\n';
  }
  return out;
}

const stepBy = (block: string, re: RegExp) => steps(block).find((s) => re.test(s.body));

function expectGated(block: string, re: RegExp, flag: string) {
  const s = stepBy(block, re);
  expect(s, `нет шага ${re}`).toBeDefined();
  expect(s!.body, `шаг «${s!.name}» не под флагом ${flag}`)
    .toMatch(new RegExp(`if: .*steps\\.scope\\.outputs\\.${flag} == 'true'`));
}

function expectScoped(block: string) {
  const co = stepBy(block, /uses: actions\/checkout/);
  expect(co, 'нет checkout').toBeDefined();
  // diff base...HEAD требует истории; по умолчанию checkout мелкий (depth 1)
  expect(co!.body).toMatch(/fetch-depth: 0/);
  const sc = steps(block).find((s) => /id: scope\b/.test(s.body));
  expect(sc, 'нет шага с id: scope').toBeDefined();
  expect(sc!.body).toMatch(/ci-scope\.sh ci\b/);
}

describe('frontend-ci.yml: v1 и v2 гоняются по путям', () => {
  const F = '.github/workflows/frontend-ci.yml';

  it('job build (v1 + MCP) определяет скоуп по диффу', () => expectScoped(job(F, 'build')));
  it('job web-next (v2) определяет скоуп по диффу', () => expectScoped(job(F, 'web-next')));

  it('v1: install/lint/test/build, образ и nginx — под флагом v1', () => {
    const b = job(F, 'build');
    expectGated(b, /npm run lint/, 'v1');
    expectGated(b, /-t lore-app:ci/, 'v1');
    expectGated(b, /lore-app:ci nginx -T/, 'v1');
  });

  it('MCP-сервер — под флагом mcp', () => expectGated(job(F, 'build'), /working-directory: mcp-server/, 'mcp'));

  it('v2: тесты, образ, проверка образа и compose — под флагом v2', () => {
    const w = job(F, 'web-next');
    expectGated(w, /working-directory: web-next/, 'v2');
    expectGated(w, /-t lore-app-next:ci/, 'v2');
    expectGated(w, /lore-app-next:ci nginx -T/, 'v2');
    expectGated(w, /config --services/, 'v2');
  });
});

describe('backend-ci.yml: бэкенд гоняется по путям', () => {
  const B = '.github/workflows/backend-ci.yml';
  it('скоуп по диффу', () => expectScoped(job(B, 'build')));
  it('живая тест-БД, gradle build/test и образ — под флагом backend', () => {
    const b = job(B, 'build');
    expectGated(b, /Point live-DB tests/, 'backend');
    expectGated(b, /gradle-retry\.sh build\b/, 'backend');
    expectGated(b, /gradle-retry\.sh test\b/, 'backend');
    expectGated(b, /Docker image build \(backend\)/, 'backend');
  });
});

describe('v1-freeze-guard.yml: src/** без метки v1-hotfix — красный PR', () => {
  const G = '.github/workflows/v1-freeze-guard.yml';
  it('файл есть', () => expect(existsSync(resolve(repo, G))).toBe(true));
  it('перепроверяется при снятии/навешивании метки и на новых коммитах', () => {
    const g = read(G);
    for (const t of ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']) expect(g).toMatch(new RegExp(`\\b${t}\\b`));
  });
  it('только PR в develop (промоушн несёт уже одобренную правку)', () => {
    expect(read(G)).toMatch(/branches: \[ ?"develop" ?\]/);
  });
  it('вызывает guard-v1 с метками PR и полной историей', () => {
    const g = read(G);
    expect(g).toMatch(/ci-scope\.sh guard-v1/);
    expect(g).toMatch(/PR_LABELS: \$\{\{ toJSON\(github\.event\.pull_request\.labels\.\*\.name\) \}\}/);
    expect(g).toMatch(/fetch-depth: 0/);
  });
});

describe('lore-cd.yml: v1 заморожен, выкатка по путям', () => {
  const C = '.github/workflows/lore-cd.yml';
  const d = () => job(C, 'deploy');
  const idx = (re: RegExp) => steps(d()).findIndex((s) => re.test(s.body));

  it('выбор сервисов — скриптом по путям (push) или по вводу (dispatch)', () => {
    const which = steps(d()).find((s) => s.name === 'Resolve which services to touch');
    expect(which?.body).toMatch(/ci-scope\.sh cd\b/);
    expect(which?.body).toMatch(/SERVICE: \$\{\{ github\.event\.inputs\.service/);
    expect(stepBy(d(), /uses: actions\/checkout/)?.body).toMatch(/fetch-depth: 0/);
  });

  it('образ v1 закрепляется ДО любых сборок и выкаток', () => {
    const pin = idx(/v1-freeze\.sh pin\b/);
    expect(pin).toBeGreaterThan(-1);
    expect(pin).toBeLessThan(idx(/compose-build-retry\.sh/));
  });

  it('после выкатки: образ v1 не сменился (если v1 не выкатывали)', () => {
    const v = stepBy(d(), /v1-freeze\.sh verify\b/);
    expect(v).toBeDefined();
    expect(v!.body).toMatch(/steps\.which\.outputs\.frontend != 'true'/);
    expect(idx(/v1-freeze\.sh verify\b/)).toBeGreaterThan(idx(/--no-deps lore-app-next\b/));
  });

  it('хотфикс v1 (ручной запуск frontend) перезакрепляет тег на новый образ', () => {
    const r = stepBy(d(), /v1-freeze\.sh repin\b/);
    expect(r).toBeDefined();
    expect(r!.body).toMatch(/steps\.which\.outputs\.frontend == 'true'/);
    expect(idx(/v1-freeze\.sh repin\b/)).toBeGreaterThan(idx(/--no-deps lore-app\s*$/m));
  });
});

// ── поведение скриптов ───────────────────────────────────────────────────────
const bashBin = process.platform === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p))
  : 'bash';

const stubDir = mkdtempSync(join(tmpdir(), 'lore-scope-stub-'));
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

function run(script: string, args: string[], env: Record<string, string>, cwd = repo) {
  const r = spawnSync(bashBin!, [resolve(repo, script).replace(/\\/g, '/'), ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_ENV: '', GITHUB_STEP_SUMMARY: '', ...env,
      PATH: `${stubDir}${delimiter}${process.env.PATH ?? ''}` },
  });
  const out = `${r.stdout}${r.stderr}`;
  const kv: Record<string, string> = {};
  for (const m of r.stdout.matchAll(/^(\w+)=(.*)$/gm)) kv[m[1]] = m[2];
  return { code: r.status, out, kv };
}

const scope = (files: string[], mode = 'ci', env: Record<string, string> = {}) =>
  run('.github/scripts/ci-scope.sh', [mode], { CI_SCOPE_FILES: files.join('\n'), ...env });

const flags = (kv: Record<string, string>) => ({ v1: kv.v1, v2: kv.v2, backend: kv.backend, mcp: kv.mcp });
const ALL = { v1: 'true', v2: 'true', backend: 'true', mcp: 'true' };
const NONE = { v1: 'false', v2: 'false', backend: 'false', mcp: 'false' };

describe.skipIf(!bashBin)('ci-scope.sh ci: что гонять', () => {
  it('web-next/** → только v2', () => {
    expect(flags(scope(['web-next/src/App.tsx', 'web-next/package.json']).kv))
      .toEqual({ ...NONE, v2: 'true' });
  });

  it('backend/** → бэкенд, MCP-контракт и ОБА веба', () => {
    expect(flags(scope(['backend/src/main/java/X.java']).kv)).toEqual(ALL);
  });

  it('mcp-server/** (контракт S0-01) → бэкенд, MCP и оба веба', () => {
    expect(flags(scope(['mcp-server/src/tools/contract.snapshot.json']).kv)).toEqual(ALL);
  });

  it('контракт телефона S0-02 (в backend/) → всё', () => {
    expect(flags(scope(['backend/src/test/resources/contract/minilore-phone-api.json']).kv)).toEqual(ALL);
  });

  it('src/** → только v1', () => {
    expect(flags(scope(['src/App.tsx']).kv)).toEqual({ ...NONE, v1: 'true' });
  });

  it('корневые файлы сборки v1 (package.json, Dockerfile) → v1', () => {
    expect(flags(scope(['package.json', 'Dockerfile']).kv)).toEqual({ ...NONE, v1: 'true' });
  });

  it('общий шаблон nginx → оба веба, без бэкенда', () => {
    expect(flags(scope(['nginx.conf.template']).kv)).toEqual({ ...NONE, v1: 'true', v2: 'true' });
  });

  it('правка CI → всё (workflow должен проверить сам себя)', () => {
    expect(flags(scope(['.github/workflows/frontend-ci.yml']).kv)).toEqual(ALL);
  });

  it('только документация → ничего тяжёлого', () => {
    expect(flags(scope(['docs/x.md', 'RELEASE-v9.9.9.md']).kv)).toEqual(NONE);
  });

  it('незнакомый путь → всё (неизвестное не пропускаем)', () => {
    expect(flags(scope(['weird/thing.bin']).kv)).toEqual(ALL);
  });

  it('смесь web-next + docs → только v2', () => {
    expect(flags(scope(['web-next/src/a.ts', 'docs/b.md']).kv)).toEqual({ ...NONE, v2: 'true' });
  });

  it('пустой список изменений → всё, с причиной (не «нечего проверять»)', () => {
    const r = scope([]);
    expect(flags(r.kv)).toEqual(ALL);
    expect(r.out).toMatch(/::warning::/);
  });

  it('дифф не вычислился (не git-каталог) → всё, громко', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lore-scope-nogit-'));
    try {
      const r = run('.github/scripts/ci-scope.sh', ['ci'], { EVENT_NAME: 'pull_request', BASE_REF: 'develop' }, tmp);
      expect(r.code).toBe(0);
      expect(flags(r.kv)).toEqual(ALL);
      expect(r.out).toMatch(/::warning::.*гоняем всё/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('выход пишется и в GITHUB_OUTPUT', () => {
    const f = join(stubDir, 'out.txt');
    writeFileSync(f, '');
    run('.github/scripts/ci-scope.sh', ['ci'], { CI_SCOPE_FILES: 'web-next/a.ts', GITHUB_OUTPUT: f.replace(/\\/g, '/') });
    const o = readFileSync(f, 'utf8');
    expect(o).toMatch(/^v2=true$/m);
    expect(o).toMatch(/^v1=false$/m);
  });

  it('неизвестный режим → ошибка', () => {
    expect(scope(['x'], 'nope').code).toBe(2);
  });
});

describe.skipIf(!bashBin)('ci-scope.sh guard-v1: заморозка src/', () => {
  it('src/** без метки → красный, с подсказкой про v1-hotfix', () => {
    const r = scope(['src/App.tsx'], 'guard-v1', { PR_LABELS: '["bug"]' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*v1-hotfix/);
    expect(r.out).toContain('src/App.tsx');
  });

  it('src/** с меткой v1-hotfix → зелёный', () => {
    expect(scope(['src/App.tsx'], 'guard-v1', { PR_LABELS: '["bug","v1-hotfix"]' }).code).toBe(0);
  });

  it('метка-тёзка (v1-hotfix-later) не считается', () => {
    expect(scope(['src/App.tsx'], 'guard-v1', { PR_LABELS: '["v1-hotfix-later"]' }).code).toBe(1);
  });

  it('без src/ → зелёный при любых метках', () => {
    expect(scope(['web-next/src/App.tsx', 'backend/x.java'], 'guard-v1', { PR_LABELS: '[]' }).code).toBe(0);
  });

  it('дифф не вычислился → красный (не проверено ≠ чисто)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lore-guard-nogit-'));
    try {
      const r = run('.github/scripts/ci-scope.sh', ['guard-v1'], { EVENT_NAME: 'pull_request', BASE_REF: 'develop', PR_LABELS: '[]' }, tmp);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/::error::/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe.skipIf(!bashBin)('ci-scope.sh cd: что выкатывать', () => {
  const cd = (files: string[], env: Record<string, string>) =>
    scope(files, 'cd', env).kv;
  const pick = (kv: Record<string, string>) => ({ backend: kv.backend, frontend: kv.frontend, frontend_next: kv.frontend_next });

  it('ручной both → бэкенд и v2, v1 НЕ пересобирается', () => {
    expect(pick(cd([], { EVENT_NAME: 'workflow_dispatch', SERVICE: 'both' })))
      .toEqual({ backend: 'true', frontend: 'false', frontend_next: 'true' });
  });

  it('ручной frontend → хотфикс v1, только он', () => {
    expect(pick(cd([], { EVENT_NAME: 'workflow_dispatch', SERVICE: 'frontend' })))
      .toEqual({ backend: 'false', frontend: 'true', frontend_next: 'false' });
  });

  it('ручной frontend-next / backend → только они', () => {
    expect(pick(cd([], { EVENT_NAME: 'workflow_dispatch', SERVICE: 'frontend-next' })))
      .toEqual({ backend: 'false', frontend: 'false', frontend_next: 'true' });
    expect(pick(cd([], { EVENT_NAME: 'workflow_dispatch', SERVICE: 'backend' })))
      .toEqual({ backend: 'true', frontend: 'false', frontend_next: 'false' });
  });

  it('пуш с правкой web-next → только v2', () => {
    expect(pick(cd(['web-next/src/App.tsx'], { EVENT_NAME: 'push' })))
      .toEqual({ backend: 'false', frontend: 'false', frontend_next: 'true' });
  });

  it('пуш с правкой backend → бэкенд и v2 (v1 заморожен)', () => {
    expect(pick(cd(['backend/x.java'], { EVENT_NAME: 'push' })))
      .toEqual({ backend: 'true', frontend: 'false', frontend_next: 'true' });
  });

  it('пуш только MCP → бэкенд не пересобирается (MCP не выкатывается CD)', () => {
    expect(cd(['mcp-server/src/a.ts'], { EVENT_NAME: 'push' }).backend).toBe('false');
  });

  it('пуш с правкой src/ → v1 не выкатывается, но это сказано вслух', () => {
    const r = scope(['src/App.tsx'], 'cd', { EVENT_NAME: 'push' });
    expect(r.kv.frontend).toBe('false');
    expect(r.out).toMatch(/::warning::.*service=frontend/);
  });

  it('неизвестный сервис в ручном запуске → ошибка', () => {
    expect(scope([], 'cd', { EVENT_NAME: 'workflow_dispatch', SERVICE: 'all' }).code).toBe(2);
  });
});

// ── v1-freeze.sh с подменным docker ─────────────────────────────────────────
writeFileSync(join(stubDir, 'docker'), `#!/usr/bin/env bash
case "$1 $2" in
  "compose ps") printf '%s\\n' "\${STUB_CID:-}"; exit 0 ;;
esac
if [ "$1" = inspect ]; then printf '%s\\n' "\${STUB_RUNNING:-}"; exit 0; fi
if [ "$1 $2" = "image inspect" ]; then
  [ -n "\${STUB_FROZEN:-}" ] || exit 1
  printf '%s\\n' "$STUB_FROZEN"; exit 0
fi
if [ "$1" = tag ]; then echo "tag $2 $3" >> "$STUB_LOG"; exit 0; fi
exit 0
`.replace(/\r\n/g, '\n'));
chmodSync(join(stubDir, 'docker'), 0o755);

describe.skipIf(!bashBin)('v1-freeze.sh: образ lore-app закреплён', () => {
  const log = join(stubDir, 'tag.log');
  const envf = join(stubDir, 'env.txt');
  const freeze = (mode: string, env: Record<string, string>) => {
    writeFileSync(log, '');
    writeFileSync(envf, '');
    return run('.github/scripts/v1-freeze.sh', [mode], {
      STUB_LOG: log.replace(/\\/g, '/'), GITHUB_ENV: envf.replace(/\\/g, '/'), ...env,
    });
  };
  const A = 'sha256:aaaa';
  const B = 'sha256:bbbb';

  it('pin: тега ещё нет → первое закрепление текущего образа', () => {
    const r = freeze('pin', { STUB_CID: 'c1', STUB_RUNNING: A, STUB_FROZEN: '' });
    expect(r.code).toBe(0);
    expect(readFileSync(log, 'utf8')).toContain(`tag ${A} lore-app:v1-frozen`);
    expect(readFileSync(envf, 'utf8')).toContain(`V1_IMAGE_BEFORE=${A}`);
  });

  it('pin: тег совпадает с работающим образом → тег не трогается', () => {
    const r = freeze('pin', { STUB_CID: 'c1', STUB_RUNNING: A, STUB_FROZEN: A });
    expect(r.code).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe('');
    expect(r.out).toContain(A);
  });

  it('pin: работает НЕ закреплённый образ → громкое предупреждение, тег не переписан', () => {
    const r = freeze('pin', { STUB_CID: 'c1', STUB_RUNNING: B, STUB_FROZEN: A });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::warning::/);
    expect(readFileSync(log, 'utf8')).toBe('');
  });

  it('pin: v1 не запущен → предупреждение, не падение', () => {
    const r = freeze('pin', { STUB_CID: '', STUB_RUNNING: '', STUB_FROZEN: '' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::warning::/);
  });

  it('verify: образ тот же → успех', () => {
    expect(freeze('verify', { STUB_CID: 'c1', STUB_RUNNING: A, V1_IMAGE_BEFORE: A }).code).toBe(0);
  });

  it('verify: образ сменился за выкатку → провал с обоими id', () => {
    const r = freeze('verify', { STUB_CID: 'c1', STUB_RUNNING: B, V1_IMAGE_BEFORE: A });
    expect(r.code).toBe(1);
    expect(r.out).toContain(A);
    expect(r.out).toContain(B);
  });

  it('verify: контейнер v1 пропал за выкатку → провал', () => {
    expect(freeze('verify', { STUB_CID: '', V1_IMAGE_BEFORE: A }).code).toBe(1);
  });

  it('repin: хотфикс → тег переезжает на новый образ', () => {
    const r = freeze('repin', { STUB_CID: 'c1', STUB_RUNNING: B, STUB_FROZEN: A });
    expect(r.code).toBe(0);
    expect(readFileSync(log, 'utf8')).toContain(`tag ${B} lore-app:v1-frozen`);
  });

  it('тег — переменной FROZEN_TAG', () => {
    freeze('pin', { STUB_CID: 'c1', STUB_RUNNING: A, STUB_FROZEN: '', FROZEN_TAG: 'x/y:z' });
    expect(readFileSync(log, 'utf8')).toContain(`tag ${A} x/y:z`);
  });
});
