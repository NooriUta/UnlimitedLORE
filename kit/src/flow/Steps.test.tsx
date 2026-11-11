// @vitest-environment jsdom
// Шаги мастера (SPRINT_UXR_S10_SEIDR_KIT_2/K2-STEPS).
//
// Повод — слова владелицы 09.11.2026: «задачи по элементам новым [во] второй
// спринт разделом новым… по админ». Мастеров в прототипе админки четыре (UC-1
// подключить человека, UC-2 дать агента, UC-5 новый ноутбук, UC-7 завести
// проект «как у похожего»), и четыре экрана напишут четыре разные полосы
// шагов — ровно так у нас уже вышло пять разных способов потянуть границу
// между блоками (разобрано в S4-30). Поэтому элемент один.
//
// Шаги — НЕ вкладки: у вкладок порядок не значит ничего и перейти можно в
// любую, у шагов есть порядок, условие перехода и накопленное введённое.
//
// Каждая проверка здесь — из состава задачи, и каждая проверялась обратно
// (снять починку — падает). Доктрина честных состояний действует и тут:
// «вперёд нельзя» обязано называть ПРИЧИНУ, а не быть серой кнопкой молча.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Steps, type StepDef } from './Steps';

/** Адрес окна — настоящий: состояние шага живёт в нём (пункт 4 задачи). */
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const steps = (over: Partial<Record<string, string | null>> = {}): StepDef[] => [
  { key: 'who', title: 'Кого подключаем', blocked: over.who ?? null, render: () => <p>шаг один</p> },
  { key: 'where', title: 'Куда', blocked: over.where ?? null, render: () => <p>шаг два</p> },
  { key: 'check', title: 'Проверка', blocked: over.check ?? null, render: () => <p>шаг три</p> },
];

const bar = () => screen.getByRole('list', { name: /шаги|steps/i });
const stepBtn = (name: RegExp) => screen.getByRole('button', { name });
const next = () => screen.getByTestId('kit-steps-next');
const back = () => screen.getByTestId('kit-steps-back');

describe('K2-STEPS · порядок и переходы', () => {
  it('положительный контроль: нарисована полоса шагов и содержимое первого', () => {
    render(<Steps steps={steps()} />);
    expect(bar()).toBeTruthy();
    expect(screen.getByText('шаг один')).toBeTruthy();
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/1.*3/);
  });

  it('вперёд ведёт по порядку, назад возвращает', () => {
    render(<Steps steps={steps()} />);
    fireEvent.click(next());
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/2.*3/);
    fireEvent.click(back());
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/1.*3/);
  });

  it('пройденные шаги кликабельны, непройденные — нет', () => {
    render(<Steps steps={steps()} />);
    // С первого шага третий недоступен.
    expect(stepBtn(/Проверка/).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(next());
    fireEvent.click(next());
    // С третьего шага первый — пройденный, к нему можно вернуться нажатием.
    const first = stepBtn(/Кого подключаем/);
    expect(first.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(first);
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/1.*3/);
  });

  it('на первом шаге кнопки «назад» нет: вести некуда', () => {
    render(<Steps steps={steps()} />);
    expect(screen.queryByTestId('kit-steps-back')).toBeNull();
  });
});

describe('K2-STEPS · «вперёд нельзя» называет причину', () => {
  it('причина напечатана рядом с кнопкой, а не только серая кнопка', () => {
    render(<Steps steps={steps({ who: 'Не выбран человек' })} />);
    expect(screen.getByText('Не выбран человек')).toBeTruthy();
    expect(next().getAttribute('aria-disabled')).toBe('true');
  });

  it('нажатие заблокированной кнопки не двигает шаг', () => {
    render(<Steps steps={steps({ who: 'Не выбран человек' })} />);
    fireEvent.click(next());
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/1.*3/);
  });

  it('причина связана с кнопкой для читающих вслух (aria-describedby)', () => {
    render(<Steps steps={steps({ who: 'Не выбран человек' })} />);
    const id = next().getAttribute('aria-describedby');
    expect(id, 'кнопка без связи с причиной — экранному чтецу причина не достанется').toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toContain('Не выбран человек');
  });

  it('препятствия нет — кнопка живая и причины на экране нет', () => {
    render(<Steps steps={steps()} />);
    expect(next().getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByTestId('kit-steps-blocked')).toBeNull();
  });
});

describe('K2-STEPS · возврат не теряет введённое', () => {
  it('набранный текст остаётся после «вперёд» и «назад» — даже у неуправляемого поля', () => {
    const own: StepDef[] = [
      { key: 'a', title: 'Первый', render: () => <input aria-label="Имя" defaultValue="" /> },
      { key: 'b', title: 'Второй', render: () => <p>второй</p> },
    ];
    render(<Steps steps={own} />);
    const input = screen.getByLabelText('Имя') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Анна' } });
    fireEvent.click(next());
    fireEvent.click(back());
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Анна');
  });

  it('неактивный шаг от чтения вслух и от табуляции скрыт', () => {
    render(<Steps steps={steps()} />);
    const second = screen.getByTestId('kit-steps-panel-where');
    expect(second.hasAttribute('hidden')).toBe(true);
  });
});

describe('K2-STEPS · состояние в адресе', () => {
  it('переход пишет ?step= — ссылкой на шаг делятся', () => {
    render(<Steps steps={steps()} />);
    fireEvent.click(next());
    expect(new URLSearchParams(window.location.search).get('step')).toBe('where');
  });

  it('адрес с шагом открывает этот шаг, а не начало', () => {
    window.history.replaceState(null, '', '/?step=check');
    render(<Steps steps={steps()} />);
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/3.*3/);
  });

  it('незнакомый шаг в адресе — открыт первый, и это СКАЗАНО', () => {
    window.history.replaceState(null, '', '/?step=nope');
    render(<Steps steps={steps()} />);
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/1.*3/);
    expect(screen.getByTestId('kit-steps-unknown').textContent).toContain('nope');
  });

  it('urlKey=null — состояние только в памяти, адрес не трогаем', () => {
    render(<Steps steps={steps()} urlKey={null} />);
    fireEvent.click(next());
    expect(window.location.search).toBe('');
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/2.*3/);
  });

  it('своё имя параметра: два мастера на экране не толкаются', () => {
    render(<Steps steps={steps()} urlKey="wiz" />);
    fireEvent.click(next());
    expect(new URLSearchParams(window.location.search).get('wiz')).toBe('where');
  });
});

describe('K2-STEPS · последний шаг: «осталось руками»', () => {
  const manual = {
    title: 'Осталось руками',
    items: [
      { text: 'Выдать пароль лично', hint: 'в системе этого сделать нельзя' },
      { text: 'Forgejo: доступ к репозиторию', href: 'https://example.invalid/repo' },
    ],
  };

  it('пункты видны со ссылками и подсказками', () => {
    window.history.replaceState(null, '', '/?step=check');
    render(<Steps steps={steps()} manual={manual} />);
    expect(screen.getByText('Выдать пароль лично')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Forgejo/ }).getAttribute('href')).toBe('https://example.invalid/repo');
    expect(screen.getByText(/в системе этого сделать нельзя/)).toBeTruthy();
  });

  it('до последнего шага «осталось руками» не показывается', () => {
    render(<Steps steps={steps()} manual={manual} />);
    expect(screen.queryByTestId('kit-steps-manual')).toBeNull();
  });

  it('на последнем шаге вместо «вперёд» — «Готово», и оно зовёт onDone', () => {
    window.history.replaceState(null, '', '/?step=check');
    const onDone = vi.fn();
    render(<Steps steps={steps()} manual={manual} onDone={onDone} />);
    expect(screen.queryByTestId('kit-steps-next')).toBeNull();
    fireEvent.click(screen.getByTestId('kit-steps-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('пустой список «руками» — блока нет: пустая рамка обещала бы, что там что-то есть', () => {
    window.history.replaceState(null, '', '/?step=check');
    render(<Steps steps={steps()} manual={{ title: 'Осталось руками', items: [] }} />);
    expect(screen.queryByTestId('kit-steps-manual')).toBeNull();
  });
});

describe('K2-STEPS · граница K-14: в элементе нет предметных имён', () => {
  it('исходник не знает ни про людей, ни про проекты, ни про роли', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // Путь от корня пакета: в jsdom-среде import.meta.url — http-адрес, и
    // читать файл по нему нельзя.
    const src = readFileSync(join(process.cwd(), 'src/flow/Steps.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['проект', 'роль', 'keycloak', 'forgejo', 'агент', 'спринт']) {
      expect(code.toLowerCase(), `в коде шагов встречается «${word}» — это знание приложения, не элемента`)
        .not.toContain(word);
    }
  });

  it('шагов ноль — элемент не падает и говорит, что шагов нет', () => {
    render(<Steps steps={[]} />);
    expect(screen.getByTestId('kit-steps-empty')).toBeTruthy();
  });
});

describe('K2-STEPS · клавиатура', () => {
  it('у полосы шагов есть имя, и каждый шаг — кнопка с номером и подписью', () => {
    render(<Steps steps={steps()} />);
    const items = screen.getAllByRole('button', { name: /Кого подключаем|Куда|Проверка/ });
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/1/);
  });

  // Enter и Space по настоящей <button> нажимает САМ браузер; jsdom этого не
  // синтезирует, поэтому проверяем не нажатие, а то, из чего оно следует: шаг
  // и обе кнопки навигации — button, доступные с клавиатуры, а не div с onClick.
  it('шаги и навигация — настоящие кнопки, значит доступны с клавиатуры', () => {
    render(<Steps steps={steps()} />);
    fireEvent.click(next());
    const first = stepBtn(/Кого подключаем/);
    expect(first.tagName).toBe('BUTTON');
    expect((first as HTMLButtonElement).type).toBe('button');
    expect(next().tagName).toBe('BUTTON');
    expect(back().tagName).toBe('BUTTON');
    act(() => { first.focus(); });
    expect(document.activeElement).toBe(first);
    fireEvent.click(first);
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/1.*3/);
  });
});

// ── S7B-29: переходы и прокрутка (SPRINT_UXR_S7B_ADMIN/S7B-29) ──────────────
// Слова владелицы 11.11: «Wizard не доделан: переход между шагами; вкладка не
// ладит со скроллом». Каждая проверка ниже падала до правки.
describe('S7B-29 · шаг из адреса согласован с условиями', () => {
  it('адрес не перескакивает условие: открыт первый закрытый шаг, и это СКАЗАНО', () => {
    window.history.replaceState(null, '', '/?step=check');
    render(<Steps steps={steps({ who: 'не выбрано, кого' })} />);
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/1.*3/);
    expect(screen.getByText('шаг один').closest('[hidden]')).toBeNull();
    const note = screen.getByTestId('kit-steps-held');
    expect(note.textContent).toContain('Проверка');
    expect(note.textContent).toContain('не выбрано, кого');
    // Адрес не переписан: условие выполнят — шаг из ссылки откроется сам.
    expect(new URLSearchParams(window.location.search).get('step')).toBe('check');
  });

  it('условие выполнено — открывается шаг из адреса, заметки нет', () => {
    window.history.replaceState(null, '', '/?step=check');
    render(<Steps steps={steps()} />);
    expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/3.*3/);
    expect(screen.queryByTestId('kit-steps-held')).toBeNull();
  });
});

describe('S7B-29 · «Готово» честное', () => {
  it('без onDone кнопки «Готово» нет: кнопка, которая ничего не делает, — обман', () => {
    window.history.replaceState(null, '', '/?step=check');
    render(<Steps steps={steps()} />);
    expect(screen.queryByTestId('kit-steps-done')).toBeNull();
    expect(screen.queryByTestId('kit-steps-next')).toBeNull();
    expect(back()).toBeTruthy();
  });
});

describe('S7B-29 · два мастера на экране', () => {
  it('у причины «вперёд нельзя» свой id у каждого мастера', () => {
    render(
      <>
        <Steps steps={steps({ who: 'причина А' })} urlKey="a" />
        <Steps steps={steps({ who: 'причина Б' })} urlKey="b" />
      </>,
    );
    const ids = screen.getAllByTestId('kit-steps-blocked').map(n => n.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    const btns = screen.getAllByTestId('kit-steps-next');
    expect(btns[0].getAttribute('aria-describedby')).toBe(ids[0]);
    expect(btns[1].getAttribute('aria-describedby')).toBe(ids[1]);
  });
});

describe('S7B-29 · прокрутка при переходе', () => {
  /** Начало шагов уехало за верхний край: длинный шаг прокручен вниз. */
  const scrolledPast = (top: number) => {
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { return { top, bottom: top + 2000, left: 0, right: 0, width: 0, height: 2000, x: 0, y: top, toJSON: () => ({}) } as DOMRect; };
    return () => { Element.prototype.getBoundingClientRect = orig; };
  };

  it('начало шагов на виду — переход окно не дёргает', () => {
    const spy = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    const undo = scrolledPast(120);
    try {
      render(<Steps steps={steps()} />);
      fireEvent.click(next());
      expect(screen.getByTestId('kit-steps-progress').textContent).toMatch(/2.*3/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = orig;
      undo();
    }
  });

  it('«вперёд», «назад» и шаг полосы прокручивают к началу шагов; открытие — нет', () => {
    const spy = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    const undo = scrolledPast(-900);
    try {
      const { container } = render(<Steps steps={steps()} />);
      expect(spy).not.toHaveBeenCalled();
      fireEvent.click(next());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.contexts[0]).toBe(container.querySelector('.sk-steps'));
      expect(spy.mock.calls[0][0]).toMatchObject({ block: 'start' });
      fireEvent.click(back());
      expect(spy).toHaveBeenCalledTimes(2);
      fireEvent.click(next());
      fireEvent.click(stepBtn(/Кого подключаем/));
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      Element.prototype.scrollIntoView = orig;
      undo();
    }
  });

  it('заблокированный «вперёд» не прокручивает: шаг не сменился', () => {
    const spy = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    const undo = scrolledPast(-900);
    try {
      render(<Steps steps={steps({ who: 'нельзя' })} />);
      fireEvent.click(next());
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = orig;
      undo();
    }
  });
});

describe('S7B-29 · при прокрутке длинного шага полоса и кнопки на виду (CSS)', () => {
  // Живой замер (Playwright, Chrome, 1280×800 и 844×390, 11.11.2026): документ
  // прокручен на 900 px — полоса шагов на −717 px, то есть за краем. Причина —
  // НЕ в шагах: `.sk-shell__main { overflow: auto }` делал область содержимого
  // контейнером прокрутки, который сам не прокручивается (прокручивается
  // документ), и любое `position: sticky` внутри неё было мёртвым.
  const read = async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  };
  const rule = (css: string, sel: string) => {
    const i = css.indexOf(sel + ' {');
    expect(i, `правила ${sel} нет`).toBeGreaterThan(-1);
    return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  };

  it('полоса шагов липнет сверху, кнопки — снизу, у обеих непрозрачный фон', async () => {
    const css = await read();
    const bar = rule(css, '.sk-steps__bar');
    const nav = rule(css, '.sk-steps__nav');
    expect(bar).toMatch(/position:\s*sticky/);
    expect(bar).toMatch(/top:/);
    expect(bar).toMatch(/background:/);
    expect(nav).toMatch(/position:\s*sticky/);
    expect(nav).toMatch(/bottom:/);
    expect(nav).toMatch(/background:/);
  });

  it('в оболочке полоса встаёт под шапку, а кнопки — над нижней панелью модулей', async () => {
    const css = await read();
    expect(rule(css, '.sk-shell .sk-steps__bar')).toMatch(/top:\s*var\(--sk-top-h\)/);
    expect(rule(css, '.sk-shell--narrow .sk-steps__nav')).toMatch(/bottom:\s*calc\(var\(--sk-dock-h\)/);
  });

  it('область содержимого оболочки — не контейнер прокрутки (иначе липкое внутри мертво)', async () => {
    const main = rule(await read(), '.sk-shell__main');
    expect(main).not.toMatch(/overflow(-y)?:\s*(auto|scroll|hidden)/);
    // Боком при этом страница не распирается: лишнее обрезается, не раздвигает.
    expect(main).toMatch(/overflow-x:\s*clip/);
  });
});
