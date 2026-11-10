// Метка версии в правом нижнем углу: что именно она говорит
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30, просьба владелицы 09.11.2026 — «в правое
// нижний угол запиши версию сервера и версию фронта или одну если они вместе»).
//
// ГЛАВНОЕ УТВЕРЖДЕНИЕ ЭТОГО ФАЙЛА: одна метка показывается ТОЛЬКО когда
// сервер и фронт действительно собраны из одного коммита. Иначе «одна версия»
// — неправда, и самая дорогая: по ней судят, доехала ли выкатка. Отсюда и
// остальные формы — не украшение, а отказ соврать:
//   • коммиты разные — две метки, подписанные «сервер» и «фронт»;
//   • фронт не помечен при сборке — показываем серверную, но НАЗЫВАЕМ её
//     серверной, а не выдаём за общую;
//   • /lore/version не ответил — «сервер: не проверено», а не пустота и не
//     последнее известное значение.
import { KIT_VERSION } from '@seidr/kit';
import { describe, expect, it } from 'vitest';
import { fetchServerVersion, shortCommit, versionLabel } from './version';

const SERVER = { release: 'v1.17.7', commit: '339f15b0c1d2e3f4', builtAt: '2026-11-09T12:00:00Z', schema: '42' };
const ok = { kind: 'ok' as const, server: SERVER };

const net = (body: unknown, status = 200) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('versionLabel · одна метка только когда версия действительно одна', () => {
  it('положительный контроль: коммиты совпали — одна метка с тегом выпуска', () => {
    const r = versionLabel('ru', ok, '339f15b0c1d2e3f4');
    expect(r.text).toBe('v1.17.7 · 339f15b0');
    // В подсказке с K-08 п. 1 всегда стоит версия конструктора: с неё
    // начинается разбор жалобы «у нас выглядит иначе». Когда всё сошлось,
    // кроме неё в подсказке ничего нет — оговорок-то и нет.
    expect(r.note).toBe(`конструктор Seiðr-kit ${KIT_VERSION}`);
  });

  it('версия конструктора в подсказке есть при ЛЮБОМ состоянии: её не у кого спрашивать', () => {
    const states = [
      ok,
      { kind: 'ok' as const, server: { ...SERVER, release: null } },
      { kind: 'failed' as const, reason: '502' },
    ];
    for (const st of states) {
      expect(versionLabel('ru', st, '339f15b0c1d2e3f4').note).toContain(KIT_VERSION);
    }
  });

  it('коммиты совпали, а тега выпуска нет (препрод) — один коммит, без выдумки', () => {
    const r = versionLabel('ru', { kind: 'ok', server: { ...SERVER, release: null } }, '339f15b0c1d2e3f4');
    expect(r.text).toBe('339f15b0');
  });

  it('коммиты РАЗНЫЕ — две метки, и каждая подписана', () => {
    const r = versionLabel('ru', ok, '4a1c22e0ffff0000');
    expect(r.text).toBe('сервер v1.17.7 · 339f15b0 · фронт 4a1c22e0');
  });

  it('фронт при сборке не помечен — метка названа СЕРВЕРНОЙ, и причина сказана', () => {
    // Это и есть ловушка: показать серверную версию как общую значит сказать
    // «фронт тоже этот», ничего об этом не зная.
    const r = versionLabel('ru', ok, '');
    expect(r.text).toBe('сервер v1.17.7 · 339f15b0');
    expect(r.note).toMatch(/фронт/i);
    expect(r.note).toMatch(/не помечен/i);
  });

  it('сервер не ответил — «не проверено», а не пусто', () => {
    const r = versionLabel('ru', { kind: 'failed', reason: 'HTTP 503' }, '4a1c22e0ffff0000');
    expect(r.text).toBe('сервер: не проверено · фронт 4a1c22e0');
    expect(r.note).toContain('503');
  });

  it('сервер не ответил и фронт не помечен — остаётся одно честное «не проверено»', () => {
    const r = versionLabel('ru', { kind: 'failed', reason: 'сеть недоступна' }, '');
    expect(r.text).toBe('сервер: не проверено');
    expect(r.note).toContain('сеть недоступна');
  });

  it('сервер сам не знает своего коммита (unknown) — это сказано, а не показано словом unknown', () => {
    const r = versionLabel('ru', { kind: 'ok', server: { ...SERVER, commit: 'unknown' } }, '4a1c22e0ffff0000');
    expect(r.text).toBe('сервер v1.17.7 · фронт 4a1c22e0');
    expect(r.note).toMatch(/сервер.*коммит/i);
    expect(r.text).not.toContain('unknown');
  });

  it('пока грузим — ни метки, ни вранья', () => {
    expect(versionLabel('ru', { kind: 'loading' }, '339f15b0c1d2e3f4').text).toBe('');
  });

  it('en: те же формы по-английски — метка одна на оба языка приложения', () => {
    expect(versionLabel('en', ok, '4a1c22e0ffff0000').text).toBe('server v1.17.7 · 339f15b0 · front 4a1c22e0');
    expect(versionLabel('en', { kind: 'failed', reason: 'HTTP 503' }, '').text).toBe('server: not checked');
  });

  it('коммит укорачивается до восьми знаков — ровно как метка образа :sha8', () => {
    expect(shortCommit('339f15b0c1d2e3f4')).toBe('339f15b0');
    expect(shortCommit('339f')).toBe('339f');
    expect(shortCommit('unknown')).toBe('');
  });
});

describe('fetchServerVersion · три исхода, различимые человеком', () => {
  it('положительный контроль: ответ разобран, release взят', async () => {
    const r = await fetchServerVersion({ fetchImpl: net({ commit: 'abc12345', built_at: 'x', schema_version: 42, release: 'v1.17.7' }) });
    expect(r).toEqual({ kind: 'ok', server: { release: 'v1.17.7', commit: 'abc12345', builtAt: 'x', schema: '42' } });
  });

  it('старый сервер без поля release — не ошибка: release null, остальное на месте', async () => {
    // Серверная половина (#1033) может доехать позже моей: метка обязана
    // работать и до неё, иначе выкатки придётся связывать порядком мержа.
    const r = await fetchServerVersion({ fetchImpl: net({ commit: 'abc12345', built_at: 'x', schema_version: 42 }) });
    expect(r).toEqual({ kind: 'ok', server: { release: null, commit: 'abc12345', builtAt: 'x', schema: '42' } });
  });

  it('ручка выключена (501) — причина со статусом', async () => {
    const r = await fetchServerVersion({ fetchImpl: net({ error: 'DISABLED' }, 501) });
    expect(r.kind).toBe('failed');
    expect(r.kind === 'failed' && r.reason).toContain('501');
  });

  it('сеть упала — причина словами сети', async () => {
    const http = (async () => { throw new Error('сеть недоступна'); }) as unknown as typeof fetch;
    const r = await fetchServerVersion({ fetchImpl: http });
    expect(r.kind === 'failed' && r.reason).toContain('сеть недоступна');
  });

  it('200, но тело не JSON — тоже отказ, а не «версия пустая»', async () => {
    const http = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const r = await fetchServerVersion({ fetchImpl: http });
    expect(r.kind).toBe('failed');
  });
});
