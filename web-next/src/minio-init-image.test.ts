import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SPRINT_LORE_PIPELINE_HOST/PL-04 (08.11.2026): CD препрода (run 4011) упал на
// `docker compose up minio-init` — образа minio/mc больше нет ни на Docker Hub
// (latest и RELEASE-теги: not found), ни на Quay (401). Клиент mc той же версии
// лежит внутри minio/minio (/usr/bin/mc) — его и использует minio-init.
const repo = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8');

describe('PL-04: minio-init без исчезнувшего образа minio/mc', () => {
  it('compose не ссылается на minio/mc; minio-init — на образе minio/minio', () => {
    const c = read('docker-compose.yml');
    expect(c).not.toMatch(/image:\s*minio\/mc/);
    expect(c).toMatch(/minio-init:\n(?:\s+#.*\n)*\s+image: minio\/minio:latest/);
  });
});
