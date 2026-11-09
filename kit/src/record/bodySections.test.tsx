// @vitest-environment jsdom
// Разделы тела записи — ДАННЫМИ, и каждый можно править
// (SPRINT_UXR_S5_RECORD_TASKS/S5-06, S5-09).
//
// Находка CJM на проде v1.17.7 (серверная сессия вместе с владелицей): заметку
// задачи нельзя править — нет ни ✎, ни «Править», двойной клик не открывает
// редактор. Из-за этого и черновик (S5-09) проверить было нечем.
//
// ПРИЧИНА, а не симптом. ✎ у тела даёт kit, но только если у вида НЕТ своего
// рисовальщика обзора (`kind.overview`). А приложение задавало его всегда,
// когда у типа есть поля группы «тело» помимо `body_md` — у задачи заметка
// приходит именно таким полем. Свой рисовальщик печатал её текстом и обходил
// редактор kit: возможность правки существовала и была недостижима.
//
// ЛЕЧЕНИЕ УНИВЕРСАЛЬНОЕ, а не заплатка на задачу: разделы тела приходят
// СПИСКОМ ДАННЫХ (`kind.bodySections`), и рисует их kit — поэтому у каждого
// раздела сразу есть и ✎, и черновик, и честное пустое состояние. Своя
// функция рисования остаётся для действительно особых случаев, но данные
// главнее: иначе каждый новый тип снова принесёт свой рисовальщик и снова
// потеряет правку.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { MartProse, MdInlineEdit } from '../content';
import { RecordView } from './RecordView';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const record: KitRecord = {
  id: 'SP/T1', kind: 'task', title: 'Задача T1', status: 'active',
  body_md: '',
  fields: { note_md: 'Заметка руками', plan_md: '' },
};

function ctxWith(extra: Partial<KitConfig> = {}, role = 'editor'): KitCtx {
  return {
    config: {
      modules: [], menu: { groups: [] }, statuses: { items: [] },
      kinds: {
        task: {
          title: 'Задача', icon: 'scroll-unfurled',
          // Разделы тела — ДАННЫМИ: ключ и подпись. Порядок — как здесь.
          bodySections: [
            { key: 'note_md', title: 'Заметка' },
            { key: 'plan_md', title: 'План' },
          ],
        },
      },
      ...extra,
    },
    data: { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' } },
    role,
    href: () => "#",
    esc: s => s,
    md: s => <MartProse text={s} />,
  };
}

const show = (extra: Partial<KitConfig> = {}, props: Partial<Parameters<typeof RecordView>[0]> = {}) =>
  render(<RecordView record={record} ctx={ctxWith(extra)} tab="overview" onTab={() => {}} {...props} />);

describe('S5-06 · разделы тела приходят данными и рисует их kit', () => {
  it('положительный контроль: заполненные разделы видны с подписями и в заданном порядке', () => {
    const { container } = render(
      <RecordView
        record={{ ...record, fields: { note_md: 'Заметка руками', plan_md: 'План работ' } }}
        ctx={ctxWith()} tab="overview" onTab={() => {}}
      />,
    );
    const heads = [...container.querySelectorAll('.sk-rec-fields__sechead')].map(h => h.textContent);
    expect(heads).toEqual(['Заметка', 'План']);
    expect(screen.getByText('Заметка руками')).toBeTruthy();
    expect(screen.getByText('План работ')).toBeTruthy();
  });

  it('С ПРАВОМ ПРАВКИ у каждого раздела есть ✎ — это и был дефект прода', () => {
    const onSave = vi.fn(async () => {});
    show({ hooks: { onSave } }, { mdEditor: MdInlineEdit });
    expect(screen.getByRole('button', { name: /Править «Заметка»/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Править «План»/ })).toBeTruthy();
  });

  it('правка раздела уходит в hooks.onSave с ключом поля и прежним значением', async () => {
    const onSave = vi.fn(async () => {});
    show({ hooks: { onSave } }, { mdEditor: MdInlineEdit });
    fireEvent.click(screen.getByRole('button', { name: /Править «Заметка»/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Код/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown/i }), { target: { value: 'Новая заметка' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'task', id: 'SP/T1', field: 'note_md', from: 'Заметка руками', to: 'Новая заметка',
    }));
  });

  it('ПУСТОЙ раздел с правом правки показан с ✎, а не спрятан', () => {
    // Иначе в пустой раздел нечем написать: тупик без способа начать.
    const onSave = vi.fn(async () => {});
    show({ hooks: { onSave } }, { mdEditor: MdInlineEdit });
    expect(screen.getByRole('button', { name: /Править «План»/ })).toBeTruthy();
  });

  it('БЕЗ права правки пустой раздел не рисуется — пустая подпись ничего не говорит', () => {
    // «План» в записи пустой. Нарисовать подпись без содержимого значит
    // сообщить человеку ноль: он не поймёт, нет текста или не загрузилось.
    // С правом правки — наоборот, раздел нужен (см. тест выше): иначе в него
    // нечем написать.
    const { container } = show();
    const heads = [...container.querySelectorAll('.sk-rec-fields__sechead')].map(h => h.textContent);
    expect(heads).toEqual(['Заметка']);
  });

  it('данные главнее своей функции рисования: заданы оба — рисует kit', () => {
    // Иначе возврат к функции тихо отнимет правку, как и было на проде.
    const onSave = vi.fn(async () => {});
    show(
      { hooks: { onSave }, kinds: {
        task: {
          title: 'Задача', icon: 'scroll-unfurled',
          bodySections: [{ key: 'note_md', title: 'Заметка' }],
          overview: () => 'СВОЙ РИСОВАЛЬЩИК',
        },
      } },
      { mdEditor: MdInlineEdit },
    );
    expect(screen.queryByText('СВОЙ РИСОВАЛЬЩИК')).toBeNull();
    expect(screen.getByRole('button', { name: /Править «Заметка»/ })).toBeTruthy();
  });

  it('разделов нет — прежнее поведение: тело записи и его ✎', () => {
    const onSave = vi.fn(async () => {});
    render(
      <RecordView
        record={{ ...record, body_md: 'Текст тела' }}
        ctx={ctxWith({ hooks: { onSave }, kinds: { task: { title: 'Задача', icon: 'scroll-unfurled' } } })}
        tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect(screen.getByRole('button', { name: /Править «Текст»/ })).toBeTruthy();
  });
});

describe('S5-06 · склеенное тело и разделы не спорят', () => {
  it('тело ПУСТОЕ, разделы есть — редактора «Текст» нет: пишут в разделы', () => {
    // У таких типов тело склеено из разделов (у ADR — «Контекст / Решение /
    // Следствия»), и писать «в тело» на сервере некуда. Предложить такую
    // кнопку значит предложить путь, которого нет.
    const onSave = vi.fn(async () => {});
    show({ hooks: { onSave } }, { mdEditor: MdInlineEdit });
    expect(screen.queryByRole('button', { name: /Править «Текст»/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Править «Заметка»/ })).toBeTruthy();
  });

  it('тело НЕ пустое — показано и правится, разделы идут после него', () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(
      <RecordView
        record={{ ...record, body_md: 'Общий текст' }}
        ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect(screen.getByRole('button', { name: /Править «Текст»/ })).toBeTruthy();
    const order = [...container.querySelectorAll('.sk-rec-sections > *')].map(n => n.className);
    expect(order[0]).not.toContain('sk-rec-fields__sec');
  });
});
