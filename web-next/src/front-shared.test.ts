// SPRINT_UXR_S3_V2_INFRA/S3-02: v2 живёт в compose отдельным сервисом
// lore-app-next рядом с lore-app (v1), и оба фронта отдаются одним общим
// шаблоном nginx (nginx.conf.template) со скриптом старта
// docker/30-lore-public-url.sh. Расхождение здесь не видно ни tsc, ни
// рендер-тестам: у v2 просто перестаёт работать прокси /lore/, редирект на
// HTTPS или CSP — и выясняется это только на стенде.
//
// Почему сервис v2 дублирует блоки v1, а не ссылается на них YAML-якорем:
// v1 заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN), его описание в compose не
// трогаем. Синхронность держит этот тест, а не общий якорь.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webNext = resolve(here, '..');
const repo = resolve(webNext, '..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const compose = () => read(resolve(repo, 'docker-compose.yml'));
const template = () => read(resolve(repo, 'nginx.conf.template'));
const dockerV1 = () => read(resolve(repo, 'Dockerfile'));
const dockerV2 = () => read(resolve(webNext, 'Dockerfile'));

/** Блок сервиса верхнего уровня (отступ 2) без строк-комментариев. */
function service(name: string): string {
  const lines = compose().split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return '';
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break; // следующий сервис или раздел
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    out.push(line.replace(/\s+#.*$/, ''));
  }
  return out.join('\n');
}

/** Содержимое подраздела сервиса (отступ 4), например environment. */
function section(svc: string, key: string): string[] {
  const lines = service(svc).split('\n');
  const start = lines.findIndex((l) => l === `    ${key}:`);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    out.push(line.trim());
  }
  return out;
}

const loreVarsInTemplate = () =>
  [...new Set([...template().matchAll(/\$\{(LORE_[A-Z_]+)\}/g)].map((m) => m[1]))].sort();

describe('compose: сервис lore-app-next', () => {
  it('объявлен и собирается из web-next/Dockerfile с контекстом в корне репо', () => {
    const svc = service('lore-app-next');
    expect(svc).not.toBe('');
    expect(svc).toMatch(/^ {6}context: \.$/m);
    expect(svc).toMatch(/^ {6}dockerfile: web-next\/Dockerfile$/m);
  });

  it('публикует свой порт, не 4400 (он у v1) и не 4401 (dev-сервер v2)', () => {
    const ports = section('lore-app-next', 'ports').join('\n');
    expect(ports).toMatch(/:80"$/m);
    expect(ports).not.toMatch(/"4400:/);
    expect(ports).not.toMatch(/4401:/);
  });

  it('получает те же build-args auth, что v1', () => {
    expect(section('lore-app-next', 'args')).toEqual(section('lore-app', 'args'));
  });

  it('те же переменные окружения шаблона, что v1, плюс метка фронта', () => {
    const v1 = section('lore-app', 'environment');
    const v2 = section('lore-app-next', 'environment');
    for (const line of v1) expect(v2).toContain(line);
    expect(v2).toContain('LORE_FRONT: v2');
  });

  it('тот же бэкенд и хосты, что у v1 (прокси /lore/, /bench/, /tyr-*)', () => {
    expect(section('lore-app-next', 'depends_on')).toEqual(section('lore-app', 'depends_on'));
    expect(section('lore-app-next', 'extra_hosts')).toEqual(section('lore-app', 'extra_hosts'));
    expect(section('lore-app-next', 'volumes')).toEqual(section('lore-app', 'volumes'));
    expect(service('lore-app-next')).toMatch(/^ {4}restart: unless-stopped$/m);
  });

  it('сервис v1 lore-app на месте и по-прежнему на 4400 из корневого Dockerfile', () => {
    const v1 = service('lore-app');
    expect(v1).toMatch(/^ {6}context: \.$/m);
    expect(v1).not.toMatch(/dockerfile:/);
    expect(section('lore-app', 'ports')).toEqual(['- "4400:80"']);
  });

  it('Traefik-меток у v2 в основном compose нет (это S3-04/05, оверлей)', () => {
    expect(service('lore-app-next')).not.toMatch(/traefik/);
  });
});

describe('общий шаблон nginx на оба фронта', () => {
  it('оба образа кладут один и тот же nginx.conf.template', () => {
    const line = 'COPY nginx.conf.template /etc/nginx/templates/default.conf.template';
    expect(dockerV1()).toContain(line);
    expect(dockerV2()).toContain(line);
  });

  it('оба образа запускают общий скрипт старта docker/30-lore-public-url.sh', () => {
    const line = 'COPY docker/30-lore-public-url.sh /docker-entrypoint.d/30-lore-public-url.sh';
    expect(dockerV1()).toContain(line);
    expect(dockerV2()).toContain(line);
    expect(dockerV2()).toMatch(/chmod \+x \/docker-entrypoint\.d\/30-lore-public-url\.sh/);
  });

  // Ловушка envsubst: подставляются ТОЛЬКО определённые переменные. Новая
  // ${LORE_X} в шаблоне без ENV-дефолта в образе остаётся в конфиге как есть,
  // nginx читает её как свою неизвестную переменную и не стартует — у того
  // фронта, где дефолт забыли.
  it('каждая ${LORE_*} шаблона имеет ENV-дефолт в обоих образах', () => {
    const vars = loreVarsInTemplate();
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) {
      expect(dockerV1(), `Dockerfile (v1): нет ENV ${v}`).toMatch(new RegExp(`\\b${v}=""`));
      expect(dockerV2(), `web-next/Dockerfile (v2): нет ENV ${v}`).toMatch(new RegExp(`\\b${v}=""`));
    }
  });

  it('каждая ${LORE_*} шаблона передаётся из compose обоим сервисам', () => {
    for (const v of loreVarsInTemplate()) {
      const want = `${v}: \${${v}:-}`;
      expect(section('lore-app', 'environment'), `lore-app: нет ${v}`).toContain(want);
      expect(section('lore-app-next', 'environment'), `lore-app-next: нет ${v}`).toContain(want);
    }
  });

  it('шаблон не привязан к одному фронту: прокси /lore/ и /bench/ на lore-backend', () => {
    const t = template();
    expect(t).toMatch(/location \/lore\/ \{\r?\n\s+proxy_pass \$lore_backend;/);
    expect(t).toMatch(/location \/bench\/ \{\r?\n\s+proxy_pass \$lore_backend;/);
    expect(t).toMatch(/ОБЩИЙ для обоих фронтов/);
  });

  // v2 на отдельной машине (lore-host): сервиса lore-backend там нет, а литерал
  // в proxy_pass резолвится на СТАРТЕ — nginx падал бы с [emerg] host not found.
  // Адрес бэкенда — переменная; пусто = прежний lore-backend:9100 (v1 не меняется).
  it('адрес бэкенда — LORE_BACKEND_URL, пусто = lore-backend:9100', () => {
    const t = template();
    expect(t).toMatch(/map "\$\{LORE_BACKEND_URL\}" \$lore_backend \{[^}]*""\s+http:\/\/lore-backend:9100;[^}]*default\s+"\$\{LORE_BACKEND_URL\}";/);
    expect(t).not.toMatch(/proxy_pass http:\/\/lore-backend:9100;/);
  });

  it('Host к бэкенду — LORE_BACKEND_HOST, пусто = $host (иначе Traefik вернёт запрос в v2 — петля)', () => {
    const t = template();
    expect(t).toMatch(/map "\$\{LORE_BACKEND_HOST\}" \$lore_backend_host \{[^}]*""\s+\$host;[^}]*default\s+"\$\{LORE_BACKEND_HOST\}";/);
    for (const loc of ['lore', 'bench']) {
      const block = t.split(`location /${loc}/ {`)[1].split('}')[0];
      expect(block, loc).toMatch(/proxy_set_header Host \$lore_backend_host;/);
      expect(block, loc).toMatch(/proxy_ssl_server_name on;/);
    }
  });

  // S4-STALE-CHUNK: после выкатки старых хэшированных чанков нет, а SPA-фолбэк
  // отдавал на их адрес index.html (200, text/html) — браузер получал HTML
  // вместо JS. Отсутствующий /assets/* обязан быть честным 404.
  it('отсутствующий /assets/* — 404, а не index.html (SPA-фолбэк его не накрывает)', () => {
    const t = template();
    const block = t.split('location /assets/ {')[1]?.split('}')[0] ?? '';
    expect(block).toMatch(/try_files \$uri =404;/);
    expect(block).not.toMatch(/index\.html/);
  });

  it('скрипт старта метит лог v2, а вывод v1 оставляет прежним «[LORE]»', () => {
    const sh = read(resolve(repo, 'docker/30-lore-public-url.sh'));
    expect(sh).toContain('P="[LORE${LORE_FRONT:+ $LORE_FRONT}]"');
    expect(sh).not.toMatch(/echo "\[LORE\]/);
    expect(dockerV2()).toMatch(/LORE_FRONT=v2/);
    expect(dockerV1()).not.toMatch(/LORE_FRONT/);
  });
});

describe('CI: compose-описание v2 проверяется', () => {
  it('job web-next прогоняет docker compose config и видит lore-app-next', () => {
    const ci = read(resolve(repo, '.github/workflows/frontend-ci.yml'));
    const job = ci.split(/^ {2}web-next:\s*$/m)[1] ?? '';
    expect(job).toMatch(/docker compose -f docker-compose\.yml config/);
    expect(job).toMatch(/lore-app-next/);
  });
});
