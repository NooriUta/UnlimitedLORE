import { describe, expect, it } from 'vitest';
import { projectLabels, applyRoleChange } from './projectLabel';

// «Страница не дообновилась» (05.11.2026): попап ролей после записи ждал
// перезагрузки карты. Теперь он применяет ответ сам — правило применения тут.
describe('applyRoleChange', () => {
  const cur = [{ project: 'AIDA/udwe-engine', role: 'reader' }, { project: 'AIDA/x', role: 'owner' }];
  it('add в новый проект добавляет', () => {
    expect(applyRoleChange([], 'AIDA/udwe-engine', 'reader', 'add')).toEqual([{ project: 'AIDA/udwe-engine', role: 'reader' }]);
  });
  it('add в проект с ролью — заменяет роль, не дублирует проект', () => {
    const r = applyRoleChange(cur, 'AIDA/udwe-engine', 'owner', 'add');
    expect(r.filter(x => x.project === 'AIDA/udwe-engine')).toEqual([{ project: 'AIDA/udwe-engine', role: 'owner' }]);
    expect(r).toHaveLength(2);
  });
  it('remove убирает проект и не трогает остальные', () => {
    expect(applyRoleChange(cur, 'AIDA/udwe-engine', 'reader', 'remove')).toEqual([{ project: 'AIDA/x', role: 'owner' }]);
  });
});

// Найдено 05.11.2026 на карточке ivanovalex32: AIDA/udwe-mig-gen и
// ciadmin/udwe-mig-gen обе рисовались чипом «udwe-mig-gen · owner» — два
// разных проекта неотличимы. Короткое имя допустимо только пока оно однозначно.
describe('projectLabels', () => {
  it('однозначный хвост — короткое имя', () => {
    const m = projectLabels(['AIDA/udwe-engine', 'NooriUta/UnlimitedLORE']);
    expect(m.get('AIDA/udwe-engine')).toBe('udwe-engine');
    expect(m.get('NooriUta/UnlimitedLORE')).toBe('UnlimitedLORE');
  });

  it('совпавший хвост — полный slug у обоих', () => {
    const m = projectLabels(['AIDA/udwe-mig-gen', 'ciadmin/udwe-mig-gen', 'ivanovalex32/UDWE']);
    expect(m.get('AIDA/udwe-mig-gen')).toBe('AIDA/udwe-mig-gen');
    expect(m.get('ciadmin/udwe-mig-gen')).toBe('ciadmin/udwe-mig-gen');
    expect(m.get('ivanovalex32/UDWE')).toBe('UDWE');
  });

  it('регистр хвоста не делает его уникальным', () => {
    const m = projectLabels(['a/Lore', 'b/lore']);
    expect(m.get('a/Lore')).toBe('a/Lore');
    expect(m.get('b/lore')).toBe('b/lore');
  });

  it('slug без владельца и повтор одного slug-а', () => {
    const m = projectLabels(['solo', 'x/solo2', 'x/solo2']);
    expect(m.get('solo')).toBe('solo');
    expect(m.get('x/solo2')).toBe('solo2');
  });
});
