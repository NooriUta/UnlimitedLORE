import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SPRINT_LORE_PIPELINE_HOST/PL-04 (08.11.2026): CD препрода (run 4011) упал на
// `docker compose up minio-init` — образа minio/mc больше нет ни на Docker Hub
// (latest и RELEASE-теги: not found), ни на Quay (401). Клиент mc лежит внутри
// образа сервера (/usr/bin/mc) — его и использует minio-init.
//
// 27.11.2026 (D-2026-S3-MINIO-TO-SILO, владелица: «разворачивай замену Minio»): сервер S3 —
// Silo (pgsty/silo) на закреплённом теге, тот же формат данных, замена образа на месте.
// minio/minio:latest больше не ставим: плавающий тег, и Docker Hub его уже не отдаёт стабильно.
const repo = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8');
const SILO = 'pgsty/silo:RELEASE.2026-11-12T00-00-00Z';
const imageOf = (c: string, svc: string) =>
  c.match(new RegExp(String.raw`\n  ${svc}:\n(?:\s+#.*\n)*\s+image: (\S+)`))?.[1];

describe('S3 препрода: Silo на закреплённом теге, без исчезнувших образов', () => {
  it('compose не ссылается на minio/mc и на minio/minio', () => {
    const c = read('docker-compose.yml');
    expect(c).not.toMatch(/image:\s*minio\/mc/);
    expect(c).not.toMatch(/image:\s*minio\/minio/);
  });

  it('minio и minio-init — на одном закреплённом образе Silo', () => {
    const c = read('docker-compose.yml');
    expect(imageOf(c, 'minio')).toBe(SILO);
    expect(imageOf(c, 'minio-init')).toBe(SILO);
  });
});
