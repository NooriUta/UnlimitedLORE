// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG, второй шаг.
//
// Смысловые решения должны читать ось из шести значений, а не сравнивать
// категорию со старыми словами. Иначе с приходом модели правила молча
// перестают срабатывать: ничего не падает, просто поведение меняется, и
// никто не замечает.
//
// Здесь закреплены два таких места, найденных в коде:
//   • проверка конфигурации принимала только четыре старых значения —
//     конфигурация с осью владелицы не прошла бы вовсе;
//   • правило «четырёх глаз» сравнивало категорию с 'done' — при `finished`
//     от модели двойное подтверждение бесшумно отключилось бы.
import { describe, expect, it } from 'vitest';
import { validateKitConfig } from './validate';
import { checkTransition } from '../approval/approval';
import type { ApprovalCtx } from '../approval/approval';
import type { KitConfig, KitRecord } from './contract';

function cfg(category: string, selfApprove = false): KitConfig {
  return {
    modules: [{ id: 'm', title: 'M', icon: 'scroll-unfurled' }],
    menu: { groups: [] },
    kinds: { task: { title: 'Задача', icon: 'checkbox-tree' } },
    statuses: {
      selfApprove,
      items: [
        { code: 'doing', title: 'В работе', category: 'in_progress', icon: 'progression', color: 'var(--inf)' },
        { code: 'closed', title: 'Завершено', category: category as never, icon: 'divided-spiral', color: 'var(--suc)' },
      ],
    },
  } as unknown as KitConfig;
}

const record: KitRecord = { id: 'T-1', kind: 'task', title: 'Задача', status: 'doing', fields: {} };

const ctxOf = (config: KitConfig): ApprovalCtx => ({
  config,
  data: { records: [record], edges: [], journal: [], meta: { generated_at: 'x' } },
  role: undefined,
  user: 'claude',
});

const catErrors = (c: string) => validateKitConfig(cfg(c)).errors.filter(e => e.path.includes('category'));

describe('S4-STATUS-AXIS-CONFIG · проверка конфигурации принимает ось', () => {
  it('новые значения оси проходят проверку', () => {
    for (const c of ['not_started', 'in_progress', 'in_force', 'finished', 'withdrawn', 'unknown']) {
      expect(catErrors(c), `категория ${c}`).toEqual([]);
    }
  });

  it('прежние четыре значения тоже проходят — старые конфиги не ломаются', () => {
    for (const c of ['todo', 'active', 'done', 'cancelled']) {
      expect(catErrors(c), `категория ${c}`).toEqual([]);
    }
  });

  it('настоящая опечатка по-прежнему ловится', () => {
    expect(catErrors('finishedd').length).toBeGreaterThan(0);
  });
});

describe('S4-STATUS-AXIS-CONFIG · «четыре глаза» по оси, а не по слову', () => {
  it('finished из модели включает двойное подтверждение', () => {
    expect(checkTransition(ctxOf(cfg('finished')), record, 'closed')).toMatchObject({ ok: true, fourEyes: true });
  });

  it('старое done работает по-прежнему', () => {
    expect(checkTransition(ctxOf(cfg('done')), record, 'closed')).toMatchObject({ ok: true, fourEyes: true });
  });

  it('«действует» двойного подтверждения не требует: это не закрытие', () => {
    expect(checkTransition(ctxOf(cfg('in_force')), record, 'closed')).toMatchObject({ fourEyes: false });
  });

  it('при selfApprove двойного подтверждения нет независимо от оси', () => {
    expect(checkTransition(ctxOf(cfg('finished', true)), record, 'closed')).toMatchObject({ fourEyes: false });
  });
});
