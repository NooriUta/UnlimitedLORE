// @vitest-environment jsdom
// Методика §7.8: подпись общей вкладки ассоциаций — из вида приложения (документа); нет — «Зависимости».
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitCtx, KindConfig } from '../core/contract';
import { RecordView } from './index';

beforeAll(() => registerGameIcons(gameIcons));

const ctxOf = (kind: KindConfig): KitCtx => ({
  config: { modules: [], menu: { groups: [] }, kinds: { quiz: kind }, statuses: { items: [{ code: 'open', title: 'Открыто', category: 'in_progress', icon: 'progression', color: 'var(--acc)' }] } },
  data: { records: [{ id: 'Q-1', kind: 'quiz', title: 'Квиз', status: 'open', fields: {} }, { id: 'T-1', kind: 'topic', title: 'Тема', status: 'open', fields: {} }],
    edges: [{ from: 'Q-1', to: 'T-1', type: 'QUIZ_OF' }], journal: [], meta: { generated_at: '' } },
  href: id => '#' + id, esc: s => s, md: s => s,
});
const base: KindConfig = { title: 'Квиз', icon: 'checkbox-tree', relations: [{ key: 'topic', label: 'Тема', relation: 'association', rel: 'QUIZ_OF', dir: 'out' }] };
const tabs = () => screen.getAllByRole('tab').map(t => t.textContent ?? '');

describe('подпись группы связей (§7.8)', () => {
  it('вид назвал группу — вкладка ассоциаций подписана им', () => {
    const ctx = ctxOf({ ...base, relationGroups: { association: 'По смыслу' } });
    render(<RecordView record={ctx.data.records[0]} ctx={ctx} tab="" onTab={() => {}} />);
    expect(tabs().some(t => t.includes('По смыслу'))).toBe(true);
  });
  it('не назвал — прежняя подпись kit «Зависимости» (умолчание не меняется)', () => {
    const ctx = ctxOf(base);
    render(<RecordView record={ctx.data.records[0]} ctx={ctx} tab="" onTab={() => {}} />);
    expect(tabs().some(t => t.includes('Зависимости'))).toBe(true);
  });
});
