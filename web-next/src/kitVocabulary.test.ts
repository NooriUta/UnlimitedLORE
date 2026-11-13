// Словарь LORE поверх kit (K-14, SPRINT_UXR_S7B_ADMIN/S7B-23_2). Перенесено из
// kit/src/elements/statusUat.test.ts: статус «UAT — приёмка» (код uat), правило
// владелицы 13.11.2026 — после 🚀 READY FOR DEPLOY агент проверяет задачу на стенде
// как пользователь и переводит её в UAT; принимает и ставит done только человек.
// Выбор владелицы 13.11.2026 (minilore ask): индиго + иконка stamper.
// Словарь ставит общая настройка тестов (src/test/setup.ts), как main.tsx при старте.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_STATUSES, TASK_STATUSES, kitT, statusMeta, taskStatusName } from '@seidr/kit';
import { KIT_COLOR_TOKENS } from '@seidr/kit/core';

describe('статус uat', () => {
  it('иконка stamper, свой цвет --st-uat, категория «на проверке», как у RFD', () => {
    expect(statusMeta('uat')).toEqual({ code: 'uat', icon: 'stamper', color: 'var(--st-uat)', category: 'review' });
    expect(statusMeta('ready_for_deploy')).toEqual({ code: 'ready_for_deploy', icon: 'wave-crest', color: 'var(--st-ready_for_deploy)', category: 'review' });
  });

  it('в жизненном цикле стоит между ready_for_deploy и done', () => {
    for (const list of [KNOWN_STATUSES, [...TASK_STATUSES]]) {
      const i = list.indexOf('ready_for_deploy');
      expect(i).toBeGreaterThan(-1);
      expect(list[i + 1]).toBe('uat');
      expect(list[i + 2]).toBe('done');
    }
  });

  it('токен цвета разрешён и задан во всех четырёх блоках палитры kit', () => {
    expect(KIT_COLOR_TOKENS).toContain('st-uat');
    const css = readFileSync(join(process.cwd(), '..', 'kit', 'src', 'styles', 'seidr.css'), 'utf8');
    expect(css.match(/--st-uat:/g)?.length).toBe(4);
  });

  it('подписи в обеих локалях — прежние слова', () => {
    expect(taskStatusName('ru', 'uat')).toBe('UAT — приёмка');
    expect(taskStatusName('en', 'uat')).toBe('UAT Testing');
    expect(taskStatusName('ru', 'ready_for_deploy')).toBe('Готово к выкатке');
    expect(taskStatusName('en', 'ready_for_deploy')).toBe('Ready for deploy');
  });
});

describe('слова LORE поверх нейтральных строк kit', () => {
  it('вход, поиск, журнал — прежние слова LORE', () => {
    expect(kitT('ru', 'kit.auth.loggedOut')).toBe('Вы вышли из LORE.');
    expect(kitT('ru', 'kit.palette.trigger.search')).toBe('Поиск по LORE…');
    expect(kitT('ru', 'kit.record.history.agent')).toBe('агент');
    expect(kitT('en', 'kit.auth.redirecting')).toMatch(/Keycloak/);
  });
});
