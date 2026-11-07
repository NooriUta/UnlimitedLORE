// SPRINT_UXR_S3_V2_INFRA/S3-07 — флаг «новая навигация»: переход v1 ↔ v2.
// Флаг живёт в общей cookie платформы seer-prefs (поле nav) — единственное
// хранилище, которое видят обе версии (S3-08). v1 — lore.odal…, v2 — new.lore.odal….
import { describe, expect, it } from 'vitest';
import { readSharedPrefs, writeSharedPrefs, type CookieJar } from '../storage/storage';
import { counterpartHost, readNavFlag, switchNav, switchNavUrl } from './navVersion';

function jar(initial = ''): CookieJar & { writes: string[] } {
  let cookie = initial;
  const writes: string[] = [];
  return {
    writes,
    read: () => cookie,
    write: (c: string) => {
      writes.push(c);
      const [pair] = c.split(';');
      const name = pair.split('=')[0];
      const rest = cookie.split('; ').filter(p => p && !p.startsWith(name + '='));
      cookie = [...rest, pair].join('; ');
    },
  };
}

const V1 = 'lore.odal.seidrstudio.pro';
const V2 = 'new.lore.odal.seidrstudio.pro';

describe('S3-07: адрес второй версии', () => {
  it('v1 → v2 добавляет поддомен new., v2 → v1 его снимает', () => {
    expect(counterpartHost(V1, 'v2')).toBe(V2);
    expect(counterpartHost(V2, 'v1')).toBe(V1);
  });

  it('переход в ту же версию оставляет хост как есть', () => {
    expect(counterpartHost(V2, 'v2')).toBe(V2);
    expect(counterpartHost(V1, 'v1')).toBe(V1);
  });

  it('localhost и голый IP — пары нет (null), а не выдуманный адрес', () => {
    expect(counterpartHost('localhost', 'v2')).toBeNull();
    expect(counterpartHost('192.168.3.131', 'v1')).toBeNull();
    expect(counterpartHost('', 'v2')).toBeNull();
  });

  it('URL перехода — корень второй версии с тем же протоколом и портом', () => {
    expect(switchNavUrl({ protocol: 'https:', hostname: V2, port: '' }, 'v1')).toBe(`https://${V1}/`);
    expect(switchNavUrl({ protocol: 'http:', hostname: V1, port: '4400' }, 'v2')).toBe(`http://${V2}:4400/`);
    expect(switchNavUrl({ protocol: 'http:', hostname: 'localhost', port: '4401' }, 'v1')).toBeNull();
  });
});

describe('S3-07: флаг в общей cookie seer-prefs', () => {
  it('без cookie флага нет (null) — «не выбирал» не равно «выбрал v1»', () => {
    expect(readNavFlag(jar())).toBeNull();
    expect(readNavFlag(jar('seer-prefs=' + encodeURIComponent('{"theme":"dark"}')))).toBeNull();
  });

  it('мусорное значение nav не принимается за выбор', () => {
    expect(readNavFlag(jar('seer-prefs=' + encodeURIComponent('{"nav":"v3"}')))).toBeNull();
  });

  it('switchNav пишет nav патчем поверх палитры/режима и отдаёт адрес перехода', () => {
    const j = jar('seer-prefs=' + encodeURIComponent('{"theme":"light","palette":"slate"}'));
    const url = switchNav('v1', { jar: j, location: { protocol: 'https:', hostname: V2, port: '' } });
    expect(url).toBe(`https://${V1}/`);
    expect(readSharedPrefs(j)).toEqual({ theme: 'light', palette: 'slate', nav: 'v1' });
    expect(readNavFlag(j)).toBe('v1');
  });

  it('флаг пишется с Domain общего родителя — его видят и lore.odal, и new.lore.odal', () => {
    const fromV2 = jar();
    switchNav('v1', { jar: fromV2, location: { protocol: 'https:', hostname: V2, port: '' } });
    const fromV1 = jar();
    writeSharedPrefs({ nav: 'v2' }, fromV1, V1);
    expect(fromV2.writes[0]).toContain('Domain=.odal.seidrstudio.pro');
    expect(fromV1.writes[0]).toContain('Domain=.odal.seidrstudio.pro');
  });

  it('на localhost флаг всё равно сохраняется, но перехода нет (null)', () => {
    const j = jar();
    const url = switchNav('v1', { jar: j, location: { protocol: 'http:', hostname: 'localhost', port: '4401' } });
    expect(url).toBeNull();
    expect(readNavFlag(j)).toBe('v1');
  });
});
