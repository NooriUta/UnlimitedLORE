// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-06 — экран «Правила CLAUDE»: доки claude-rules и их дифф.
//
// Что отдаёт сервер (проверено по коду backend):
//   • срез docs?kind=claude-rules — список доков правил;
//   • срез doc_by_id — тело (content_md_ru / content_md_en);
//   • GET /lore/history?type=doc&id= — цепочка SCD2 версий: valid_from,
//     content_hash, автор; ТЕЛА версий (content_md) сегодня НЕ отдаёт.
// Дифф с файлом на машине считает только MCP claude_rules_diff — серверу он не
// приходит. Поэтому вид выбирается по данным: тела версий есть → построчный
// дифф (kit DiffPreview); есть только хеши → «изменилось / то же» по хешу;
// версий меньше двух → сравнивать нечего, и это сказано словами.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { RulesScreen } from './RulesScreen';
import { diffView, parseDocHistory, versionDiff, versionDiffRows } from './rules';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const DOCS = [
  { doc_id: 'claude_rules_unlimitedlore', title: 'Правила UnlimitedLORE', kind: 'claude-rules' },
  { doc_id: 'claude_rules_global', title: 'Глобальные правила', kind: 'claude-rules' },
];
const DOC = { doc_id: 'claude_rules_global', title: 'Глобальные правила', content_md_ru: '# Рабочие привычки\n\nПисать отчёты по-русски.' };
const v = (n: number, hash: string | null, extra: Record<string, unknown> = {}) => ({
  state_uid: `s${n}`, valid_from: `2026-11-0${n}T10:00:00Z`, valid_to: null, content_hash: hash,
  author: { kind: 'agent', caller: 'Claude Code (full)', source: 'hist' }, ...extra,
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fake(o: { docs?: unknown[]; docsStatus?: number; hist?: unknown; histStatus?: number } = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.startsWith('/lore/slice/docs')) return o.docsStatus ? json({ error: 'DOWN' }, o.docsStatus) : json({ rows: o.docs ?? DOCS });
    if (url.startsWith('/lore/slice/doc_by_id')) return json({ rows: [DOC] });
    if (url.startsWith('/lore/history')) return json(o.hist ?? { type: 'doc', id: DOC.doc_id, rows: [], attribution: { ok: true } }, o.histStatus ?? 200);
    return json({ error: 'NOPE' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><RulesScreen fetchImpl={f} /></KitLangProvider>);
const pick = async () => {
  fireEvent.click(await screen.findByTestId('adm-rule-claude_rules_global'));
};

describe('модель: вид диффа выбирается по данным', () => {
  it('версий меньше двух — сравнивать нечего', () => {
    expect(diffView(parseDocHistory({ rows: [] }).rows)).toBe('none');
    expect(diffView(parseDocHistory({ rows: [v(1, 'h1')] }).rows)).toBe('none');
  });

  it('есть только хеши — вид «по хешу»', () => {
    expect(diffView(parseDocHistory({ rows: [v(1, 'h1'), v(2, 'h2')] }).rows)).toBe('hashes');
  });

  it('у всех версий есть тела — построчный дифф', () => {
    const rows = parseDocHistory({ rows: [v(1, 'h1', { content_md: 'a' }), v(2, 'h2', { content_md: 'b' })] }).rows;
    expect(diffView(rows)).toBe('bodies');
  });

  it('ответ без массива rows — сбой, а не «версий нет»', () => {
    expect(() => parseDocHistory({ type: 'doc' })).toThrow(/rows/);
  });

  it('дифф тел: убранное и добавленное, общее — как «то же»', () => {
    const rows = versionDiffRows('один\nдва\n', 'один\nтри\n');
    expect(rows.some(r => r.kind === 'remove' && r.text.includes('два'))).toBe(true);
    expect(rows.some(r => r.kind === 'add' && r.text.includes('три'))).toBe(true);
    expect(rows.some(r => r.kind === 'same' && r.text.includes('один'))).toBe(true);
  });
});

describe('экран «Правила CLAUDE»', () => {
  it('список доков claude-rules — из среза docs по kind, выбор — в адресе', async () => {
    const { f, calls } = fake();
    mount(f);
    await pick();
    expect(calls.some(u => u.startsWith('/lore/slice/docs') && u.includes('kind=claude-rules'))).toBe(true);
    expect(window.location.search).toContain('adm-rule=claude_rules_global');
  });

  it('тело дока — MD-рендер (MartProse), не голый текст', async () => {
    mount(fake().f);
    await pick();
    const body = await screen.findByTestId('adm-rule-body');
    expect(await within(body).findByRole('heading', { name: 'Рабочие привычки' })).toBeTruthy();
  });

  it('про файл сказано честно: дифф с файлом — MCP claude_rules_diff на машине', async () => {
    mount(fake().f);
    await pick();
    expect((await screen.findByTestId('adm-rules-file-note')).textContent).toContain('claude_rules_diff');
  });

  it('версий нет — «сравнивать нечего», а не пустой дифф', async () => {
    mount(fake().f);
    await pick();
    const box = await screen.findByTestId('adm-rule-diff');
    expect(box.getAttribute('data-view')).toBe('none');
    expect(box.textContent).toMatch(/верси/);
  });

  it('только хеши — версии списком, смена тела видна по хешу', async () => {
    mount(fake({ hist: { rows: [v(1, 'h1'), v(2, 'h1'), v(3, 'h3')], attribution: { ok: true } } }).f);
    await pick();
    const box = await screen.findByTestId('adm-rule-diff');
    expect(box.getAttribute('data-view')).toBe('hashes');
    expect(within(box).getByTestId('adm-ver-s2').getAttribute('data-change')).toBe('same');
    expect(within(box).getByTestId('adm-ver-s3').getAttribute('data-change')).toBe('changed');
    expect(within(box).getByTestId('adm-ver-s1').getAttribute('data-change')).toBe('first');
    expect(screen.getByTestId('adm-rules-no-bodies')).toBeTruthy();
  });

  it('хеша у версии нет — «не сравнить», а не «то же»', async () => {
    mount(fake({ hist: { rows: [v(1, 'h1'), v(2, null)], attribution: { ok: true } } }).f);
    await pick();
    expect((await screen.findByTestId('adm-ver-s2')).getAttribute('data-change')).toBe('unknown');
  });

  it('тела версий есть — построчный дифф через kit DiffPreview', async () => {
    mount(fake({ hist: { rows: [v(1, 'h1', { content_md: 'один\nдва' }), v(2, 'h2', { content_md: 'один\nтри' })], attribution: { ok: true } } }).f);
    await pick();
    const box = await screen.findByTestId('adm-rule-diff');
    expect(box.getAttribute('data-view')).toBe('bodies');
    expect(box.querySelector('[data-kind="add"]')?.textContent).toContain('три');
    expect(box.querySelector('[data-kind="remove"]')?.textContent).toContain('два');
  });

  it('история 403 — «нет прав» в блоке версий, тело дока при этом видно', async () => {
    mount(fake({ hist: { error: 'SCOPE_EMPTY', detail: 'нет проектов' }, histStatus: 403 }).f);
    await pick();
    expect(await screen.findByText(/нет проектов/)).toBeTruthy();
    expect(await screen.findByTestId('adm-rule-body')).toBeTruthy();
  });

  it('срез docs упал — ошибка с повтором, а не «доков нет»', async () => {
    mount(fake({ docsStatus: 502 }).f);
    expect(await screen.findByRole('button', { name: /повтор/i })).toBeTruthy();
  });

  it('доков правил нет — честное «пусто»', async () => {
    mount(fake({ docs: [] }).f);
    expect(await screen.findByTestId('adm-rules-empty')).toBeTruthy();
  });
});

// SPRINT_UXR_S7B_ADMIN/S7B-06, приёмка 14.11: (1) дифф версий шёл целым телом — kit wordDiff
// сдаётся на 400 словах, а док правил ~13 КБ, и экран рисовал «снимется всё / добавится всё»;
// (2) версии 1 в выборе не было — чипы строились с rows.slice(1).
describe('S7B-06 · дифф длинного дока построчно; версия 1 в списке', () => {
  const LONG = Array.from({ length: 300 }, (_, i) => `Правило номер ${i + 1}: делать как договорились, без исключений.`);
  const from = LONG.join('\n');
  const to = [...LONG.slice(0, 150), 'Новое правило: дифф по строкам.', ...LONG.slice(150, 299), 'Правило номер 300: изменено.'].join('\n');

  it('модель: длинный док — точный построчный дифф, только изменённые строки и контекст', () => {
    const d = versionDiff(from, to);
    expect(d.exact).toBe(true);
    const removed = d.rows.filter(r => r.kind === 'remove');
    const added = d.rows.filter(r => r.kind === 'add');
    expect(removed.map(r => r.text)).toEqual([LONG[299]]);
    expect(added.map(r => r.text)).toEqual(['Новое правило: дифф по строкам.', 'Правило номер 300: изменено.']);
    // Неизменённые строки не идут стеной: строк диффа — десятки, а не сотни.
    expect(d.rows.length).toBeLessThan(20);
    expect(d.rows.some(r => r.kind === 'same' && /\d+/.test(r.text) && r.id.startsWith('skip'))).toBe(true);
  });

  it('экран: версия 1 есть в выборе; выбрана — сказано, что сравнивать её не с чем', async () => {
    const rows = [v(1, 'h1', { content_md: 'один' }), v(2, 'h2', { content_md: 'два' }), v(3, 'h3', { content_md: 'три' })];
    mount(fake({ hist: { rows, attribution: { ok: true } } }).f);
    await pick();
    const box = await screen.findByTestId('adm-rule-diff');
    const radios = within(box).getAllByRole('radio');
    expect(radios.map(r => r.textContent)).toEqual(['версия 1', 'версия 2', 'версия 3']);
    fireEvent.click(radios[0]);
    expect((await within(box).findByTestId('adm-rule-first')).textContent).toMatch(/перв/i);
  });
});
