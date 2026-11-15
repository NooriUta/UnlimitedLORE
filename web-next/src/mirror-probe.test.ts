// SPRINT_LORE_OWN_HOST/OH-KKREPO-PILOT (CICDGitHub, 15.11.2026): зеркало ci-server
// переезжает с Nexus на kkRepo, адреса репозиториев те же. Проба доступности в
// use-nexus.sh ходила в REST API Nexus (/service/rest/v1/repositories) — у kkRepo
// такого пути нет (404, проверено на :8181), скрипт решил бы «зеркало не отвечает»,
// и сборки молча пошли бы мимо зеркала. Правило: проба — реальный артефакт из
// прокси-репозитория, он есть у любого зеркала с теми же именами репозиториев.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(resolve(__dirname, '..', '..', '.github', 'scripts', 'use-nexus.sh'), 'utf8')
  .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('проба зеркала не зависит от продукта (Nexus или kkRepo)', () => {
  it('не ходит в REST API Nexus', () => {
    expect(script).not.toMatch(/service\/rest\//);
  });
  it('проверяет реальный артефакт из maven-прокси', () => {
    const probe = /^PROBE_ARTIFACT="([^"]+)"/m.exec(script)?.[1] ?? '';
    expect(probe, 'проба — артефакт из MAVEN_MIRROR').toMatch(/^\$\{?MAVEN_MIRROR\}?.+\.pom$/);
    expect(script).toMatch(/if ! curl [^\n]*"\$PROBE_ARTIFACT"/);
  });
});
