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

  it('тело НЕ показывается отдельным блоком: оно КОПИЯ раздела (прод v1.17.8)', () => {
    // Находка серверной сессии: у задачи заметка выходила ДВАЖДЫ — разделом
    // «Текст» и разделом «Заметка», оба с ✎. Сервер отдаёт тело записи копией
    // одного из разделов для старых клиентов (у задачи это заметка, у спринта
    // контекст, у спеки содержимое), и kit рисовал её ещё и своим блоком.
    // Прежний тест требовал как раз этого второго блока — то есть закреплял
    // удвоение.
    const onSave = vi.fn(async () => {});
    const { container } = render(
      <RecordView
        record={{ ...record, body_md: 'Заметка руками' }}
        ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect(screen.queryByRole('button', { name: /Править «Текст»/ })).toBeNull();
    // Текст виден ОДИН раз — как раздел «Заметка», и правится как раздел.
    expect(screen.getAllByText('Заметка руками')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Править «Заметка»/ })).toBeTruthy();
    const first = [...container.querySelectorAll('.sk-rec-sections > *')][0];
    expect(first?.className).toContain('sk-rec-fields__sec');
  });
});

describe('S5-06 · раздел «только чтение» не получает ✎', () => {
  // Серверная сессия 09.11 проверила по коду `LoreRecordRegistry.schemaJson`:
  // у каждого раздела тела есть `editable` и свой путь записи `write`. Право
  // правки ЗАПИСИ этого не отменяет: ✎ у раздела с `editable: false` обещал
  // бы сохранение, которого некуда отправить.
  it('editable: false — текст виден, кнопки правки нет', () => {
    const onSave = vi.fn(async () => {});
    render(
      <RecordView
        record={{ ...record, fields: { note_md: 'Заметка руками', plan_md: 'План' } }}
        ctx={ctxWith({ hooks: { onSave }, kinds: {
          task: {
            title: 'Задача', icon: 'scroll-unfurled',
            bodySections: [
              { key: 'note_md', title: 'Заметка' },
              { key: 'plan_md', title: 'План', editable: false },
            ],
          },
        } })}
        tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    // «План» встречается дважды — подписью раздела и его текстом; берём
    // подпись заголовка, иначе утверждение зависит от совпадения строк.
    expect(screen.getAllByText('План').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Править «Заметка»/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Править «План»/ })).toBeNull();
  });

  it('editable: false и раздел ПУСТОЙ — не рисуется вовсе: ни текста, ни способа начать', () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(
      <RecordView
        record={record}
        ctx={ctxWith({ hooks: { onSave }, kinds: {
          task: {
            title: 'Задача', icon: 'scroll-unfurled',
            bodySections: [{ key: 'plan_md', title: 'План', editable: false }],
          },
        } })}
        tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect([...container.querySelectorAll('.sk-rec-fields__sechead')]).toEqual([]);
  });
});

describe('S5-06 · подсказка «как править» — ОДНА на запись, а не у каждого раздела', () => {
  // Слова владелицы 09.11.2026: «верни типтап редактирование, вы ухудшили user
  // experience». Правка на месте никуда не делась — ухудшилось ЧТЕНИЕ: когда
  // разделы стали править по отдельности, строка-подсказка и кнопка «Режим
  // исходника» размножились по числу разделов, и запись из документа
  // превратилась в форму. Подсказка — свойство записи, не поля.
  const hints = () => document.querySelectorAll('.sk-mdedit__hint');
  const pens = () => document.querySelectorAll('.sk-mdedit__pen');

  it('два раздела, тела нет — подсказка одна, а ✎ у каждого раздела', () => {
    const onSave = vi.fn(async () => {});
    render(
      <RecordView
        record={{ ...record, fields: { note_md: 'Заметка', plan_md: 'План' } }}
        ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect(hints()).toHaveLength(1);
    expect(pens()).toHaveLength(2);
  });

  it('есть тело и разделы — подсказку показывает тело', () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(
      <RecordView
        record={{ ...record, body_md: 'Общий текст', fields: { note_md: 'Заметка', plan_md: 'План' } }}
        ctx={ctxWith({ hooks: { onSave } })} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect(hints()).toHaveLength(1);
    // Именно у первого блока — то есть у тела, до разделов.
    const first = container.querySelector('.sk-rec-sections > *');
    expect(first?.querySelector('.sk-mdedit__hint')).toBeTruthy();
  });

  it('первый раздел только для чтения — подсказка у первого ПРАВИМОГО', () => {
    const onSave = vi.fn(async () => {});
    render(
      <RecordView
        record={{ ...record, fields: { note_md: 'Заметка', plan_md: 'План' } }}
        ctx={ctxWith({ hooks: { onSave }, kinds: {
          task: {
            title: 'Задача', icon: 'scroll-unfurled',
            bodySections: [
              { key: 'note_md', title: 'Заметка', editable: false },
              { key: 'plan_md', title: 'План' },
            ],
          },
        } })}
        tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect(hints()).toHaveLength(1);
    expect(pens()).toHaveLength(1);
  });

  it('без права правки подсказок нет вовсе — читателю править нечем', () => {
    render(
      <RecordView
        record={{ ...record, fields: { note_md: 'Заметка', plan_md: 'План' } }}
        ctx={ctxWith()} tab="overview" onTab={() => {}} mdEditor={MdInlineEdit}
      />,
    );
    expect(hints()).toHaveLength(0);
  });
});
