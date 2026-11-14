// @vitest-environment jsdom
// PU-29 п.6 (владелица 14.11.2026, приёмка v1.17.21 на препроде): строка
// «✎ — правка на месте · исходник markdown и «вместе» — кнопками в самом
// редакторе» над каждым текстом паспорта замусоривает экран, а кнопки правки
// выглядят по-разному (текстовая ✎ у характеристик, иконка-карандаш у текста).
// Правило: подсказка — в title кнопки правки, отдельной строки нет; кнопка
// правки — одна и та же иконка (ICON_CANON.ctlEdit) везде.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { KitLangProvider } from '../i18n';
import { MdInlineEdit } from '../content/MdInlineEdit';
import { EditableField } from './EditableField';

beforeAll(() => { registerGameIcons(gameIcons); });

describe('PU-29 п.6 · подсказка правки — в подсказке кнопки, иконка правки одна', () => {
  it('над текстом нет строки-подсказки; её слова — в title кнопки правки', () => {
    const { container } = render(<KitLangProvider lang="ru"><MdInlineEdit value="Абзац" label="Описание" onSave={vi.fn()} /></KitLangProvider>);
    expect(container.querySelector('.sk-mdedit__hint')).toBeNull();
    const pen = screen.getByRole('button', { name: /Описание/ });
    expect(pen.getAttribute('title')).toMatch(/исходник markdown/);
  });

  it('у характеристики кнопка правки — та же иконка, что у текста, а не символ ✎', () => {
    const { container } = render(
      <KitLangProvider lang="ru">
        <EditableField def={{ key: 'p', label: 'Приоритет', kind: 'text' } as never} value="P1" view="P1" onSave={vi.fn(async () => {})} />
        <MdInlineEdit value="Абзац" label="Описание" onSave={vi.fn()} />
      </KitLangProvider>,
    );
    const field = screen.getByRole('button', { name: /Приоритет/ });
    const text = screen.getByRole('button', { name: /Описание/ });
    expect(field.textContent).not.toContain('✎');
    expect(field.className).toContain('sk-iconbtn');
    expect(field.innerHTML.replace(/\s/g, '')).toBe(text.innerHTML.replace(/\s/g, ''));
    expect(container.querySelectorAll('.sk-iconbtn')).toHaveLength(2);
  });
});
