import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SPRINT_LORE_PIPELINE_HOST/PL-12 (08.11.2026). Первый прогон CD препрода (run 3989)
// упал на `./gradlew --version` в образе бэкенда: дистрибутив Gradle (140 МБ)
// wrapper качал напрямую services.gradle.org → GitHub, а канал до GitHub рваный
// (с хоста 131 — 200 за 50 с, из контейнера — 502/503). Зеркала Nexus покрывали
// только зависимости. Теперь и дистрибутив идёт через Nexus, с откатом напрямую.
const repo = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

describe('PL-12: дистрибутив Gradle в образе бэкенда — через Nexus', () => {
  it('Dockerfile.local: build-arg зеркала подменяет distributionUrl ДО ./gradlew --version', () => {
    const d = read('backend/Dockerfile.local');
    expect(d).toMatch(/^ARG LORE_GRADLE_DIST_MIRROR=""$/m);
    const argAt = d.indexOf('ARG LORE_GRADLE_DIST_MIRROR');
    const sedAt = d.search(/sed -i "s#\^distributionUrl=/);
    const verAt = d.indexOf('./gradlew --no-daemon --version');
    expect(sedAt).toBeGreaterThan(argAt);
    expect(verAt).toBeGreaterThan(sedAt);
    // без зеркала — как раньше: подмена только под if -n
    expect(d).toMatch(/if \[ -n "\$LORE_GRADLE_DIST_MIRROR" \]/);
  });

  it('compose прокидывает зеркало в build-args бэкенда', () => {
    expect(read('docker-compose.yml')).toMatch(/LORE_GRADLE_DIST_MIRROR: \$\{LORE_GRADLE_DIST_MIRROR:-\}/);
  });

  it('CD задаёт адрес gradle-dist-proxy в Nexus', () => {
    expect(read('.github/workflows/lore-cd.yml')).toMatch(
      /LORE_GRADLE_DIST_MIRROR: http:\/\/192\.168\.3\.131:8081\/repository\/gradle-dist-proxy\//,
    );
  });

  it('повтор сборки: мёртвое зеркало снимается до сборки, неудача — откат напрямую', () => {
    const s = read('.github/scripts/compose-build-retry.sh');
    expect(s).toMatch(/зеркало дистрибутива Gradle .* не отвечает/);
    expect(s).toMatch(/export LORE_GRADLE_DIST_MIRROR=""/);
  });
});
