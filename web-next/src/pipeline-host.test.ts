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
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(cd()).toMatch(/LORE_PUBLIC_URL_V2: https:\/\/preprod\.new\.lore\.odal\.seidrstudio\.pro$/m);
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
    const b1 = cdSteps().find((x) => /bundle-probe\.sh\b.*https:\/\/preprod\.lore\.odal\.seidrstudio\.pro/.test(x.body));
    const b2 = cdSteps().find((x) => /bundle-probe\.sh\b.*https:\/\/preprod\.new\.lore\.odal\.seidrstudio\.pro/.test(x.body));
    expect(b1, 'нет пробы бандла v1 по имени препрода').toBeDefined();
    expect(b2, 'нет пробы бандла v2 по имени препрода').toBeDefined();
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
      /compose-build-retry\.sh/, /docker compose up\b/, /docker compose run\b/,
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

  it('база задаётся LORE_DB (lore.db) и без неё compose не соберётся', () => {
    expect(ov()).toMatch(/- lore\.db=\$\{LORE_DB:\?/);
  });

  it('образы именуются как на проде, тег :sha8, метка revision', () => {
    for (const svc of ['lore-backend', 'lore-app', 'lore-app-next']) {
      expect(ov()).toMatch(new RegExp(`image: unlimitedlore-${svc}:\\$\\{LORE_IMAGE_TAG:\\?`));
    }
    expect((ov().match(/org\.opencontainers\.image\.revision: \$\{LORE_BUILD_COMMIT/g) ?? []).length).toBe(3);
  });

  it('базовый compose не тронут: v1 по-прежнему "4400:80"', () => {
    expect(read('docker-compose.yml')).toMatch(/- "4400:80"/);
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
});

// ── поведение скриптов ───────────────────────────────────────────────────────
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

describe.skipIf(!bashBin)('lore-host-deploy.sh resolve', () => {
  const S = '.github/scripts/lore-host-deploy.sh';

  it('находит образы препрода по родителю merge-коммита с тем же деревом', () => {
    const r0 = miniRepo();
    const imgs = join(stub, 'imgs-ok');
    writeFileSync(imgs, [
      `unlimitedlore-lore-backend:${r0.pre8} sha256:b1 ${r0.pre}`,
      `unlimitedlore-lore-app:${r0.pre8} sha256:a1 -`,
      `unlimitedlore-lore-app-next:${r0.pre8} sha256:n1 ${r0.pre}`,
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
    ].join('\n') + '\n');
    const r = run(S, ['resolve'], { CWD: r0.d, TAG: 'v9.9.9', STUB_IMAGES: imgs, DEPLOY_STATE: join(r0.d, 's.env') });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/revision/);
    rmSync(r0.d, { recursive: true, force: true });
  });
});

describe.skipIf(!bashBin)('lore-host-deploy.sh: замена тегов в compose', () => {
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

describe.skipIf(!bashBin)('preprod-db-refresh.sh: в прод и в замороженные копии не заливает', () => {
  const S = 'scripts/preprod-db-refresh.sh';
  it.each(['system_aida_lore', 'system_aida_lore_frozen_20261107', 'some_db'])('TARGET_DB=%s — отказ до любых действий', (db) => {
    const r = run(S, [], { TARGET_DB: db, ARCADEDB_ROOT_PASSWORD: 'x', R: 'false' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error::TARGET_DB=/);
  });
});

describe.skipIf(!bashBin)('preprod-gates.sh: защита от прода', () => {
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
