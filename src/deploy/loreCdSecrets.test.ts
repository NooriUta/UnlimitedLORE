import { describe, expect, it } from 'vitest';
import cd from '../../.github/workflows/lore-cd.yml?raw';

/**
 * SPEC-SECRETS-001: хранилище секретов — одно, Infisical, и ТОЛЬКО по
 * https://secrets.seidrstudio.pro. По http машинная личность логинится
 * открытым текстом, а секреты едут так же — по локальной сети, где живут и
 * чужие узлы. Стенд LORE поднимается этим workflow, поэтому адрес проверяется
 * здесь, а не на хосте (правка на хосте не переживает деплой).
 */
describe('lore-cd.yml: адрес хранилища секретов', () => {
  const url = /^\s*LORE_SECRETS_URL:\s*(\S+)\s*$/m.exec(cd)?.[1];

  it('задан явно', () => {
    expect(url, 'LORE_SECRETS_URL в lore-cd.yml не найден').toBeTruthy();
  });

  it('https://secrets.seidrstudio.pro, не голый http', () => {
    expect(url).toBe('https://secrets.seidrstudio.pro');
  });

  it('диагностика деплоя пробует тот же адрес, без http-дефолта', () => {
    expect(cd).not.toMatch(/LORE_SECRETS_URL:-http:/);
  });
});
