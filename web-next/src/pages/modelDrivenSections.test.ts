// SPRINT_LORE_KNOW_REGISTRY/KREG-13. Владелец 26.11.2026: «сделай, чтобы мы всё же модель использовали, а не она
// валялась отдельно». Сторож: типы выпуска 1.19.1 (skill, tag, kind, agent_session) попадают в интерфейс ИЗ МОДЕЛИ —
// у каждого есть контракт списка (surfaces.list), раздел skill есть в меню по nav модели, правка скилла пишет ключ,
// названный в модели (write.idKey), а не по таблице клиента.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { listContractOf, contractScreen } from '../lists/listContract';
import { menuFromModel } from '../shell/v2Config';
import { savePassportField } from '../record/passportSave';

// Документ /lore/model в форме ответа сервера (golden бэкенда): меню — surfaces.nav, списки — surfaces.list.
const model = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', 'backend', 'src', 'test', 'resources', 'model-golden', 'lore-model.json'), 'utf8')) as unknown;
// Схема записи, которую клиент получает от фасада /lore/record (golden бэкенда).
type W = { endpoint: string; field: string; idKey?: string };
const record = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', 'backend', 'src', 'test', 'resources', 'model-golden', 'lore-record.json'), 'utf8')) as
  Record<string, { schema_unread: { fields: { key: string; write?: W }[] } }>;

describe('KREG-13 · разделы новых типов — из модели', () => {
  for (const type of ['skill', 'tag', 'kind', 'agent_session']) {
    it(`${type}: контракт списка в модели и экран собирается из него`, () => {
      const c = listContractOf(model, type);
      expect(c, type).not.toBeNull();
      const def = contractScreen(type, c!);
      expect(def.slice).toBe(c!.slice);
    });
  }

  it('skill — пункт меню из nav модели (раздел без своего экрана не отброшен)', () => {
    const ids = menuFromModel('ru', model).flatMap(g => g.items.map(i => i.id));
    expect(ids).toContain('skill');
  });

  it('положительный контроль: тип без контракта списка — null', () => {
    expect(listContractOf(model, 'no_such_type')).toBeNull();
  });

  it('правка скилла: ключ записи — из модели (write.idKey = skill_id)', async () => {
    const f = record.skill.schema_unread.fields.find(x => x.write)!;
    expect(f.write!.idKey).toBe('skill_id');
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await savePassportField('skill', { id: 'SK-1', title: 'Скилл' }, f.key, 'x', fetchImpl as unknown as typeof fetch, null, f.write!);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body.skill_id).toBe('SK-1');
    expect(body.id).toBeUndefined();
  });
});
