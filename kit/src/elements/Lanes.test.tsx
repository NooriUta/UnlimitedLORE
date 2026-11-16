// @vitest-environment jsdom
// SPRINT_UXR_S13_KIT4/K4-LANES: «дорожки» — запись, разложенная по полосам (у сна А · стык · у сна Б),
// элементы полосы — ссылки на записи с бейджем; стык — акцентом. Пилот 15.11: «пункты не кликаются».
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { KitLangProvider } from '../i18n';
import { Lanes } from './Lanes';

const lanes = [
  { key: 'A', title: 'У сна А', items: [{ id: 'S-1', title: 'Свиток времени', kind: 'scroll', badge: '×2' }] },
  { key: 'AB', title: 'Стык', accent: true, items: [{ id: 'Q-1', title: 'Квиз о времени', kind: 'quiz' }] },
  { key: 'B', title: 'У сна Б', items: [] },
];
const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);

describe('Lanes', () => {
  it('полосы с заголовками; стык выделен; пустая полоса — словами', () => {
    wrap(<Lanes lanes={lanes} href={id => '#' + id} label="Тропа" />);
    const groups = screen.getAllByRole('group');
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['У сна А', 'Стык', 'У сна Б']);
    expect(groups[1].getAttribute('data-accent')).toBe('true');
    expect(groups[2].textContent).toMatch(/пусто/i);
  });

  it('элементы — ссылки на записи, бейдж рядом', () => {
    wrap(<Lanes lanes={lanes} href={id => '#' + id} label="Тропа" />);
    const link = screen.getByRole('link', { name: /Свиток времени/ });
    expect(link.getAttribute('href')).toBe('#S-1');
    expect(link.closest('li')!.textContent).toContain('×2');
  });

  it('адреса нет — текст без ссылки, а не мёртвая ссылка', () => {
    wrap(<Lanes lanes={lanes} href={() => null} label="Тропа" />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Свиток времени')).toBeTruthy();
  });
});

// Пилот 16.11: щелчок по упоминанию в полосе перезагружал страницу (~4 с). onOpen — как у ListView:
// обычный щелчок — приложению, Ctrl/⌘/средняя кнопка — браузеру; ссылка остаётся ссылкой.
describe('Lanes · onOpen', () => {
  it('обычный щелчок уходит в onOpen без перехода, Ctrl-щелчок — браузеру', () => {
    const onOpen = vi.fn();
    wrap(<Lanes lanes={lanes} href={id => '#' + id} label="Тропа" onOpen={onOpen} />);
    const link = screen.getByRole('link', { name: /Свиток времени/ });
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpen).toHaveBeenCalledWith('S-1');
    onOpen.mockClear();
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    expect(link.getAttribute('href')).toBe('#S-1');
  });
});
