// SPRINT_UXR_S7A_NEWS/S7A-02 — модель экрана новостей v2: запрос к серверу,
// состояние в URL, проверка контракта ответа и подписи. Чисел клиент не
// считает (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0) — здесь только форма.
import { describe, expect, it } from 'vitest';
import gameIcons from '@iconify-json/game-icons/icons.json';
import {
  DEFAULT_NEWS_QUERY, NEWS_FIXTURE, NEWS_KIND_META, NEWS_TYPE_META, NewsContractError, buildNewsParams,
  newsDict, newsGroupLabel, parseNewsResponse, readNewsQuery, utcClock, writeNewsQuery,
} from './index';
import { hasGameIcon, registerGameIcons } from '@seidr/kit';
import { newsHrefV2 } from '../newsLinks';

describe('S7A-02 · запрос GET /lore/news/v2', () => {
  it('по умолчанию: неделя, пояс, разрез по проектам, матрица 6, без limit (окно целиком, паритет 14)', () => {
    const p = buildNewsParams(DEFAULT_NEWS_QUERY, { timeZone: 'Europe/Moscow' });
    expect(p.get('days')).toBe('7');
    expect(p.get('tz')).toBe('Europe/Moscow');
    expect(p.get('group_by')).toBe('project');
    expect(p.get('matrix')).toBe('6');
    expect(p.has('limit')).toBe(false);
    expect(p.has('sub')).toBe(false);
  });

  it('период День/Неделя/Месяц → days 1/7/30 (паритет 15); время машины → tz=UTC', () => {
    expect(buildNewsParams({ ...DEFAULT_NEWS_QUERY, period: 'day' }, { timeZone: 'X/Y' }).get('days')).toBe('1');
    expect(buildNewsParams({ ...DEFAULT_NEWS_QUERY, period: 'month' }, { timeZone: 'X/Y' }).get('days')).toBe('30');
    expect(buildNewsParams({ ...DEFAULT_NEWS_QUERY, zone: 'utc' }, { timeZone: 'X/Y' }).get('tz')).toBe('UTC');
  });

  it('фильтры по осям — списком через запятую; els — отдельно; sub и group_by', () => {
    const p = buildNewsParams({
      ...DEFAULT_NEWS_QUERY, group: 'type', sub: 'project',
      filters: { project: ['A/x', 'B/y'], type: ['task'] }, els: ['task:S/T-1'],
    }, { timeZone: 'UTC' });
    expect(p.get('project')).toBe('A/x,B/y');
    expect(p.get('type')).toBe('task');
    expect(p.get('els')).toBe('task:S/T-1');
    expect(p.get('group_by')).toBe('type');
    expect(p.get('sub')).toBe('project');
  });

  it('фиксированный разрез паспорта (S7A-06) перекрывает фильтр пользователя по той же оси', () => {
    const p = buildNewsParams({ ...DEFAULT_NEWS_QUERY, filters: { sprint: ['OTHER'], type: ['adr'] } },
      { timeZone: 'UTC', scope: { sprint: 'SPRINT_X' } });
    expect(p.get('sprint')).toBe('SPRINT_X');
    expect(p.get('type')).toBe('adr');
  });

  it('sub, совпадающий с group_by, не уходит (сервер его всё равно игнорирует)', () => {
    const p = buildNewsParams({ ...DEFAULT_NEWS_QUERY, group: 'type', sub: 'type' }, { timeZone: 'UTC' });
    expect(p.has('sub')).toBe(false);
  });
});

describe('S7A-02 · состояние разреза — в URL (правило «состояние вкладки и выбора — в URL»)', () => {
  it('туда и обратно без потерь, с префиксом (несколько лент на странице не мешают друг другу)', () => {
    const q = {
      ...DEFAULT_NEWS_QUERY, period: 'month' as const, zone: 'utc' as const, group: 'kind' as const, sub: 'project' as const,
      order: 'asc' as const, matrix: 10, filters: { project: ['A/x', 'B/y'], author: ['human'] }, els: ['task:S/T-1'],
    };
    const patch = writeNewsQuery(q, 'n');
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(patch)) if (v !== null) sp.set(k, v);
    expect(readNewsQuery(sp, 'n')).toEqual(q);
    expect(readNewsQuery(sp, 'a')).toEqual(DEFAULT_NEWS_QUERY);
  });

  it('умолчания в URL не пишутся (null — снять параметр)', () => {
    const patch = writeNewsQuery(DEFAULT_NEWS_QUERY, 'n');
    expect(Object.values(patch).every(v => v === null)).toBe(true);
  });

  it('мусор в URL — к умолчанию, а не к падению', () => {
    const sp = new URLSearchParams('np=year&ng=nope&nm=abc&no=sideways&nf=project');
    expect(readNewsQuery(sp, 'n')).toEqual(DEFAULT_NEWS_QUERY);
  });
});

describe('S7A-02 · контракт ответа (паритет 26 с исправлением: без events — ошибка, а не пусто)', () => {
  it('фикстура проходит проверку контракта', () => {
    expect(parseNewsResponse(NEWS_FIXTURE)).toBe(NEWS_FIXTURE);
  });

  it('ответ без events — NewsContractError с именем поля', () => {
    const { events: _drop, ...rest } = NEWS_FIXTURE;
    expect(() => parseNewsResponse(rest)).toThrow(NewsContractError);
    expect(() => parseNewsResponse(rest)).toThrow(/events/);
  });

  it('ответ без meta/groups/metrics и не-объект — тоже ошибка', () => {
    expect(() => parseNewsResponse({ ...NEWS_FIXTURE, meta: undefined })).toThrow(/meta/);
    expect(() => parseNewsResponse({ ...NEWS_FIXTURE, groups: null })).toThrow(/groups/);
    expect(() => parseNewsResponse({ ...NEWS_FIXTURE, metrics: 1 })).toThrow(/metrics/);
    expect(() => parseNewsResponse(null)).toThrow(NewsContractError);
    expect(() => parseNewsResponse('<html>')).toThrow(NewsContractError);
  });
});

describe('S7A-02 · подписи и ссылки', () => {
  it('ключи-заглушки сервера — словами: без проекта (паритет 22), прочие (k), короткий слаг', () => {
    expect(newsGroupLabel('project', '(no-project)', 'ru')).toBe('без проекта');
    expect(newsGroupLabel('project', '(other:13)', 'ru')).toBe('прочие (13)');
    expect(newsGroupLabel('project', 'NooriUta/volva', 'ru')).toBe('volva');
    expect(newsGroupLabel('sprint', '(no-sprint)', 'en')).toBe('no sprint');
    expect(newsGroupLabel('author', 'agent', 'ru')).toBe('агент');
    expect(newsGroupLabel('type', 'adr', 'ru')).toBe('ADR');
    expect(newsGroupLabel('kind', 'ready', 'ru')).toBe('готово к выкатке');
  });

  it('время машины: HH:MM UTC из at_utc; если день по UTC другой — с датой', () => {
    expect(utcClock('2026-11-07T14:42:00Z', '2026-11-07')).toBe('14:42');
    expect(utcClock('2026-11-05T22:30:00Z', '2026-11-06')).toBe('05.11 22:30');
    expect(utcClock(null, '2026-11-06')).toBeNull();
  });

  it('задачи и спеки кликабельны (D-2026-UXR-NEWS-V2-RULES п. 2), у каждого типа своя ссылка v2 (паритет 12, K-14)', () => {
    const by = (type: string) => NEWS_FIXTURE.events.find(e => e.type === type)!;
    for (const t of ['task', 'spec', 'adr', 'sprint', 'decision', 'release']) {
      const h = newsHrefV2(by(t));
      expect(h, t).toBeTruthy();
      // Адресов v1 больше нет: ссылку строит маршрутизатор приложения.
      expect(h, t).not.toMatch(/section=|passport=/);
    }
  });

  // Сервер (#1025) отдаёт вопросы: type 'question', события created/closed.
  // Без своей ветки строка вопроса была без ссылки, иконки и подписи типа.
  it('вопрос: ссылка v2 на запись, иконка и подпись типа', () => {
    const q = { ...NEWS_FIXTURE.events[0], type: 'question', el: 'Q-UXR-4', sprint: null };
    expect(newsHrefV2(q)).toBeTruthy();
    expect(newsHrefV2(q)).not.toMatch(/section=|passport=/);
    expect(NEWS_TYPE_META.question?.icon).toBe('help');
    expect(newsGroupLabel('type', 'question', 'ru')).toBe('вопрос');
    expect(newsGroupLabel('type', 'question', 'en')).toBe('question');
  });

  // S4-25: события «отменено» и «вернули в работу» — lucide (выбор владелицы), проверка — по реестру GameIcon.
  it('иконки типов (паритет 2) и событий (паритет 1) есть в зарегистрированных наборах', () => {
    registerGameIcons(gameIcons);
    const slugs = [...Object.values(NEWS_TYPE_META), ...Object.values(NEWS_KIND_META)].map(m => m.icon);
    expect(slugs.length).toBeGreaterThan(10);
    expect(slugs.filter(s => !hasGameIcon(s))).toEqual([]);
    expect(NEWS_TYPE_META.release.icon).toBe('open-book');
    expect(NEWS_TYPE_META.adr.icon).toBe('scroll-quill');
    expect(NEWS_TYPE_META.decision.icon).toBe('gavel');
    expect(NEWS_TYPE_META.spec.icon).toBe('spell-book');
    expect(NEWS_KIND_META.created.icon).toBe('sprout');
    expect(NEWS_KIND_META.closed.icon).toBe('check-mark');
    expect(NEWS_KIND_META.released.icon).toBe('upgrade');
    // «Ждёт выкатки» — жёлтым (D-2026-UXR-STATUS-AXIS).
    expect(NEWS_KIND_META.ready.tone).toBe('wrn');
  });

  it('словарь ru и en — одни и те же ключи, без пустых строк (паритет 30)', () => {
    const ru = newsDict('ru'), en = newsDict('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    expect(Object.entries({ ...ru, ...en }).filter(([, v]) => !v.trim())).toEqual([]);
    expect(Object.keys(ru).length).toBeGreaterThan(60);
  });
});
