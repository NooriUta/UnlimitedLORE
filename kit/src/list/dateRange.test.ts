// Фильтр по дате — диапазон «с … по …» (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DATE-RANGE).
//
// Повод — слово владелицы 11.11.2026: «для фильтров в датах давать возможность
// выбора диапазонов». Здесь — чистая модель: значение {from, to} с открытыми
// границами, быстрые периоды от времени ИСТОЧНИКА, зона местное/UTC, запись в
// адрес и подпись словами. Ни одного имени поля или параметра сервера: их
// называет приложение (K-14).
import { describe, expect, it } from 'vitest';
import {
  dateRangeUrlPatch, describeDateRange, filterByDateRange, inDateRange, isDateRangeActive, parseDateRangeParam,
  rangeInstants, readDateRangeUrl, resolveDateRange, writeDateRangeParam, type DateRangeValue,
} from './dateRange';

const NOW = '2026-11-11T09:30:00Z';
const v = (p: Partial<DateRangeValue>): DateRangeValue => ({ from: null, to: null, zone: 'utc', ...p });

describe('K2-DATE-RANGE · адрес ↔ значение', () => {
  it('закрытый диапазон: 2026-11-10..2026-11-11', () => {
    expect(parseDateRangeParam('2026-11-10..2026-11-11')).toEqual({ from: '2026-11-10', to: '2026-11-11' });
    expect(writeDateRangeParam(v({ from: '2026-11-10', to: '2026-11-11' }))).toBe('2026-11-10..2026-11-11');
  });
  it('открытые границы: «с 10.11» и «по 11.11»', () => {
    expect(parseDateRangeParam('2026-11-10..')).toEqual({ from: '2026-11-10', to: null });
    expect(parseDateRangeParam('..2026-11-11')).toEqual({ from: null, to: '2026-11-11' });
    expect(writeDateRangeParam(v({ from: '2026-11-10' }))).toBe('2026-11-10..');
    expect(writeDateRangeParam(v({ to: '2026-11-11' }))).toBe('..2026-11-11');
  });
  it('один день — один день', () => {
    expect(parseDateRangeParam('2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-10' });
  });
  it('быстрый период живёт в адресе именем: ссылка «7 дней» завтра значит завтрашние 7 дней', () => {
    expect(parseDateRangeParam('7d')).toEqual({ from: null, to: null, preset: '7d' });
    expect(writeDateRangeParam(v({ preset: 'month' }))).toBe('month');
  });
  it('мусор и перевёрнутые границы — не фильтр, а не «0 записей»', () => {
    expect(parseDateRangeParam('вчера')).toBeNull();
    expect(parseDateRangeParam('2026-13-40..')).toBeNull();
    expect(parseDateRangeParam('..')).toBeNull();
    expect(parseDateRangeParam('2026-11-12..2026-11-10')).toBeNull();
  });
  it('пустое значение снимает параметр', () => {
    expect(writeDateRangeParam(v({}))).toBeNull();
  });
  it('ключ адреса называет приложение; зона — рядом, местная по умолчанию не пишется', () => {
    expect(dateRangeUrlPatch('upd', v({ from: '2026-11-10', zone: 'utc' }))).toEqual({ upd: '2026-11-10..', upd_tz: 'utc' });
    expect(dateRangeUrlPatch('upd', v({ from: '2026-11-10', zone: 'local' }))).toEqual({ upd: '2026-11-10..', upd_tz: null });
    expect(readDateRangeUrl('?upd=2026-11-10..2026-11-11&upd_tz=utc', 'upd'))
      .toEqual({ from: '2026-11-10', to: '2026-11-11', zone: 'utc' });
    expect(readDateRangeUrl('?x=1', 'upd')).toEqual({ from: null, to: null, zone: 'local' });
  });
});

describe('K2-DATE-RANGE · быстрые периоды — от времени источника', () => {
  it('сегодня / вчера / 7 дней / 30 дней / этот месяц', () => {
    expect(resolveDateRange(v({ preset: 'today' }), NOW, 'UTC')).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(resolveDateRange(v({ preset: 'yesterday' }), NOW, 'UTC')).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(resolveDateRange(v({ preset: '7d' }), NOW, 'UTC')).toEqual({ from: '2026-11-05', to: '2026-11-11' });
    expect(resolveDateRange(v({ preset: '30d' }), NOW, 'UTC')).toEqual({ from: '2026-10-13', to: '2026-11-11' });
    expect(resolveDateRange(v({ preset: 'month' }), NOW, 'UTC')).toEqual({ from: '2026-11-01', to: '2026-11-11' });
  });
  it('«сегодня» по местной зоне — день источника в этой зоне, а не UTC', () => {
    // 22:30 UTC 11.11 — в Москве уже 12.11.
    const late = '2026-11-11T22:30:00Z';
    expect(resolveDateRange(v({ preset: 'today', zone: 'utc' }), late, 'Europe/Moscow')).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(resolveDateRange(v({ preset: 'today', zone: 'local' }), late, 'Europe/Moscow')).toEqual({ from: '2026-11-12', to: '2026-11-12' });
  });
});

describe('K2-DATE-RANGE · включительность и открытые границы', () => {
  const range = v({ from: '2026-11-10', to: '2026-11-11' });
  it('обе границы включительно: полночь начала и последняя секунда конца входят', () => {
    expect(inDateRange('2026-11-10T00:00:00Z', range, NOW, 'UTC')).toBe(true);
    expect(inDateRange('2026-11-11T23:59:59Z', range, NOW, 'UTC')).toBe(true);
    expect(inDateRange('2026-11-09T23:59:59Z', range, NOW, 'UTC')).toBe(false);
    expect(inDateRange('2026-11-12T00:00:00Z', range, NOW, 'UTC')).toBe(false);
  });
  it('открытая граница ничего не режет со своей стороны', () => {
    expect(inDateRange('2001-01-01T00:00:00Z', v({ to: '2026-11-11' }), NOW, 'UTC')).toBe(true);
    expect(inDateRange('2099-01-01T00:00:00Z', v({ from: '2026-11-10' }), NOW, 'UTC')).toBe(true);
    expect(inDateRange('2026-11-09T12:00:00Z', v({ from: '2026-11-10' }), NOW, 'UTC')).toBe(false);
  });
  it('смена зоны меняет день отметки: 21:30 UTC 09.11 — в Москве уже 10.11', () => {
    const at = '2026-11-09T21:30:00Z';
    expect(inDateRange(at, v({ from: '2026-11-10', to: '2026-11-11', zone: 'utc' }), NOW, 'Europe/Moscow')).toBe(false);
    expect(inDateRange(at, v({ from: '2026-11-10', to: '2026-11-11', zone: 'local' }), NOW, 'Europe/Moscow')).toBe(true);
  });
  it('отметка только датой сравнивается как день, без сдвига зоной', () => {
    expect(inDateRange('2026-11-10', v({ from: '2026-11-10', to: '2026-11-10', zone: 'local' }), NOW, 'America/New_York')).toBe(true);
  });
  it('нет времени или не разобрали — null («не знаем»), а не false', () => {
    expect(inDateRange(null, range, NOW, 'UTC')).toBeNull();
    expect(inDateRange('когда-то', range, NOW, 'UTC')).toBeNull();
  });
  it('неактивный фильтр пропускает всё, включая записи без времени', () => {
    expect(isDateRangeActive(v({}))).toBe(false);
    expect(inDateRange(null, v({}), NOW, 'UTC')).toBe(true);
  });
});

describe('K2-DATE-RANGE · границы мгновениями — для источника', () => {
  it('UTC: начало первого дня и конец последнего, включительно', () => {
    expect(rangeInstants(v({ from: '2026-11-10', to: '2026-11-11' }), NOW, 'UTC'))
      .toEqual({ from: '2026-11-10T00:00:00.000Z', to: '2026-11-11T23:59:59.999Z' });
  });
  it('местная зона сдвигает мгновения: полночь в Москве — 21:00 UTC накануне', () => {
    expect(rangeInstants(v({ from: '2026-11-10', to: '2026-11-11', zone: 'local' }), NOW, 'Europe/Moscow'))
      .toEqual({ from: '2026-11-09T21:00:00.000Z', to: '2026-11-11T20:59:59.999Z' });
  });
  it('открытая граница — null', () => {
    expect(rangeInstants(v({ from: '2026-11-10' }), NOW, 'UTC')).toEqual({ from: '2026-11-10T00:00:00.000Z', to: null });
  });
});

describe('K2-DATE-RANGE · фильтр по загруженному', () => {
  const rec = (id: string, at?: string) => ({ id, kind: 'x', title: id, status: '', fields: {}, ...(at ? { updated_at: at } : {}) });
  it('оставляет попавших, считает отброшенных без времени', () => {
    const rs = [rec('a', '2026-11-10T10:00:00Z'), rec('b', '2026-11-01T10:00:00Z'), rec('c')];
    const out = filterByDateRange(rs, 'updated_at', v({ from: '2026-11-10' }), NOW, 'UTC');
    expect(out.records.map(r => r.id)).toEqual(['a']);
    expect(out.undated).toBe(1);
  });
  it('неактивный — тот же массив, без отброшенных', () => {
    const rs = [rec('a'), rec('b', '2026-11-01T10:00:00Z')];
    const out = filterByDateRange(rs, 'updated_at', v({}), NOW, 'UTC');
    expect(out.records).toBe(rs);
    expect(out.undated).toBe(0);
  });
});

describe('K2-DATE-RANGE · чип словами', () => {
  it('ru', () => {
    expect(describeDateRange(v({ from: '2026-11-10', to: '2026-11-11' }), 'ru')).toBe('10–11 ноября');
    expect(describeDateRange(v({ from: '2026-11-10', to: '2026-11-10' }), 'ru')).toBe('10 ноября');
    expect(describeDateRange(v({ from: '2026-10-30', to: '2026-11-02' }), 'ru')).toBe('30 октября – 2 ноября');
    expect(describeDateRange(v({ from: '2025-12-30', to: '2026-01-02' }), 'ru')).toBe('30 декабря 2025 – 2 января 2026');
    expect(describeDateRange(v({ from: '2026-11-10' }), 'ru')).toBe('с 10 ноября');
    expect(describeDateRange(v({ to: '2026-11-11' }), 'ru')).toBe('по 11 ноября');
    expect(describeDateRange(v({ preset: '7d' }), 'ru')).toBe('за 7 дней');
    expect(describeDateRange(v({ preset: 'today' }), 'ru')).toBe('сегодня');
  });
  it('en', () => {
    expect(describeDateRange(v({ from: '2026-11-10', to: '2026-11-11' }), 'en')).toBe('Nov 10–11');
    expect(describeDateRange(v({ from: '2026-11-10' }), 'en')).toBe('from Nov 10');
    expect(describeDateRange(v({ preset: 'month' }), 'en')).toBe('this month');
  });
  it('UTC называется в подписи: иначе «10 ноября» читается местным днём', () => {
    expect(describeDateRange(v({ from: '2026-11-10', to: '2026-11-10', zone: 'utc' }), 'ru', { showZone: true })).toBe('10 ноября (UTC)');
  });
});
