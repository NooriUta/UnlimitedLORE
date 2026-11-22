// SPRINT_LORE_PIPELINE_HOST/PL-04 и PL-05 (ADR-LORE-046): труба после переезда
// прода на lore-host.
//
//   * PL-04 — пуш в preprod катит на ci-server ПРЕПРОД: свой compose-проект,
//     свои порты, свои имена, своя база и своё окружение Infisical. Прод
//     (lore.odal, new.lore, :4400 — пересыльщик MCP на прод) препрод не трогает.
//   * PL-05 — тег vX.Y.Z на main катит на lore-host ТОТ ЖЕ образ :sha8, что прошёл
//     препрод: без пересборки, по SSH с закреплённым отпечатком хоста.
//
// Почему тест: CD и релиз бегут только по пушу в preprod и по тегу. Препрод,
// который по ошибке повесил метку на Host(lore.odal) или открыл :4400, или релиз,
// который «пересобрал, раз образа нет», вскрылись бы уже на проде.
//
// Две части: текст workflow/оверлея и поведение скриптов (bash с подменённым
// docker/ssh/git в PATH).
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');
const has = (p: string) => existsSync(resolve(repo, p));

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

/** Шаги job'а: имя → тело без комментариев. */
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

/** Текст без строк-комментариев: проверяем то, что исполняется, а не пояснения. */
const code = (s: string) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const CD = '.github/workflows/lore-cd.yml';
const REL = '.github/workflows/lore-release.yml';
const OVERLAY = 'docker-compose.preprod.yml';
const cd = () => code(read(CD));
const cdSteps = () => steps(job(CD, 'deploy'));

// ── PL-04: препрод ───────────────────────────────────────────────────────────

describe('PL-04: lore-cd.yml катит ПРЕПРОД, а не прод', () => {
  it('отдельный compose-проект lore-preprod и оверлей препрода', () => {
    expect(cd()).toMatch(/^ {6}COMPOSE_PROJECT_NAME: lore-preprod$/m);
    expect(cd()).toMatch(/^ {6}COMPOSE_FILE: docker-compose\.yml:docker-compose\.preprod\.yml$/m);
    // оверлей Traefik прода вешает Host(lore.odal) — в препроде его быть не должно
    expect(cd()).not.toMatch(/docker-compose\.traefik\.yml/);
    expect(cd()).not.toMatch(/COMPOSE_PROJECT_NAME: unlimitedlore\b/);
  });

  it('своя база и своё окружение Infisical', () => {
    expect(cd()).toMatch(/^ {6}LORE_DB: system_aida_lore_preprod$/m);
    expect(cd()).toMatch(/^ {6}LORE_SECRETS_ENVIRONMENT: preprod$/m);
    expect(cd()).not.toMatch(/LORE_SECRETS_ENVIRONMENT: prod\b/);
  });

  it('адреса установки — имена препрода', () => {
    expect(cd()).toMatch(/LORE_PUBLIC_URL: https:\/\/preprod\.lore\.odal\.seidrstudio\.pro$/m);
    // S8-02 (18.11.2026): канонический адрес v2 — основное имя препрода, без new
    expect(cd()).toMatch(/LORE_PUBLIC_URL_V2: https:\/\/preprod\.lore\.odal\.seidrstudio\.pro$/m);
    const cors = /CORS_ORIGINS: (.+)$/m.exec(cd())?.[1] ?? '';
    expect(cors).toContain('https://preprod.lore.odal.seidrstudio.pro');
    expect(cors).toContain('https://preprod.new.lore.odal.seidrstudio.pro');
    expect(cors).not.toMatch(/:4400\b|\/\/lore\.odal|\/\/new\.lore/);
  });

  it('ни один исполняемый шаг не ходит на прод-адреса (lore.odal, new.lore, :4400)', () => {
    // имена прода без префикса preprod. и порт пересыльщика MCP на прод
    expect(cd()).not.toMatch(/(?<!preprod\.)(?<![\w.-])lore\.odal\.seidrstudio\.pro/);
    expect(cd()).not.toMatch(/(?<!preprod\.)new\.lore\.odal\.seidrstudio\.pro/);
    expect(cd()).not.toMatch(/:4400\b/);
  });

  it('шага темы Keycloak в CD препрода нет (тема едет релизом на lore-host)', () => {
    expect(cdSteps().find((s) => /keycloak\/themes/.test(s.body))).toBeUndefined();
    expect(cd()).not.toMatch(/Deploy Keycloak theme/);
  });

  it('образы помечаются :sha8 и меткой revision (для пробы /lore/version)', () => {
    expect(cd()).toMatch(/LORE_IMAGE_TAG=/);
    const pin = cdSteps().find((s) => /preprod-pin-sha\.sh\b/.test(s.body));
    expect(pin, 'нет шага пометки образов препрода :sha8').toBeDefined();
    expect(pin!.body).toMatch(/id: pinned/);
  });

  it('проба /lore/version — по имени препрода и с коммитом из метки образа', () => {
    const s = cdSteps().find((x) => /version-probe\.sh\b/.test(x.body));
    expect(s, 'нет шага version-probe').toBeDefined();
    expect(s!.body).toMatch(/version-probe\.sh https:\/\/preprod\.lore\.odal\.seidrstudio\.pro/);
    expect(s!.body).toMatch(/EXPECT_COMMIT: \$\{\{ steps\.pinned\.outputs\.backend_revision/);
  });

  it('публичная страница v2 и бандлы проверяются на именах препрода', () => {
    expect(cdSteps().find((x) => /post-deploy-probe\.sh v2-page\s+https:\/\/preprod\.new\.lore\.odal\.seidrstudio\.pro/.test(x.body))).toBeDefined();
    // S8-02 (владелица 18.11.2026: «отключить v1 и все перевести на v2», «что бы не писать new», «и на препроде»):
    // основное имя препрода отдаёт v2; имя с new — тоже v2; v1 — только запасной вход по IP :4410.
    const main = cdSteps().find((x) => /bundle-probe\.sh\b.*container:lore-app-next\s+https:\/\/preprod\.lore\.odal\.seidrstudio\.pro/.test(x.body));
    const alias = cdSteps().find((x) => /bundle-probe\.sh\b.*container:lore-app-next\s+https:\/\/preprod\.new\.lore\.odal\.seidrstudio\.pro/.test(x.body));
    const v1 = cdSteps().find((x) => /bundle-probe\.sh\b.*container:lore-app\s+http:\/\/192\.168\.3\.131:4410\//.test(x.body));
    expect(main, 'нет пробы: основное имя препрода отдаёт бандл v2').toBeDefined();
    expect(alias, 'нет пробы: имя с new по-прежнему отдаёт v2').toBeDefined();
    // LORE CD 8968 (18.11.2026): v1 по IP :4410 отвечает 301 на основное имя (его LORE_PUBLIC_URL) — то есть
    // страницы v1 больше нет вовсе, а проба «v1 отдаёт свой бандл» роняла выкатку и отменяла тег образов (PL-05).
    expect(v1, 'v1 выключен — пробы его бандла быть не должно').toBeUndefined();
    expect(cdSteps().find((x) => /bundle-probe\.sh\b.*container:lore-app\s+https:\/\/preprod\.lore/.test(x.body)), 'v1 больше не на основном имени').toBeUndefined();
  });

  it('ворота препрода (база, Infisical preprod) стоят ДО любых сборок', () => {
    const gate = cdSteps().findIndex((s) => /preprod-gates\.sh\b/.test(s.body));
    const build = cdSteps().findIndex((s) => /compose-build-retry\.sh/.test(s.body));
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(build);
  });

  it('нет базы препрода — создаётся из снимка прода (CREATE_ONLY), до сборок', () => {
    const gate = cdSteps().find((s) => /preprod-gates\.sh\b/.test(s.body));
    expect(gate!.body).toMatch(/id: gates/);
    expect(gate!.body).toMatch(/PREPROD_DB_AUTOCREATE: "true"/);
    const i = cdSteps().findIndex((s) => /scripts\/preprod-db-refresh\.sh/.test(s.body));
    expect(i, 'нет шага создания базы из снимка').toBeGreaterThan(-1);
    const s = cdSteps()[i];
    expect(s.body).toMatch(/if: steps\.gates\.outputs\.db_missing == 'true'/);
    expect(s.body).toMatch(/CREATE_ONLY: "true"/);
    expect(s.body).toMatch(/TARGET_DB: \$\{\{ env\.LORE_DB \}\}/);
    expect(i).toBeLessThan(cdSteps().findIndex((x) => /compose-build-retry\.sh/.test(x.body)));
  });

  it('индексы лечатся в базе препрода, а не в system_aida_lore', () => {
    const heal = cdSteps().find((s) => /db-heal\.sh/.test(s.body));
    expect(heal!.body).toMatch(/DB_NAME: \$\{\{ env\.LORE_DB \}\}/);
    expect(heal!.body).not.toMatch(/DB_NAME: system_aida_lore\s*$/m);
  });

  it('dry_run: ввод есть, и ничего меняющего в dry-run не выполняется', () => {
    expect(read(CD)).toMatch(/^ {6}dry_run:$/m);
    const mutating = [
      // MIG-01: `docker compose run` накатки схемы живёт в migrate-schema.sh — шаг, который его зовёт, тоже только live
      /compose-build-retry\.sh/, /docker compose up\b/, /migrate-schema\.sh/,
      /v1-freeze\.sh (pin|repin)\b/, /db-heal\.sh/, /preprod-pin-sha\.sh/, /api\.telegram\.org/,
    ];
    for (const re of mutating) {
      const ss = cdSteps().filter((s) => re.test(s.body));
      expect(ss.length, `нет шага ${re}`).toBeGreaterThan(0);
      for (const s of ss) expect(s.body, `шаг «${s.name}» не под live`).toMatch(/steps\.mode\.outputs\.live == 'true'/);
    }
  });
});

describe('PL-04: оверлей docker-compose.preprod.yml', () => {
  const ov = () => (has(OVERLAY) ? code(read(OVERLAY)) : '');

  it('порты препрода: 4410/4412/9110/19000/19001 через !override', () => {
    expect(ov()).toMatch(/"4410:80"/);
    expect(ov()).toMatch(/"4412:80"/);
    expect(ov()).toMatch(/"127\.0\.0\.1:9110:9100"/);
    expect(ov()).toMatch(/"19000:9000"/);
    expect(ov()).toMatch(/"127\.0\.0\.1:19001:9001"/);
    expect((ov().match(/ports: !override/g) ?? []).length).toBe(4);
    expect(ov()).not.toMatch(/"4400:|:9100:9100"|"9000:9000"|"4402:/);
  });

  it('метки Traefik — только Host препрода, резолвер regru, свои имена роутеров', () => {
    expect(ov()).toMatch(/Host\(`preprod\.lore\.odal\.seidrstudio\.pro`\)/);
    expect(ov()).toMatch(/Host\(`preprod\.new\.lore\.odal\.seidrstudio\.pro`\)/);
    expect(ov()).not.toMatch(/Host\(`lore\.odal|Host\(`new\.lore/);
    const resolvers = ov().match(/tls\.certresolver: regru/g) ?? [];
    expect(resolvers.length).toBeGreaterThanOrEqual(2);
    for (const m of ov().matchAll(/traefik\.http\.routers\.([\w-]+)\./g)) expect(m[1]).toMatch(/^lore-preprod/);
  });

  it('S8-02: основное имя препрода — роутер v2 (и старое имя с new); у v1 роутера Traefik нет', () => {
    const next = ov().match(/traefik\.http\.routers\.lore-preprod-next\.rule: (.+)/);
    expect(next && next[1]).toMatch(/Host\(`preprod\.lore\.odal\.seidrstudio\.pro`\)/);
    expect(next && next[1]).toMatch(/Host\(`preprod\.new\.lore\.odal\.seidrstudio\.pro`\)/);
    expect(ov()).not.toMatch(/traefik\.http\.routers\.lore-preprod\.rule/);
  });

  it('база задаётся LORE_DB (lore.db) и без неё compose не соберётся', () => {
    expect(ov()).toMatch(/- lore\.db=\$\{LORE_DB:\?/);
  });

  it('образы именуются как на проде, тег :sha8, метка revision', () => {
    for (const svc of ['lore-backend', 'lore-app', 'lore-app-next', 'lore-mcp']) {
      expect(ov()).toMatch(new RegExp(`image: unlimitedlore-${svc}:\\$\\{LORE_IMAGE_TAG:\\?`));
    }
    expect((ov().match(/org\.opencontainers\.image\.revision: \$\{LORE_BUILD_COMMIT/g) ?? []).length).toBe(4);
  });

  it('базовый compose не тронут: v1 по-прежнему "4400:80"', () => {
    expect(read('docker-compose.yml')).toMatch(/- "4400:80"/);
  });
});

// ── S4-30: коммит фронта доезжает в бандл ────────────────────────────────────

describe('S4-30: фронт v2 знает, из какого коммита собран', () => {
  // Метка версии в правом нижнем углу (просьба владелицы 09.11) показывает ОДНУ
  // версию только когда сервер и фронт собраны из одного коммита. Сверять не с
  // чем, если отметки у фронта нет: метка тогда честно говорит «сервер …», и
  // главный вопрос — доехала ли выкатка целиком — остаётся без ответа.
  //
  // Переменная берётся та же, что уже есть у бэкенда (LORE_BUILD_COMMIT в
  // lore-cd.yml), поэтому workflow не правится: отметка просто доводится до
  // сборки фронта. Vite впекает import.meta.env в бандл, значит это build-arg,
  // а не переменная контейнера — иначе значение не попадёт в код вовсе.
  const compose = () => code(read('docker-compose.yml'));
  const dockerfile = () => code(read('web-next/Dockerfile'));

  it('build-arg у lore-app-next берёт существующий LORE_BUILD_COMMIT', () => {
    expect(compose()).toMatch(/VITE_LORE_BUILD_COMMIT:\s*\$\{LORE_BUILD_COMMIT:-\}/);
  });

  it('Dockerfile принимает его и кладёт в окружение сборки — иначе Vite его не увидит', () => {
    expect(dockerfile()).toMatch(/ARG VITE_LORE_BUILD_COMMIT/);
    expect(dockerfile()).toMatch(/ENV[\s\S]{0,200}VITE_LORE_BUILD_COMMIT=\$VITE_LORE_BUILD_COMMIT/);
  });

  it('CD уже знает этот коммит — новой переменной в workflow не нужно', () => {
    expect(read('.github/workflows/lore-cd.yml')).toMatch(/LORE_BUILD_COMMIT:\s*\$\{\{\s*github\.sha\s*\}\}/);
  });
});

// ── PL-05: прод по тегу ──────────────────────────────────────────────────────

describe('PL-05: lore-release.yml катит прод на lore-host', () => {
  const rel = () => code(read(REL));
  const dep = () => job(REL, 'deploy-prod');
  const depSteps = () => steps(dep());
  const idx = (re: RegExp) => depSteps().findIndex((s) => re.test(s.body));

  it('прежние шаги релиза на месте (Publish, зеркало, Telegram, RELEASE-<tag>.md)', () => {
    const pub = job(REL, 'publish');
    expect(pub).toMatch(/- name: Publish$/m);
    expect(pub).toMatch(/- name: Mirror main \+ tag to GitHub$/m);
    expect(pub).toMatch(/- name: Notify release$/m);
    expect(pub).toMatch(/RELEASE-\$\{TAG\}\.md/);
  });

  it('dry_run и явный deploy на ручном запуске; dry-run не публикует релиз', () => {
    expect(read(REL)).toMatch(/^ {6}dry_run:$/m);
    expect(read(REL)).toMatch(/^ {6}deploy:$/m);
    expect(job(REL, 'publish')).toMatch(/^ {4}if: .*inputs\.dry_run != 'true'/m);
    expect(dep()).toMatch(/^ {4}if: .*github\.event_name == 'push'/m);
  });

  // 1.18 (владелица 21.11: «старую базу бэкап, а новую под неё … а то нам и на проде придётся новые имена делать»).
  it('замена базы прода базой переноса — после compose, до db; источник из поля или переменной', () => {
    const sw = idx(/lore-host-deploy\.sh dbswap/);
    expect(sw).toBeGreaterThan(idx(/lore-host-deploy\.sh compose/));
    expect(sw).toBeLessThan(idx(/lore-host-deploy\.sh db$/m));
    expect(depSteps()[sw].body).toMatch(/SWAP_FROM: \$\{\{ inputs\.swap_from \|\| vars\.LORE_PROD_SWAP_FROM \}\}/);
    expect(read(REL)).toMatch(/^ {6}swap_from:$/m);
  });

  it('ключ CD из секрета и отпечаток хоста закреплён', () => {
    expect(rel()).toMatch(/LORE_HOST_SSH_KEY: \$\{\{ secrets\.LORE_HOST_SSH_KEY \}\}/);
    expect(rel()).toMatch(/LORE_HOST_FP: SHA256:dp7oLAGQkIQ\+fcFOuwqhnqoLOB0VkWom2ibmuzDG6YA/);
  });

  it('образы ищутся готовыми (прошли препрод), сборки в релизе нет', () => {
    expect(idx(/lore-host-deploy\.sh resolve\b/)).toBeGreaterThan(-1);
    expect(dep()).not.toMatch(/compose-build-retry|docker (compose )?build\b/);
  });

  it('порядок: resolve → ssh → ship → бэкап compose/замена → база → up → тема → пробы', () => {
    const order = ['resolve', 'ssh', 'ship', 'compose', 'db', 'up', 'theme', 'probe']
      .map((m) => idx(new RegExp(`lore-host-deploy\\.sh ${m}\\b`)));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('меняющие шаги не выполняются в dry-run', () => {
    for (const m of ['ship', 'compose', 'db', 'up', 'theme', 'probe']) {
      const s = depSteps().find((x) => new RegExp(`lore-host-deploy\\.sh ${m}\\b`).test(x.body));
      expect(s!.body, `шаг ${m} не под live`).toMatch(/steps\.mode\.outputs\.live == 'true'/);
    }
  });

  it('откат описан в шапке workflow', () => {
    const head = read(REL).split('\non:')[0];
    expect(head).toMatch(/ОТКАТ/);
    expect(head).toMatch(/docker-compose\.yml\.bak-/);
  });
});

describe('PL-04: снимок прода → база препрода (только ручной запуск с подтверждением)', () => {
  const W = '.github/workflows/lore-preprod-db-refresh.yml';
  const w = () => (has(W) ? code(read(W)) : '');

  it('только workflow_dispatch, подтверждение именем базы, dry-run по умолчанию', () => {
    expect(w()).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(w()).not.toMatch(/^ {2}(push|schedule|pull_request):/m);
    expect(w()).toMatch(/if \[ "\$CONFIRM" != "\$TARGET_DB" \]/);
    expect(w()).toMatch(/dry_run:[\s\S]*?default: 'true'/);
    expect(w()).toMatch(/scripts\/preprod-db-refresh\.sh/);
  });

  it('тот же замок, что у CD препрода: не заливать базу посреди выкатки', () => {
    expect(w()).toMatch(/group: lore-cd-preprod/);
    expect(cd()).toMatch(/group: lore-cd-preprod/);
  });

  it('скрипт распаковывает архив (restore по file:// запрещён) и хранит прежнюю базу', () => {
    const s = code(read('scripts/preprod-db-refresh.sh'));
    expect(s).toMatch(/unzip -q/);
    expect(s).not.toMatch(/restore database/i);
    expect(s).toMatch(/_bak_\$TS/);
    expect(s).not.toMatch(/drop database/i);
  });

  // 08.11, первый реальный прогон (run 3973): `docker cp` кладёт архив от root, а
  // LORE-ygg работает под arcadedb — `rm /tmp/snap.zip` внутри set -e ронял уже
  // УДАВШУЮСЯ распаковку, а сообщение врало про «прежнюю базу», которой не было.
  it('архив в контейнере убирается от root и не роняет распаковку; сообщение — по факту', () => {
    const s = code(read('scripts/preprod-db-refresh.sh'));
    const unzipLine = s.split('\n').find((l) => /unzip -q/.test(l)) ?? '';
    expect(unzipLine).not.toMatch(/rm -f/);
    expect(s).toMatch(/docker exec -u 0 "\$LOCAL_YGG" rm -f \/tmp\/snap\.zip/);
    expect(s).not.toMatch(/die "распаковка не удалась — прежняя база лежит как/);
    // остаток прерванной заливки (каталог без открытой базы) считается «есть» → в _bak
    expect(s).toMatch(/docker exec "\$LOCAL_YGG" test -d "\$DB_DIR\/\$TARGET_DB"/);
  });

  // 1.18 (владелица 21.11): «просто старую базу бэкап, а новую под неё … а то нам и на проде придётся
  // новые имена делать». Имя базы препрода в CD не меняется; база переноса встаёт под него.
  it('режим local_source: база переноса под прежнее имя, прежняя в _bak, LORE_DB в CD не меняется', () => {
    expect(w()).toMatch(/local_source:[\s\S]*?default: ''/);
    expect(w()).toMatch(/LOCAL_SOURCE: \$\{\{ inputs\.local_source \}\}/);
    expect(w()).toMatch(/if: inputs\.local_source == ''/); // ssh до прода в этом режиме не нужен
    const s = code(read('scripts/preprod-db-refresh.sh'));
    expect(s).toMatch(/migration_dst\*\) ;;/);
    expect(s).toMatch(/mv "\$DB_DIR\/\$LOCAL_SOURCE" "\$DB_DIR\/\$TARGET_DB"/);
    expect(s).toMatch(/FROM LoreModelSchema/);
    expect(cd()).toMatch(/^ {6}LORE_DB: system_aida_lore_preprod$/m);
  });
});

// D-2026-KC-PREPROD-REALM-DUPLICATES (14.11.2026): препрод входит через свои realm'ы-дубли
// в том же KC, прод — через исходные. Токен прода в препрод не проходит (ключи свои).
describe('препрод на realm omilorePreprod, прод на omilore', () => {
  const ISS_PRE = 'https://odal.seidrstudio.pro/kc/realms/omilorePreprod';
  const ISS_PROD = 'https://odal.seidrstudio.pro/kc/realms/omilore';

  it('lore-cd.yml (препрод): issuer бэкенда и веба — omilorePreprod, KC-мост — тот же realm', () => {
    expect(cd()).toMatch(new RegExp(`LORE_OIDC_ISSUER: ${ISS_PRE.replace(/[./]/g, '\\$&')}\\s*$`, 'm'));
    expect(cd()).toMatch(new RegExp(`VITE_OIDC_ISSUER: ${ISS_PRE.replace(/[./]/g, '\\$&')}\\s*$`, 'm'));
    expect(cd()).toMatch(/^\s+KC_ADMIN_REALM: omilorePreprod\s*$/m);
    expect(cd()).not.toMatch(/realms\/omilore\s*$/m);
  });

  it('lore-release.yml (прод) остаётся на omilore — препродный realm туда не протёк', () => {
    const rel = code(read(REL));
    expect(rel).not.toMatch(/omilorePreprod/);
    if (/realms\//.test(rel)) expect(rel).toMatch(new RegExp(ISS_PROD.replace(/[./]/g, '\\$&')));
  });
});

// PL-03: пустая база версии N выкладывается артефактом CI — не руками на ci-server.
describe('PL-03: шаблон пустой базы lore-schema-vN.zip — артефакт CI', () => {
  const W = '.github/workflows/lore-empty-db-template.yml';
  const w = () => (has(W) ? code(read(W)) : '');
  const st = () => steps(job(W, 'template'));

  it('запуск: push в develop при правке схемы и вручную; не на каждый PR', () => {
    expect(w()).toMatch(/^on:\n {2}push:\n {4}branches: \[ "develop" \]/m);
    expect(w()).toMatch(/LoreSchemaMigrations\.java/);
    expect(w()).toMatch(/LoreSchemaInitializer\.java/);
    expect(w()).toMatch(/^ {2}workflow_dispatch:/m);
    expect(w()).not.toMatch(/^ {2}pull_request:/m);
  });

  it('собирает, ПРОВЕРЯЕТ развёртыванием и только потом выкладывает', () => {
    const names = st().map((s) => s.body);
    const iBuild = names.findIndex((b) => /deploy-empty-db\.sh build/.test(b));
    const iVerify = names.findIndex((b) => /deploy-empty-db\.sh verify/.test(b));
    const iUp = names.findIndex((b) => /upload-artifact@v3/.test(b));
    expect(iBuild).toBeGreaterThan(-1);
    expect(iVerify).toBeGreaterThan(iBuild);
    expect(iUp).toBeGreaterThan(iVerify);
    // выкладка — без if: always(): непроверенный архив артефактом не уезжает
    expect(names[iUp]).not.toMatch(/if: always\(\)/);
  });

  it('контейнеры своего прогона убираются всегда (OH-17)', () => {
    const t = st().find((s) => /ci-teardown\.sh "\$\{\{ github\.run_id \}\}"/.test(s.body));
    expect(t?.body).toMatch(/if: always\(\)/);
  });

  it('брошенное отменёнными прогонами снимается в начале прогона (OH-17, отмена не выполняет always())', () => {
    const all = st();
    const sweep = all.findIndex((s) => /ci-teardown\.sh --stale \d+/.test(s.body));
    const own = all.findIndex((s) => /ci-teardown\.sh "\$\{\{ github\.run_id \}\}"/.test(s.body));
    expect(sweep, 'шага уборки брошенного нет').toBeGreaterThanOrEqual(0);
    expect(sweep, 'уборка брошенного — до работы прогона, а не в конце').toBeLessThan(own);
    expect(all[sweep].body, 'уборка брошенного не валит прогон').toMatch(/continue-on-error: true/);
  });
});

// ── поведение скриптов ───────────────────────────────────────────────────────
// PL-11: потолок для тестов с реальными git/bash (см. охранный тест в конце файла).
const SPAWN_TIMEOUT = 30_000;
const bashBin = process.platform === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p))
  : 'bash';

const stub = mkdtempSync(join(tmpdir(), 'lore-pl-stub-'));
afterAll(() => rmSync(stub, { recursive: true, force: true }));

// docker: `image inspect IMG --format …` — по файлу $STUB_IMAGES («имя:тег id revision»).
writeFileSync(join(stub, 'docker'), `#!/usr/bin/env bash
if [ "$1 $2" = "image inspect" ]; then
  line=$(grep -E "^$3 " "$STUB_IMAGES" 2>/dev/null | head -1)
  [ -n "$line" ] || exit 1
  case "$*" in
    *revision*) echo "$line" | awk '{print ($3=="-"?"":$3)}' ;;
    *) echo "$line" | awk '{print $2}' ;;
  esac
  exit 0
fi
if [ "$1" = run ]; then
  img=""
  for a in "$@"; do case "$a" in unlimitedlore-*) img="$a" ;; esac; done
  b=$(grep -E "^bundle $img " "$STUB_IMAGES" 2>/dev/null | awk '{print $3}')
  [ -n "$b" ] && printf '<script type="module" crossorigin src="/%s"></script>\\n' "$b"
  exit 0
fi
exit 0
`.replace(/\r\n/g, '\n'));
chmodSync(join(stub, 'docker'), 0o755);

// PROBE_CURL для пробы /mcp (S8-02): печатает HTTP-код по имени хоста из URL.
// STUB_MCP_CODES="lore.odal.seidrstudio.pro=401 new.lore.odal.seidrstudio.pro=502"; по умолчанию 401.
const mcpCurl = join(stub, 'mcpcurl').replace(/\\/g, '/');
writeFileSync(mcpCurl, `#!/usr/bin/env bash
url=""
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
[ -n "\${MCP_CURL_LOG:-}" ] && echo "$url" >> "$MCP_CURL_LOG"
h="\${url#*://}"; h="\${h%%/*}"
code=401
for kv in \${STUB_MCP_CODES:-}; do [ "\${kv%%=*}" = "$h" ] && code="\${kv#*=}"; done
printf '%s' "$code"
`.replace(/\r\n/g, '\n'));
chmodSync(mcpCurl, 0o755);

function run(script: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(bashBin!, [resolve(repo, script).replace(/\\/g, '/'), ...args], {
    encoding: 'utf8',
    cwd: env.CWD ?? repo,
    env: { ...process.env, ...env, PATH: `${stub}${delimiter}${process.env.PATH ?? ''}` },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** Мини-репо: main ← merge(preprod) + тег; дерево тега = дерево preprod. */
function miniRepo() {
  const d = mkdtempSync(join(tmpdir(), 'lore-pl-repo-'));
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't');
  const migr = 'backend/src/main/java/studio/seer/heimdall/lore/LoreSchemaMigrations.java';
  const write = (n: number) => {
    spawnSync(bashBin!, ['-c', `mkdir -p $(dirname ${migr}) && printf '        new Step(%s, 17, "a", List.of()),\\n' 69 ${n} > ${migr}`], { cwd: d });
  };
  write(70); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  git(d, 'checkout', '-qb', 'preprod');
  write(71); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'feature');
  const pre = git(d, 'rev-parse', 'HEAD');
  git(d, 'checkout', '-q', 'main');
  git(d, 'merge', '-q', '--no-ff', '-m', 'Merge preprod', 'preprod');
  git(d, 'tag', 'v9.9.9');
  return { d, pre, pre8: pre.slice(0, 8), tag8: git(d, 'rev-parse', 'HEAD').slice(0, 8) };
}

describe.skipIf(!bashBin)('lore-host-deploy.sh resolve', { timeout: SPAWN_TIMEOUT }, () => {
  const S = '.github/scripts/lore-host-deploy.sh';

  it('находит образы препрода по родителю merge-коммита с тем же деревом', () => {
    const r0 = miniRepo();
    const imgs = join(stub, 'imgs-ok');
    writeFileSync(imgs, [
      `unlimitedlore-lore-backend:${r0.pre8} sha256:b1 ${r0.pre}`,
      `unlimitedlore-lore-app:${r0.pre8} sha256:a1 -`,
      `unlimitedlore-lore-app-next:${r0.pre8} sha256:n1 ${r0.pre}`,
      `unlimitedlore-lore-mcp:${r0.pre8} sha256:m1 -`,
      `bundle unlimitedlore-lore-app:${r0.pre8} assets/index-V1.js`,
      `bundle unlimitedlore-lore-app-next:${r0.pre8} assets/index-V2.js`,
    ].join('\n') + '\n');
    const out = join(r0.d, 'state.env');
    const r = run(S, ['resolve'], { CWD: r0.d, TAG: 'v9.9.9', STUB_IMAGES: imgs, DEPLOY_STATE: out });
    expect(r.out).toContain(r0.pre8);
    expect(r.code).toBe(0);
    const st = readFileSync(out, 'utf8');
    expect(st).toContain(`SRC8=${r0.pre8}`);
    expect(st).toContain(`EXPECT_COMMIT=${r0.pre}`);
    expect(st).toContain('CODE_SCHEMA=71');
    expect(st).toContain('BUNDLE_V1=assets/index-V1.js');
    expect(st).toContain('ID_MCP=sha256:m1');
    rmSync(r0.d, { recursive: true, force: true });
  });

  it('образов :sha8 нет — красный и без пересборки, со списком недостающих', () => {
    const r0 = miniRepo();
    const imgs = join(stub, 'imgs-none');
    writeFileSync(imgs, `unlimitedlore-lore-backend:${r0.pre8} sha256:b1 ${r0.pre}\n`);
    const r = run(S, ['resolve'], { CWD: r0.d, TAG: 'v9.9.9', STUB_IMAGES: imgs, DEPLOY_STATE: join(r0.d, 's.env') });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::/);
    expect(r.out).toContain(`unlimitedlore-lore-app:${r0.pre8}`);
    expect(r.out).not.toMatch(/docker build|compose build/);
    rmSync(r0.d, { recursive: true, force: true });
  });

  it('образ бэкенда без метки revision — красный: /lore/version нечем сверить', () => {
    const r0 = miniRepo();
    const imgs = join(stub, 'imgs-nolabel');
    writeFileSync(imgs, [
      `unlimitedlore-lore-backend:${r0.pre8} sha256:b1 -`,
      `unlimitedlore-lore-app:${r0.pre8} sha256:a1 -`,
      `unlimitedlore-lore-app-next:${r0.pre8} sha256:n1 -`,
      `unlimitedlore-lore-mcp:${r0.pre8} sha256:m1 -`,
    ].join('\n') + '\n');
    const r = run(S, ['resolve'], { CWD: r0.d, TAG: 'v9.9.9', STUB_IMAGES: imgs, DEPLOY_STATE: join(r0.d, 's.env') });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/revision/);
    rmSync(r0.d, { recursive: true, force: true });
  });
});

describe.skipIf(!bashBin)('lore-host-deploy.sh remote-swap: источник — только база переноса', { timeout: SPAWN_TIMEOUT }, () => {
  const S = '.github/scripts/lore-host-deploy.sh';
  it.each(['system_aida_lore', 'migration_src_2026_11_20', 'some_db'])('источник %s — отказ до обращения к docker', (src) => {
    const r = run(S, ['remote-swap', '/nonexistent', src, 'system_aida_lore'], {});
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/источник замены — только база переноса migration_dst\*/);
  });
  it('источник совпадает с базой — отказ', () => {
    const r = run(S, ['remote-swap', '/nonexistent', 'migration_dst_x', 'migration_dst_x'], {});
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/совпадает/);
  });
});

describe.skipIf(!bashBin)('lore-host-deploy.sh: замена тегов в compose', { timeout: SPAWN_TIMEOUT }, () => {
  const S = '.github/scripts/lore-host-deploy.sh';
  const compose = [
    'services:',
    '  lore-backend:',
    '    image: unlimitedlore-lore-backend:07a8c740',
    '  lore-app:',
    '    image: unlimitedlore-lore-app:07a8c740',
    '  lore-app-next:',
    '    image: unlimitedlore-lore-app-next:6249a781',
    '',
  ].join('\n');

  it('меняет только теги своих образов; lore-app не задевает lore-app-next', () => {
    const d = mkdtempSync(join(tmpdir(), 'lore-pl-swap-'));
    const f = join(d, 'docker-compose.yml');
    writeFileSync(f, compose);
    const r = run(S, ['swap-file', f.replace(/\\/g, '/'), 'lore-app', 'abcdef12'], {});
    expect(r.code).toBe(0);
    const got = readFileSync(f, 'utf8');
    expect(got).toContain('image: unlimitedlore-lore-app:abcdef12');
    expect(got).toContain('image: unlimitedlore-lore-app-next:6249a781');
    expect(got).toContain('image: unlimitedlore-lore-backend:07a8c740');
    rmSync(d, { recursive: true, force: true });
  });

  it('образа нет в файле — красный, файл не тронут', () => {
    const d = mkdtempSync(join(tmpdir(), 'lore-pl-swap-'));
    const f = join(d, 'docker-compose.yml');
    writeFileSync(f, 'services:\n  x:\n    image: other:1\n');
    const r = run(S, ['swap-file', f.replace(/\\/g, '/'), 'lore-app', 'abcdef12'], {});
    expect(r.code).toBe(1);
    expect(readFileSync(f, 'utf8')).toBe('services:\n  x:\n    image: other:1\n');
    rmSync(d, { recursive: true, force: true });
  });
});

describe.skipIf(!bashBin)('preprod-db-refresh.sh: в прод и в замороженные копии не заливает', { timeout: SPAWN_TIMEOUT }, () => {
  const S = 'scripts/preprod-db-refresh.sh';
  it.each(['system_aida_lore', 'system_aida_lore_frozen_20261107', 'some_db'])('TARGET_DB=%s — отказ до любых действий', (db) => {
    const r = run(S, [], { TARGET_DB: db, ARCADEDB_ROOT_PASSWORD: 'x', R: 'false' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::TARGET_DB=/);
  });
  it.each(['system_aida_lore', 'migration_src_2026_11_20', 'some_db'])('LOCAL_SOURCE=%s — не база переноса: отказ', (src) => {
    const r = run(S, [], { TARGET_DB: 'system_aida_lore_preprod', LOCAL_SOURCE: src, ARCADEDB_ROOT_PASSWORD: 'x', R: 'false' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::LOCAL_SOURCE=/);
  });
});

describe('скрипты трубы: проверки не врут из-за SIGPIPE', () => {
  // pipefail + `printf "$big" | grep -q` — grep выходит на первом совпадении,
  // printf получает SIGPIPE, и «найдено» читается как «не найдено». Так упал
  // второй dry-run PL-04 (lore.db в конфиге был). Только here-string.
  it.each([
    '.github/scripts/preprod-gates.sh', '.github/scripts/lore-host-deploy.sh',
    '.github/scripts/bundle-probe.sh', '.github/scripts/preprod-pin-sha.sh', 'scripts/preprod-db-refresh.sh',
  ])('%s', (f) => {
    expect(code(read(f))).not.toMatch(/printf '%s' "\$\w+" \| grep -q/);
  });
});

describe.skipIf(!bashBin)('preprod-gates.sh: защита от прода', { timeout: SPAWN_TIMEOUT }, () => {
  const S = '.github/scripts/preprod-gates.sh';
  const base = { PREPROD_GATES_ONLY: 'guards', LORE_DB: 'system_aida_lore_preprod', LORE_SECRETS_ENVIRONMENT: 'preprod', COMPOSE_PROJECT_NAME: 'lore-preprod' };

  it('препрод-значения проходят', () => {
    expect(run(S, [], base).code).toBe(0);
  });

  it.each([
    ['LORE_DB', 'system_aida_lore'],
    ['LORE_DB', 'system_aida_lore_frozen_20261107'],
    ['LORE_SECRETS_ENVIRONMENT', 'prod'],
    ['COMPOSE_PROJECT_NAME', 'unlimitedlore'],
  ])('%s=%s — красный', (k, v) => {
    const r = run(S, [], { ...base, [k]: v });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::/);
  });

  it('в dry-run тот же отказ не роняет шаг, но назван вслух', () => {
    const r = run(S, [], { ...base, LORE_DB: 'system_aida_lore', DRY_RUN: 'true' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::error::/);
    expect(r.out).toMatch(/упал бы/);
  });
});

// PL-11 (08.11): тесты, гоняющие настоящие git/bash, в одиночку идут ~1,8 с, а в
// полном прогоне под нагрузкой всех воркеров упирались в дефолтные 5 с vitest
// (замер: 1 из 3 полных прогонов — 5206 мс, тот же тест). Каждый такой describe
// обязан нести явный потолок SPAWN_TIMEOUT — потолок от зависания, не норма.
describe('PL-11: тесты с реальными процессами несут явный таймаут', () => {
  it('каждый describe.skipIf(!bashBin) объявлен с { timeout: SPAWN_TIMEOUT }', () => {
    const src = read('web-next/src/pipeline-host.test.ts');
    const heads = src.split('\n').filter((l) => /^describe\.skipIf\(!bashBin\)\(/.test(l));
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) expect(h).toMatch(/\{ timeout: SPAWN_TIMEOUT \}/);
  });
});

// Решение владелицы 08.11: бэкенд препрода ходит в ArcadeDB 131 под root (basic).
// Токен lore-backend на 131 выдан только на system_aida_lore — на базу препрода
// он давал 403 при старте (CD run на preprod-75bc50fe, бэкенд в рестарт-цикле).
// Переменная репозитория vars.LORE_MART_AUTH препрод больше не переключает.
describe('PL-04: бэкенд препрода — basic (root), а не токен прода', () => {
  it('Deploy backend: LORE_MART_AUTH жёстко basic, без vars.LORE_MART_AUTH', () => {
    const w = read('.github/workflows/lore-cd.yml');
    const step = w.slice(w.indexOf('- name: Deploy backend'), w.indexOf('docker compose up -d --no-deps lore-backend'));
    expect(step).toMatch(/LORE_MART_AUTH: basic\b/);
    expect(step).not.toMatch(/vars\.LORE_MART_AUTH/);
  });
});

// SPRINT_LORE_PRODUCT_BACKLOG/DBR-01, шаг 4.2 (вариант А владелицы): рантайм прода ходит в ArcadeDB
// собственным API-токеном без updateSchema, root-пароль остаётся только у накатки схемы и бэкапа.
// Раньше compose отдавал ARCADEDB_ROOT_PASSWORD рантайму, и бэкап/снимок прода брали его через
// `docker exec` в работающий бэкенд — убрать пароль из рантайма, не переведя их, значило сломать
// бэкап перед накаткой. Поэтому root живёт в отдельном сервисе lore-migrate (профиль migrate).
describe('DBR-01: root-пароль прода — только у накатки и бэкапа (lore-migrate), рантайм на токене', () => {
  const HOST = 'docker/lore-host/docker-compose.yml';
  /** Блок сервиса `name:` (отступ 2) до следующего сервиса. */
  const svc = (name: string) => job(HOST, name);
  const env = (block: string) => code(block).split('\n').filter((l) => /^ {6}- /.test(l)).join('\n');

  it('рантайм lore-backend: без ARCADEDB_ROOT_PASSWORD, способ входа жёстко token', () => {
    const be = env(svc('lore-backend'));
    expect(be).not.toMatch(/ARCADEDB_ROOT_PASSWORD/);
    expect(be).toMatch(/^ {6}- lore\.mart\.auth=token$/m);
    expect(be).not.toMatch(/LORE_MART_AUTH/);
  });

  it('lore-migrate: наследует lore-backend, профиль migrate, root и basic, накатка-и-выход', () => {
    const m = code(svc('lore-migrate'));
    expect(m, 'сервиса lore-migrate нет').not.toBe('');
    expect(m).toMatch(/^ {4}extends:\n {6}service: lore-backend$/m);
    expect(m).toMatch(/^ {4}profiles: \[migrate\]$/m);
    expect(m).toMatch(/^ {6}- ARCADEDB_ROOT_PASSWORD=\$\{ARCADEDB_ROOT_PASSWORD:-unset\}$/m);
    expect(m).toMatch(/^ {6}- lore\.mart\.auth=basic$/m);
    expect(m).toMatch(/^ {6}- lore\.migrate=true$/m);
    expect(m).toMatch(/^ {6}- lore\.migrate\.only=true$/m);
  });

  it('накатка и бэкап прода в lore-host-deploy.sh идут через lore-migrate, не через рантайм', () => {
    const s = code(read('.github/scripts/lore-host-deploy.sh'));
    expect(s).toMatch(/docker compose run --rm --no-deps -T lore-migrate/);
    expect(s).toMatch(/docker compose run --rm --no-deps -T --entrypoint sh lore-migrate -c/);
    expect(s).not.toMatch(/docker compose run --rm --no-deps -T lore-backend/);
    expect(s).not.toMatch(/docker exec "\$cid"/);
  });

  it.each(['scripts/migrate-live-check.sh', 'scripts/migration-snapshot.sh', 'scripts/preprod-db-refresh.sh'])(
    '%s: снимок прода — кредом lore-migrate, а не docker exec в рантайм', (f) => {
      const s = code(read(f));
      expect(s).not.toMatch(/docker exec \$bcid/);
      expect(s).toMatch(/docker compose run --rm --no-deps -T --entrypoint sh lore-migrate -c/);
    });
});

// Метка версии в углу (владелица 09.11): тег релиза доезжает до /lore/version только
// если выкатка прода передаёт его в контейнер, а compose принимает. Снять любую из
// двух строк — release молча станет null, и метка покажет коммит вместо версии.
describe('тег релиза доходит до бэкенда прода', () => {
  it('шаг up передаёт LORE_RELEASE_TAG, compose принимает его в environment lore-backend', () => {
    expect(read('.github/scripts/lore-host-deploy.sh')).toMatch(/LORE_RELEASE_TAG=\$TAG docker compose up -d lore-backend/);
    expect(read('docker-compose.yml')).toContain('- LORE_RELEASE_TAG=${LORE_RELEASE_TAG:-}');
  });
});

// SPRINT_UXR_S8_SWITCH/S8-01: чек-лист готовности к переключению на v2 —
// «/lore/version отвечает» обязано проверяться на проде по ОБОИМ публичным
// именам. Оба образа собираются с одного шаблона nginx, но прокси /lore/ у v2
// на проде релиз не сверял: проба шла только через имя v1. После переключения
// основной адрес — v2, и телефон с MCP пойдут через его nginx; потерянный там
// location /lore/ отдал бы SPA-заглушку при зелёном релизе.
describe.skipIf(!bashBin)('S8-01: проба прода /lore/version — через nginx v1 И v2', { timeout: SPAWN_TIMEOUT }, () => {
  const fwd = (p: string) => p.replace(/\\/g, '/');

  /** Копия lore-host-deploy.sh рядом с заглушками version-probe/bundle-probe. */
  function probeRun(failHost = '') {
    const d = mkdtempSync(join(tmpdir(), 'lore-pl-probe-'));
    writeFileSync(join(d, 'lore-host-deploy.sh'), read('.github/scripts/lore-host-deploy.sh'));
    writeFileSync(join(d, 'bundle-probe.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(d, 'version-probe.sh'), [
      '#!/usr/bin/env bash',
      'echo "$1 EXPECT=${EXPECT_COMMIT:-}" >> "$PROBE_LOG"',
      'if [ -n "${STUB_FAIL_HOST:-}" ] && [ "$1" = "$STUB_FAIL_HOST" ]; then echo "::error::stub: $1 красный"; exit 1; fi',
      'exit 0', '',
    ].join('\n'));
    // R — «ssh на lore-host»: бандл по порту, строка сверки схемы в логе бэкенда.
    writeFileSync(join(d, 'r.sh'), [
      '#!/usr/bin/env bash',
      'case "$*" in',
      '  *":4400/"*) echo \'<script src="/assets/index-V1.js"></script>\' ;;',
      '  *":4402/"*) echo \'<script src="/assets/index-V2.js"></script>\' ;;',
      '  *"compose logs"*) echo "схема сверена: БД v71 = код v71" ;;',
      'esac', '',
    ].join('\n'));
    chmodSync(join(d, 'r.sh'), 0o755);
    const st = join(d, 'state.env');
    writeFileSync(st, [
      'BUNDLE_V1=assets/index-V1.js', 'BUNDLE_V2=assets/index-V2.js',
      'EXPECT_COMMIT=0123456789abcdef', 'CODE_SCHEMA=71', 'UP_AT=2026-11-10T00:00:00Z', '',
    ].join('\n'));
    const log = join(d, 'probe.log');
    writeFileSync(log, '');
    const r = run(fwd(join(d, 'lore-host-deploy.sh')), ['probe'], {
      DEPLOY_STATE: fwd(st), R: fwd(join(d, 'r.sh')), PROBE_LOG: fwd(log),
      STUB_FAIL_HOST: failHost, TAG: 'v9.9.9', PROBE_CURL: mcpCurl, PROBE_ATTEMPTS: '1',
    });
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    rmSync(d, { recursive: true, force: true });
    return { ...r, calls };
  }

  it('зовёт version-probe и по имени v1, и по имени v2 — оба с коммитом сборки', () => {
    const r = probeRun();
    expect(r.out).not.toMatch(/::error::/);
    expect(r.code).toBe(0);
    expect(r.calls).toContain('https://lore.odal.seidrstudio.pro EXPECT=0123456789abcdef');
    expect(r.calls).toContain('https://new.lore.odal.seidrstudio.pro EXPECT=0123456789abcdef');
  });

  it('/lore/version через nginx v2 красный — красная и вся проба, с подсказкой отката', () => {
    const r = probeRun('https://new.lore.odal.seidrstudio.pro');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ОТКАТ на lore-host/);
  });

  it('/lore/version через nginx v1 красный — по-прежнему красная проба', () => {
    expect(probeRun('https://lore.odal.seidrstudio.pro').code).toBe(1);
  });
});

// 1.18 (20.11.2026): база прода после переноса собрана из модели — бэкенд пишет «схема собрана из модели
// (LoreModelSchema)», а не «схема сверена: БД vN». Выкатка прода (state/db/probe) ждала только «схема сверена»:
// state считал схему неизвестной, db делал бэкап и накатку (а та на такой базе честно «шаги V пропущены» →
// провал), probe краснел. Правило: база из модели — признанное состояние, а не «неизвестно».
describe.skipIf(!bashBin)('1.18: выкатка прода на базу, собранную из модели', { timeout: SPAWN_TIMEOUT }, () => {
  const fwd = (p: string) => p.replace(/\\/g, '/');
  const MODEL_LINE = '[LORE MIGRATE] схема собрана из модели (LoreModelSchema) — журнал шагов V не сверяется';

  function stepRun(step: string, stateLines: string[], logLine: string, versionJson = '') {
    const d = mkdtempSync(join(tmpdir(), 'lore-pl-model-'));
    writeFileSync(join(d, 'lore-host-deploy.sh'), read('.github/scripts/lore-host-deploy.sh'));
    writeFileSync(join(d, 'bundle-probe.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(d, 'version-probe.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(d, 'version.json'), versionJson);
    writeFileSync(join(d, 'r.sh'), [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$R_LOG"',
      'case "$*" in',
      `  *"/lore/version"*) cat "${fwd(join(d, 'version.json'))}" ;;`,
      '  *":4400/"*) echo \'<script src="/assets/index-V1.js"></script>\' ;;',
      '  *":4402/"*) echo \'<script src="/assets/index-V2.js"></script>\' ;;',
      '  *"compose logs"*) printf "%s\\n" "$LOG_LINE" ;;',
      'esac', '',
    ].join('\n'));
    chmodSync(join(d, 'r.sh'), 0o755);
    const st = join(d, 'state.env');
    writeFileSync(st, [...stateLines, ''].join('\n'));
    const rlog = join(d, 'r.log'); writeFileSync(rlog, '');
    const r = run(fwd(join(d, 'lore-host-deploy.sh')), [step], {
      DEPLOY_STATE: fwd(st), R: fwd(join(d, 'r.sh')), R_LOG: fwd(rlog), LOG_LINE: logLine, TAG: 'v1.18.0',
      PROBE_CURL: mcpCurl, PROBE_ATTEMPTS: '1',
    });
    const state = readFileSync(st, 'utf8'); const calls = readFileSync(rlog, 'utf8');
    rmSync(d, { recursive: true, force: true });
    return { ...r, state, calls };
  }

  it('db: схема прода «из модели» — ни бэкапа, ни накатки, шаг зелёный', () => {
    const r = stepRun('db', ['CODE_SCHEMA=95', 'PROD_SCHEMA=model', 'PROD_DB=system_aida_lore'], MODEL_LINE);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/собрана из модели/);
    expect(r.calls).not.toMatch(/remote-backup|lore-migrate/);
  });

  it('probe: в логе нового бэкенда «схема собрана из модели» — проба зелёная', () => {
    const r = stepRun('probe', ['BUNDLE_V1=assets/index-V1.js', 'BUNDLE_V2=assets/index-V2.js',
      'EXPECT_COMMIT=0123456789abcdef', 'CODE_SCHEMA=95', 'UP_AT=2026-11-20T00:00:00Z'], MODEL_LINE);
    expect(r.out).not.toMatch(/::error::/);
    expect(r.code).toBe(0);
  });

  // Патч 1.18.1: выкатка 1.18 (задача 39647) была ложно красной — на базе из модели строки «схема сверена: БД v93»
  // нет и быть не может. Сверка — /lore/version: schema_source=model и schema_version=model:<N> модели тега.
  const PROBE_STATE = ['BUNDLE_V1=assets/index-V1.js', 'BUNDLE_V2=assets/index-V2.js', 'EXPECT_COMMIT=0123456789abcdef',
    'CODE_SCHEMA=95', 'UP_AT=2026-11-20T00:00:00Z', 'PROD_SCHEMA=model'];

  it('probe на базе из модели: /lore/version = model:<N> модели тега — зелёная без строки «схема сверена»', () => {
    const r = stepRun('probe', [...PROBE_STATE, 'MODEL_VERSION=1'], 'что-то другое',
      '{"commit":"0123456789abcdef","schema_version":"model:1","schema_source":"model","model_hash":"d7e16a827891d5e0"}');
    expect(r.out).not.toMatch(/::error::/);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/schema_version=model:1/);
  });

  it('probe на базе из модели: версия по хэшу, а не номер модели тега — красная', () => {
    const r = stepRun('probe', [...PROBE_STATE, 'MODEL_VERSION=1'], 'схема собрана из модели (LoreModelSchema)',
      '{"schema_version":"model:d7e16a827891d5e0","schema_source":"model"}');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ждали schema_source=model и schema_version=model:1/);
  });

  it('probe на базе из модели: номер модели тега не прочитан — красная, а не тихо зелёная', () => {
    const r = stepRun('probe', PROBE_STATE, 'что-то другое', '{"schema_version":"model:1","schema_source":"model"}');
    expect(r.code).toBe(1);
  });

  it('probe: ни «схема сверена», ни «из модели» — по-прежнему красная', () => {
    const r = stepRun('probe', ['BUNDLE_V1=assets/index-V1.js', 'BUNDLE_V2=assets/index-V2.js',
      'EXPECT_COMMIT=0123456789abcdef', 'CODE_SCHEMA=95', 'UP_AT=2026-11-20T00:00:00Z'], 'что-то другое');
    expect(r.code).toBe(1);
  });
});

// 1.18.3 · САМОПРОВЕРКА ВЫКАТКИ ПРОДА. Вид схемы прода брался ТОЛЬКО из лога бэкенда, и строку искали
// такой, какой её никто не пишет: на базе из модели рантайм (lore.migrate=false) пишет «схема собрана из
// модели — шаги V не применяются, переходник чтения включён», а «(LoreModelSchema)» есть лишь у пути сверки
// шагов V, до которого такая база не доходит (LoreSchemaMigrationRunner.runSchema → builtFromModel). Итог:
// PROD_SCHEMA пуст → проба шла веткой шагов V и требовала «схема сверена: БД v93» → задача деплоя красная
// два релиза подряд (1.18.0 — 39647, 1.18.1 — 39867) при исправном проде. Правило: вид схемы спрашиваем у
// самого бэкенда (/lore/version: schema_source, schema_version), лог — запасной путь, «не определили» —
// честный отказ вслух, а не молчаливая ветка V.
describe.skipIf(!bashBin)('1.18.3: вид схемы прода — из /lore/version, лог — запасной путь', { timeout: SPAWN_TIMEOUT }, () => {
  const fwd = (p: string) => p.replace(/\\/g, '/');
  const S = '.github/scripts/lore-host-deploy.sh';
  const RUNNER = 'backend/src/main/java/studio/seer/heimdall/lore/LoreSchemaMigrationRunner.java';
  // Строка, которую правда пишет рантайм прода на базе из модели (путь READ_ADAPTER).
  const RUNTIME_MODEL_LINE = '[LORE MIGRATE] схема собрана из модели — шаги V не применяются, переходник чтения включён (status_raw → status)';
  const MODEL_JSON = '{"commit":"0123456789abcdef","schema_version":"model:1","schema_source":"model","model_hash":"d7e16a827891d5e0"}';
  const STEPS_JSON = '{"commit":"0123456789abcdef","schema_version":93,"schema_source":"steps"}';
  // Исправный v2 для сторожа петли (state зовёт v2_guard).
  const CFG = ['name: lore-app-next', 'services:', '  lore-app-next:', '    environment:',
    '      LORE_BACKEND_HOST: lore-backend', '      LORE_BACKEND_URL: http://lore-backend:9100',
    '    networks:', '      lore-be: null', 'networks:', '  lore-be:', '    name: unlimitedlore_default',
    '    external: true', ''].join('\n');

  /** Шаг на копии скрипта; R — заглушка ssh: /lore/version → version.json, лог → $LOG_LINE, compose config → исправный v2. */
  function stepRun(step: string, stateLines: string[], logLine: string, versionJson = '', extra: Record<string, string> = {}) {
    const d = mkdtempSync(join(tmpdir(), 'lore-pl-kind-'));
    writeFileSync(join(d, 'lore-host-deploy.sh'), read(S));
    writeFileSync(join(d, 'bundle-probe.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(d, 'version-probe.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(d, 'version.json'), versionJson);
    writeFileSync(join(d, 'cfg.yml'), CFG);
    writeFileSync(join(d, 'r.sh'), [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$R_LOG"',
      'case "$*" in',
      `  *"/lore/version"*) cat "${fwd(join(d, 'version.json'))}" ;;`,
      `  *"compose config"*) cat "${fwd(join(d, 'cfg.yml'))}" ;;`,
      '  *"compose logs"*) printf "%s\\n" "$LOG_LINE" ;;',
      '  *":4400/"*) echo \'<script src="/assets/index-V1.js"></script>\' ;;',
      '  *":4402/"*) echo \'<script src="/assets/index-V2.js"></script>\' ;;',
      '  *"State.Health.Status"*) echo healthy ;;',
      'esac', '',
    ].join('\n'));
    chmodSync(join(d, 'r.sh'), 0o755);
    const st = join(d, 'state.env');
    writeFileSync(st, [...stateLines, ''].join('\n'));
    const rlog = join(d, 'r.log'); writeFileSync(rlog, '');
    const r = run(fwd(join(d, 'lore-host-deploy.sh')), [step], {
      DEPLOY_STATE: fwd(st), R: fwd(join(d, 'r.sh')), R_LOG: fwd(rlog), LOG_LINE: logLine, TAG: 'v1.18.3',
      PROBE_CURL: mcpCurl, PROBE_ATTEMPTS: '1', PROBE_DELAY: '0', ...extra,
    });
    const state = readFileSync(st, 'utf8'); const calls = readFileSync(rlog, 'utf8');
    rmSync(d, { recursive: true, force: true });
    return { ...r, state, calls };
  }

  const PROBE_STATE = ['BUNDLE_V1=assets/index-V1.js', 'BUNDLE_V2=assets/index-V2.js',
    'EXPECT_COMMIT=0123456789abcdef', 'CODE_SCHEMA=95', 'UP_AT=2026-11-21T00:00:00Z'];

  it('state: /lore/version говорит schema_source=model — PROD_SCHEMA=model, строки в логе не требуется', () => {
    const r = stepRun('state', [], '', MODEL_JSON);
    expect(r.out).not.toMatch(/::error::/);
    expect(r.code).toBe(0);
    expect(r.state, r.out).toMatch(/^PROD_SCHEMA=model$/m);
  });

  // Заглушка R отдаёт строку лога целиком (настоящий grep выполняется на lore-host), поэтому здесь
  // проверяется разбор строки; что шаблон скрипта её вообще ловит — последний тест этого describe.
  it('state: /lore/version не прочитан, в логе — строка рантайма про модель (без «(LoreModelSchema)») — PROD_SCHEMA=model', () => {
    const r = stepRun('state', [], RUNTIME_MODEL_LINE, '');
    expect(r.code).toBe(0);
    expect(r.state, r.out).toMatch(/^PROD_SCHEMA=model$/m);
  });

  it('state: /lore/version говорит steps, в логе «БД v93» — PROD_SCHEMA=93', () => {
    const r = stepRun('state', [], 'схема сверена: БД v93 = код v93', STEPS_JSON);
    expect(r.state, r.out).toMatch(/^PROD_SCHEMA=93$/m);
  });

  it('state: steps по /lore/version, номера в логе нет — PROD_SCHEMA=steps (вид ясен, номер нет), а не пусто', () => {
    const r = stepRun('state', [], '', STEPS_JSON);
    expect(r.state, r.out).toMatch(/^PROD_SCHEMA=steps$/m);
  });

  it('state: ни /lore/version, ни строки в логе — PROD_SCHEMA пуст и сказано вслух «не определён»', () => {
    const r = stepRun('state', [], '', '');
    expect(r.state, r.out).toMatch(/^PROD_SCHEMA=$/m);
    expect(r.out).toMatch(/вид схемы прода не определён/);
  });

  it('probe: база из модели, вида схемы в state нет (как в 1.18.0 и 1.18.1) — зелёная по /lore/version, а не красная из-за «БД v95»', () => {
    const r = stepRun('probe', [...PROBE_STATE, 'MODEL_VERSION=1'], RUNTIME_MODEL_LINE, MODEL_JSON);
    expect(r.out).not.toMatch(/::error::/);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/schema_version=model:1/);
  });

  it('probe: ни /lore/version, ни строки в логе — красная словами «вид схемы прода не определён»', () => {
    const r = stepRun('probe', PROBE_STATE, 'что-то другое', '');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/вид схемы прода не определён/);
  });

  it('db: вид схемы — шаги V, номера нет (PROD_SCHEMA=steps) — бэкап и накатка, а не «прод НОВЕЕ кода»', () => {
    const r = stepRun('db', ['CODE_SCHEMA=95', 'PROD_SCHEMA=steps', 'PROD_DB=system_aida_lore'], '');
    expect(r.out).not.toMatch(/НОВЕЕ кода/);
    expect(r.calls, r.out).toMatch(/remote-backup/);
  });

  it('plan: база прода собрана из модели — так и сказано, без «прод НОВЕЕ кода» и арифметической ругани', () => {
    const r = stepRun('plan', ['CODE_SCHEMA=95', 'PROD_SCHEMA=model', 'SRC8=abcdef12', 'PROD_DB=system_aida_lore'], '');
    expect(r.out).toMatch(/из модели/);
    expect(r.out).not.toMatch(/НОВЕЕ кода/);
    expect(r.out).not.toMatch(/integer expected|integer expression/);
  });

  it('скрипт ищет в логе строку, которую бэкенд правда пишет (а не «(LoreModelSchema)» из пути сверки шагов)', () => {
    const runner = read(RUNNER);
    // Строки «из модели», которые пишет рантайм и путь сверки: разбор обрывается на склейке Java — её хватает.
    const logged = [...runner.matchAll(/"(\[LORE MIGRATE\][^"]*схема собрана из модели[^"]*)"/g)].map(m => m[1]);
    expect(logged.length, 'бэкенд пишет хотя бы одну строку «схема собрана из модели»').toBeGreaterThan(0);
    // Шаблоны grep скрипта (в одинарных кавычках — как их видит удалённый shell), где есть ветка про модель.
    const pats = [...read(S).matchAll(/'([^'\n]*схема собрана из модели[^'\n]*)'/g)].map(m => m[1]);
    expect(pats.length, 'скрипт ищет в логе строку «схема собрана из модели»').toBeGreaterThan(0);
    for (const p of pats) {
      const alt = p.split('|').find(a => a.includes('из модели'));
      expect(alt, `в шаблоне «${p}» нет ветки про модель`).toBeTruthy();
      for (const s of logged) expect(new RegExp(alt!).test(s), `шаблон «${alt}» не ловит строку бэкенда «${s}»`).toBe(true);
    }
  });
});

// SPRINT_UXR_S8_SWITCH/S8-02 (патч 1.18.1, факты прода lore-host 21.11):
//   * петля — nginx v2 ходил в API по LORE_BACKEND_URL=https://lore.odal.seidrstudio.pro; после
//     переключения lore.odal на v2 он проксировал сам в себя, /lore/version висел. Правило: v2 ходит
//     в бэкенд напрямую по docker-сети (http://lore-backend:9100, сеть бэкенда unlimitedlore_default),
//     а публичное имя LORE в LORE_BACKEND_URL/LORE_BACKEND_HOST — громкий отказ выкатки ДО up;
//   * /mcp на v2 → 502: nginx шлёт на lore-mcp:9200, а контейнера lore-mcp на проде не было — релиз
//     его не вёз (preprod-pin-sha.sh не метил, SERVICES не знал). Теперь едет тем же :sha8, что прошёл
//     препрод, порядок up: бэкенд → healthy → lore-mcp → v1 → v2, проба /mcp через оба имени: 401/405.
describe('S8-02: эталоны compose lore-host — v2 к бэкенду напрямую, lore-mcp рядом', () => {
  const BE = 'docker/lore-host/docker-compose.yml';
  const NEXT = 'docker/lore-host/docker-compose.next.yml';

  it('v2: LORE_BACKEND_URL=http://lore-backend:9100, Host lore-backend, никакого публичного имени LORE', () => {
    expect(has(NEXT), `${NEXT} нет`).toBe(true);
    const v2 = code(job(NEXT, 'lore-app-next'));
    expect(v2).toMatch(/^ {6}LORE_BACKEND_URL: http:\/\/lore-backend:9100$/m);
    expect(v2).toMatch(/^ {6}LORE_BACKEND_HOST: lore-backend$/m);
    expect(v2).not.toMatch(/LORE_BACKEND_(URL|HOST):.*lore\.odal\.seidrstudio\.pro/);
    expect(v2).toMatch(/^ {6}- "4402:80"$/m);
  });

  it('v2 подключён к внешней сети бэкенда unlimitedlore_default (иначе lore-backend/lore-mcp не резолвятся)', () => {
    const f = code(read(NEXT));
    expect(f).toMatch(/^networks:\n {2}lore-be:\n {4}name: unlimitedlore_default\n {4}external: true$/m);
    expect(code(job(NEXT, 'lore-app-next'))).toMatch(/^ {4}networks: \[default, lore-be\]$/m);
  });

  it('lore-mcp: образ :<sha8> как у остальных, бэкенд по сети, порта наружу нет, секреты только переменными', () => {
    const m = code(job(BE, 'lore-mcp'));
    expect(m, 'сервиса lore-mcp в эталоне нет').not.toBe('');
    expect(m).toMatch(/^ {4}image: unlimitedlore-lore-mcp:[A-Za-z0-9._-]+$/m);
    expect(m).toMatch(/^ {6}- LORE_BACKEND_URL=http:\/\/lore-backend:9100$/m);
    expect(m).not.toMatch(/^ {4}ports:/m);
    expect(m).toMatch(/condition: service_healthy/);
    // Значений секретов в эталоне нет: всё, что похоже на секрет, — только ${…} с пустым дефолтом.
    for (const l of m.split('\n').filter((x) => /SECRET|PASSWORD|TOKEN/.test(x))) {
      expect(l).toMatch(/=\$\{[A-Z_]+:-\}$/);
    }
  });

  it('preprod-pin-sha.sh метит :sha8 и lore-mcp — иначе релиз его не найдёт', () => {
    expect(read('.github/scripts/preprod-pin-sha.sh')).toMatch(/for svc in lore-backend lore-app lore-app-next lore-mcp; do/);
  });

  it('lore-host-deploy.sh: lore-mcp в SERVICES, живёт в каталоге бэкенда', () => {
    const s = code(read('.github/scripts/lore-host-deploy.sh'));
    expect(s).toMatch(/^SERVICES="lore-backend lore-mcp lore-app lore-app-next"$/m);
    expect(s).toMatch(/lore-mcp\) echo MCP/);
  });
});

describe.skipIf(!bashBin)('S8-02: lore-host-deploy.sh — сторож петли, порядок up, проба /mcp', { timeout: SPAWN_TIMEOUT }, () => {
  const fwd = (p: string) => p.replace(/\\/g, '/');
  const S = '.github/scripts/lore-host-deploy.sh';
  const cfg = (url: string, host: string) => [
    'name: lore-app-next',
    'services:',
    '  lore-app-next:',
    '    environment:',
    `      LORE_BACKEND_HOST: ${host}`,
    `      LORE_BACKEND_URL: ${url}`,
    '      LORE_PUBLIC_URL: https://new.lore.odal.seidrstudio.pro',
    '    image: unlimitedlore-lore-app-next:abcdef12',
    '    networks:',
    '      lore-be: null',
    'networks:',
    '  lore-be:',
    '    name: unlimitedlore_default',
    '    external: true',
    '',
  ].join('\n');
  const GOOD = cfg('http://lore-backend:9100', 'lore-backend');

  /** step на копии скрипта; R — заглушка ssh: compose config → $CFG_FILE, health → healthy. */
  function stepRun(step: string, config: string | null, extra: Record<string, string> = {}) {
    const d = mkdtempSync(join(tmpdir(), 'lore-s802-'));
    writeFileSync(join(d, 'lore-host-deploy.sh'), read(S));
    writeFileSync(join(d, 'bundle-probe.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(d, 'version-probe.sh'), '#!/usr/bin/env bash\nexit 0\n');
    const cf = join(d, 'cfg.yml');
    if (config !== null) writeFileSync(cf, config);
    writeFileSync(join(d, 'r.sh'), [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$R_LOG"',
      'case "$*" in',
      '  *"compose config"*) [ -f "$CFG_FILE" ] || { echo "no such file" >&2; exit 1; }; cat "$CFG_FILE" ;;',
      '  *"State.Health.Status"*) echo healthy ;;',
      '  *":4400/"*) echo \'<script src="/assets/index-V1.js"></script>\' ;;',
      '  *":4402/"*) echo \'<script src="/assets/index-V2.js"></script>\' ;;',
      '  *"compose logs"*) echo "схема сверена: БД v71 = код v71" ;;',
      'esac', '',
    ].join('\n'));
    chmodSync(join(d, 'r.sh'), 0o755);
    const st = join(d, 'state.env');
    writeFileSync(st, ['BUNDLE_V1=assets/index-V1.js', 'BUNDLE_V2=assets/index-V2.js',
      'EXPECT_COMMIT=0123456789abcdef', 'CODE_SCHEMA=71', 'UP_AT=2026-11-21T00:00:00Z', ''].join('\n'));
    const rlog = join(d, 'r.log'); writeFileSync(rlog, '');
    const mlog = join(d, 'mcp.log'); writeFileSync(mlog, '');
    const r = run(fwd(join(d, 'lore-host-deploy.sh')), [step], {
      DEPLOY_STATE: fwd(st), R: fwd(join(d, 'r.sh')), R_LOG: fwd(rlog), CFG_FILE: fwd(cf), TAG: 'v1.18.1',
      PROBE_CURL: mcpCurl, PROBE_ATTEMPTS: '1', PROBE_DELAY: '0', MCP_CURL_LOG: fwd(mlog), ...extra,
    });
    const calls = readFileSync(rlog, 'utf8'); const mcp = readFileSync(mlog, 'utf8');
    rmSync(d, { recursive: true, force: true });
    return { ...r, calls, mcp };
  }

  it('up: бэкенд → healthy → lore-mcp → v1 → v2', () => {
    const r = stepRun('up', GOOD);
    expect(r.out).not.toMatch(/::error::/);
    expect(r.code).toBe(0);
    const at = (re: RegExp) => { const m = re.exec(r.calls); return m ? m.index : -1; };
    const be = at(/docker compose up -d lore-backend$/m);
    const health = at(/State\.Health\.Status/);
    const mcp = at(/docker compose up -d (--no-deps )?lore-mcp$/m);
    const v1 = at(/docker compose up -d lore-app$/m);
    const v2 = at(/lore-app-next && docker compose up -d$/m);
    expect([be, health, mcp, v1, v2].every((x) => x >= 0), r.calls).toBe(true);
    expect(be).toBeLessThan(health);
    expect(health).toBeLessThan(mcp);
    expect(mcp).toBeLessThan(v1);
    expect(v1).toBeLessThan(v2);
  });

  it.each([
    ['https://lore.odal.seidrstudio.pro', 'lore.odal.seidrstudio.pro'],
    ['https://new.lore.odal.seidrstudio.pro', 'lore-backend'],
    ['http://lore.odal.seidrstudio.pro:443/', 'lore-backend'],
    ['http://lore-backend:9100', 'lore.odal.seidrstudio.pro'],
    ['http://lore-backend:9100', 'new.lore.odal.seidrstudio.pro'],
  ])('up: LORE_BACKEND_URL=%s, HOST=%s — петля, громкий отказ ДО любого compose up', (url, host) => {
    const r = stepRun('up', cfg(url, host));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*петл/);
    expect(r.calls).not.toMatch(/compose up/);
  });

  it('up: v2 не в сети бэкенда unlimitedlore_default — отказ до up', () => {
    const r = stepRun('up', GOOD.replace('name: unlimitedlore_default', 'name: lore-app-next_default'));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*unlimitedlore_default/);
    expect(r.calls).not.toMatch(/compose up/);
  });

  it('up: compose config v2 не прочитан — «не смогли проверить», а не «петли нет»', () => {
    const r = stepRun('up', null);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*не прочитан/);
    expect(r.calls).not.toMatch(/compose up/);
  });

  it('state: тот же сторож — петля видна уже на шаге чтения', () => {
    expect(stepRun('state', GOOD).code).toBe(0);
    const r = stepRun('state', cfg('https://lore.odal.seidrstudio.pro', 'lore.odal.seidrstudio.pro'));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*петл/);
  });

  it('probe: /mcp через оба имени отвечает 401 — зелёная', () => {
    const r = stepRun('probe', GOOD);
    expect(r.out).not.toMatch(/::error::/);
    expect(r.code).toBe(0);
    expect(r.mcp).toContain('https://lore.odal.seidrstudio.pro/mcp');
    expect(r.mcp).toContain('https://new.lore.odal.seidrstudio.pro/mcp');
  });

  it('probe: 405 на /mcp — тоже вход, зелёная', () => {
    expect(stepRun('probe', GOOD, { STUB_MCP_CODES: 'lore.odal.seidrstudio.pro=405' }).code).toBe(0);
  });

  it.each(['502', '404', '000', '200'])('probe: /mcp на v2 отвечает %s — красная, с подсказкой отката', (c) => {
    const r = stepRun('probe', GOOD, { STUB_MCP_CODES: `new.lore.odal.seidrstudio.pro=${c}` });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::.*\/mcp/);
    expect(r.out).toMatch(/ОТКАТ на lore-host/);
  });
});

// ── Готовый пакет установки вложением релиза ─────────────────────────────────
// Слово владелицы 22.11.2026: «мне нужна сборка инсталятор для друзей». Друг
// скачивает ОДИН файл из релиза, а не клонирует репозиторий и собирает сам.
// Пакет лёгкий (install.sh + compose + .env.example + README + lore-migrate.mjs);
// исполняемый файл на 125 МБ — только по явной просьбе (вход with_exe): он
// всё равно собирается на месте, тащить его в каждый релиз незачем. Сбой сборки
// или загрузки не смеет помешать уже опубликованному релизу — отсюда
// continue-on-error и отдельный вердикт, как у зеркала GitHub.
const ASSET_SH = '.github/scripts/release-installer-asset.sh';

describe('релиз несёт готовый пакет установки вложением', () => {
  const pubSteps = () => steps(job(REL, 'publish'));
  const assetStep = () => pubSteps().find((s) => s.body.includes(ASSET_SH));

  it('шаг идёт ПОСЛЕ публикации и не роняет релиз (continue-on-error)', () => {
    const st = pubSteps();
    const iPub = st.findIndex((s) => s.name === 'Publish');
    const iAsset = st.findIndex((s) => s.body.includes(ASSET_SH));
    expect(iPub, 'шаг Publish не найден').toBeGreaterThan(-1);
    expect(iAsset, 'шага с пакетом установки нет').toBeGreaterThan(iPub);
    expect(st[iAsset].body).toMatch(/continue-on-error: true/);
    expect(st[iAsset].body).toMatch(/id: installer_asset/);
  });

  it('честный вердикт отдельным шагом — как у зеркала', () => {
    const v = pubSteps().find((s) => /Вердикт вложений/.test(s.name));
    expect(v, 'шага «Вердикт вложений» нет').toBeTruthy();
    expect(v!.body).toMatch(/always\(\)/);
    expect(v!.body).toMatch(/steps\.installer_asset\.outcome == 'failure'/);
    expect(v!.body).toMatch(/::error::/);
  });

  it('бинарь — только по явной просьбе: вход with_exe, по умолчанию false', () => {
    const lines = read(REL).split('\n');
    const from = lines.findIndex((l) => l === '      with_exe:');
    expect(from, 'входа with_exe нет').toBeGreaterThan(-1);
    let to = lines.length;
    for (let i = from + 1; i < lines.length; i++) {
      if (/^ {0,6}\S/.test(lines[i])) { to = i; break; }
    }
    expect(lines.slice(from, to).join('\n')).toMatch(/^ {8}default: 'false'$/m);
    expect(assetStep()!.body).toMatch(/WITH_EXE: \$\{\{ inputs\.with_exe \|\| 'false' \}\}/);
  });
});

describe.skipIf(!bashBin)('release-installer-asset.sh', { timeout: SPAWN_TIMEOUT }, () => {
  const abin = mkdtempSync(join(tmpdir(), 'lore-asset-bin-'));
  afterAll(() => rmSync(abin, { recursive: true, force: true }));
  const sh = (name: string, body: string) => {
    writeFileSync(join(abin, name), `#!/usr/bin/env bash\n${body}`.replace(/\r\n/g, '\n'));
    chmodSync(join(abin, name), 0o755);
  };

  // node: вместо build-installer.mjs — запись аргументов и ровно те файлы, что он кладёт в --out.
  const NODE_STUB = `echo "$*" >> "$NODE_LOG"
out=""; prev=""
for a in "$@"; do [ "$prev" = "--out" ] && out="$a"; prev="$a"; done
[ -n "$out" ] || exit 0
mkdir -p "$out"
printf 'bundle\\n' > "$out/lore-migrate.mjs"
case "$*" in *--exe*) printf 'ELF\\n' > "$out/lore-migrate" ;; esac
exit 0
`;
  sh('node', NODE_STUB);
  // npm: только отметка о вызове — сеть в тестах не трогаем.
  sh('npm', 'echo "$*" >> "$NPM_LOG"\nexit "${NPM_CODE:-0}"\n');
  // curl: ответы API Forgejo по URL; -o пишет тело, -w печатает код.
  sh('curl', `echo "$*" >> "$CURL_LOG"
o=""; prev=""; url=""
for a in "$@"; do
  [ "$prev" = "-o" ] && o="$a"
  case "$a" in http*) url="$a" ;; esac
  prev="$a"
done
code=200
body='{"id":77,"assets":[]}'
case "$url" in
  *assets\\?name=*) code="\${STUB_UPLOAD_CODE:-201}"; body='{"id":5,"name":"a"}' ;;
  *) body="\${STUB_RELEASE_JSON:-$body}" ;;
esac
if [ -n "$o" ]; then printf '%s' "$body" > "$o"; else printf '%s' "$body"; fi
case "$*" in *-w*) printf '%s' "$code" ;; esac
exit 0
`);

  const fwd = (p: string) => p.replace(/\\/g, '/');

  function area() {
    const d = mkdtempSync(join(tmpdir(), 'lore-asset-'));
    // сборщики «уже установлены» — npm в тестах звать незачем
    mkdirSync(join(d, 'tools', 'node_modules', 'esbuild'), { recursive: true });
    mkdirSync(join(d, 'tools', 'node_modules', 'postject'), { recursive: true });
    writeFileSync(join(d, 'created.json'), '{"id":77,"tag_name":"v9.9.9"}');
    writeFileSync(join(d, 'existing.json'), '{"errors":["release does not exist"]}');
    return d;
  }

  function asset(cmd: string, d: string, env: Record<string, string> = {}) {
    const r = spawnSync(bashBin!, [resolve(repo, ASSET_SH).replace(/\\/g, '/'), cmd], {
      encoding: 'utf8',
      cwd: repo,
      env: {
        ...process.env,
        TAG: 'v9.9.9',
        API: 'http://forgejo:3000/api/v1/repos/AIDA/UnlimitedLORE',
        TOKEN: 'tkn',
        OUT: fwd(join(d, 'build')),
        INSTALLER_TOOLS_DIR: fwd(join(d, 'tools')),
        CREATED_JSON: fwd(join(d, 'created.json')),
        EXISTING_JSON: fwd(join(d, 'existing.json')),
        // curl — явным путём: на Windows подмена через PATH невозможна, Git Bash
        // ставит /mingw64/bin перед унаследованным PATH (как PROBE_CURL выше)
        CURL_BIN: fwd(join(abin, 'curl')),
        NODE_LOG: fwd(join(d, 'node.log')),
        NPM_LOG: fwd(join(d, 'npm.log')),
        CURL_LOG: fwd(join(d, 'curl.log')),
        ...env,
        PATH: `${abin}${delimiter}${process.env.PATH ?? ''}`,
      },
    });
    const log = (f: string) => (existsSync(join(d, f)) ? readFileSync(join(d, f), 'utf8') : '');
    return { code: r.status, out: `${r.stdout}${r.stderr}`, node: log('node.log'), npm: log('npm.log'), curl: log('curl.log') };
  }

  const listTar = (d: string) => {
    // cd + относительное имя: абсолютный путь с двоеточием (C:/…) GNU tar читает как «хост:файл»
    const r = spawnSync(bashBin!, ['-c', `cd "${fwd(join(d, 'build', 'asset'))}" && tar -tzf lore-installer-v9.9.9.tar.gz`], { encoding: 'utf8' });
    return r.stdout.split('\n').map((l) => l.replace(/^lore-installer-v9\.9\.9\//, '').replace(/\/$/, '')).filter(Boolean);
  };
  const names = (curl: string) => [...curl.matchAll(/assets\?name=(\S+)/g)].map((m) => m[1]);

  it('архив — ровно лёгкая часть пакета: install.sh, compose, .env.example, README, lore-migrate.mjs', () => {
    const d = area();
    const r = asset('all', d);
    expect(r.out, r.out).not.toMatch(/::warning::/);
    expect(r.code).toBe(0);
    expect(listTar(d).sort()).toEqual(
      ['.env.example', 'README.md', 'docker-compose.install.yml', 'install.sh', 'lore-migrate.mjs'].sort(),
    );
    // SHA256SUMS — отдельным файлом рядом с архивом
    expect(readFileSync(join(d, 'build', 'asset', 'SHA256SUMS'), 'utf8'))
      .toMatch(/^[0-9a-f]{64} {2}lore-installer-v9\.9\.9\.tar\.gz$/m);
    rmSync(d, { recursive: true, force: true });
  });

  it('with_exe=false (по умолчанию): бинаря нет ни в архиве, ни во вложениях, и он не собирается', () => {
    const d = area();
    const r = asset('all', d);
    expect(r.node).not.toMatch(/--exe/);
    expect(listTar(d)).not.toContain('lore-migrate');
    expect(existsSync(join(d, 'build', 'asset', 'lore-migrate-linux-x64'))).toBe(false);
    expect(readFileSync(join(d, 'build', 'asset', 'SHA256SUMS'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(names(r.curl).sort()).toEqual(['SHA256SUMS', 'lore-installer-v9.9.9.tar.gz']);
    rmSync(d, { recursive: true, force: true });
  });

  it('with_exe=true: бинарь собирается и едет ОТДЕЛЬНЫМ вложением, архив остаётся лёгким', () => {
    const d = area();
    const r = asset('all', d, { WITH_EXE: 'true' });
    expect(r.code).toBe(0);
    expect(r.node).toMatch(/--exe/);
    expect(listTar(d)).not.toContain('lore-migrate');
    expect(existsSync(join(d, 'build', 'asset', 'lore-migrate-linux-x64'))).toBe(true);
    expect(names(r.curl)).toContain('lore-migrate-linux-x64');
    rmSync(d, { recursive: true, force: true });
  });

  it('id релиза — из ответа публикации; его нет — из уже существующего релиза', () => {
    const d = area();
    expect(asset('all', d).curl).toMatch(/releases\/77\/assets\?name=/);
    rmSync(d, { recursive: true, force: true });

    const d2 = area();
    rmSync(join(d2, 'created.json'));
    writeFileSync(join(d2, 'existing.json'), '{"id":42,"assets":[]}');
    expect(asset('all', d2).curl).toMatch(/releases\/42\/assets\?name=/);
    rmSync(d2, { recursive: true, force: true });
  });

  it('ошибка загрузки — предупреждение и ненулевой код шага, а не ::error:: посреди релиза', () => {
    const d = area();
    const r = asset('all', d, { STUB_UPLOAD_CODE: '500' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::warning::/);
    expect(r.out).not.toMatch(/::error::/);
    rmSync(d, { recursive: true, force: true });
  });

  it('сборка не удалась — предупреждение, вложения не выдумываются', () => {
    const d = area();
    sh('node', 'exit 1\n');
    const r = asset('all', d);
    sh('node', NODE_STUB);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::warning::/);
    expect(r.curl).not.toMatch(/assets\?name=/);
    rmSync(d, { recursive: true, force: true });
  });
});

// ── «Дотянуть данные PR» кнопкой (MD-05; владелица 22.11.2026, вариант «б») ──────────────────────────────
// Операция была только в бэкенде и в установщике: запустить её на нашей среде мог лишь человек с токеном
// суперадмина, и смоук RFD2-MD05 оставался красным «по данным». Прогон берёт служебную учётку lore-ci-ops
// из Infisical среды и получает токен сам.
describe('MD-05 · прогон «Дотянуть данные PR»', () => {
  const WF = '.github/workflows/lore-pr-backfill.yml';
  const SH = '.github/scripts/lore-pr-backfill.sh';

  it('запускается только руками, с выбором среды и отдельным согласием на запись', () => {
    const y = read(WF);
    expect(y).toMatch(/workflow_dispatch:/);
    // Автоматических запусков у прогона нет: он пишет в базу среды, и срабатывать «сам» не должен.
    for (const auto of ['\n  push:', '\n  pull_request:', '\n  schedule:']) expect(y).not.toContain(auto);
    expect(y).toMatch(/options: \[preprod, prod\]/);
    expect(y).toMatch(/apply:[\s\S]*default: 'false'/);
  });

  it('две дотяжки на одной среде не идут параллельно и не отменяют друг друга', () => {
    const y = read(WF);
    expect(y).toMatch(/group: lore-pr-backfill-\$\{\{ inputs\.environment \}\}/);
    expect(y).toMatch(/cancel-in-progress: false/);
  });

  it('учётка берётся из Infisical среды, токен — у Keycloak той же среды', () => {
    const s = read(SH);
    expect(s).toMatch(/LORE_CI_OPS_CLIENT_ID/);
    expect(s).toMatch(/LORE_CI_OPS_CLIENT_SECRET/);
    expect(s).toMatch(/REALM="omilorePreprod"/);
    expect(s).toMatch(/REALM="omilore"/);
    expect(s).toMatch(/\/kc\/realms\/\$REALM/);
    expect(s).toMatch(/grant_type=client_credentials/);
    // Среда задаёт И адрес, И realm: иначе прогон с выбором «preprod» сходил бы токеном прода.
    expect(s).toMatch(/preprod\) BASE=.*REALM="omilorePreprod"/);
  });

  it('пробный прогон идёт ВСЕГДА, настоящий — только при apply=true', () => {
    const s = read(SH);
    expect(s).toMatch(/pr-backfill --url "\$BASE" --limit "\$LIMIT" --dry-run/);
    expect(s).toMatch(/if \[ "\$APPLY" = true \]/);
    // Настоящий прогон стоит ПОСЛЕ пробного и не запускается, если пробный упал.
    expect(s.indexOf('--dry-run')).toBeLessThan(s.indexOf('"$APPLY" = true'));
    expect(s).toMatch(/настоящий не запускаю/);
  });

  it('секреты не печатаются: токен в выводе затирается', () => {
    const s = read(SH);
    expect(s).toMatch(/Bearer \*\*\*/);
    expect(s).not.toMatch(/echo .*\$CLIENT_SECRET/);
    expect(s).not.toMatch(/echo .*\$LORE_TOKEN/);
  });

  it('неизвестная среда — отказ словами, а не молчаливый preprod', () => {
    const s = read(SH);
    expect(s).toMatch(/среда «\$ENVN» неизвестна/);
  });
});

// ── Зеркало SeidrStudio на мажорном релизе (22.11.2026) ──────────────────────
// Слово владелицы: «я попросила всё, что едет, продублировать как зеркала и выносить при смене x.y релизов».
// Смысл: друг, которому отдали пакет установки, должен иметь возможность посмотреть исходники того, что ставит.
// Поэтому зеркало обновляется на vX.Y.0 и молчит на патчах — иначе оно пушит каждый патч и обходит правило.
describe('зеркало SeidrStudio: мажорный тег, громкий BLOCKED без секрета', () => {
  const relSteps = () => steps(job('.github/workflows/lore-release.yml', 'publish'));
  const mirror = () => relSteps().find((s) => /Mirror main \+ tag to SeidrStudio/.test(s.name ?? s.body));

  it('шаг есть и стоит в джобе публикации', () => {
    expect(mirror(), 'шаг зеркала SeidrStudio в джобе publish').toBeTruthy();
  });

  it('патчи не зеркалятся: условие на vX.Y.0', () => {
    expect(mirror()!.body).toMatch(/v\[0-9\]\+\\.\[0-9\]\+\\.0\$|v\[0-9\]\+\.\[0-9\]\+\.0\$/);
    expect(mirror()!.body).toMatch(/не трогаем/);
  });

  it('нет секрета — громкий BLOCKED с выходом из разблокировки, а не тихий пропуск', () => {
    const b = mirror()!.body;
    expect(b).toMatch(/BLOCKED/);
    expect(b).toMatch(/MIRROR_PUSH_TOKEN/);
    expect(b, 'сказано, кто разблокирует').toMatch(/выпускает владелица|кладёт CICDGitHub/);
  });

  it('тег обязан быть в main — зеркало отражает релизы, а не произвольные точки', () => {
    expect(mirror()!.body).toMatch(/merge-base --is-ancestor/);
  });

  it('отставшее зеркало не роняет уже опубликованный релиз', () => {
    expect(mirror()!.body.length > 0).toBe(true);
    expect(JSON.stringify(mirror())).toMatch(/continue-on-error/);
  });
});
