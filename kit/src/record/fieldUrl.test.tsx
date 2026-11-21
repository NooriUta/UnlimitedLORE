// @vitest-environment jsdom
// SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 — «у PR есть паспорт с заголовком и ссылкой».
//
// Адрес у хоста git (PR, репозиторий) лежит в поле вида text: kit выводил его строкой, по которой нельзя
// перейти. Правило общее, не про PR: значение текстового поля — целиком адрес http(s) — рисуется ссылкой
// в новой вкладке. Иная схема (javascript:, data:) и текст с адресом внутри остаются текстом.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitCtx } from '../core/contract';
import { FieldValue } from './RecordView';

const ctx = { config: { kinds: {} }, md: (s: string) => s, href: (id: string) => `#${id}` } as unknown as KitCtx;
const URL = 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1641';

describe('MD-05 · адрес в текстовом поле — ссылка', () => {
  it('адрес http(s) — ссылка в новой вкладке без доступа к открывшему окну', () => {
    render(<FieldValue type="text" value={URL} ctx={ctx} />);
    const a = screen.getByRole('link', { name: URL });
    expect(a.getAttribute('href')).toBe(URL);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('положительный контроль: обычный текст ссылкой не становится', () => {
    render(<FieldValue type="text" value="feat/md05" ctx={ctx} />);
    expect(screen.getByText('feat/md05')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('чужая схема и текст с адресом внутри — текстом', () => {
    for (const v of ['javascript:alert(1)', 'data:text/html,x', `см. ${URL}`, 'https://a b']) {
      const { unmount } = render(<FieldValue type="text" value={v} ctx={ctx} />);
      expect(screen.queryByRole('link'), v).toBeNull();
      unmount();
    }
  });
});
