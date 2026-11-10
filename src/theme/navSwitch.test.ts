// SPRINT_UXR_S3_V2_INFRA/S3-07: сторона v1 переключателя «новая навигация».
// v2 живёт на том же адресе с поддоменом new. (web-next/src/nav/navVersion.ts);
// выбор кладётся в общую cookie seer-prefs, поле nav — её читают обе версии.
import { describe, expect, it, vi } from 'vitest';
import { v2Url, switchToV2 } from './navSwitch';

const loc = (hostname: string, port = '', protocol = 'https:') => ({ protocol, hostname, port });

describe('S3-07 v1: адрес v2', () => {
  it('v2 — тот же хост с поддоменом new., тот же протокол и порт', () => {
    expect(v2Url(loc('lore.odal.seidrstudio.pro'))).toBe('https://new.lore.odal.seidrstudio.pro/');
    expect(v2Url(loc('lore.odal.seidrstudio.pro', '4400', 'http:'))).toBe('http://new.lore.odal.seidrstudio.pro:4400/');
  });

  it('на localhost и голом IP пары нет — null, а не выдуманный адрес', () => {
    expect(v2Url(loc('localhost', '5173'))).toBeNull();
    expect(v2Url(loc('192.168.3.131', '4400'))).toBeNull();
    expect(v2Url(loc(''))).toBeNull();
  });

  it('уже на new. — поддомен не удваивается', () => {
    expect(v2Url(loc('new.lore.odal.seidrstudio.pro'))).toBe('https://new.lore.odal.seidrstudio.pro/');
  });
});

describe('S3-07 v1: включение флага', () => {
  it('запоминает nav=v2 в общей cookie и отдаёт адрес перехода', () => {
    const write = vi.fn();
    expect(switchToV2(loc('lore.odal.seidrstudio.pro'), write)).toBe('https://new.lore.odal.seidrstudio.pro/');
    expect(write).toHaveBeenCalledWith({ nav: 'v2' });
  });

  it('пары нет — флаг не пишется, перехода нет', () => {
    const write = vi.fn();
    expect(switchToV2(loc('localhost'), write)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
});
