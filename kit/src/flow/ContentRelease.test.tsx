// @vitest-environment jsdom
// Экран «Выпуск контента» (SPRINT_UXR_S10_SEIDR_KIT/K-12).
//
// Поток, под который он заведён (из состава задачи): методотдел собирает
// версию пака N → владелица активирует N на проде → при беде откат на N-1.
// В LORE такого экрана нет: раздел «Релизы» показывает теги, PR и спринты, но
// не дифф содержимого и не активацию.
//
// Что здесь закреплено жёстче всего:
//  • класс выпуска (хотфикс / релиз) СЧИТАЕТ СЕРВЕР, kit его только рисует.
//    Посчитать класс на клиенте значило бы решать за сервер по неполной
//    выдаче — а выдача бывает обрезанной;
//  • активация и откат — действия рискованные, поэтому через подтверждение;
//  • «активаций ещё не было» и «журнал не прислали» — разные утверждения.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContentRelease, type ContentDiff } from './ContentRelease';

const diff = (over: Partial<ContentDiff> = {}): ContentDiff => ({
  from: 7,
  to: 8,
  class: 'hotfix',
  added: [{ id: 'A-1', title: 'Новое правило' }],
  changed: [{
    id: 'C-1',
    title: 'Правило порядка',
    fields: { title: { from: 'правило для всех', to: 'правило для новичков' } },
  }],
  removed: [{ id: 'R-1', title: 'Снятое правило' }],
  ...over,
});

describe('K-12 · версии, класс и три группы', () => {
  it('положительный контроль: видны номера версий и три группы', () => {
    render(<ContentRelease diff={diff()} />);
    expect(screen.getByTestId('kit-rel-versions').textContent).toMatch(/7/);
    expect(screen.getByTestId('kit-rel-versions').textContent).toMatch(/8/);
    expect(screen.getByTestId('kit-rel-added')).toBeTruthy();
    expect(screen.getByTestId('kit-rel-changed')).toBeTruthy();
    expect(screen.getByTestId('kit-rel-removed')).toBeTruthy();
  });

  it('класс выпуска показан тем, что прислал сервер', () => {
    render(<ContentRelease diff={diff()} />);
    expect(screen.getByTestId('kit-rel-class').getAttribute('data-class')).toBe('hotfix');
    render(<ContentRelease diff={diff({ class: 'release' })} />);
    expect(screen.getAllByTestId('kit-rel-class')[1].getAttribute('data-class')).toBe('release');
  });

  it('класс не прислали — сказано, что не прислали, и НЕ посчитано самим', () => {
    render(<ContentRelease diff={diff({ class: null })} />);
    expect(screen.getByTestId('kit-rel-class').getAttribute('data-class')).toBe('unknown');
    expect(screen.getByTestId('kit-rel-class').textContent?.trim()).not.toBe('');
  });

  it('у каждой группы своё число', () => {
    render(<ContentRelease diff={diff({ added: [{ id: 'a' }, { id: 'b' }] })} />);
    expect(screen.getByTestId('kit-rel-added').textContent).toMatch(/2/);
  });

  it('пустая группа не исчезает: «добавленных нет» — это тоже ответ', () => {
    render(<ContentRelease diff={diff({ added: [] })} />);
    expect(screen.getByTestId('kit-rel-added-empty')).toBeTruthy();
  });

  it('совсем нет изменений — сказано одной строкой, а не три пустые группы', () => {
    render(<ContentRelease diff={diff({ added: [], changed: [], removed: [] })} />);
    expect(screen.getByTestId('kit-rel-nochanges')).toBeTruthy();
  });
});

describe('K-12 · пословный дифф у изменённых полей', () => {
  it('видно убранное и добавленное слово, а не «поле изменилось»', () => {
    render(<ContentRelease diff={diff()} />);
    const row = screen.getByTestId('kit-rel-field-C-1-title');
    expect(row.querySelector('[data-chunk="del"]')?.textContent).toContain('всех');
    expect(row.querySelector('[data-chunk="add"]')?.textContent).toContain('новичков');
  });

  it('имя поля названо: без него непонятно, что именно правили', () => {
    render(<ContentRelease diff={diff()} />);
    expect(screen.getByTestId('kit-rel-field-C-1-title').textContent).toContain('title');
  });

  it('очень длинное поле — дифф грубый, и это сказано словами', () => {
    const long = Array.from({ length: 900 }, (_, i) => `слово${i}`).join(' ');
    render(<ContentRelease diff={diff({
      changed: [{ id: 'C-2', fields: { body: { from: long, to: `${long} хвост` } } }],
    })} />);
    expect(screen.getByTestId('kit-rel-rough-C-2-body').textContent?.trim()).not.toBe('');
  });

  it('у изменённой записи нет полей — сказано, что подробностей не прислали', () => {
    render(<ContentRelease diff={diff({ changed: [{ id: 'C-3', fields: {} }] })} />);
    expect(screen.getByTestId('kit-rel-nofields-C-3')).toBeTruthy();
  });
});

describe('K-12 · бюджет строк и полнота выдачи', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `A-${i}`, title: `Запись ${i}` }));

  it('длинная группа режется по бюджету, и остаток назван числом', () => {
    render(<ContentRelease diff={diff({ added: many })} rowBudget={5} />);
    expect(screen.getAllByTestId(/^kit-rel-item-A-/)).toHaveLength(5);
    expect(screen.getByTestId('kit-rel-more-added').textContent).toMatch(/7/);
  });

  it('«ещё N» раскрывает остаток: спрятанное должно оставаться доступным', () => {
    render(<ContentRelease diff={diff({ added: many })} rowBudget={5} />);
    fireEvent.click(screen.getByTestId('kit-rel-more-added'));
    expect(screen.getAllByTestId(/^kit-rel-item-A-/)).toHaveLength(12);
  });

  it('сервер обрезал выдачу — «показано N из M» отдельно от нашего бюджета', () => {
    render(<ContentRelease diff={diff({ shown: 3, total: 40, truncated: true })} />);
    const said = screen.getByTestId('kit-rel-truncated').textContent ?? '';
    expect(said).toMatch(/3/);
    expect(said).toMatch(/40/);
  });
});

describe('K-12 · активация и откат — только с подтверждением', () => {
  it('«Активировать» сразу не применяет: сначала подтверждение', () => {
    const onActivate = vi.fn();
    render(<ContentRelease diff={diff()} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('kit-rel-activate'));
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByTestId('kit-rel-confirm')).toBeTruthy();
  });

  it('после подтверждения действие уходит наружу с номером версии', () => {
    const onActivate = vi.fn();
    render(<ContentRelease diff={diff()} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('kit-rel-activate'));
    fireEvent.click(screen.getByTestId('kit-rel-confirm-yes'));
    expect(onActivate).toHaveBeenCalledWith(8);
  });

  it('подтверждение можно отменить, и тогда ничего не уходит', () => {
    const onActivate = vi.fn();
    render(<ContentRelease diff={diff()} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('kit-rel-activate'));
    fireEvent.click(screen.getByTestId('kit-rel-confirm-no'));
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('kit-rel-confirm')).toBeNull();
  });

  it('откат идёт на ПРЕДЫДУЩУЮ версию, тоже через подтверждение', () => {
    const onRollback = vi.fn();
    render(<ContentRelease diff={diff()} onRollback={onRollback} />);
    fireEvent.click(screen.getByTestId('kit-rel-rollback'));
    fireEvent.click(screen.getByTestId('kit-rel-confirm-yes'));
    expect(onRollback).toHaveBeenCalledWith(7);
  });

  it('предыдущей версии нет — откат не предлагается, и сказано почему', () => {
    render(<ContentRelease diff={diff({ from: null })} onRollback={() => {}} />);
    expect(screen.queryByTestId('kit-rel-rollback')).toBeNull();
    expect(screen.getByTestId('kit-rel-norollback').textContent?.trim()).not.toBe('');
  });

  it('идёт применение — кнопки заняты и не стреляют', () => {
    const onActivate = vi.fn();
    render(<ContentRelease diff={diff()} onActivate={onActivate} busy />);
    fireEvent.click(screen.getByTestId('kit-rel-activate'));
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByTestId('kit-rel-activate').getAttribute('aria-disabled')).toBe('true');
  });

  it('обработчика нет — кнопки нет вовсе: нажимать нечему', () => {
    render(<ContentRelease diff={diff()} />);
    expect(screen.queryByTestId('kit-rel-activate')).toBeNull();
  });
});

describe('K-12 · журнал активаций', () => {
  const log = [
    { version: 7, who: 'методотдел', when: '2026-11-01T10:00:00Z', action: 'activate' as const },
    { version: 6, who: 'владелица', when: '2026-10-28T09:00:00Z', action: 'rollback' as const },
  ];

  it('кто, когда и какая версия — всё три', () => {
    render(<ContentRelease diff={diff()} log={log} />);
    const rows = screen.getAllByTestId(/^kit-rel-log-/);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/методотдел/);
    expect(rows[0].textContent).toMatch(/7/);
  });

  it('активация и откат в журнале различимы', () => {
    render(<ContentRelease diff={diff()} log={log} />);
    expect(screen.getAllByTestId(/^kit-rel-log-/)[1].getAttribute('data-action')).toBe('rollback');
  });

  it('журнал пуст — «активаций ещё не было»', () => {
    render(<ContentRelease diff={diff()} log={[]} />);
    expect(screen.getByTestId('kit-rel-log-empty')).toBeTruthy();
  });

  it('журнал не прислали вовсе — это ДРУГОЕ утверждение, не «не было»', () => {
    render(<ContentRelease diff={diff()} />);
    expect(screen.queryByTestId('kit-rel-log-empty')).toBeNull();
    expect(screen.getByTestId('kit-rel-log-unknown')).toBeTruthy();
  });
});

describe('K-12 · граница K-14', () => {
  it('в элементе нет предметных имён: что за контент — знает приложение', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/flow/ContentRelease.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['пак', 'свиток', 'правило', 'методотдел', 'спринт', 'задач']) {
      expect(code.toLowerCase(), `в коде выпуска встречается «${word}»`).not.toContain(word);
    }
  });
});

// Проверка 11.11.2026 (владелица: «посмотри, нет ли там багов»).
describe('K-12 · найдено на проверке 11.11', () => {
  const d: ContentDiff = { from: 7, to: 8, class: 'hotfix', added: [{ id: 'A' }], changed: [], removed: [] };

  it('выпуск начался после открытия подтверждения (busy) — «Да» не активирует второй раз', () => {
    const onActivate = vi.fn();
    const { rerender } = render(<ContentRelease diff={d} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId('kit-rel-activate'));
    rerender(<ContentRelease diff={d} onActivate={onActivate} busy />);
    fireEvent.click(screen.getByTestId('kit-rel-confirm-yes'));
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByTestId('kit-rel-confirm-yes').getAttribute('aria-disabled')).toBe('true');
  });

  it('пока живая версия — та, что «было» (N ещё не активирована), отката нет: он вёл бы на неё же', () => {
    render(<ContentRelease diff={d} onRollback={() => {}} log={[{ version: 7, who: 'x', when: 't', action: 'activate' }]} />);
    expect(screen.queryByTestId('kit-rel-rollback')).toBeNull();
    expect(screen.getByTestId('kit-rel-norollback').textContent).toMatch(/8/);
  });

  it('после активации N откат на N-1 предлагается', () => {
    render(<ContentRelease diff={d} onRollback={() => {}} log={[{ version: 8, who: 'x', when: 't2', action: 'activate' }, { version: 7, who: 'x', when: 't', action: 'activate' }]} />);
    expect(screen.getByTestId('kit-rel-rollback').textContent).toMatch(/7/);
  });

  it('журнал не прислали — что живое, неизвестно: откат остаётся, как было', () => {
    render(<ContentRelease diff={d} onRollback={() => {}} />);
    expect(screen.getByTestId('kit-rel-rollback')).toBeTruthy();
  });
});
