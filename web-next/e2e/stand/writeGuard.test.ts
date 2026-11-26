// Пишущие сценарии стенда: в копию (вход — заглушка) или TEST-данные на препроде (@writes); прод — никогда.
import { describe, expect, it } from 'vitest';
import { preprodTestWriteRefusal, writeCopyRefusal } from './writeGuard.ts';

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
    expect(writeCopyRefusal('https://preprod.lore.odal.seidrstudio.pro', OFF)).toMatch(/seidrstudio/);
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

const PRE = 'https://preprod.lore.odal.seidrstudio.pro';
const OK = { writer: true, ids: ['TEST-proj-a', 'TEST-proj-b', 'TEST-org-smoke'] };

describe('preprodTestWriteRefusal: TEST-данные на препроде, больше нигде', () => {
  it('положительный контроль: препрод, сценарий @writes, только TEST-коды — можно', () => {
    expect(preprodTestWriteRefusal(PRE, OK)).toBeNull();
    expect(preprodTestWriteRefusal(`${PRE}/?sec=project`, { writer: true, ids: ['test_proj_c'] })).toBeNull();
  });

  it('прод — отказ (оба адреса прода и lore-host)', () => {
    expect(preprodTestWriteRefusal('https://lore.odal.seidrstudio.pro', OK)).toMatch(/прод/);
    expect(preprodTestWriteRefusal('https://new.lore.odal.seidrstudio.pro', OK)).toMatch(/прод/);
    expect(preprodTestWriteRefusal('http://192.168.3.143:4400', OK)).toMatch(/прод/);
  });

  it('другой хост (стенд ci-server, копия, похожий домен) — отказ', () => {
    expect(preprodTestWriteRefusal('http://192.168.3.131:4412', OK)).toMatch(/только на preprod/);
    expect(preprodTestWriteRefusal('http://192.168.3.150:4601', OK)).toMatch(/только на preprod/);
    expect(preprodTestWriteRefusal('https://preprod.lore.odal.seidrstudio.pro.evil.example', OK)).toMatch(/только на preprod/);
    expect(preprodTestWriteRefusal('http://preprod.lore.odal.seidrstudio.pro', OK)).toMatch(/https/);
  });

  it('не-TEST код — отказ, даже если остальные TEST', () => {
    expect(preprodTestWriteRefusal(PRE, { writer: true, ids: ['TEST-proj-a', 'AIDA/MIDGARD'] })).toMatch(/AIDA\/MIDGARD/);
    expect(preprodTestWriteRefusal(PRE, { writer: true, ids: ['NooriUta/UnlimitedLORE'] })).toMatch(/не тестовые/);
    expect(preprodTestWriteRefusal(PRE, { writer: true, ids: ['TESTER-x'] })).toMatch(/не тестовые/);
    expect(preprodTestWriteRefusal(PRE, { writer: true, ids: ['TEST-'] })).toMatch(/не тестовые/);
  });

  it('сценарий без метки @writes или без названных сущностей — отказ', () => {
    expect(preprodTestWriteRefusal(PRE, { writer: false, ids: OK.ids })).toMatch(/@writes/);
    expect(preprodTestWriteRefusal(PRE, { writer: true, ids: [] })).toMatch(/не названы/);
  });

  it('неразборчивый адрес — отказ', () => {
    expect(preprodTestWriteRefusal(undefined, OK)).not.toBeNull();
  });
});
