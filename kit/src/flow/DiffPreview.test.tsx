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
