// Смоук стенда не ждёт бесконечно ни одного действия (прогоны 37831 на стенде и на ryzenai 19.11.2026).
// Корень: подпись к expect вычисляется ДО проверки — `${await alert.first().innerText()}` при 0 совпадений
// ждал элемент без срока, пока не истекал весь сценарий (UI-LISTS 24 мин, RFD-AP01 6 мин), а за это время
// истекал вход у всех следующих наборов. Правило: у действий есть общий срок (actionTimeout), а текст для
// подписей берётся через textOf — он не ждёт отсутствующий элемент.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const standDir = resolve(root, 'e2e/stand');

describe('смоук стенда: ни одно действие не ждёт бесконечно', () => {
  it('у действий общий срок — actionTimeout в конфиге стенда', () => {
    const cfg = readFileSync(resolve(root, 'playwright.stand.config.ts'), 'utf8');
    expect(cfg).toMatch(/actionTimeout:\s*\d/);
  });

  it('текст элемента внутри подписи `${await …}` берётся только через textOf', () => {
    const bad: string[] = [];
    for (const f of readdirSync(standDir).filter(n => n.endsWith('.ts'))) {
      readFileSync(resolve(standDir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/\$\{\s*\(?\s*await\s+[^}]*\.(innerText|textContent|getAttribute)\(/.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
