// SPRINT_LORE_EXT_AUDIT_1190/AUD-DOCS · AUD-SUPERADMIN (issues SeidrStudio/UnlimitedLORE #4, #5, #8).
//
// Внешний аудит установки 1.19.0: человек по документации не узнал, как назвать базу (LORE_DB), какой
// ролью создаётся проект (superadmin, без дефиса), что значит пустой LORE_PUBLIC_URL и как подключить
// агента к MCP по HTTP (/mcp, LORE_MCP_TRANSPORT). Сторож: эти вещи названы в README пакета и в
// docs/DEPLOYMENT.md, а сам пакет действительно поднимает MCP по HTTP за nginx (#4 — поставка, не только текст).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const README = read('../../deploy/install/README.md');
const DEPLOYMENT = read('../../docs/DEPLOYMENT.md');
const COMPOSE = read('../../deploy/install/docker-compose.install.yml');
const NGINX = read('../../nginx.conf.template');

test('#5: LORE_DB описан — имя базы задаётся переменной, system_aida_lore — только умолчание', () => {
  for (const [name, doc] of [['README пакета', README], ['DEPLOYMENT.md', DEPLOYMENT]]) {
    assert.match(doc, /`LORE_DB`[^\n]*(имя базы|имя БД)/i, `${name}: LORE_DB не объяснён`);
    assert.match(doc, /LORE_DB[^\n]*system_aida_lore|system_aida_lore[^\n]*LORE_DB/, `${name}: не сказано, что system_aida_lore — умолчание LORE_DB`);
  }
  assert.doesNotMatch(DEPLOYMENT, /БД называется именно `system_aida_lore`/, 'DEPLOYMENT.md всё ещё требует жёсткое имя базы');
});

test('#8: роль создания проекта — superadmin одним словом; super-admin — синоним; admin не создаёт проект', () => {
  for (const [name, doc] of [['README пакета', README], ['DEPLOYMENT.md', DEPLOYMENT]]) {
    assert.match(doc, /LORE_SEER_ROLE=superadmin/, `${name}: нет LORE_SEER_ROLE=superadmin`);
    assert.match(doc, /project_new/, `${name}: не сказано, что project_new требует superadmin`);
    assert.match(doc, /super-admin[^\n]*синоним|синоним[^\n]*super-admin/, `${name}: не сказано, что super-admin — синоним`);
  }
});

test('LORE_PUBLIC_URL: пусто — редиректа нет, приложение работает', () => {
  for (const [name, doc] of [['README пакета', README], ['DEPLOYMENT.md', DEPLOYMENT]]) {
    assert.match(doc, /`LORE_PUBLIC_URL`[^\n]*(пуст|не задан)[^\n]*редирект/i, `${name}: не сказано, что пустой LORE_PUBLIC_URL выключает редирект`);
  }
});

test('#4: MCP по HTTP — адрес /mcp и LORE_MCP_TRANSPORT названы в обоих документах', () => {
  for (const [name, doc] of [['README пакета', README], ['DEPLOYMENT.md', DEPLOYMENT]]) {
    assert.match(doc, /\/mcp\b/, `${name}: нет адреса /mcp`);
    assert.match(doc, /LORE_MCP_TRANSPORT/, `${name}: нет LORE_MCP_TRANSPORT`);
  }
});

test('#4 поставка: пакет поднимает lore-mcp в HTTP-режиме, nginx веба проксирует /mcp и /mcp/health', () => {
  const svc = /\n {2}lore-mcp:\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|\nvolumes:)/.exec(COMPOSE);
  assert.ok(svc, 'в compose пакета нет сервиса lore-mcp');
  assert.match(svc[1], /- LORE_MCP_TRANSPORT=http\b/, 'lore-mcp не в HTTP-режиме');
  assert.match(svc[1], /- LORE_MCP_PORT=9200\b/);
  assert.match(svc[1], /- LORE_BACKEND_URL=http:\/\/lore-backend:9100\b/);
  assert.doesNotMatch(svc[1], /\n {4}profiles:/, 'lore-mcp спрятан за профилем — по умолчанию не поднимется');
  assert.match(NGINX, /location = \/mcp \{[\s\S]*?lore-mcp:9200/, 'nginx не проксирует /mcp в lore-mcp:9200');
  assert.match(NGINX, /location \/mcp\/ \{[\s\S]*?lore-mcp:9200/, 'nginx не проксирует /mcp/ (там /mcp/health)');
});
