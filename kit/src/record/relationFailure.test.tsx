// @vitest-environment jsdom
// Отказ привязки виден человеку (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST).
//
// Нашлось при подключении `hooks.onRelation` к живому серверу. Управление
// связями в kit вызывало хук через `void call(...)` — отказ промиса
// ВЫБРАСЫВАЛСЯ. Поле ввода при этом очищалось сразу, до ответа.
//
// Снаружи это выглядело как успех: человек ввёл код, поле опустело, строки в
// таблице нет. Он заключит, что связь не та, и попробует другой код — а
// сервер всё это время отказывал по одной и той же причине (у пути привязки
// `POST /lore/record/{type}/{id}/relation` стоит requireAdmin, и ещё он
// отвечает UNKNOWN_RELATION, если у типа нет такого пути).
//
// Молчаливый отказ хуже ошибки: ошибку человек читает и идёт просить доступ, а
// молчание заставляет его перебирать варианты. Поэтому:
//   • причина отказа печатается словами;
//   • введённый код НЕ теряется — иначе его придётся набирать заново;
//   • пока ответа нет, кнопка занята: второй клик не отправляет то же дважды.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { RecordRelations } from './RecordRelations';
import type { KitCtx, KitRecord, KitRelationDef } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const record: KitRecord = { id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'active', fields: {} };
const target: KitRecord = { id: 'SPRINT_B', kind: 'sprint', title: 'Спринт Б', status: 'active', fields: {} };

const def: KitRelationDef = {
  key: 'questions', label: 'Вопросы', relation: 'aggregation', rel: 'DEPENDS_ON', dir: 'out',
};

const ctxWith = (onRelation: NonNullable<KitCtx['config']['hooks']>['onRelation']): KitCtx => ({
  data: {
    records: [record, target],
    edges: [{ from: 'SPRINT_A', to: 'SPRINT_B', type: 'DEPENDS_ON' }],
    journal: [], meta: { generated_at: 'x' },
  },
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [] } },
    roles: { reader: { canEdit: true, canStatus: true } },
    hooks: { onRelation },
  },
  role: 'reader',
  href: id => `#${id}`,
  esc: s => s,
  md: s => <span>{s}</span>,
});

const show = (onRelation: NonNullable<KitCtx['config']['hooks']>['onRelation']) =>
  render(<RecordRelations record={record} ctx={ctxWith(onRelation)} defs={[def]} lang="ru" />);

const input = () => screen.getByRole('textbox') as HTMLInputElement;
const link = () => screen.getByRole('button', { name: 'Привязать' });

describe('S4-MODEL-PASSPORT-LIST · отказ привязки не молчит', () => {
  it('положительный контроль: при удачной привязке код из поля уходит', async () => {
    const onRelation = vi.fn(async () => {});
    show(onRelation);
    await act(async () => {
      fireEvent.change(input(), { target: { value: 'SPRINT_C' } });
      fireEvent.click(link());
    });
    expect(onRelation).toHaveBeenCalledWith(expect.objectContaining({ target: 'SPRINT_C', action: 'add' }));
    await waitFor(() => expect(input().value).toBe(''));
  });

  it('сервер отказал — причина напечатана, а не проглочена', async () => {
    show(vi.fn(async () => { throw new Error('нужна роль администратора'); }));
    await act(async () => {
      fireEvent.change(input(), { target: { value: 'SPRINT_C' } });
      fireEvent.click(link());
    });
    await waitFor(() => expect(document.body.textContent).toContain('нужна роль администратора'));
  });

  it('введённый код после отказа остаётся — набирать заново не нужно', async () => {
    show(vi.fn(async () => { throw new Error('нужна роль администратора'); }));
    await act(async () => {
      fireEvent.change(input(), { target: { value: 'SPRINT_C' } });
      fireEvent.click(link());
    });
    await waitFor(() => expect(input().value).toBe('SPRINT_C'));
  });

  it('отказ отвязки тоже виден: строка остаётся, причина названа', async () => {
    show(vi.fn(async () => { throw new Error('нужна роль администратора'); }));
    // Кнопка отвязки — по имени: в таблице теперь есть и управление списка (поиск, фильтр, порядок).
    const unlink = screen.getAllByRole('button', { name: /^Отвязать/ })[0];
    await act(async () => { fireEvent.click(unlink); });
    await waitFor(() => expect(document.body.textContent).toContain('нужна роль администратора'));
  });

  it('удачная правка стирает прежнюю жалобу — иначе она висит вечно', async () => {
    let fail = true;
    show(vi.fn(async () => { if (fail) throw new Error('нужна роль администратора'); }));
    await act(async () => {
      fireEvent.change(input(), { target: { value: 'SPRINT_C' } });
      fireEvent.click(link());
    });
    await waitFor(() => expect(document.body.textContent).toContain('нужна роль администратора'));
    fail = false;
    await act(async () => { fireEvent.click(link()); });
    await waitFor(() => expect(document.body.textContent).not.toContain('нужна роль администратора'));
  });

  it('пока ответа нет, кнопка занята: один клик — одна отправка', async () => {
    let release: (() => void) | null = null;
    const onRelation = vi.fn(() => new Promise<void>(res => { release = res; }));
    show(onRelation);
    await act(async () => {
      fireEvent.change(input(), { target: { value: 'SPRINT_C' } });
      fireEvent.click(link());
    });
    expect((link() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(link()); });
    expect(onRelation).toHaveBeenCalledTimes(1);
    await act(async () => { release?.(); });
  });
});

// Второе, что нашлось рядом: kit решал, можно ли управлять связью, ПО ВИДУ
// UML — «агрегация и ассоциация можно, остальное нет». Сервер решает иначе: у
// каждой связи типа стоит свой признак `manageable`, потому что путь привязки
// есть не у всех (`LoreRecordRelationRoutes`).
//
// Живой случай расхождения в реестре LORE: `IMPLEMENTED_IN` между ADR и
// спринтом — вид `realization`, и путь привязки у неё ЕСТЬ (маршрут
// ADR_SPRINT, `manageable: true`). Правило по виду UML его скрывало: человек
// видел список и не мог ничего изменить, хотя сервер позволяет.
//
// Поэтому признак сервера главнее: он знает про свои пути. Вид UML остаётся
// умолчанием для конфигов, которые про `manageable` не говорят (демо kit,
// «Дата-странники») — иначе переход сломал бы им управление связями.
describe('S4-MODEL-PASSPORT-LIST · управлять или нет решает сервер, а не вид UML', () => {
  const withDef = (d: KitRelationDef) =>
    render(<RecordRelations record={record} ctx={ctxWith(vi.fn(async () => {}))} defs={[d]} lang="ru" />);

  it('manageable: false у агрегации — формы нет, хотя вид это разрешал', () => {
    withDef({ key: 'questions', label: 'Вопросы', relation: 'aggregation', rel: 'RAISED_IN', dir: 'in', manageable: false });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('manageable: true у реализации — форма есть, хотя вид это запрещал (IMPLEMENTED_IN)', () => {
    withDef({ key: 'adrs', label: 'Реализует ADR', relation: 'realization', rel: 'IMPLEMENTED_IN', dir: 'in', manageable: true });
    expect(screen.queryByRole('textbox')).toBeTruthy();
  });

  it('признака нет — прежнее правило по виду UML, чтобы не сломать чужие конфиги', () => {
    withDef({ key: 'tasks', label: 'Задачи', relation: 'aggregation', rel: 'HAS_TASK', dir: 'out' });
    expect(screen.queryByRole('textbox')).toBeTruthy();
  });
});
