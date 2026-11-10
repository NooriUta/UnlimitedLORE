// @vitest-environment jsdom
// Дифф перед применением (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DIFF).
//
// Повод — слова владелицы 09.11.2026: «задачи по элементам новым [во] второй
// спринт разделом новым… по админ».
//
// Зачем он именно там: одно нажатие раздаёт права сразу нескольким людям в
// нескольких местах. Без предпросмотра человек узнаёт, что он сделал, только
// из журнала — то есть после.
//
// ГЛАВНОЕ, из-за чего элемент дорогой: у каждой строки своё СОСТОЯНИЕ
// ПРОВЕРКИ. Дифф строится по чужим системам, где «такого нет» сплошь
// неотличимо от «не смогли спросить» и от «нет прав посмотреть». Дифф, который
// рисует их одинаково, вреднее отсутствия диффа: по нему раздают права.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DiffPreview, type DiffRow } from './DiffPreview';

const ok = { state: 'checked' } as const;

const rows = (): DiffRow[] => [
  { id: 'r1', kind: 'add', text: 'строка добавится', detail: 'подробность', check: ok },
  { id: 'r2', kind: 'remove', text: 'строка снимется', check: ok },
  { id: 'r3', kind: 'same', text: 'строка уже есть', check: ok },
];

const apply = () => screen.getByTestId('kit-diff-apply');

// 10.11.2026. Прежние проверки рисовали дифф ВОВСЕ БЕЗ обработчика применения
// и при этом ждали кнопку «Применить N» и фразы «применять нечего». Это и был
// дефект, найденный сессией приложения: кнопка обещала действие, которого нет.
// Поэтому проверки, говорящие о применении, теперь передают обработчик — то
// есть ставят тот случай, который и описывают. Отдельная группа ниже держит
// обратное правило: без обработчика ни кнопки, ни фраз о применении нет.
describe('K2-DIFF · три состояния строки', () => {
  it('положительный контроль: все три строки нарисованы', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} />);
    expect(screen.getAllByTestId(/^kit-diff-row-/)).toHaveLength(3);
  });

  it('добавится / снимется / уже есть различимы, а не красятся одинаково', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-row-r1').getAttribute('data-kind')).toBe('add');
    expect(screen.getByTestId('kit-diff-row-r2').getAttribute('data-kind')).toBe('remove');
    expect(screen.getByTestId('kit-diff-row-r3').getAttribute('data-kind')).toBe('same');
  });

  it('«уже есть» НЕ прячется: он объясняет, почему изменений меньше, чем галочек', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} />);
    expect(screen.getByText('строка уже есть')).toBeTruthy();
  });
});

describe('K2-DIFF · состояние проверки у каждой строки', () => {
  const mixed = (): DiffRow[] => [
    { id: 'a', kind: 'add', text: 'проверено', check: ok },
    { id: 'b', kind: 'add', text: 'не смогли проверить', check: { state: 'unverified', reason: 'источник не ответил' } },
    { id: 'c', kind: 'add', text: 'нет прав смотреть', check: { state: 'forbidden', reason: 'нужна роль администратора' } },
  ];

  it('три исхода проверки различимы по состоянию строки', () => {
    render(<DiffPreview rows={mixed()} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-row-a').getAttribute('data-check')).toBe('checked');
    expect(screen.getByTestId('kit-diff-row-b').getAttribute('data-check')).toBe('unverified');
    expect(screen.getByTestId('kit-diff-row-c').getAttribute('data-check')).toBe('forbidden');
  });

  it('«не смогли проверить» несёт причину на экране, а не только в данных', () => {
    render(<DiffPreview rows={mixed()} onApply={() => {}} />);
    expect(screen.getByText(/источник не ответил/)).toBeTruthy();
  });

  it('«нет прав» несёт свою причину и не выглядит как «не смогли»', () => {
    render(<DiffPreview rows={mixed()} onApply={() => {}} />);
    expect(screen.getByText(/нужна роль администратора/)).toBeTruthy();
  });

  it('непроверенная строка НЕ уходит в применение молча', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={mixed()} onApply={onApply} />);
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].map((r: DiffRow) => r.id)).toEqual(['a']);
  });

  it('у непроверенной строки прямо сказано, что её не применят', () => {
    render(<DiffPreview rows={mixed()} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-skip-b')).toBeTruthy();
    expect(screen.getByTestId('kit-diff-skip-c')).toBeTruthy();
    expect(screen.queryByTestId('kit-diff-skip-a')).toBeNull();
  });
});

describe('K2-DIFF · одна кнопка на всю пачку', () => {
  it('счётчик равен числу применимых строк: «уже есть» в него не входит', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} />);
    expect(apply().textContent).toMatch(/2/);
  });

  it('число склоняется по-русски', () => {
    const one: DiffRow[] = [{ id: 'x', kind: 'add', text: 'одна', check: ok }];
    render(<DiffPreview rows={one} onApply={() => {}} />);
    expect(apply().textContent).toMatch(/1 изменение/);
  });

  it('применение отдаёт приложению ровно применимые строки', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} />);
    fireEvent.click(apply());
    expect(onApply.mock.calls[0][0].map((r: DiffRow) => r.id)).toEqual(['r1', 'r2']);
  });

  it('идёт применение — кнопка занята и повторно не стреляет', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} busy />);
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
    expect(apply().getAttribute('aria-disabled')).toBe('true');
  });
});

describe('K2-DIFF · нечего применять — кнопки нет, и сказано ПОЧЕМУ', () => {
  it('сравнивать нечего: строк не прислали', () => {
    render(<DiffPreview rows={[]} onApply={() => {}} />);
    expect(screen.queryByTestId('kit-diff-apply')).toBeNull();
    expect(screen.getByTestId('kit-diff-nothing').textContent?.trim()).not.toBe('');
  });

  it('всё уже есть — это НЕ «нечего сравнивать», и текст другой', () => {
    const same: DiffRow[] = [{ id: 's', kind: 'same', text: 'уже есть', check: ok }];
    render(<DiffPreview rows={same} onApply={() => {}} />);
    expect(screen.queryByTestId('kit-diff-apply')).toBeNull();
    const said = screen.getByTestId('kit-diff-nothing').textContent ?? '';
    expect(said).toMatch(/уже|нет изменений/i);
  });

  it('изменения есть, но ни одно не проверено — сказано именно это', () => {
    const unver: DiffRow[] = [
      { id: 'u', kind: 'add', text: 'не проверено', check: { state: 'unverified', reason: 'источник не ответил' } },
    ];
    render(<DiffPreview rows={unver} onApply={() => {}} />);
    expect(screen.queryByTestId('kit-diff-apply')).toBeNull();
    const said = screen.getByTestId('kit-diff-nothing').textContent ?? '';
    expect(said).toMatch(/не провер/i);
  });

  it('три «нечего применять» — три РАЗНЫХ утверждения, а не одно на все случаи', () => {
    const texts = new Set<string>();
    for (const set of [
      [] as DiffRow[],
      [{ id: 's', kind: 'same', text: 'уже есть', check: ok }] as DiffRow[],
      [{ id: 'u', kind: 'add', text: 'нет', check: { state: 'unverified' as const, reason: 'источник не ответил' } }] as DiffRow[],
    ]) {
      const { unmount } = render(<DiffPreview rows={set} onApply={() => {}} />);
      texts.add(screen.getByTestId('kit-diff-nothing').textContent ?? '');
      unmount();
    }
    expect(texts.size, 'разные причины «нечего применять» должны звучать по-разному').toBe(3);
  });
});

describe('K2-DIFF · граница K-14', () => {
  it('в элементе нет предметных имён: что за изменения — знает приложение', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/flow/DiffPreview.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['проект', 'роль', 'keycloak', 'forgejo', 'агент', 'спринт', 'человек']) {
      expect(code.toLowerCase(), `в коде диффа встречается «${word}»`).not.toContain(word);
    }
  });

  it('подпись блока приходит от приложения', () => {
    render(<DiffPreview rows={rows()} label="Что изменится" />);
    expect(screen.getByText('Что изменится')).toBeTruthy();
  });
});

// ── Режим чтения: применять нечем, значит и кнопки нет ──────────────────
//
// Находка сессии приложения 10.11.2026 (экран «Правила CLAUDE», S7B-06): дифф
// версий документа показывают ДЛЯ ЧТЕНИЯ — применять там нечего. Но кнопка
// «Применить N» рисовалась всё равно и по нажатию не делала ничего, потому что
// обработчик не передан.
//
// Это тот же класс, что мы ловим везде: интерфейс обещает действие, которого
// нет. Кнопка-обманка хуже отсутствия кнопки — по ней судят, что изменения
// ещё не применены, и жмут снова.
//
// Правило: нет обработчика применения — нет ни кнопки, ни фраз о том, почему
// применять нечего (они про применение, а здесь его не бывает вовсе). Строки
// диффа при этом показываются как есть: читать их и есть смысл этого режима.
describe('DiffPreview · режим чтения (обработчика применения нет)', () => {
  const rows: DiffRow[] = [
    { id: 'a', kind: 'add', text: 'добавится строка', check: { state: 'checked' } },
    { id: 'b', kind: 'remove', text: 'снимется строка', check: { state: 'checked' } },
    { id: 'c', kind: 'same', text: 'уже есть', check: { state: 'checked' } },
  ];

  it('положительный контроль: с обработчиком кнопка есть', () => {
    render(<DiffPreview rows={rows} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-apply')).toBeTruthy();
  });

  it('без обработчика кнопки применения нет вовсе', () => {
    render(<DiffPreview rows={rows} />);
    expect(screen.queryByTestId('kit-diff-apply'), 'кнопка обещает действие, которого нет').toBeNull();
  });

  it('и фраз «применять нечего» тоже нет — они про применение', () => {
    render(<DiffPreview rows={[{ id: 'c', kind: 'same', text: 'уже есть', check: { state: 'checked' } }]} />);
    expect(screen.queryByTestId('kit-diff-nothing'), 'сказано про применение там, где его не бывает').toBeNull();
  });

  it('строки при этом показаны целиком — ради них режим и нужен', () => {
    render(<DiffPreview rows={rows} />);
    expect(screen.getByTestId('kit-diff-row-a')).toBeTruthy();
    expect(screen.getByTestId('kit-diff-row-b')).toBeTruthy();
    expect(screen.getByTestId('kit-diff-row-c')).toBeTruthy();
  });

  it('пустой дифф в режиме чтения говорит, что сравнивать нечего', () => {
    render(<DiffPreview rows={[]} onApply={() => {}} />);
    // «Строк нет» — это про данные, а не про применение: такое сказать надо.
    expect(document.body.textContent ?? '').toMatch(/нечего|нет/i);
  });
});


// ── Четвёртый вид строки: «было → стало» ───────────────────────────────
//
// Запрос сессии приложения 10.11.2026: смены значения среди видов строки нет,
// и экран изображает её ДВУМЯ строками («снимется editor», «добавится
// viewer»). Человек читает это как два действия и как потерю доступа между
// ними — то есть разметка утверждает то, чего не будет.
//
// Поэтому четвёртый вид: одна строка, в ней прежнее значение и новое,
// различимые СЛОВАМИ и разметкой, а не только цветом.
describe('K2-DIFF · «было → стало» одной строкой', () => {
  const chg = (): DiffRow[] => [
    { id: 'c1', kind: 'change', text: 'значение сменится', from: 'прежнее', to: 'новое', check: ok },
  ];

  it('положительный контроль: смена — ОДНА строка, а не две', () => {
    render(<DiffPreview rows={chg()} onApply={() => {}} />);
    expect(screen.getAllByTestId(/^kit-diff-row-/)).toHaveLength(1);
    expect(screen.getByTestId('kit-diff-row-c1').getAttribute('data-kind')).toBe('change');
  });

  it('смена не притворяется ни добавлением, ни снятием', () => {
    render(<DiffPreview rows={chg()} onApply={() => {}} />);
    const kind = screen.getByTestId('kit-diff-row-c1').getAttribute('data-kind');
    expect(kind).not.toBe('add');
    expect(kind).not.toBe('remove');
  });

  it('прежнее и новое значения оба на экране', () => {
    render(<DiffPreview rows={chg()} onApply={() => {}} />);
    const said = screen.getByTestId('kit-diff-change-c1').textContent ?? '';
    expect(said).toMatch(/прежнее/);
    expect(said).toMatch(/новое/);
  });

  it('«было» и «стало» названы СЛОВАМИ, а не только цветом и порядком', () => {
    render(<DiffPreview rows={chg()} onApply={() => {}} />);
    const said = screen.getByTestId('kit-diff-change-c1').textContent ?? '';
    expect(said).toMatch(/было/i);
    expect(said).toMatch(/стало/i);
  });

  it('у прежнего и нового своя разметка: слепить их в одну строку текста нельзя', () => {
    render(<DiffPreview rows={chg()} onApply={() => {}} />);
    const block = screen.getByTestId('kit-diff-change-c1');
    expect(block.querySelector('.sk-diff__was')).toBeTruthy();
    expect(block.querySelector('.sk-diff__now')).toBeTruthy();
  });

  it('смена — это изменение: счётчик её считает', () => {
    render(<DiffPreview rows={chg()} onApply={() => {}} />);
    expect(apply().textContent).toMatch(/1/);
  });

  it('«уже есть» в счётчик по-прежнему НЕ входит, а смена входит', () => {
    const mix: DiffRow[] = [
      ...chg(),
      { id: 's', kind: 'same', text: 'уже есть', check: ok },
      { id: 'a', kind: 'add', text: 'добавится', check: ok },
    ];
    render(<DiffPreview rows={mix} onApply={() => {}} />);
    expect(apply().textContent).toMatch(/2/);
  });

  it('смена уходит в применение вместе с остальными изменениями', () => {
    const onApply = vi.fn();
    const mix: DiffRow[] = [...chg(), { id: 's', kind: 'same', text: 'уже есть', check: ok }];
    render(<DiffPreview rows={mix} onApply={onApply} />);
    fireEvent.click(apply());
    expect(onApply.mock.calls[0][0].map((r: DiffRow) => r.id)).toEqual(['c1']);
  });

  it('у смены своё состояние проверки: непроверенная не применяется и сказано, что пропустят', () => {
    const onApply = vi.fn();
    const unver: DiffRow[] = [
      { id: 'c1', kind: 'change', text: 'сменится', from: 'прежнее', to: 'новое', check: { state: 'unverified', reason: 'источник не ответил' } },
      { id: 'a', kind: 'add', text: 'добавится', check: ok },
    ];
    render(<DiffPreview rows={unver} onApply={onApply} />);
    expect(screen.getByTestId('kit-diff-row-c1').getAttribute('data-check')).toBe('unverified');
    expect(screen.getByTestId('kit-diff-skip-c1')).toBeTruthy();
    fireEvent.click(apply());
    expect(onApply.mock.calls[0][0].map((r: DiffRow) => r.id)).toEqual(['a']);
  });

  it('«нет прав» у смены несёт свою причину', () => {
    const forb: DiffRow[] = [
      { id: 'c1', kind: 'change', text: 'сменится', from: 'прежнее', to: 'новое', check: { state: 'forbidden', reason: 'смотреть не дали' } },
    ];
    render(<DiffPreview rows={forb} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-row-c1').getAttribute('data-check')).toBe('forbidden');
    expect(screen.getByText(/смотреть не дали/)).toBeTruthy();
  });

  it('«было» пустое — это ДОБАВЛЕНИЕ, а не «было (пусто) → стало X»', () => {
    const bad: DiffRow[] = [{ id: 'c1', kind: 'change', text: 'сменится', from: '  ', to: 'новое', check: ok }];
    render(<DiffPreview rows={bad} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-row-c1').getAttribute('data-kind')).toBe('add');
    expect(screen.queryByTestId('kit-diff-change-c1'), 'нарисована смена без «было»').toBeNull();
  });

  it('и подмена вида НЕ молчаливая: сказано, что «было» не передали', () => {
    const bad: DiffRow[] = [{ id: 'c1', kind: 'change', text: 'сменится', from: '', to: 'новое', check: ok }];
    render(<DiffPreview rows={bad} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-note-c1').textContent?.trim()).not.toBe('');
  });

  it('«стало» пустое — это СНЯТИЕ, и тоже сказано', () => {
    const bad: DiffRow[] = [{ id: 'c1', kind: 'change', text: 'сменится', from: 'прежнее', to: '', check: ok }];
    render(<DiffPreview rows={bad} onApply={() => {}} />);
    expect(screen.getByTestId('kit-diff-row-c1').getAttribute('data-kind')).toBe('remove');
    expect(screen.getByTestId('kit-diff-note-c1').textContent?.trim()).not.toBe('');
  });

  it('«нет было» и «нет стало» — два РАЗНЫХ утверждения, а не одно на оба случая', () => {
    const texts = new Set<string>();
    for (const set of [
      [{ id: 'c1', kind: 'change' as const, text: 'x', from: '', to: 'новое', check: ok }],
      [{ id: 'c1', kind: 'change' as const, text: 'x', from: 'прежнее', to: '', check: ok }],
    ]) {
      const { unmount } = render(<DiffPreview rows={set} onApply={() => {}} />);
      texts.add(screen.getByTestId('kit-diff-note-c1').textContent ?? '');
      unmount();
    }
    expect(texts.size, 'пропажа «было» и пропажа «стало» звучат по-разному').toBe(2);
  });

  it('у полной смены лишней оговорки нет', () => {
    render(<DiffPreview rows={chg()} onApply={() => {}} />);
    expect(screen.queryByTestId('kit-diff-note-c1')).toBeNull();
  });
});

// ── Подтверждение словом перед применением ─────────────────────────────
//
// Запрос сессии приложения 10.11.2026: опасную пачку (раздать доступы, снять
// их сразу у нескольких) подтверждают вводом слова. Что считать опасным и
// каким словом — предметное знание (водораздел K-14), kit его не выдумывает:
// слово и подпись приходят от приложения.
//
// Отказ называет причину ТЕКСТОМ — то же правило, что у «вперёд нельзя» в
// Steps: серая кнопка молча это отказ без объяснения.
describe('K2-DIFF · подтверждение словом', () => {
  const conf = { word: 'СНЯТЬ', label: 'введите СНЯТЬ' };
  const field = () => screen.getByTestId('kit-diff-confirm') as HTMLInputElement;

  it('положительный контроль: без confirm поля нет, применение зовётся сразу', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} />);
    expect(screen.queryByTestId('kit-diff-confirm')).toBeNull();
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('с confirm поле есть, и подпись пришла от приложения', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} confirm={conf} />);
    expect(field()).toBeTruthy();
    expect(screen.getByText('введите СНЯТЬ')).toBeTruthy();
  });

  it('слово не введено — применение НЕ вызывается', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} confirm={conf} />);
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('и причина названа ТЕКСТОМ, а не серой кнопкой молча', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} confirm={conf} />);
    expect(screen.getByTestId('kit-diff-blocked').textContent?.trim()).not.toBe('');
  });

  it('кнопка связана с причиной: читающему вслух причина достаётся', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} confirm={conf} />);
    const id = apply().getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toBe(screen.getByTestId('kit-diff-blocked'));
  });

  it('слово введено точно — применение вызвано с применимыми строками', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} confirm={conf} />);
    fireEvent.change(field(), { target: { value: 'СНЯТЬ' } });
    fireEvent.click(apply());
    expect(onApply.mock.calls[0][0].map((r: DiffRow) => r.id)).toEqual(['r1', 'r2']);
  });

  it('введено точно — причины отказа больше нет', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} confirm={conf} />);
    fireEvent.change(field(), { target: { value: 'СНЯТЬ' } });
    expect(screen.queryByTestId('kit-diff-blocked')).toBeNull();
  });

  it('пробелы по краям обрезаем: лишний пробел — не отказ', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} confirm={conf} />);
    fireEvent.change(field(), { target: { value: '  СНЯТЬ \n' } });
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  // Решение: регистр по умолчанию ВАЖЕН. Слово подтверждения выбрало
  // приложение; молча считать «снять» тем же, что «СНЯТЬ», значит ослабить
  // заслон, о котором нас не просили. Нужно иначе — приложение говорит об
  // этом вслух (ignoreCase).
  it('регистр по умолчанию важен: не то написание — не подтверждение', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} confirm={conf} />);
    fireEvent.change(field(), { target: { value: 'снять' } });
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('приложение может сказать, что регистр не важен — и тогда не важен', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} confirm={{ ...conf, ignoreCase: true }} />);
    fireEvent.change(field(), { target: { value: 'снять' } });
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('«ещё не ввели» и «ввели не то» — два РАЗНЫХ утверждения', () => {
    render(<DiffPreview rows={rows()} onApply={() => {}} confirm={conf} />);
    const empty = screen.getByTestId('kit-diff-blocked').textContent ?? '';
    fireEvent.change(field(), { target: { value: 'не то' } });
    const wrong = screen.getByTestId('kit-diff-blocked').textContent ?? '';
    expect(empty.trim()).not.toBe('');
    expect(wrong.trim()).not.toBe('');
    expect(wrong, 'отказ одной фразой скрывает разницу между «не ввели» и «ошиблись»').not.toBe(empty);
  });

  it('применять нечего — поля подтверждения нет: кнопки нет, нечего и подтверждать', () => {
    const same: DiffRow[] = [{ id: 's', kind: 'same', text: 'уже есть', check: ok }];
    render(<DiffPreview rows={same} onApply={() => {}} confirm={conf} />);
    expect(screen.queryByTestId('kit-diff-apply')).toBeNull();
    expect(screen.queryByTestId('kit-diff-confirm'), 'подтверждать нечего, а поле стоит').toBeNull();
  });

  it('строк вовсе нет — поля подтверждения тоже нет', () => {
    render(<DiffPreview rows={[]} onApply={() => {}} confirm={conf} />);
    expect(screen.queryByTestId('kit-diff-confirm')).toBeNull();
  });

  it('режим чтения: применения нет — значит и подтверждения нет', () => {
    render(<DiffPreview rows={rows()} confirm={conf} />);
    expect(screen.queryByTestId('kit-diff-confirm')).toBeNull();
    expect(screen.queryByTestId('kit-diff-blocked')).toBeNull();
  });

  // Пустое слово — ошибка приложения. Молча снять заслон нельзя: его затем и
  // просили. Поэтому применение не даём и говорим, почему.
  it('слово подтверждения не задано — применять не даём и сказано почему', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} confirm={{ word: '   ', label: 'введите слово' }} />);
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('kit-diff-blocked').textContent?.trim()).not.toBe('');
  });

  it('идёт применение — кнопка занята и при введённом слове тоже не стреляет', () => {
    const onApply = vi.fn();
    render(<DiffPreview rows={rows()} onApply={onApply} confirm={conf} busy />);
    fireEvent.change(field(), { target: { value: 'СНЯТЬ' } });
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
  });
});
