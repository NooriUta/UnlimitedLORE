// @vitest-environment jsdom
// Паспорт типа «только чтение» доходит до экрана
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS, типы фасада 09.11).
//
// Проверка сквозная намеренно — от адреса запроса до названия в карточке.
// Урок дня (сторож `wired.test.ts`): «тип добавлен в карту и покрыт тестом
// карты» ≠ «запись открывается». Карту можно поправить и забыть про экран.
//
// Отдельно проверяется АДРЕС запроса: у релиза ключ содержит и слэш, и
// решётку, и ошибка здесь не падает, а тихо отдаёт ДРУГУЮ запись.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Ответ фасада для типа «только чтение»: править нельзя, версии нет. */
const readOnly = (type: string, id: string, title: string) => ({
  contract: 'lore.record/1',
  record: { type, id, title, status: 'accepted', version: null },
  values: { title },
  parts: [],
  links: [],
  // Сервер говорит прямо: путей записи нет. Клиент это НЕ предполагает — он
  // рисует то, что пришло.
  perms: {
    can_edit: false, can_status: false, can_create: false, status_next: [],
    reason: 'только чтение: путей записи у этого типа в паспорте пока нет',
  },
  facts: {},
  schema: { fields: [{ key: 'title', label: 'Название', kind: 'text', group: 'head', editable: false }], relations: [] },
  meta: { facade: 'lore.record/1', sources: [{ block: 'record', state: 'ok' }], data_state: [] },
});

function net(body: unknown) {
  const urls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return json(body);
  });
  return { fetchImpl: fn as unknown as typeof fetch, urls };
}

describe('паспорт типа «только чтение»', () => {
  it('решение: название с фасада доходит до экрана', async () => {
    const n = net(readOnly('decision', 'D-2026-LORE-X', 'Решение с фасада'));
    render(<ListPassport type="decision" id="D-2026-LORE-X" placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="Решения" onBack={() => {}} />);
    expect(await screen.findByText('Решение с фасада', {}, { timeout: 8000 })).toBeTruthy();
    expect(n.urls.some(u => u.includes('/lore/record/decision/D-2026-LORE-X'))).toBe(true);
  });

  it('вопрос: свой тип в адресе, а не чужой', async () => {
    const n = net(readOnly('question', 'OQ-027', 'Вопрос с фасада'));
    render(<ListPassport type="question" id="OQ-027" placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="Вопросы" onBack={() => {}} />);
    expect(await screen.findByText('Вопрос с фасада', {}, { timeout: 8000 })).toBeTruthy();
    expect(n.urls.some(u => u.includes('/lore/record/question/OQ-027'))).toBe(true);
  });

  it('веха открывается, хотя статуса у типа нет вовсе', async () => {
    const body = readOnly('milestone', 'M-LORE-CLIENT-SAFE', 'O1 · client-safe');
    body.record.status = '';
    const n = net(body);
    render(<ListPassport type="milestone" id="M-LORE-CLIENT-SAFE" placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="Вехи" onBack={() => {}} />);
    expect(await screen.findByText('O1 · client-safe', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('РЕЛИЗ: решётка в ключе уходит как %23, слэш остаётся — иначе откроется ЧУЖАЯ запись', async () => {
    const uid = 'NooriUta/UnlimitedLORE#v1.17.4';
    const n = net(readOnly('release', uid, 'v1.17.4'));
    render(<ListPassport type="release" id={uid} placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="Релизы" onBack={() => {}} />);
    expect(await screen.findByText('v1.17.4', {}, { timeout: 8000 })).toBeTruthy();
    const url = n.urls.find(u => u.includes('/lore/record/release/'))!;
    expect(url).toContain('/lore/record/release/NooriUta/UnlimitedLORE%23v1.17.4');
    // Слэш не закодирован: шаблон пути фасада `{id: .+}` рассчитан на живой слэш.
    expect(url).not.toContain('%2F');
    // И решётка не осталась живой: иначе браузер отрезал бы хвост.
    expect(url.split('/lore/record/release/')[1]).not.toContain('#');
  });

  it('версии нет (null) — паспорт открывается, а не падает', async () => {
    // У решений и вопросов истории SCD2 нет, сервер отдаёт version: null.
    const n = net(readOnly('decision', 'D-1', 'Без версии'));
    render(<ListPassport type="decision" id="D-1" placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="Решения" onBack={() => {}} />);
    expect(await screen.findByText('Без версии', {}, { timeout: 8000 })).toBeTruthy();
  });
});
