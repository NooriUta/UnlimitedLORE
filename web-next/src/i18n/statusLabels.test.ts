import { describe, expect, it } from 'vitest';
import ru from './ru.json';
import en from './en.json';

// 08.11.2026: после перевода статуса спринта на канон (planStatusOf → active) паспорт
// v2 показал «Активно», а список и v1 — «В работе». Код плана active везде подписан
// одинаково, как в v1 (status.active = «В работе»). Прочие расхождения подписей между
// status.* / lists.* / record.* — грамматический род («Заблокирован» спринт vs
// «Заблокировано») и намеренное «Действует» у ADR — сторожем не считаются.
type Dict = Record<string, string>;

describe.each([['ru', ru as Dict, 'В работе'], ['en', en as Dict, 'In progress']])('подпись кода active — %s', (_l, d, want) => {
  it('status / lists / record подписывают active одинаково, как v1', () => {
    expect(d['status.active']).toBe(want);
    expect(d['lists.status.active']).toBe(want);
    expect(d['record.status.active']).toBe(want);
  });
});
