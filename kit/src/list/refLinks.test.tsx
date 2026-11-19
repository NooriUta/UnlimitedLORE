// @vitest-environment jsdom
// Поле-ссылка в списке и карточке открывает свою запись. Владелица 18.11.2026 (скрин карточек задач на телефоне,
// «Спринт SPRINT_UXR_S13_KIT4» — текст): «единственно если объект ссылка хорошо бы была возможность перехода».
// Правило kit, а не одной карточки: поле вида 'ref' с refKind + refHref приложения → ссылка; щелчок не открывает
// саму карточку (только запись по ссылке).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const task: KitRecord = { id: 'S/T-1', kind: 'task', title: 'Задача', status: '', fields: { sprint: 'SPRINT_UXR_S13_KIT4', note: 'текст' } };
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'task', fields: [
    { key: 'sprint', title: 'Спринт', type: 'ref', refKind: 'sprint' },
    { key: 'note', title: 'Заметка', type: 'text' },
  ] } },
  statuses: { items: [] },
  list: { views: ['list', 'cards'], columns: ['title', 'sprint', 'note'] },
} as KitConfig;
const data: KitData = { records: [task], edges: [], journal: [], meta: { generated_at: '2026-11-18T12:00:00Z', total: 1 } };
const refHref = ({ id, type }: { id: string; type?: string | null }) => `/?sec=${type}&open=${encodeURIComponent(id)}`;

describe('поле-ссылка в списке — переход к записи', () => {
  it('в карточке значение ссылки — ссылка на запись своего вида', () => {
    const onOpen = vi.fn();
    const { container } = render(<ListView config={config} data={data} urlState={false} refHref={refHref} onOpen={onOpen} />);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: /Вид/ })).getByRole('radio', { name: 'Карточки' }));
    const a = container.querySelector('.sk-cards a[href="/?sec=sprint&open=SPRINT_UXR_S13_KIT4"]') as HTMLAnchorElement | null;
    expect(a, 'спринт в карточке — ссылка').not.toBeNull();
    fireEvent.click(a!);
    expect(onOpen, 'щелчок по ссылке не открывает саму карточку').not.toHaveBeenCalled();
  });

  it('в таблице — тоже ссылка; поле не-ссылка остаётся текстом', () => {
    const { container } = render(<ListView config={config} data={data} urlState={false} refHref={refHref} />);
    expect(container.querySelector('a[href="/?sec=sprint&open=SPRINT_UXR_S13_KIT4"]')).not.toBeNull();
    expect(container.querySelector('a[href*="текст"]')).toBeNull();
  });

  it('приложение адреса не дало — значение текстом, как раньше', () => {
    const { container } = render(<ListView config={config} data={data} urlState={false} />);
    expect(container.querySelector('a[href*="sprint"]')).toBeNull();
    expect(container.textContent).toContain('SPRINT_UXR_S13_KIT4');
  });
});
