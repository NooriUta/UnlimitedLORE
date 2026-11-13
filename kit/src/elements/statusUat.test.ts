// Статус задачи «UAT — приёмка» (код uat, 🧪), правило владелицы 13.11.2026:
// после 🚀 READY FOR DEPLOY агент проверяет задачу на стенде как пользователь и
// переводит её в UAT; принимает и ставит done только человек.
// Выбор владелицы 13.11.2026 (minilore ask): индиго + иконка stamper.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { statusMeta, KNOWN_STATUSES } from './statusMeta';
import { TASK_STATUSES } from '../tasks/taskGroups';
import { KIT_COLOR_TOKENS } from '../core/validate';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

describe('статус uat', () => {
  it('иконка stamper, свой цвет --st-uat, категория «на проверке», как у RFD', () => {
    expect(statusMeta('uat')).toEqual({ code: 'uat', icon: 'stamper', color: 'var(--st-uat)', category: 'review' });
  });

  it('в жизненном цикле стоит между ready_for_deploy и done', () => {
    for (const list of [KNOWN_STATUSES, [...TASK_STATUSES]]) {
      const i = list.indexOf('ready_for_deploy');
      expect(list[i + 1]).toBe('uat');
      expect(list[i + 2]).toBe('done');
    }
  });

  it('токен цвета разрешён и задан во всех четырёх блоках палитры', () => {
    expect(KIT_COLOR_TOKENS).toContain('st-uat');
    const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');
    expect(css.match(/--st-uat:/g)?.length).toBe(4);
  });

  it('подпись есть в обеих локалях', () => {
    expect((ru as Record<string, string>)['kit.tasks.status.uat']).toBe('UAT — приёмка');
    expect((en as Record<string, string>)['kit.tasks.status.uat']).toBe('UAT Testing');
  });
});
