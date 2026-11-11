// SPRINT_UXR_S5_RECORD_TASKS/S5-08 — сохранение MD-поля со слиянием по блокам.
// 409 VERSION_CONFLICT → перечитать запись → слить по блокам: без спора —
// записать слитое с НОВОЙ версией; со спором — отказ MdMergeConflict со
// спорными блоками (их рисует поле правки kit).
import { describe, expect, it, vi } from 'vitest';
import { isMdMergeConflict } from '@seidr/kit/content';
import { saveMerging } from './passportMerge';
import { VersionConflict } from './passportSave';

const base = 'Первый.\n\nВторой.\n\nТретий.';

describe('saveMerging', () => {
  it('версия совпала — одна запись, перечитывать нечего', async () => {
    const save = vi.fn(async () => {});
    const reread = vi.fn();
    await saveMerging({ base, mine: 'Моё.', version: 'v1', save, reread });
    expect(save).toHaveBeenCalledWith('Моё.', 'v1');
    expect(reread).not.toHaveBeenCalled();
  });

  it('409 и правки разных блоков — слитый текст записан с новой версией, без потерь', async () => {
    const mine = base.replace('Первый.', 'Первый — моё.');
    const theirs = base.replace('Третий.', 'Третий — их.');
    const save = vi.fn()
      .mockRejectedValueOnce(new VersionConflict('v2', 'agent-x', 'stale'))
      .mockResolvedValueOnce(undefined);
    const rebase = vi.fn();
    await saveMerging({ base, mine, version: 'v1', save, reread: async () => ({ text: theirs, version: 'v2' }), rebase });
    expect(save).toHaveBeenLastCalledWith('Первый — моё.\n\nВторой.\n\nТретий — их.', 'v2');
    expect(rebase).toHaveBeenCalledWith({ text: theirs, version: 'v2' });
  });

  it('409 и правка одного блока обеими — MdMergeConflict только с этим спором, записи нет', async () => {
    const mine = base.replace('Второй.', 'Второй — моё.');
    const theirs = base.replace('Второй.', 'Второй — их.');
    const save = vi.fn().mockRejectedValueOnce(new VersionConflict('v2', 'agent-x', 'stale'));
    const rebase = vi.fn();
    const err = await saveMerging({ base, mine, version: 'v1', save, reread: async () => ({ text: theirs, version: 'v2' }), rebase })
      .then(() => null, e => e);
    expect(isMdMergeConflict(err)).toBe(true);
    const disputed = err.chunks.filter((c: { kind: string }) => c.kind === 'conflict');
    expect(disputed).toEqual([{ kind: 'conflict', base: 'Второй.', mine: 'Второй — моё.', theirs: 'Второй — их.' }]);
    expect(err.updatedBy).toBe('agent-x');
    expect(save).toHaveBeenCalledTimes(1);
    // Следующее сохранение пойдёт поверх ИХ текста и их версии — иначе снова 409.
    expect(rebase).toHaveBeenCalledWith({ text: theirs, version: 'v2' });
  });

  it('другой отказ — наружу как есть, без перечитывания', async () => {
    const boom = new Error('HTTP 403');
    const reread = vi.fn();
    await expect(saveMerging({ base, mine: 'x', version: 'v1', save: async () => { throw boom; }, reread })).rejects.toBe(boom);
    expect(reread).not.toHaveBeenCalled();
  });
});
