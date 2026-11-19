// Пишущий сценарий стенда (model118 M5) пишет ТОЛЬКО в копию: не стенд, не прод, вход — заглушка.
import { describe, expect, it } from 'vitest';
import { writeCopyRefusal } from './writeGuard.ts';

const OFF = { auth_enabled: false };

describe('writeCopyRefusal: запись только в копию', () => {
  it('положительный контроль: копия на ryzenai с выключенным входом — можно', () => {
    expect(writeCopyRefusal('http://192.168.3.150:4601', OFF)).toBeNull();
  });

  it('прод — отказ', () => {
    expect(writeCopyRefusal('https://lore.odal.seidrstudio.pro', OFF)).toMatch(/прод/);
    expect(writeCopyRefusal('http://192.168.3.131:4400', OFF)).toMatch(/прод/);
  });

  it('ci-server на любом порту (стенд, препрод) — отказ', () => {
    expect(writeCopyRefusal('http://192.168.3.131:4412', OFF)).toMatch(/ci-server/);
  });

  it('любой адрес *.seidrstudio.pro (препрод, стенд) — отказ', () => {
    expect(writeCopyRefusal('https://preprod.new.lore.odal.seidrstudio.pro', OFF)).toMatch(/seidrstudio/);
  });

  it('вход включён или не узнали — отказ: копия с заглушкой входа обязательна', () => {
    expect(writeCopyRefusal('http://192.168.3.150:4601', { auth_enabled: true })).toMatch(/вход/);
    expect(writeCopyRefusal('http://192.168.3.150:4601', null)).toMatch(/вход/);
  });

  it('неразборчивый адрес — отказ', () => {
    expect(writeCopyRefusal('не адрес', OFF)).not.toBeNull();
    expect(writeCopyRefusal(undefined, OFF)).not.toBeNull();
  });
});
