// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED: MCP по адресу хоста LORE
// выкатывается вместе со стендом. Владелица 19.11.2026: «мне надоело локально
// mcp пересобирать» → «mcp лучше по адресу lore host».
//
// Сторожим проводку целиком, потому что каждое звено отказывает молча:
//   compose без сервиса — /mcp отвечает 502; сервис с портом наружу — MCP
//   открыт мимо TLS; nginx с буферизацией — поток SSE склеивается и клиент
//   висит до таймаута; CD без сборки/выкатки — стенд живёт на старом MCP.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

/** Блок сервиса compose: от «  name:» до следующего сервиса верхнего уровня. */
function service(file: string, name: string): string {
  const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|\\n[a-z]|$)`).exec(read(file));
  return m ? m[1] : '';
}

/** Блок location nginx по точному заголовку. */
function location(head: string): string {
  const t = read('nginx.conf.template');
  const i = t.indexOf(`location ${head} {`);
  if (i < 0) return '';
  return t.slice(i, t.indexOf('\n    }', i));
}

describe('compose: сервис lore-mcp', () => {
  const s = () => service('docker-compose.yml', 'lore-mcp');
  it('собирается из mcp-server в HTTP-режиме, бэкенд — по имени в сети compose', () => {
    expect(s()).toMatch(/context: \.\/mcp-server/);
    expect(s()).toMatch(/LORE_MCP_TRANSPORT: http/);
    expect(s()).toMatch(/LORE_BACKEND_URL: .*http:\/\/lore-backend:9100/);
    expect(s()).toMatch(/LORE_BUILD_COMMIT: \$\{LORE_BUILD_COMMIT/);
  });
  it('порта наружу нет — вход только через nginx фронта', () => {
    expect(s()).not.toMatch(/\bports:/);
    expect(service('docker-compose.preprod.yml', 'lore-mcp')).not.toMatch(/\bports:/);
  });
  it('секретов OIDC у сервиса нет (токен — от клиента)', () => {
    expect(s()).not.toMatch(/LORE_MCP_CLIENT_(ID|SECRET)|LORE_OIDC_ISSUER/);
  });
  it('препрод: образ с тегом выкатки, как у остальных сервисов', () => {
    expect(service('docker-compose.preprod.yml', 'lore-mcp')).toMatch(/image: unlimitedlore-lore-mcp:\$\{LORE_IMAGE_TAG/);
  });
});

describe('mcp-server/Dockerfile', () => {
  const d = () => read('mcp-server/Dockerfile');
  it('HTTP-режим, dist/index.js, профили рядом с dist, отметка сборки из аргумента', () => {
    expect(d()).toMatch(/LORE_MCP_TRANSPORT=http/);
    expect(d()).toMatch(/CMD \["node", "dist\/index\.js"\]/);
    expect(d()).toMatch(/agent-profiles/);
    expect(d()).toMatch(/ARG LORE_BUILD_COMMIT/);
  });
});

describe('nginx: /mcp → lore-mcp, поток не буферизуется', () => {
  for (const head of ['= /mcp', '/mcp/']) {
    it(`location ${head}: адрес через переменную (nginx поднимается без сервиса), HTTP/1.1`, () => {
      const b = location(head);
      expect(b).not.toBe('');
      expect(b).toMatch(/set \$lore_mcp_upstream lore-mcp:9200;/);
      expect(b).toMatch(/proxy_pass http:\/\/\$lore_mcp_upstream;/);
      expect(b).toMatch(/proxy_http_version 1\.1;/);
      expect(b).toMatch(/proxy_buffering off;/);
    });
  }
  it('/mcp: длинный read_timeout и тело крупнее дефолтного 1m', () => {
    const b = location('= /mcp');
    expect(b).toMatch(/proxy_read_timeout 3600s;/);
    expect(b).toMatch(/client_max_body_size \d+m;/);
  });
  it('голого префикса `location /mcp {` нет — он поймал бы SPA-маршруты /mcp…', () => {
    expect(read('nginx.conf.template')).not.toMatch(/location \/mcp \{/);
  });
});

describe('lore-cd.yml: сборка, выкатка и проба lore-mcp', () => {
  const cd = () => read('.github/workflows/lore-cd.yml');
  it('ручной запуск умеет выкатить только MCP', () => {
    expect(cd()).toMatch(/options: \[[^\]]*\bmcp\b[^\]]*\]/);
  });
  it('образ собирается скриптом с повтором и выкатывается --no-deps под флагом mcp', () => {
    expect(cd()).toMatch(/if: steps\.mode\.outputs\.live == 'true' && steps\.which\.outputs\.mcp == 'true'\n\s+run: bash \.github\/scripts\/compose-build-retry\.sh lore-mcp/);
    expect(cd()).toMatch(/docker compose up -d --no-deps lore-mcp/);
  });
  it('после выкатки /mcp/health пробуется через nginx v2 и сверяется коммит', () => {
    // Та же проба, что /lore/version: JSON, а не SPA-заглушка, и коммит выкатки.
    expect(cd()).toMatch(/post-deploy-probe\.sh version "[^"]*" http:\/\/lore-app-next\/mcp\/health "\$LORE_BUILD_COMMIT"/);
  });
});
