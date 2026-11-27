// Сторож «в образе и бандле нет ни одного нашего имени хоста» (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE;
// владелица: «гвозди убери из инсталлятора»). Все адреса задаются настройками при ЗАПУСКЕ.
//
// Что сканируется. Тесты web-next гоняются в CI ДО `npm run build`, поэтому бандл здесь не собрать — сторож
// читает то, из чего бандл и образы собираются:
//   • web-next/src/** — без *.test.*, *.spec.*, e2e и тестовых помощников;
//   • kit — dist установленного пакета @seidr/kit (K5-PACKAGE-DELIVERY): ровно то, что уедет в бандл;
//   • backend/src/main/** — код и ресурсы образа бэкенда;
//   • образ веба: web-next/Dockerfile, docker/*.sh; пакет установки deploy/install/** (кроме README);
//   • web-next/dist/** — если бандл собран локально (после `npm run build`), он проверяется тоже.
// Строки-комментарии (//, /*, *, #) не считаются: адрес в пояснении в рантайм не попадает.
// Наши собственные стенды (docker-compose.preprod.yml, docker/lore-host, .github) — не образ и не бандл, их не трогаем.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIT_PKG_DIR } from './test/kitPaths';

const repo = resolve(__dirname, '../..');
const OUR_HOSTS = /seidrstudio\.pro|\bodal\./i;

/** Разрешённые места — с причиной. Путь от корня репозитория (префикс), match — необязательный фильтр строки. */
const ALLOWED: { path: string; match?: RegExp; why: string }[] = [
  { path: 'web-next/src/standSmoke/', why: 'тестовый контур нашего стенда (стенд-смоук): по определению знает наши адреса' },
  { path: 'web-next/src/nav/navVersion.ts', why: 'переключатель v1/v2 с общей cookie на нашем домене; уходит вместе с v1' },
  {
    path: 'backend/src/main/resources/lore-model/lore-model.json', match: /"definition"/,
    why: 'пример в тексте определения поля full_path (модель приходит из LORE), а не адрес вызова',
  },
];

// ── Пакет установки (решение владелицы 21.11.2026: «в пакете установки не должно быть наших настроек») ──────────
// Не только домены: наши realm, машины и хосты, адреса LAN, наши org/repo. Комментарии тоже считаются — пакет
// уезжает к чужим людям целиком, и README показывает окно установщика. Умолчания-примеры — только нейтральные.
// 22.11.2026 правило расширено по разбору документации: сторож искал только наши ДОМЕНЫ и хосты, а в пакете
// нашлись имена — клиент разработчика мобильного приложения и упоминания «нашего стенда и прода». Такое
// вычитывается глазами ровно один раз, потом возвращается; поэтому перечень, а не вычитка.
// Исключение одно и названо ниже: схема возврата приложения вшита в APK и меняется только вместе с ним.
const INSTALL_OURS = /seidrstudio\.pro|\bodal\.|omilore|\blore-host\b|\bci-server\b|lorcetus|ryzenai|192\.168\.|\bAIDA\/|NooriUta|UnlimitedLORE|mobilepoc|на (нашем|нашей) (стенде|проде|инфраструктуре)/i;
const INSTALL_ALLOWED: { file: RegExp; match: RegExp; why: string }[] = [
  {
    file: /(^|\/)README\.md$/, match: /seidrstudio\.pro|\bAIDA\/|NooriUta|UnlimitedLORE/i,
    why: 'справочная ссылка в документации на исходники проекта (владелица 21.11: «ссылку на наш git оставь для информации в доках») — не настройка',
  },
  {
    file: /(^|\/)install\.sh$/, match: /GHCR_OWNER="\$\{GHCR_OWNER:-nooriuta\}"/,
    why: 'реестр выпусков образов LORE (ghcr) по умолчанию для мажорной версии без --build; вынесено владелице на решение',
  },
  {
    file: /./, match: /pro\.seidrstudio\.minilore/,
    why: 'схема возврата мобильного приложения вшита в APK манифестом (appAuthRedirectScheme): её нельзя заменить на нейтральную, не пересобрав приложение — владелец заводит ИМЕННО её как redirect в своём Keycloak',
  },
  {
    file: /(^|\/)install\.sh$/, match: /needle in "mobilepoc-app"/,
    why: 'строка самопроверки, которая ЛОВИТ умолчание разработчика в плане установки: имя нужно ей как образец для поиска, второе имя она собирает на месте',
  },
];

/** Нарушения в тексте файла пакета установки (имя — для разрешённого списка). */
function installOffenders(name: string, text: string): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (!INSTALL_OURS.test(line)) return;
    if (INSTALL_ALLOWED.some(a => a.file.test(name) && a.match.test(line))) return;
    hits.push(`${name}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
  return hits;
}

const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|[\\/](e2e|__tests__|test-utils)[\\/]|\.d\.ts$/;
const TEXT = /\.([cm]?[jt]sx?|json|properties|ya?ml|html|css|sh|java|conf|template|env|example)$|Dockerfile/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*|#|<!--)/.test(line);

function offenders(files: string[], opts: { comments: boolean }): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const rel = relative(repo, f).replace(/\\/g, '/');
    if (SKIP_FILE.test(rel) || !TEXT.test(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!OUR_HOSTS.test(line)) return;
      if (opts.comments && isComment(line)) return;
      if (ALLOWED.some(a => rel.startsWith(a.path) && (!a.match || a.match.test(line)))) return;
      hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  return hits;
}

describe('SELF-PROVISION · в образе и бандле нет наших имён хостов', () => {
  it('исходники веба, kit, бэкенда (src/main), образа веба и пакета установки', () => {
    const files = [
      ...walk(resolve(repo, 'web-next/src')),
      ...walk(resolve(KIT_PKG_DIR, 'dist')),
      ...walk(resolve(repo, 'backend/src/main')),
      resolve(repo, 'web-next/Dockerfile'),
      ...walk(resolve(repo, 'docker')).filter(f => /\.sh$/.test(f)),
      ...walk(resolve(repo, 'deploy/install')).filter(f => !/README\.md$/.test(f)),
    ];
    expect(files.length).toBeGreaterThan(100); // положительный контроль: сканер действительно что-то читает
    expect(offenders(files, { comments: true })).toEqual([]);
  });

  it('собранный бандл web-next/dist — если есть (локально после npm run build)', () => {
    const dist = resolve(repo, 'web-next/dist');
    if (!existsSync(dist)) return; // в CI тесты идут до сборки — тогда работает проверка исходников выше
    expect(offenders(walk(dist), { comments: false })).toEqual([]);
  });

  it('сторож ловит гвоздь (положительный контроль)', () => {
    expect(OUR_HOSTS.test("const u = 'https://git.seidrstudio.pro';")).toBe(true);
    expect(OUR_HOSTS.test("const u = 'https://volva.odal.example';")).toBe(true);
    expect(OUR_HOSTS.test("const u = 'https://git.example.org';")).toBe(false);
    expect(isComment('  // см. lore.odal.seidrstudio.pro')).toBe(true);
    expect(isComment("  href: 'https://lore.odal.seidrstudio.pro',")).toBe(false);
  });

  it('у каждого исключения названа причина', () => {
    for (const a of ALLOWED) expect(a.why.length, a.path).toBeGreaterThan(20);
    for (const a of INSTALL_ALLOWED) expect(a.why.length, String(a.file)).toBeGreaterThan(20);
  });
});

describe('SELF-PROVISION · в пакете установки нет наших настроек', () => {
  it('deploy/install/** — все файлы, включая .env.example, README и комментарии', () => {
    const files = walk(resolve(repo, 'deploy/install'));
    expect(files.some(f => f.endsWith('.env.example'))).toBe(true);
    const hits = files.flatMap(f => installOffenders(relative(repo, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('вшитая копия пакета (install-bundle.json — то, что кладёт install-bundle-sync.mjs)', () => {
    const b = JSON.parse(readFileSync(resolve(repo, 'scripts/model-migration/rules/install-bundle.json'), 'utf8')) as { files: Record<string, string> };
    expect(Object.keys(b.files).length).toBeGreaterThanOrEqual(4);
    const hits = Object.entries(b.files).flatMap(([name, text]) => installOffenders('install-bundle.json/' + name, text));
    expect(hits).toEqual([]);
  });

  it('сторож пакета ловит наши realm, машины, LAN и org (положительный контроль)', () => {
    for (const bad of ['LORE_OIDC_ISSUER=https://kc/realms/omilore', '# эмуляция на ryzenai', 'ssh ci-server', 'http://192.168.3.131:4400', 'NooriUta/UnlimitedLORE', 'context: https://git.seidrstudio.pro/AIDA/forgejo-mcp.git'])
      expect(installOffenders('docker-compose.install.yml', bad), bad).toHaveLength(1);
    expect(installOffenders('README.md', 'исходники: https://git.seidrstudio.pro/AIDA/UnlimitedLORE')).toEqual([]);
    expect(installOffenders('README.md', 'realm omilore')).toHaveLength(1);
    expect(installOffenders('.env.example', 'LORE_OIDC_ISSUER=https://lore.example.org/realms/lore')).toEqual([]);
  });
});
