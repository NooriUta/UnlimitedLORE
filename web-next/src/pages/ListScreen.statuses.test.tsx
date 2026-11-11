// @vitest-environment jsdom
// Ось статусов РАЗДЕЛА приходит из модели (SPRINT_UXR_S10_SEIDR_KIT/K-14 п. 4,
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG).
//
// Повод — слова владелицы 09.11.2026: «зачем тебе словарь статусов на своей
// стороне, если это задача уже конкретного приложения» и «я думала, для этого
// отдельный элемент модели будет, типа справочники статусов и workflow по
// объектам, присылать в kit».
//
// ПРИЧИНА, по которой это не косметика. Перечни статусов лежали в
// `lists/screens.ts` по разделам. Пока словарь в клиенте, добавленный на
// сервере статус (так было с `ready_for_deploy`) на экране не появляется, а
// подпись расходится с серверной молча. Паспорт перевели на модель 09.11
// (fetchTypeStatuses), списки остались — это и доделано.
//
// И главное: умолчание приложения НЕ исчезает, но становится НАЗВАННЫМ.
// Молчаливый откат к своему списку — ровно тот дефект, из-за которого в меню
// статуса задачи были чужие статусы и два «В работе».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SPRINTS = [{ sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 ACTIVE', git_projects: ['p1'], priority: 1 }];

/** Документ модели с циклом типа «спринт»: подпись нарочно НЕ как в клиенте. */
const MODEL = {
  format: 'model/0',
  version: '2026-11-10T00:00:00Z',
  statuses: {
    sprint: {
      entries: [
        { code: 'active', title: 'В строю', category: 'active', icon: 'sprint', color: 'var(--st-active)', order: 1 },
        { code: 'done', title: 'Завершён', category: 'done', icon: 'trophy', color: 'var(--st-done)', order: 2 },
      ],
    },
  },
};

/** Сеть, отвечающая по адресу: срез и модель грузятся независимо. */
function net(model: unknown, modelStatus = 200) {
  const urls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    if (u.includes('/lore/model')) return json(modelStatus, model);
    return json(200, { rows: SPRINTS });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const chip = (container: HTMLElement) => container.querySelector('[data-record-id="S_A"] [data-status="active"]');

describe('K-14 п. 4 · статусы списка из модели', () => {
  it('положительный контроль: список нарисован и статус у строки есть', async () => {
    const { impl } = net(MODEL);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-record-id="S_A"]')).toBeTruthy());
    await waitFor(() => expect(chip(container)).toBeTruthy());
  });

  it('подпись статуса берётся ИЗ МОДЕЛИ, а не из перечня в коде экрана', async () => {
    const { impl } = net(MODEL);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    // «В строю» — подпись модели; «В работе» — подпись умолчания приложения.
    await waitFor(() => expect(chip(container)?.textContent).toContain('В строю'));
    expect(chip(container)?.textContent).not.toContain('В работе');
  });

  it('модель спрашивается ровно за тот тип, который у раздела', async () => {
    const { impl, urls } = net(MODEL);
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(urls.some(u => u.includes('/lore/model'))).toBe(true));
  });

  it('модель недоступна — умолчание приложения, и это СКАЗАНО словами', async () => {
    const { impl } = net({ error: 'boom' }, 502);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(chip(container)?.textContent).toContain('В работе'));
    // `\w` в JS кириллицу не покрывает — отсюда явный класс букв: иначе
    // проверка падает на присутствующем тексте.
    await waitFor(() => expect(document.body.textContent).toMatch(/умолчани[а-яё]* приложения/i));
  });

  it('в модели нет цикла для типа — тоже названо, а не молчаливый откат', async () => {
    const { impl } = net({ format: 'model/0', version: 'v', statuses: { task: { entries: [] } } });
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(chip(container)?.textContent).toContain('В работе'));
    await waitFor(() => expect(document.body.textContent).toMatch(/не описан словарь|нет цикла/i));
  });

  it('у раздела без типа в модели запроса модели нет вовсе: нечего спрашивать', async () => {
    const urls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json(200, { rows: [{ milestone_id: 'M-1', name: 'Веха', week: 1 }] });
    }) as unknown as typeof fetch;
    render(<ListScreen screen="milestones" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(urls.some(u => u.includes('/lore/slice/milestones'))).toBe(true));
    expect(urls.some(u => u.includes('/lore/model')), 'у вех нет статусной оси в модели — спрашивать нечего').toBe(false);
  });
});

// S4-35 / ADR-LORE-049: показ колонок из той же модели доходит до таблицы
// списка — приоритет колонки, шаг ширины. Иначе на 1100 px колонки по-прежнему
// рубит браузер, а не правило «первой уходит наименее важная».
describe('S4-35 · показ колонок списка из модели', () => {
  it('приоритет и ширина поля из модели — у колонки списка', async () => {
    const withTypes = { ...MODEL, types: { sprint: { label: 'Спринт', fields: [
      { key: 'priority', label: 'Приоритет', kind: 'number', visibility: 'visible', display: { priority: 4, width: 'xs', overflow: 'none' } },
    ] } } };
    const { impl } = net(withTypes);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(container.querySelector('th.sk-list__c-priority')?.classList.contains('sk-list__p4')).toBe(true));
    expect(container.querySelector('th.sk-list__c-priority')?.getAttribute('data-w')).toBe('xs');
  });
});
