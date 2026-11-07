// SPRINT_UXR_S3_V2_INFRA/S3-06: LORE CD собирает и выкатывает ВТОРОЙ образ
// (lore-app-next, v2) рядом с lore-app (v1) и после деплоя ПРОБУЕТ результат
// снаружи: :4400/lore/version (адрес, по которому ходит MCP) и
// new.lore.odal.seidrstudio.pro (D-2026-UXR-V2-HOST).
//
// Почему тест здесь, а не «посмотрим на стенде»: CD бежит только по пушу в
// preprod. Забытый шаг выкатки v2 или проба, которая «зелёная» при любом
// ответе, вскрылись бы уже после промоушна — а очередь на стенд общая.
//
// Две части:
//   1. текст workflow — шаги есть, стоят в нужном порядке и под нужным флагом;
//   2. поведение скриптов — гоняем bash с подменённым `docker` в PATH и
//      проверяем, ЧТО считается успехом. Проба, которая не отличает SPA-заглушку
//      от ответа бэкенда, хуже отсутствующей: она подтверждает то, чего нет.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

const cd = () => read('.github/workflows/lore-cd.yml');

/** Шаги workflow: имя → тело (if/run/env), в порядке следования. */
function steps(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const lines = cd().split('\n');
  let cur: { name: string; body: string } | null = null;
  for (const line of lines) {
    const m = /^ {6}- name: (.+)$/.exec(line);
    if (m) {
      cur = { name: m[1].trim(), body: '' };
      out.push(cur);
      continue;
    }
    if (/^ {6}- uses:/.test(line)) { cur = null; continue; }
    if (cur && !/^\s*#/.test(line)) cur.body += line + '\n';
  }
  return out;
}

const stepIndex = (re: RegExp) => steps().findIndex((s) => re.test(s.body));

describe('lore-cd.yml: второй образ (lore-app-next)', () => {
  it('ручной запуск умеет выкатить только v2', () => {
    expect(cd()).toMatch(/options: \[[^\]]*\bfrontend-next\b[^\]]*\]/);
  });

  it('флаг frontend_next выводится из выбора сервиса (both и frontend-next)', () => {
    const which = steps().find((s) => s.name === 'Resolve which services to touch');
    expect(which?.body).toMatch(/frontend_next=/);
  });

  it('образ v2 собирается тем же скриптом с повтором и под своим флагом', () => {
    const s = steps().find((x) => /compose-build-retry\.sh lore-app-next\b/.test(x.body));
    expect(s, 'нет шага сборки lore-app-next').toBeDefined();
    expect(s!.body).toMatch(/steps\.which\.outputs\.frontend_next == 'true'/);
  });

  it('v2 поднимается своим `up --no-deps`, не задевая lore-app', () => {
    const s = steps().find((x) => /docker compose up -d --no-deps lore-app-next\b/.test(x.body));
    expect(s, 'нет шага выкатки lore-app-next').toBeDefined();
    expect(s!.body).toMatch(/frontend_next == 'true'/);
    expect(s!.body).not.toMatch(/--no-deps lore-app(\s|$)/);
  });

  it('v2 проверяется изнутри контейнера: бандл именно v2, а не просто 200', () => {
    const s = steps().find((x) => /ps -q lore-app-next/.test(x.body));
    expect(s, 'нет проверки контейнера lore-app-next').toBeDefined();
    expect(s!.body).toMatch(/<title>LORE v2<\/title>/);
    expect(s!.body).toMatch(/\/assets\//);
  });

  it('после деплоя — проба :4400/lore/version (адрес MCP) со сверкой коммита', () => {
    const s = steps().find((x) => /post-deploy-probe\.sh version\b.*:4400\/lore\/version/.test(x.body));
    expect(s, 'нет пробы :4400/lore/version').toBeDefined();
    expect(s!.body).toMatch(/github\.sha/);
  });

  it('после деплоя — проба /lore/ через nginx v2 (прокси общего шаблона)', () => {
    expect(stepIndex(/post-deploy-probe\.sh version\b.*lore-app-next\/lore\/version/)).toBeGreaterThan(-1);
  });

  it('после деплоя — проба new.lore: отдаётся именно v2', () => {
    const s = steps().find((x) => /post-deploy-probe\.sh v2-page\s+https:\/\/new\.lore\.odal\.seidrstudio\.pro/.test(x.body));
    expect(s, 'нет пробы new.lore').toBeDefined();
    // строгость — переменной репозитория, а не правкой workflow
    expect(s!.body).toMatch(/LORE_V2_PUBLIC_PROBE: \$\{\{ vars\.LORE_V2_PUBLIC_PROBE/);
  });

  it('пробы стоят ПОСЛЕ выкатки обоих фронтов', () => {
    const upV1 = stepIndex(/--no-deps lore-app\s*$/m);
    const upV2 = stepIndex(/--no-deps lore-app-next\b/);
    const probe = stepIndex(/post-deploy-probe\.sh/);
    expect(upV1).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(Math.max(upV1, upV2));
  });
});

// ── поведение скриптов ───────────────────────────────────────────────────────
// На Windows `bash` из PATH — заглушка WSL, поэтому берём Git Bash явно. Нет его
// — тесты помечаются пропущенными ПОД СВОИМ ИМЕНЕМ (в CI на Linux бегут всегда).
const bashBin = process.platform === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p))
  : 'bash';

const stubDir = mkdtempSync(join(tmpdir(), 'lore-cd-stub-'));
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

// Подменный docker: `run … curl` печатает тело и строку «код тип», как
// `curl -w '\n%{http_code} %{content_type}'`; `compose config --services`
// печатает список сервисов; `compose build` пишет аргументы в журнал.
writeFileSync(join(stubDir, 'docker'), `#!/usr/bin/env bash
if [ "$1" = run ]; then
  printf '%s' "\${STUB_BODY:-}"
  printf '\\n%s %s' "\${STUB_CODE:-000}" "\${STUB_TYPE:-}"
  [ "\${STUB_CODE:-000}" = 000 ] && exit 7
  exit 0
fi
if [ "$1 $2" = "compose config" ]; then printf '%s\\n' \${STUB_SERVICES:-}; exit \${STUB_CONFIG_RC:-0}; fi
if [ "$1 $2" = "compose build" ]; then shift 2; echo "build $*" >> "$STUB_LOG"; exit 0; fi
exit 0
`.replace(/\r\n/g, '\n'));
writeFileSync(join(stubDir, 'curl'), '#!/usr/bin/env bash\necho 200\n');
chmodSync(join(stubDir, 'docker'), 0o755);
chmodSync(join(stubDir, 'curl'), 0o755);

function runScript(script: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(bashBin!, [resolve(repo, script).replace(/\\/g, '/'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env, PATH: `${stubDir}${delimiter}${process.env.PATH ?? ''}` },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const SHA = '0123456789abcdef0123456789abcdef01234567';
const probe = (args: string[], env: Record<string, string>) =>
  runScript('.github/scripts/post-deploy-probe.sh', args, env);
const version = (env: Record<string, string>) =>
  probe(['version', 'v1 :4400', 'http://192.168.3.131:4400/lore/version', SHA], env);
const json = 'application/json;charset=UTF-8';

describe.skipIf(!bashBin)('post-deploy-probe.sh version', () => {
  it('200 + тот же коммит → успех', () => {
    const r = version({ STUB_CODE: '200', STUB_TYPE: json, STUB_BODY: `{"commit":"${SHA}","built_at":"x","schema_version":90}` });
    expect(r.out).toContain(SHA);
    expect(r.code).toBe(0);
  });

  it('200, но коммит старый → провал с обоими коммитами в сообщении', () => {
    const r = version({ STUB_CODE: '200', STUB_TYPE: json, STUB_BODY: '{"commit":"deadbeefdeadbeef","schema_version":90}' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('deadbeefdeadbeef');
    expect(r.out).toContain(SHA);
  });

  it('200 text/html — это SPA-заглушка, а не бэкенд → провал', () => {
    const r = version({ STUB_CODE: '200', STUB_TYPE: 'text/html', STUB_BODY: '<!doctype html><title>LORE</title>' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/SPA|text\/html/);
  });

  it('401 — бэкенд за прокси жив, но коммит НЕ ПРОВЕРЕН и это сказано вслух', () => {
    const r = version({ STUB_CODE: '401', STUB_TYPE: '', STUB_BODY: '' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::warning::.*НЕ ПРОВЕРЕН/);
  });

  it('нет ответа (000) → провал', () => {
    expect(version({ STUB_CODE: '000' }).code).toBe(1);
  });

  it('502 от nginx → провал', () => {
    expect(version({ STUB_CODE: '502', STUB_TYPE: 'text/html', STUB_BODY: 'Bad Gateway' }).code).toBe(1);
  });

  it('без ожидаемого коммита (бэкенд не выкатывался) — только живость', () => {
    const r = probe(['version', 'v2 nginx', 'http://lore-app-next/lore/version'],
      { STUB_CODE: '200', STUB_TYPE: json, STUB_BODY: '{"commit":"whatever"}' });
    expect(r.code).toBe(0);
  });
});

describe.skipIf(!bashBin)('post-deploy-probe.sh v2-page', () => {
  const url = 'https://new.lore.odal.seidrstudio.pro';
  const v2 = '<!doctype html><html><head><title>LORE v2</title></head></html>';
  const v1 = '<!doctype html><html><head><title>LORE</title></head></html>';

  it('200 с заголовком v2 → успех', () => {
    const r = probe(['v2-page', url], { STUB_CODE: '200', STUB_TYPE: 'text/html', STUB_BODY: v2, LORE_V2_PUBLIC_PROBE: 'required' });
    expect(r.code).toBe(0);
  });

  it('отдаётся v1 (временный роутер) при required → провал с причиной', () => {
    const r = probe(['v2-page', url], { STUB_CODE: '200', STUB_TYPE: 'text/html', STUB_BODY: v1, LORE_V2_PUBLIC_PROBE: 'required' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/v1|не v2/);
  });

  it('отдаётся v1 в режиме warn → не валит деплой, но громкое ::warning::', () => {
    const r = probe(['v2-page', url], { STUB_CODE: '200', STUB_TYPE: 'text/html', STUB_BODY: v1, LORE_V2_PUBLIC_PROBE: 'warn' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::warning::/);
  });

  it('по умолчанию (переменная не задана) — warn', () => {
    const r = probe(['v2-page', url], { STUB_CODE: '000', LORE_V2_PUBLIC_PROBE: '' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::warning::/);
  });

  it('нет ответа при required → провал', () => {
    expect(probe(['v2-page', url], { STUB_CODE: '000', LORE_V2_PUBLIC_PROBE: 'required' }).code).toBe(1);
  });

  it('неизвестный режим строгости — ошибка, а не тихий warn', () => {
    expect(probe(['v2-page', url], { STUB_CODE: '200', STUB_BODY: v2, LORE_V2_PUBLIC_PROBE: 'strict' }).code).toBe(2);
  });
});

describe.skipIf(!bashBin)('compose-build-retry.sh: имя сервиса сверяется с compose', () => {
  const log = join(stubDir, 'build.log');
  const build = (args: string[]) => {
    writeFileSync(log, '');
    return runScript('.github/scripts/compose-build-retry.sh', args, {
      STUB_SERVICES: 'lore-backend lore-app lore-app-next minio',
      STUB_LOG: log.replace(/\\/g, '/'),
    });
  };

  it('известный сервис собирается', () => {
    const r = build(['lore-app-next']);
    expect(r.code).toBe(0);
    expect(readFileSync(log, 'utf8')).toContain('build lore-app-next');
  });

  it('опечатка в имени — громкий отказ ДО сборки (а не молчаливый no-op)', () => {
    const r = build(['frontend']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/::error::.*frontend/);
    expect(readFileSync(log, 'utf8')).toBe('');
  });
});
