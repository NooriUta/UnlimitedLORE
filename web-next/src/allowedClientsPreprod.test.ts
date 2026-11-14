// SPRINT_LORE_PRODUCT_BACKLOG/MINI-01-AZP-ALLOWLIST — список клиентов токена включён ТОЛЬКО на
// препроде (владелица 14.11.2026: «включи разрешённых клиентов только на препроде»).
// Сторож держит три утверждения, и каждое ломает своё:
//  1. compose передаёт настройку в контейнер бэкенда — без этого переменная шага выкатки
//     никуда не доходит, и «включено» было бы только на бумаге;
//  2. выкатка препрода задаёт непустой список с веб-клиентом, мобилкой, сервером miniLORE и MCP;
//  3. выкатка прода список НЕ задаёт — там проверка выключена до решения владелицы.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

describe('MINI-01 · список клиентов: препрод — да, прод — нет', () => {
  it('compose передаёт lore.auth.allowed-clients в бэкенд из LORE_AUTH_ALLOWED_CLIENTS', () => {
    expect(read('docker-compose.yml')).toMatch(/- lore\.auth\.allowed-clients=\$\{LORE_AUTH_ALLOWED_CLIENTS:-\}/);
  });

  it('выкатка препрода задаёт список: lore-app, mobilepoc-app, minilore-srv, lore-mcp-*', () => {
    const cd = read('.github/workflows/lore-cd.yml');
    const line = cd.split('\n').find(l => l.includes('LORE_AUTH_ALLOWED_CLIENTS:')) ?? '';
    for (const c of ['lore-app', 'mobilepoc-app', 'minilore-srv', 'lore-mcp-*']) expect(line, c).toContain(c);
  });

  // 14.11.2026, промо #1368: LORE CD препрода красный — собственная проба /lore/version ходит сервисным
  // клиентом из секрета LORE_CD_PROBE_CLIENT_ID, его в списке не было → 403 CLIENT_NOT_ALLOWED.
  // Правило: клиент пробы CD всегда в списке (имя — из того же секрета, без копии значения в коде).
  it('в список препрода всегда входит клиент собственной пробы CD', () => {
    const cd = read('.github/workflows/lore-cd.yml');
    const line = cd.split('\n').find(l => l.includes('LORE_AUTH_ALLOWED_CLIENTS:')) ?? '';
    expect(cd).toContain('PROBE_CLIENT_ID: ${{ secrets.LORE_CD_PROBE_CLIENT_ID }}');
    expect(line).toContain('secrets.LORE_CD_PROBE_CLIENT_ID');
  });

  it('выкатка прода список не задаёт — проверка там выключена', () => {
    for (const wf of ['.github/workflows/lore-release.yml', '.github/workflows/lore-host-swap-image.yml']) {
      expect(read(wf), wf).not.toContain('LORE_AUTH_ALLOWED_CLIENTS');
    }
  });
});
