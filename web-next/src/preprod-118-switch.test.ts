// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · выкатка 1.18 на препрод: блокеры переключения препрода на базу,
// собранную из модели.
//
//   1. Шаг CD «Migrate schema» (lore.migrate=true + only) на базе из модели получал отказ старта — CD краснел.
//      Потом бэкенд пропускал шаги V строкой «шаги V пропущены: накатывать нечего» — и всё, что после 1.18
//      делалось шагами V (V94–V100), до прода молча не доезжало. С 25.11.2026 бэкенд ДОВОДИТ схему до кода
//      (LoreSchemaAdditive) и пишет строку «… доводка схемы кода vN …»; migrate-schema.sh подтверждает
//      накатку только по ней, прежняя строка — красный. На старой базе — прежняя строка «схема накатана».
//   2. Имя новой базы migration_dst_preprod проходит оба сторожа: ворота препрода (*_preprod) и перенос
//      (migration_dst*). Сторожа не ослаблены: прод и замороженные копии по-прежнему красные.
//   3. Перенос на ci-server (lore-migration-snapshot.yml, action=migrate): файл решений по умолчанию,
//      ветка develop, полный путь transfer → edges → отпечаток дважды со сверкой; без секретов — BLOCKED.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');
/** Текст без строк-комментариев: проверяем то, что исполняется. */
const code = (s: string) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const fwd = (p: string) => p.replace(/\\/g, '/');

const SPAWN_TIMEOUT = 30_000;
const bashBin = process.platform === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p))
  : 'bash';

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));
function dir(prefix: string) { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; }

function exe(d: string, name: string, body: string) {
  writeFileSync(join(d, name), body.replace(/\r\n/g, '\n'));
  chmodSync(join(d, name), 0o755);
}

function run(script: string, env: Record<string, string>, binDir: string) {
  const r = spawnSync(bashBin!, [fwd(resolve(repo, script))], {
    encoding: 'utf8',
    cwd: env.CWD ?? repo,
    env: { ...process.env, ...env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const NEW_DB = 'migration_dst_preprod';
const RUNNER = 'backend/src/main/java/studio/seer/heimdall/lore/LoreSchemaMigrationRunner.java';

// ── 1. шаг накатки CD ────────────────────────────────────────────────────────
describe.skipIf(!bashBin)('MIG-01: шаг CD «Migrate schema» на базе 1.18 не краснеет', { timeout: SPAWN_TIMEOUT }, () => {
  const S = '.github/scripts/migrate-schema.sh';
  const MARK = /ADDITIVE_MARK = "([^"]+)"/.exec(read(RUNNER));
  // строка, которую печатает modelAdditiveLine раннера (форма сверяется с исходником ниже)
  const ADDITIVE_LINE = '[LORE MIGRATE] lore.migrate.only=true — схема собрана из модели (LoreModelSchema), шаги V не применяются; '
    + 'доводка схемы кода v1 (54761523d90deed8): типов +6, свойств +27, индексов +5, посеяно 18 — записи [know_skill]; '
    + 'процесс завершается (шаг накатки CD)';
  const OLD_SKIP_LINE = '[LORE MIGRATE] lore.migrate.only=true — схема собрана из модели (LoreModelSchema), '
    + 'шаги V пропущены: накатывать нечего, процесс завершается (шаг накатки CD)';

  /** docker-заглушка: `compose run …` печатает $STUB_OUT и выходит с $STUB_RC. */
  function migrate(out: string, rc = 0) {
    const d = dir('lore-mig-step-');
    exe(d, 'docker', '#!/usr/bin/env bash\nprintf "%s\\n" "$STUB_OUT"\nexit "${STUB_RC:-0}"\n');
    const log = fwd(join(d, 'migrate.log'));
    return run(S, { STUB_OUT: out, STUB_RC: String(rc), MIGRATE_LOG: log, MIGRATE_TIMEOUT: '60' }, d);
  }

  it('строка доводки — та, что печатает бэкенд', () => {
    expect(MARK, 'ADDITIVE_MARK в раннере').not.toBeNull();
    expect(MARK![1]).toBe('доводка схемы кода');
    expect(ADDITIVE_LINE).toContain(MARK![1]);
    expect(read(RUNNER)).toContain('схема собрана из модели (LoreModelSchema), шаги V не применяются; "');
    expect(read(S)).toContain('схема собрана из модели (LoreModelSchema), шаги V не применяются; доводка схемы кода');
  });

  it('база из модели: схема доведена до кода — зелёный, что сделано — в выводе', () => {
    const r = migrate(ADDITIVE_LINE);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/из модели/);
    expect(r.out).toMatch(/типов \+6, свойств \+27, индексов \+5, посеяно 18/);
    expect(r.out).not.toMatch(/::error::/);
  });

  it('база из модели: «шаги V пропущены: накатывать нечего» (образ без доводки) — красный', () => {
    const r = migrate(OLD_SKIP_LINE);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*доводки схемы кода нет/);
  });

  it('старая база: «схема накатана» — зелёный, как раньше', () => {
    const r = migrate('[LORE MIGRATE] lore.migrate.only=true — схема накатана, процесс завершается (шаг накатки CD)');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/накатка подтверждена/);
  });

  it('отказ старта (код ≠ 0) — красный', () => {
    const r = migrate('[LORE MIGRATE] Отказ старта: схема базы собрана из модели (LoreModelSchema), а lore.migrate=true', 1);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::накатка схемы упала/);
  });

  it('код 0 без строки подтверждения — красный', () => {
    const r = migrate('что-то вывелось, но не то');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::/);
  });

  it('lore-cd.yml зовёт скрипт, а не держит проверку строкой в run:', () => {
    const w = code(read('.github/workflows/lore-cd.yml'));
    const step = w.slice(w.indexOf('- name: Migrate schema'), w.indexOf('- name: MinIO препрода'));
    expect(step).toMatch(/bash \.github\/scripts\/migrate-schema\.sh/);
    expect(step).toMatch(/LORE_MIGRATE: "true"/);
    expect(step).toMatch(/LORE_MIGRATE_ONLY: "true"/);
  });
});

// ── 2. имя новой базы ────────────────────────────────────────────────────────
describe.skipIf(!bashBin)(`MIG-01: имя ${NEW_DB} проходит оба сторожа`, { timeout: SPAWN_TIMEOUT }, () => {
  const base = { PREPROD_GATES_ONLY: 'guards', LORE_SECRETS_ENVIRONMENT: 'preprod', COMPOSE_PROJECT_NAME: 'lore-preprod' };
  const d = dir('lore-mig-gates-');

  it('ворота препрода (preprod-gates.sh) пускают', () => {
    const r = run('.github/scripts/preprod-gates.sh', { ...base, LORE_DB: NEW_DB }, d);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(`база препрода: ${NEW_DB}`));
  });

  it.each(['system_aida_lore', 'system_aida_lore_frozen_20261107', 'migration_dst', 'migration_dst_linux'])(
    'ворота препрода по-прежнему не пускают %s', (db) => {
      expect(run('.github/scripts/preprod-gates.sh', { ...base, LORE_DB: db }, d).code).toBe(1);
    });

  it('перенос (transfer.mjs, transfer-edges.mjs) пишет в него', () => {
    for (const f of ['scripts/model-migration/transfer.mjs', 'scripts/model-migration/transfer-edges.mjs']) {
      const m = /if \(!\/(\^migration_dst[^/]*)\/\.test\(db\.env\.MIG_DST_DB\)\)/.exec(read(f));
      expect(m, f).not.toBeNull();
      expect(new RegExp(m![1]).test(NEW_DB), f).toBe(true);
    }
  });

  it('сторож баз workflow переноса пускает его приёмником', () => {
    const d2 = dir('lore-mig-guard-');
    exe(d2, 'node', '#!/usr/bin/env bash\nexit 0\n');
    const r = run('.github/scripts/model-migration-run.sh', { MIG_SRC_DB: 'migration_src_2026_11_20', MIG_DST_DB: NEW_DB, GUARD_ONLY: 'true' }, d2);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(`→ приёмник ${NEW_DB}`));
  });
});

// ── 3. перенос на ci-server ──────────────────────────────────────────────────
describe.skipIf(!bashBin)('MIG-01: перенос на ci-server — полный путь как ryzen-full-all.sh', { timeout: SPAWN_TIMEOUT }, () => {
  const S = '.github/scripts/model-migration-run.sh';
  const DEC = 'scripts/model-migration/rules/decisions.lore.json';

  /** node-заглушка: пишет вызовы в $CALLS; dst-fingerprint печатает отпечаток из $FP1 / $FP2 по номеру прогона. */
  function pipeline(env: Record<string, string>) {
    const d = dir('lore-mig-run-');
    const calls = join(d, 'calls.log');
    writeFileSync(calls, '');
    exe(d, 'node', [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$CALLS"',
      'case "$*" in',
      '  *dst-fingerprint*) n=$(grep -c dst-fingerprint "$CALLS"); v=FP$n; echo "отпечаток содержимого: ${!v}" ;;',
      'esac',
      'exit 0', '',
    ].join('\n'));
    const r = run(S, {
      MIG_SRC_DB: 'migration_src_2026_11_20', MIG_DST_DB: NEW_DB, STAGE: 'full', RESET: 'false',
      MIG_DB_USER: 'u', MIG_DB_PASSWORD: 'p-SECRET', MIG_REPORT_DIR: fwd(join(d, 'report')),
      CALLS: fwd(calls), FP1: 'aaaa', FP2: 'aaaa', ...env,
    }, d);
    return { ...r, calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean) };
  }

  it('без секретов — BLOCKED с именами, что завести; конвейер не запускался', () => {
    const r = pipeline({ MIG_DB_USER: '', MIG_DB_PASSWORD: '' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/BLOCKED/);
    expect(r.out).toMatch(/MIG_DB_USER/);
    expect(r.out).toMatch(/MIG_DB_PASSWORD/);
    expect(r.calls).toEqual([]);
  });

  it('этапы: connect, затем дважды transfer → edges → dst-fingerprint; решения — файл по умолчанию', () => {
    const r = pipeline({});
    expect(r.code).toBe(0);
    const cmds = r.calls.map((c) => c.split(' ')[1]);
    expect(cmds).toEqual(['connect', 'transfer', 'edges', 'dst-fingerprint', 'transfer', 'edges', 'dst-fingerprint']);
    for (const c of r.calls) expect(c).toContain(`--decisions ${DEC}`);
    expect(r.calls.filter((c) => / transfer /.test(` ${c} `)).every((c) => c.includes('--reset'))).toBe(true);
    expect(r.out).toMatch(/отпечатки двух прогонов совпали: aaaa/);
    expect(r.out).not.toContain('p-SECRET');
  });

  it('отпечатки разошлись — красный', () => {
    const r = pipeline({ FP2: 'bbbb' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*отпечатки.*разошлись/);
  });

  it('файла решений нет — красный до конвейера', () => {
    const r = pipeline({ MIG_DECISIONS: 'нет/такого.json' });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it('сторож: рабочая база приёмником — красный', () => {
    const r = pipeline({ MIG_DST_DB: 'system_aida_lore' });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it('workflow: ветка develop, приёмник migration_dst_preprod, решения по умолчанию, этап full, скрипт', () => {
    const w = read('.github/workflows/lore-migration-snapshot.yml');
    /** Блок input'а `name:` (отступ 6) до следующего input'а. */
    const input = (name: string) => {
      const lines = w.split('\n');
      const start = lines.findIndex((l) => l === `      ${name}:`);
      if (start < 0) return '';
      const end = lines.findIndex((l, i) => i > start && !/^ {8}/.test(l));
      return lines.slice(start, end < 0 ? undefined : end).join('\n');
    };
    expect(input('code_ref')).toMatch(/default: 'develop'/);
    expect(input('dest')).toMatch(new RegExp(`default: '${NEW_DB}'`));
    expect(input('decisions')).toMatch(new RegExp(`default: '${DEC.replace(/\./g, '\\.')}'`));
    expect(input('stage')).toMatch(/'full'/);
    expect(code(w)).not.toMatch(/migration\/model-v2/);
    // Владелица 20.11: «секрет от базы по миграции такой же как и у root обычного не надо плодить» —
    // конвейер берёт root и существующий ARCADEDB_ROOT_PASSWORD, отдельных MIG_DB_* в репо нет.
    expect(code(w)).toMatch(/MIG_DB_USER: root/);
    expect(code(w)).toMatch(/MIG_DB_PASSWORD: \$\{\{ secrets\.ARCADEDB_ROOT_PASSWORD \}\}/);
    expect(code(w)).not.toMatch(/secrets\.MIG_DB_/);
    expect(code(w)).toMatch(/bash \.github\/scripts\/model-migration-run\.sh/);
    expect(existsSync(resolve(repo, DEC))).toBe(true);
  });
});
