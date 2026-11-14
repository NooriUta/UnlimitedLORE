// @vitest-environment jsdom
// Порядок вкладок паспорта один во ВСЕХ местах показа (приёмка 14.11.2026, владелица: «проверь
// по всем паспортам в левом состоянии и в полной развёртке последовательность табов — если она
// перепутана, найди баг»). Проверка в Chrome на проде v1.17.20: у 8 типов из 11 порядок в доке
// (left/right) и во весь экран разный.
//
// Два корня, оба здесь:
//  1. В доке слева/справа ряд «Контент» собирался из recordItems — ДО applySections, и порядок
//     модели в доке не применялся вовсе (спринт: «Задачи · Фазы · Вопросы…» вместо «Задачи ·
//     Реализует ADR · Зависит от…»).
//  2. Тело в модели — раздел с ключом `content` (source: body), а вкладка тела в kit — `overview`.
//     Ключи не совпадали, «Контент» считался «не названным моделью» и уезжал в хвост ряда, хотя
//     у ADR, решения, спеки модель ставит его первым.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitMeta, KitRecord, KitRelationDef } from '../core/contract';
import type { PassportOrder } from '../model/surfaces';
import type { RecordPlacement } from './RecordDock';
import { RecordView } from './RecordView';

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: {} });
const host = r('H-1', 'host', 'Запись');
const kids = ['K-1', 'K-2', 'K-3'].map(id => r(id, 'kid', `Дочка ${id}`));
const edges = [
  { from: 'H-1', to: 'K-1', type: 'HAS_PART' },
  { from: 'H-1', to: 'K-2', type: 'HAS_NOTE' },
  { from: 'H-1', to: 'K-3', type: 'HAS_FILE' },
];
const rel = (key: string, label: string, rl: string): KitRelationDef => ({ key, label, relation: 'aggregation', rel: rl, dir: 'out' });
const RELATIONS = [rel('kids', 'Дочки', 'HAS_PART'), rel('notes', 'Заметки', 'HAS_NOTE'), rel('files', 'Вложения', 'HAS_FILE')];

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { host: { title: 'Запись', icon: 'scroll-quill', fields: [{ key: 'version', title: 'Версия', type: 'text' }], relations: RELATIONS } },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
};
const ctx: KitCtx = {
  config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s,
  data: { records: [host, ...kids], edges, journal: [], meta: { generated_at: '2026-11-14T00:00:00Z' } as unknown as KitMeta },
};

/** Как отдаёт сервер: тело — ключ `content`, связи — в порядке, отличном от порядка kit. */
const MODEL: PassportOrder = {
  decided: true, notes: [],
  sections: [
    { key: 'content', source: 'body', ref: null, order: 1, slot: 'own', group: null },
    { key: 'files', source: 'relation', ref: 'HAS_FILE', order: 2, slot: 'own', group: null },
    { key: 'notes', source: 'relation', ref: 'HAS_NOTE', order: 3, slot: 'own', group: null },
    { key: 'kids', source: 'relation', ref: 'HAS_PART', order: 4, slot: 'own', group: null },
  ],
};

const labels = () => screen.getAllByRole('tab')
  .map(t => t.querySelector('span:not(.sk-tab__count):not(.sk-tab__mark)')?.textContent ?? '');
const view = (placement: RecordPlacement) =>
  render(<RecordView record={host} ctx={ctx} tab="overview" onTab={() => {}} placement={placement} narrow={false} sections={MODEL} />);
const relOrder = (ls: string[]) => ls.filter(l => ['Дочки', 'Заметки', 'Вложения'].includes(l));

describe('порядок вкладок паспорта — один во всех местах показа', () => {
  it('во весь экран: связи в порядке модели', () => {
    view('full');
    expect(relOrder(labels())).toEqual(['Вложения', 'Заметки', 'Дочки']);
  });

  for (const place of ['left', 'right'] as const) {
    it(`в доке ${place}: тот же порядок модели, что во весь экран`, () => {
      view(place);
      expect(relOrder(labels())).toEqual(['Вложения', 'Заметки', 'Дочки']);
    });
  }

  it('тело модели (`content`) — это вкладка «Контент»: стоит там, где её поставила модель, а не в хвосте', () => {
    view('full');
    expect(labels()[0]).toBe('Контент');
  });
});
