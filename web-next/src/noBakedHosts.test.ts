// Сторож «в образе и бандле нет ни одного нашего имени хоста» (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE;
// владелица: «гвозди убери из инсталлятора»). Все адреса задаются настройками при ЗАПУСКЕ.
//
// Что сканируется. Тесты web-next гоняются в CI ДО `npm run build`, поэтому бандл здесь не собрать — сторож
// читает то, из чего бандл и образы собираются:
//   • web-next/src/** и kit/src/** — без *.test.*, *.spec.*, e2e и тестовых помощников;
//   • backend/src/main/** — код и ресурсы образа бэкенда;
//   • образ веба: web-next/Dockerfile, docker/*.sh; пакет установки deploy/install/** (кроме README);
//   • web-next/dist/** — если бандл собран локально (после `npm run build`), он проверяется тоже.
// Строки-комментарии (//, /*, *, #) не считаются: адрес в пояснении в рантайм не попадает.
// Наши собственные стенды (docker-compose.preprod.yml, docker/lore-host, .github) — не образ и не бандл, их не трогаем.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
  {
    path: 'deploy/install/docker-compose.install.yml', match: /FORGEJO_MCP_SRC/,
    why: 'источник СБОРКИ forgejo-mcp по умолчанию (переопределяется FORGEJO_MCP_SRC/FORGEJO_MCP_IMAGE), не адрес, куда ходит установка',
  },
];

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
      ...walk(resolve(repo, 'kit/src')),
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
  });
});
