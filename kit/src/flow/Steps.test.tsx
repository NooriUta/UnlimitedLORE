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
