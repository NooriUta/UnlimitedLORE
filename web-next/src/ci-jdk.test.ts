// JDK в Backend CI = версия компиляции бэкенда (апгрейд 28.11.2026, слово владелицы «мажоры поднимай до LTS»).
// С 28.11 в образе раннера forgejo-ci-runtime лежат ДВА JDK (21 и 25). Прежний шаг брал первую найденную
// `java` под /opt (`head -1`): при двух JDK выбор зависит от порядка обхода каталога, и компиляция под 25
// краснела бы на 21 через раз. Шаг выбирает JDK по мажору из build.gradle; github-hosted — тот же мажор.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

const target = () => {
  const m = read('backend/build.gradle').match(/targetCompatibility = JavaVersion\.VERSION_(\d+)/);
  expect(m, 'build.gradle: targetCompatibility').not.toBeNull();
  return m![1];
};

describe('Backend CI: JDK совпадает с версией компиляции', () => {
  it('компиляция — 25 LTS (рантайм-образ уже eclipse-temurin:25)', () => {
    expect(target()).toBe('25');
    expect(read('backend/build.gradle')).toMatch(/sourceCompatibility = JavaVersion\.VERSION_25/);
  });

  it('self-hosted: JDK выбирается по мажору, а не первым попавшимся', () => {
    const ci = read('.github/workflows/backend-ci.yml');
    const step = ci.slice(ci.indexOf('Use runner-image JDK'), ci.indexOf('Gradle retry selftest'));
    // прежний шаг: первая попавшаяся java под /opt — при двух JDK выбор случаен
    expect(step).not.toMatch(/find \/opt/);
    expect(step).toContain(`JDK_MAJOR: '${target()}'`);
    // 25 лежит в /usr/lib/jvm/temurin-25 (CICD 28.11), прежние мажоры — в /opt/acttoolcache
    expect(step).toMatch(/\/usr\/lib\/jvm\/temurin-\$\{JDK_MAJOR\}\/bin\/java/);
    // PR #1922: шаг идёт под bash -eo pipefail, а ls с отсутствующим путём даёт код 2 — поиск обязан это глотать
    expect(step).toMatch(/head -1 \|\| true\)"/);
  });

  it('github-hosted: setup-java той же версии', () => {
    expect(read('.github/workflows/backend-ci.yml')).toMatch(new RegExp(`java-version: '${target()}'`));
  });
});
