// @vitest-environment jsdom
// SPRINT_UXR_S14_KIT5/K5-FIELD-LIST — вид поля «список».
//
// «Дата-странники» (SPRINT_DWL_METHOD/ME-10): поля Quiz.options, Quiz.hints, Scroll.dreams в модели
// имеют вид list. Перевод модели в конфиг отвечал «вид поля list неизвестен — показано текстом»,
// и значения приходилось склеивать в строку через « · ».
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configFromModel } from '../model/configFromModel';
import { parseModel } from '../model/loadModel';
import type { KitCtx } from '../core/contract';
import { FieldValue } from './RecordView';

// Модель — СНЯТАЯ с живого сервера (shared/fixtures/model.json), а не собранная руками
// (CT-KIT-FIXTURES): у первого поля задачи подменяется только вид.
const MODEL = join(__dirname, '..', '..', 'fixtures', 'model.json') // снимок живой модели LORE (из UnlimitedLORE shared/fixtures, 22.11.2026);
const doc = (kind: string) => {
  const raw = JSON.parse(readFileSync(MODEL, 'utf8')) as { types: Record<string, { fields: { key: string; kind: string; visibility: string }[] }> };
  const first = raw.types.task.fields[0];
  first.kind = kind;
  first.visibility = 'visible';
  return { model: parseModel(raw), key: first.key };
};
const fieldOf = (kind: string) => {
  const { model, key } = doc(kind);
  const r = configFromModel(model, { statusDict: 'task' });
  return { field: r.kinds.task?.fields?.find(f => f.key === key), notes: r.notes.kinds.join(' '), key };
};
const ctx = { config: { kinds: {} }, md: (s: string) => s, href: (id: string) => `#${id}` } as unknown as KitCtx;

describe('K5-FIELD-LIST · перевод модели', () => {
  it('положительный контроль: модель разобрана, поле есть и вид text читается', () => {
    const r = fieldOf('text');
    expect(r.field, r.key).toMatchObject({ type: 'text' });
  });

  it('вид list известен: тип поля — list, оговорки «неизвестен» нет', () => {
    const r = fieldOf('list');
    expect(r.field, r.key).toMatchObject({ type: 'list' });
    expect(r.notes).not.toMatch(/«list» неизвестен/);
  });

  it('по-настоящему незнакомый вид по-прежнему назван словами', () => {
    expect(fieldOf('matrix').notes).toMatch(/«matrix» неизвестен/);
  });
});

describe('K5-FIELD-LIST · показ значения', () => {
  it('значения списка — отдельными пунктами, а не склеенной строкой', () => {
    render(<FieldValue type="list" value={['Альфа', 'Бета', 'Гамма']} ctx={ctx} title="Варианты" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Бета')).toBeTruthy();
    expect(screen.queryByText(/Альфа.*Бета/)).toBeNull();
  });

  it('одно значение не массивом — один пункт', () => {
    render(<FieldValue type="list" value="Альфа" ctx={ctx} title="Варианты" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('пустой список — как любое пустое поле: тире, а не пустая рамка', () => {
    const { container } = render(<FieldValue type="list" value={[]} ctx={ctx} title="Варианты" />);
    expect(container.textContent).toBe('—');
  });

  // SPRINT_LORE_WORK_ANY_KIND/WK-01: вид продукта в модели — text, а значение с сервера — набор
  // (["tech","service"]). Правило общее: массив в поле text/enum — пунктами списка, а не сырым JSON.
  it('массив в поле text или enum — пунктами, а не «["tech","service"]»', () => {
    const { container } = render(<FieldValue type="text" value={['tech', 'service']} ctx={ctx} title="Вид" />);
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['tech', 'service']);
    expect(container.textContent).not.toMatch(/\[|"/);
    const e = render(<FieldValue type="enum" value={['tech']} ctx={ctx} title="Вид" />);
    expect(e.container.textContent).toBe('tech');
    const z = render(<FieldValue type="text" value={[]} ctx={ctx} title="Вид" />);
    expect(z.container.textContent).toBe('—');
  });

  it('пункт-объект показан своим текстом, а не «[object Object]»', () => {
    render(<FieldValue type="list" value={[{ id: 'a', text: 'Альфа' }, { title: 'Бета' }]} ctx={ctx} title="Варианты" />);
    expect(screen.getByText('Альфа')).toBeTruthy();
    expect(screen.getByText('Бета')).toBeTruthy();
    expect(screen.queryByText(/object Object/)).toBeNull();
  });
});
