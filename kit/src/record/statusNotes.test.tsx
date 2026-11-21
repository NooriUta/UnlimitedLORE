// @vitest-environment jsdom
// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-12 — «Ждём: …» у ждущей задачи рядом со статусом (владелица 16.11.2026: «какого
// ответа и от кого ждёшь в карточке не написано»). Сервер отдаёт values.waiting_for только у waiting и причину —
// только у статусов с причиной (LoreRecordValues), модель кладёт поля в группу head. Смоук препрода 21.11.2026
// (прогон 39448, RFD2-MDL12): фасад отдавал «Ждём», а паспорт его не показывал — сборщик брал из head только
// заголовок и статус, остальные поля шапки терялись.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { registerGameIcons } from '../elements/GameIcon';
import { KitLangProvider } from '../i18n';
import { passportFromDoc, STATUS_NOTES_KEY, type KitRecordDoc } from './recordDoc';
import { RecordHead } from './RecordHead';
import { RecordFacts } from './RecordFacts';

beforeAll(() => { registerGameIcons(gameIcons); });

const doc = (values: Record<string, unknown>, status = 'waiting'): KitRecordDoc => ({
  // Документ — kit-форма без предметных имён сервера (как dw.record/1 в recordDoc.test): kit полей не знает.
  contract: 'kit.test/1',
  record: { type: 'task', id: 'S/T-1', title: 'Задача', status, version: 'v1', updated_at: null, updated_by: null },
  schema: {
    type: 'task', label: 'Задача', icon: 'scroll-quill',
    fields: [
      { key: 'title', label: 'Название', kind: 'text', required: true, editable: true, group: 'head' },
      { key: 'status', label: 'Статус', kind: 'enum', required: true, editable: true, group: 'head' },
      { key: 'waiting_for', label: 'Ждём', kind: 'text', required: false, editable: false, group: 'head' },
      { key: 'status_reason', label: 'Причина статуса', kind: 'text', required: false, editable: false, group: 'head' },
      { key: 'code', label: 'Код', kind: 'text', required: false, editable: false, group: 'head' },
    ],
    tabs: [], relations: [],
  },
  values: { title: 'Задача', code: 'T-1', ...values },
  links: [], parts: [],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-21T00:00:00Z', facade: 'server', sources: [{ block: 'record', state: 'ok' }] },
});

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задача', icon: 'scroll-quill' } },
  statuses: { items: [{ code: 'waiting', title: 'ждёт', category: 'active', icon: 'sands-of-time', color: 'var(--wrn)' }] },
};
const ctxOf = (r: KitRecord): KitCtx => ({ config, data: { records: [r], edges: [], journal: [], meta: { generated_at: '2026-11-21T00:00:00Z' } }, href: id => `#${id}`, esc: s => s, md: s => s });

describe('MDL-12 · поля шапки (кроме названия, статуса и кода) — строкой рядом со статусом', () => {
  it('сборщик кладёт «Ждём» и причину в заметки статуса; название и код туда не попадают', () => {
    const p = passportFromDoc(doc({ waiting_for: 'ответ владелицы по D5', status_reason: 'нужен ответ' }), { lang: 'ru' });
    expect(p.record.fields[STATUS_NOTES_KEY]).toEqual([
      { key: 'waiting_for', label: 'Ждём', value: 'ответ владелицы по D5' },
      { key: 'status_reason', label: 'Причина статуса', value: 'нужен ответ' },
    ]);
  });

  it('значения нет (у DONE сервер не отдаёт прежний адресат) — заметок нет', () => {
    const p = passportFromDoc(doc({}, 'done'), { lang: 'ru' });
    expect(p.record.fields[STATUS_NOTES_KEY]).toBeUndefined();
  });

  it('шапка и строка фактов показывают «Ждём: …» рядом со статусом', () => {
    const r = passportFromDoc(doc({ waiting_for: 'ответ владелицы по D5' }), { lang: 'ru' }).record;
    const { unmount } = render(<KitLangProvider lang="ru"><RecordHead record={r} ctx={ctxOf(r)} lang="ru" titleId="h" /></KitLangProvider>);
    expect(screen.getByTestId('kit-status-note').textContent).toBe('Ждём: ответ владелицы по D5');
    unmount();
    render(<KitLangProvider lang="ru"><RecordFacts record={r} ctx={ctxOf(r)} spec={{}} lang="ru" /></KitLangProvider>);
    expect(screen.getByTestId('kit-status-note').textContent).toBe('Ждём: ответ владелицы по D5');
  });
});
