// Отчёт переноса — в каталог раздела админки препрода (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02).
//
// Корень «прогона не было» на стенде (MA2/MA3/MA7 смоука 21.11.2026): у бэкенда препрода не задан
// lore.migration.dir (ни переменной, ни тома — docker inspect lore-preprod-lore-backend-1), а workflow переноса
// кладёт отчёт только артефактом. Правка: том lore-preprod-migration смонтирован в бэкенд как /migration и задан
// каталогом; workflow после этапа full делает сухой прогон и публикует dry-run.json и transfer.json (второй прогон)
// в этот том. Файл решений стенда (decisions.json, журнал) не трогается.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const fwd = (p: string) => p.replace(/\\/g, '/');
const bashBin = process.platform === 'win32' ? ['C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p)) : 'bash';

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));
function dir(prefix: string) { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; }

const S = '.github/scripts/migration-report-publish.sh';
const VOLUME = 'lore-preprod-migration';

/** docker-заглушка: пишет вызовы в $CALLS. */
function publish(env: Record<string, string>, files: string[] = ['dry-run.json', 'run1-transfer.json', 'run2-transfer.json']) {
  const d = dir('lore-mig-pub-');
  const calls = join(d, 'calls.log');
  writeFileSync(calls, '');
  writeFileSync(join(d, 'docker'), '#!/usr/bin/env bash\necho "$*" >> "$CALLS"\nexit 0\n');
  chmodSync(join(d, 'docker'), 0o755);
  const report = join(d, 'report');
  mkdirSync(report);
  for (const f of files) writeFileSync(join(report, f), '{}');
  const r = spawnSync(bashBin!, [fwd(resolve(repo, S))], {
    encoding: 'utf8', cwd: repo,
    env: { ...process.env, MIG_REPORT_DIR: fwd(report), MIG_DST_DB: 'migration_dst_preprod', CALLS: fwd(calls), ...env,
      PATH: `${d}${delimiter}${process.env.PATH ?? ''}` },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean) };
}

describe.skipIf(!bashBin)('MIG-02: отчёт переноса публикуется в каталог админки препрода', { timeout: 30_000 }, () => {
  it('копирует dry-run.json и transfer.json (второй прогон) в том препрода; decisions.json не трогает', () => {
    const r = publish({});
    expect(r.code, r.out).toBe(0);
    const all = r.calls.join('\n');
    expect(all).toMatch(new RegExp(`-v ${VOLUME}:/migration`));
    expect(all).toMatch(/cp .*dry-run\.json .*:\/migration\/dry-run\.json/);
    expect(all).toMatch(/cp .*run2-transfer\.json .*:\/migration\/transfer\.json/);
    expect(all).not.toMatch(/decisions/);
    expect(r.calls.some((c) => /^rm -f /.test(c))).toBe(true); // вспомогательный контейнер убран
  });

  it('приёмник не препрода — ничего не публикует', () => {
    const r = publish({ MIG_DST_DB: 'migration_dst_ryzen' });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.out).toMatch(/не публикую/);
  });

  it('нет dry-run.json — красный: без него админка скажет «прогона не было»', () => {
    const r = publish({}, ['run2-transfer.json']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/dry-run\.json/);
    expect(r.calls).toEqual([]);
  });

  it('compose препрода: бэкенду задан каталог переноса и смонтирован тот же том', () => {
    const c = code(read('docker-compose.preprod.yml'));
    expect(c).toMatch(/lore\.migration\.dir=\/migration/);
    expect(c).toMatch(new RegExp(`${VOLUME}:/migration`));
    expect(c).toMatch(new RegExp(`name: ${VOLUME}`));
  });

  it('workflow: после этапа full — сухой прогон и публикация, только для приёмника препрода', () => {
    const w = code(read('.github/workflows/lore-migration-snapshot.yml'));
    expect(w).toMatch(/STAGE: dry-run/);
    expect(w).toMatch(/bash \.github\/scripts\/migration-report-publish\.sh/);
    expect(w).toMatch(/inputs\.stage == 'full' && inputs\.dest == 'migration_dst_preprod'/);
  });
});
