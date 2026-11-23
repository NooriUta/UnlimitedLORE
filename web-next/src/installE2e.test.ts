// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · труба установщика: «пустая машина → пакет из kkRepo → установка → перенос →
// сверка → проба». Владелица 21.11.2026: «давай сделаем трубу, которая будет тестировать установку с нуля и миграцию»;
// «отдельную у инсталлера на основе наших наработок» — каркас свой, шаги переиспользуются:
//   пакет — lore-installer-publish.yml (kkRepo, SHA256SUMS); установка — deploy/install/install.sh из архива исходников
//   пакета; перенос и отпечатки — .github/scripts/model-migration-run.sh (STAGE=full, как lore-migration-snapshot.yml).
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const fwd = (p: string) => p.replace(/\\/g, '/');
const TIMEOUT = 60_000;
const bashBin = process.platform === 'win32' ? ['C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p)) : 'bash';

const tmp: string[] = [];
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });
const dir = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
function exe(d: string, name: string, body: string) { writeFileSync(join(d, name), body); chmodSync(join(d, name), 0o755); }
function run(script: string, env: Record<string, string>, binDir: string, args: string[] = []) {
  const r = spawnSync(bashBin!, [fwd(resolve(repo, script)), ...args], {
    encoding: 'utf8', cwd: repo,
    env: { ...process.env, ...env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const E2E = '.github/scripts/lore-install-e2e.sh';
const MIG = '.github/scripts/model-migration-run.sh';
const WF = '.github/workflows/lore-install-e2e.yml';

/** Поддельный каталог версии в kkRepo: файлы и SHA256SUMS; `bad` — подменить файл после подсчёта сумм. */
function fakeRepo(version: string, bad = false) {
  const root = dir('kkrepo-');
  const vdir = join(root, 'lore-installer', version);
  mkdirSync(join(vdir, 'src'), { recursive: true });
  const files: [string, string][] = [[`lore-migrate-${version}-linux-x64`, 'бинарь'], [`lore-migrate-${version}.mjs`, 'модуль'], [`src/lore-${version}.tar.gz`, 'архив']];
  let sums = '';
  for (const [n, body] of files) {
    writeFileSync(join(vdir, n), body);
    sums += createHash('sha256').update(body).digest('hex') + '  ' + n + '\n';
  }
  writeFileSync(join(vdir, 'SHA256SUMS'), sums);
  if (bad) writeFileSync(join(vdir, `lore-migrate-${version}-linux-x64`), 'подмена');
  return 'file://' + fwd(root).replace(/^([A-Za-z]):/, '/$1:');
}

describe.skipIf(!bashBin)('MIG-04 · труба установщика: каркас', { timeout: TIMEOUT }, () => {
  it('без версии пакета — отказ словами, ничего не делалось', () => {
    const r = run(E2E, { E2E_VERSION: '' }, dir('e2e-'), ['fetch']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/E2E_VERSION/);
  });

  it('пакет скачан и каждый файл сверен с SHA256SUMS', () => {
    const work = dir('e2e-work-');
    const r = run(E2E, { E2E_VERSION: '1.18.0-rc.abcdef12', KKREPO_BASE: fakeRepo('1.18.0-rc.abcdef12'), E2E_WORK: fwd(work) }, dir('e2e-'), ['fetch']);
    expect(r.out).toMatch(/SHA256SUMS сошлись, файлов сверено: 3/);
    expect(r.code).toBe(0);
    expect(existsSync(join(work, 'pkg', 'src', 'lore-1.18.0-rc.abcdef12.tar.gz'))).toBe(true);
  });

  it('файл подменён — красный, установки не будет', () => {
    const r = run(E2E, { E2E_VERSION: '1.18.0-rc.abcdef12', KKREPO_BASE: fakeRepo('1.18.0-rc.abcdef12', true), E2E_WORK: fwd(dir('e2e-work-')) }, dir('e2e-'), ['fetch']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/SHA256SUMS не сошлись/);
  });

  // SPEC-LORE-INSTALLER-PIPELINE, «Готово, когда»: намеренно сломанный пакет (неверный SHA256) — красная труба с причиной.
  it('намеренная порча (E2E_SABOTAGE=sha256) — красный с причиной, на целом пакете', () => {
    const r = run(E2E, { E2E_VERSION: '1.18.0-rc.abcdef12', KKREPO_BASE: fakeRepo('1.18.0-rc.abcdef12'), E2E_WORK: fwd(dir('e2e-work-')), E2E_SABOTAGE: 'sha256' }, dir('e2e-'), ['fetch']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/порча[\s\S]*SHA256SUMS не сошлись/);
  });

  it('приёмник переноса — только migration_dst*: рабочая база красная до любых действий', () => {
    const r = run(E2E, { E2E_VERSION: '1.18.0-rc.abcdef12', E2E_DST_DB: 'system_aida_lore' }, dir('e2e-'), ['plan']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/migration_dst/);
  });

  it('план называет, откуда каждый шаг: свой только каркас', () => {
    const r = run(E2E, { E2E_VERSION: '1.18.0-rc.abcdef12', MIG_SRC_DB: 'migration_src_2026_11_20' }, dir('e2e-'), ['plan']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/fetch .*lore-installer-publish\.yml/);
    expect(r.out).toMatch(/install .*install-bundle.*install\.sh --selftest.*install\.sh --build-from-source/);
    expect(r.out).toMatch(/migrate .*model-migration-run\.sh STAGE=full/);
    expect(r.out).toMatch(/probe .*\/lore\/version.*open_tasks.*organizations.*repositories/);
    expect(r.out).toMatch(/probe .*версия пакета.*seed_drift/);
    // Владелица 21.11: «ок и шагом» · «в инсталляции» — дотяжка данных PR из git-хоста. С 1.18.2 шаг РАБОЧИЙ
    // (команда pr-backfill, #1730): в трубе идёт пробным прогоном и ничего не пишет.
    expect(r.out).toMatch(/pr-data .*pr-backfill --dry-run/);
    expect(r.out).not.toMatch(/pr-data .*не реализован/);
    // Решение владелицы 21.11: «пока ставь указать s3 хранилище или без опции файлов» — сценарий А идёт без файлов.
    expect(r.out).toMatch(/install .*--files none/);
    expect(r.out).toMatch(/probe .*хранилище файлов не подключено/);
    // MIG-01: свежая установка — база из модели: schema_version модели, срезы типов 1.18 — 200 и пусто.
    expect(r.out).toMatch(/probe .*schema_version — модель/);
    expect(r.out).toMatch(/probe .*organizations, repositories, project_prs — 200 и пусто/);
  });

  // Эмуляция на ryzenai 21.11: имя проекта переменной окружения расходилось с .env — compose поднимал lore-e2e,
  // а помощники install.sh (dcurl, сеть <проект>_default) ходили в lore_default. Имя кладётся в .env до install.sh.
  it('имя проекта compose — в .env установки до install.sh, не переменной окружения', () => {
    const s = code(read(E2E));
    expect(s).toMatch(/COMPOSE_PROJECT_NAME=/);
    expect(s).toMatch(/env -u COMPOSE_PROJECT_NAME/);
  });

  it('сам перенос не написан заново — вызывается model-migration-run.sh с бинарём пакета', () => {
    const s = code(read(E2E));
    expect(s).toMatch(/model-migration-run\.sh/);
    expect(s).toMatch(/MIG_CLI=/);
    expect(s).not.toMatch(/dst-fingerprint/); // сверку отпечатков делает переиспользуемый скрипт
    expect(s).toMatch(/install-bundle --out/);
    expect(s).toMatch(/--files none/);
    // ryzenai 21.11: на базе из модели бэкенд отказывает старт при lore.migrate=true — переключение ставит false.
    expect(s).toMatch(/LORE_MIGRATE=false/);
    expect(s).toMatch(/LORE_MIGRATE_BIN=/);
    expect(s).toMatch(/"schema_version":"model:/);
    expect(s).toMatch(/FILES_NOT_CONFIGURED/);
    // ryzenai 21.11: ArcadeDB, пересозданная с портом, ещё не отвечала — connect получил ECONNRESET.
    expect(s).toMatch(/\/api\/v1\/ready/);
    expect(s).toMatch(/install\.sh" --selftest/);
  });

  // MIG-04, прогон на ryzenai 22.11: шаг «Дотянуть данные PR» был заглушкой «ещё не реализован», хотя команда
  // pr-backfill появилась в 1.18.2 (#1730). Теперь шаг рабочий: пробный прогон, мост не настроен — пропуск
  // с причиной (у чужой установки токена git-хоста может не быть вовсе), любой другой отказ — красный.
  it('pr-data: пробный прогон дотяжки; «мост не настроен» — пропуск, иной отказ — падение', () => {
    const s = code(read(E2E));
    expect(s).toMatch(/pr-backfill --url .* --dry-run/);
    expect(s).toMatch(/FORGEJO_NOT_CONFIGURED/);
    expect(s).not.toMatch(/ещё не реализован/);
    // Пробный прогон не пишет в базу: у КОМАНДЫ (а не у имени файла отчёта) всегда есть --dry-run.
    expect(s).not.toMatch(/"\$BIN" pr-backfill(?!.*--dry-run)/);
  });
});

describe.skipIf(!bashBin)('MIG-04 · перенос в приёмник на другом сервере (чужая установка)', { timeout: TIMEOUT }, () => {
  it('MIG_DST_URL и учётка приёмника — в файле доступа; пароль не печатается', () => {
    const d = dir('mig-dst-');
    const calls = join(d, 'calls.log');
    writeFileSync(calls, '');
    exe(d, 'node', [
      '#!/usr/bin/env bash',
      'env_file=""; prev=""; for a in "$@"; do [ "$prev" = "--env" ] && env_file="$a"; prev="$a"; done',
      'echo "$2 $(grep -E \'^MIG_(DB_URL|DST_URL|DST_USER|SRC_USER)=\' "$env_file" | tr \'\\n\' \' \')" >> "$CALLS"',
      'case "$*" in *dst-fingerprint*) echo "отпечаток содержимого: aaaa" ;; esac', 'exit 0', '',
    ].join('\n'));
    const r = run(MIG, {
      MIG_SRC_DB: 'migration_src_2026_11_20', MIG_DST_DB: 'migration_dst_install', STAGE: 'full',
      MIG_DB_URL: 'http://192.168.3.131:2480', MIG_DB_USER: 'src-user', MIG_DB_PASSWORD: 'SRC-SECRET',
      MIG_DST_URL: 'http://127.0.0.1:2491', MIG_DST_USER: 'root', MIG_DST_PASSWORD: 'DST-SECRET',
      MIG_REPORT_DIR: fwd(join(d, 'rep')), CALLS: fwd(calls),
    }, d);
    expect(r.code).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).toMatch(/MIG_DST_URL=http:\/\/127\.0\.0\.1:2491/);
    expect(log).toMatch(/MIG_DST_USER=root/);
    expect(log).toMatch(/MIG_SRC_USER=src-user/);
    expect(r.out).not.toMatch(/SRC-SECRET|DST-SECRET/);
  });
});

describe('MIG-04 · workflow трубы', () => {
  it('ручной запуск и тег rc; логика — в скрипте, пакет — из kkRepo', () => {
    const w = read(WF);
    expect(w).toMatch(/workflow_dispatch:/);
    expect(w).toMatch(/sabotage:/);
    expect(w).toMatch(/tags:\s*\n\s*- 'v\*-rc\*'/);
    expect(code(w)).toMatch(/bash \.github\/scripts\/lore-install-e2e\.sh/);
    expect(code(w)).toMatch(/ci-teardown\.sh/);
    // Секреты — только существующие: root ArcadeDB ci-server (источник). Своих секретов труба не заводит.
    const secrets = [...w.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(secrets)].sort()).toEqual(['ARCADEDB_ROOT_PASSWORD']);
  });
});
