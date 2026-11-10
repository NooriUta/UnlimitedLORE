// Версия kit — одна и та же в манифесте и в коде (SPRINT_UXR_S10_SEIDR_KIT/K-08, п. 1).
//
// Сторож нужен ровно по уроку K-14: один и тот же факт, записанный в двух
// местах, расходится молча. Там это были статусные цвета в трёх местах (тема,
// валидатор, схема), и kit отказался показать статус, цвет для которого сам же
// и завёл. Версия — такой же факт: если литерал в коде отстанет от
// `package.json`, приложение будет сообщать неверную версию при разборе чужой
// жалобы, то есть врать именно там, где нужна точность.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_VERSION, kitVersionAtLeast, parseKitVersion } from './version';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };

describe('K-08 п. 1 · версия kit', () => {
  it('положительный контроль: манифест прочитан и несёт версию', () => {
    expect(typeof manifest.version).toBe('string');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('версия в коде совпадает с версией в package.json', () => {
    expect(KIT_VERSION, 'литерал версии отстал от манифеста — приложение будет сообщать не ту версию').toBe(manifest.version);
  });

  it('версия — semver, а не произвольная строка', () => {
    expect(parseKitVersion(KIT_VERSION)).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it('не semver — null, а не ноль: «не поняли» ≠ «0.0.0»', () => {
    for (const bad of ['', 'v1.2.3', '1.2', 'latest', '1.2.3-rc1']) {
      expect(parseKitVersion(bad), bad).toBeNull();
    }
  });

  it('сравнение по старшинству: major, затем minor, затем patch', () => {
    expect(kitVersionAtLeast('0.1.0', '0.1.0')).toBe(true);
    expect(kitVersionAtLeast('0.1.0', '0.1.4')).toBe(true);
    expect(kitVersionAtLeast('0.2.0', '0.1.9')).toBe(false);
    expect(kitVersionAtLeast('0.9.9', '1.0.0')).toBe(true);
    expect(kitVersionAtLeast('1.0.0', '0.9.9')).toBe(false);
  });

  it('одна из версий не semver — «не смогли сравнить», а не «младше»', () => {
    expect(kitVersionAtLeast('не версия', '0.1.0')).toBeNull();
    expect(kitVersionAtLeast('0.1.0', 'нет')).toBeNull();
  });
});
