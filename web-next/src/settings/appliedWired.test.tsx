// @vitest-environment jsdom
// Личные настройки записи ДОХОДЯТ до экрана, а не висят мёртвым атрибутом
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02, S5-14).
//
// Находка CJM на проде 09.11.2026 (серверная сессия, проверяла с владелицей):
// «две правды в одной панели — "Меню при чтении записи = не сворачивать", а
// ниже галочка "Сворачивать меню при чтении" включена».
//
// КОРЕНЬ, а не симптом. В панели было ДВА блока про одно и то же, и ни один не
// работал:
//   • строки контракта S2 (`collapse_nav_on_read`, `right_column`) ложились
//     атрибутами на корень документа — `data-read-nav`, `data-right-column`, —
//     и эти атрибуты не читал НИКТО: ни kit (грепом по исходникам и по CSS),
//     ни web-next. Настройка сохранялась и ничего не меняла;
//   • блок «режим чтения» из kit (`ReadingSettings`) писал в своё хранилище и
//     настраивал `ReadingView`, который web-next НЕ РИСУЕТ вовсе.
// Отсюда и «две правды»: две мёртвые настройки с разными значениями.
//
// Здесь закрепляется, что настройка стала живой: правая колонка записи
// открывается или свёрнута по выбору человека, а меню при открытии записи
// сворачивается, если он так выбрал.
import { beforeEach, describe, expect, it } from 'vitest';
import { appliedRightColumn, appliedCollapseNavOnRead } from './applied';
import { applySettings } from './applySettings';
import { DEFAULT_SETTINGS } from '../api/contracts/s2';

const root = () => document.documentElement;

beforeEach(() => {
  for (const a of ['data-read-nav', 'data-right-column']) root().removeAttribute(a);
});

describe('S4-02 · выбор человека читается оттуда же, куда его применили', () => {
  it('положительный контроль: applySettings ставит атрибуты, а чтение их видит', () => {
    applySettings(root(), { ...DEFAULT_SETTINGS, right_column: 'open', collapse_nav_on_read: true });
    expect(appliedRightColumn()).toBe('open');
    expect(appliedCollapseNavOnRead()).toBe(true);
  });

  it('«свёрнута» и «не сворачивать» — тоже выбор, а не отсутствие выбора', () => {
    applySettings(root(), { ...DEFAULT_SETTINGS, right_column: 'closed', collapse_nav_on_read: false });
    expect(appliedRightColumn()).toBe('closed');
    expect(appliedCollapseNavOnRead()).toBe(false);
  });

  it('«авто» атрибута не ставит — и читается как «авто», а не как «свёрнута»', () => {
    // Молчание настройки значит «решай сам», и подменять его на «закрыто»
    // нельзя: человек не выбирал закрыть.
    applySettings(root(), { ...DEFAULT_SETTINGS, right_column: 'auto' });
    expect(appliedRightColumn()).toBe('auto');
  });

  it('чужое значение в атрибуте — «авто», а не падение', () => {
    root().setAttribute('data-right-column', 'широкая');
    expect(appliedRightColumn()).toBe('auto');
  });

  it('документа нет (сервер, тесты) — «авто» и «не сворачивать»', () => {
    // Чтение не должно требовать браузера: модуль импортируют и экраны, и тесты.
    expect(appliedRightColumn(null)).toBe('auto');
    expect(appliedCollapseNavOnRead(null)).toBe(false);
  });
});

describe('S5-14 · в панели не осталось второго блока про то же', () => {
  it('блок «режим чтения» из kit в панели v2 не рисуется — он настраивал экран, которого тут нет', async () => {
    const src = (await import('node:fs')).readFileSync(`${process.cwd()}/src/settings/PersonalSettings.tsx`, 'utf8');
    expect(src).not.toMatch(/<ReadingSettings/);
    // И причина названа в самом файле, а не только здесь: иначе блок вернут
    // обратно как «потерянную функциональность».
    expect(src).toMatch(/ReadingView/);
  });
});
