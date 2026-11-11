// @vitest-environment jsdom
// Статус в ленте подписан ПО-ЧЕЛОВЕЧЕСКИ, а код — в подсказке
// (просьба владелицы 10.11.2026 со снимком ленты: «статусы пописаны но не
// локализацей и прямо в теле строки — учитывать локализацию, надписи в
// подсказки»).
//
// Что было: в строке события лента печатала КОД — «planned → ready_for_deploy»,
// «planned → partial». Код — это ключ, а не слово языка: человек читает ленту,
// а не словарь. При этом подпись у нас есть, и ровно там же: словарь статусов
// приложения (`StatusDictCtx`), откуда лента уже берёт иконку и цвет.
//
// Что должно быть: в строке — подпись из словаря, в подсказке — код (его
// спрашивают, когда надо свериться с API или с фильтром).
//
// Честность: словаря нет или кода в нём нет — показываем код и ГОВОРИМ об этом
// в подсказке. Подменять отсутствующую подпись выдуманной нельзя.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StatusDictCtx } from '@seidr/kit';
import { NewsStatusMark } from './NewsFeed';

const DICT = [
  { code: 'planned', title: 'Запланировано', category: 'todo' as const, icon: 'calendar', color: 'var(--st-planned)' },
  { code: 'ready_for_deploy', title: 'К выкатке', category: 'active' as const, icon: 'waves', color: 'var(--st-ready_for_deploy)' },
];

let box: HTMLElement;

// «Словаря нет» передаём ОТДЕЛЬНЫМ помощником, а не `undefined` вторым
// аргументом: по правилу JS явный undefined включает значение по умолчанию —
// то есть такой вызов отдал бы словарь, и проверка «без словаря» проверяла бы
// обратное тому, что заявлено в её названии.
const showNoDict = (code: string | null) => {
  const r = render(
    <StatusDictCtx.Provider value={undefined}>
      <NewsStatusMark code={code} />
    </StatusDictCtx.Provider>,
  );
  box = r.container;
  return r;
};

const show = (code: string | null, dict: typeof DICT = DICT) => {
  // Контейнер СВОЙ на каждый показ: разметка прошлого теста остаётся в
  // документе, и общий поиск по документу нашёл бы чужой значок — проверка
  // прошла бы мимо того, что проверяет.
  const r = render(
    <StatusDictCtx.Provider value={dict}>
      <NewsStatusMark code={code} />
    </StatusDictCtx.Provider>,
  );
  box = r.container;
  return r;
};

const mark = () => box.querySelector('.sk-news__st') as HTMLElement;

describe('лента: подпись статуса из словаря, код — в подсказке', () => {
  it('положительный контроль: значок статуса нарисован', () => {
    show('planned');
    expect(mark()).toBeTruthy();
  });

  it('в строке — слово языка, а не ключ', () => {
    show('planned');
    expect(mark().textContent).toContain('Запланировано');
    expect(mark().textContent).not.toContain('planned');
  });

  it('код статуса доступен в подсказке — по нему сверяются с API и фильтром', () => {
    show('ready_for_deploy');
    expect(mark().textContent).toContain('К выкатке');
    expect(mark().getAttribute('title')).toContain('ready_for_deploy');
  });

  it('кода нет в словаре — показан код, и подсказка это ОБЪЯСНЯЕТ', () => {
    show('shipped');
    expect(mark().textContent).toContain('shipped');
    expect(mark().getAttribute('title')).toMatch(/словар/i);
  });

  it('словаря нет вовсе — то же правило: код плюс объяснение, без выдумок', () => {
    showNoDict('planned');
    expect(mark().textContent).toContain('planned');
    expect(mark().getAttribute('title')).toMatch(/словар/i);
  });

  it('статуса нет — пусто остаётся пустым, без подписи из ниоткуда', () => {
    show(null);
    expect(mark().getAttribute('data-status')).toBe('');
  });

  it('код остаётся в data-атрибуте: по нему ищут тесты и аудит', () => {
    show('planned');
    expect(mark().getAttribute('data-status')).toBe('planned');
  });
});
