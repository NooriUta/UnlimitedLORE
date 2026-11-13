// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-20 — «Привести в порядок»: модель (точный пересчёт плана по галочкам)
// и экран (группы по виду ошибки, строка = запись, «Перепроверить» убавляет счётчик, честные состояния).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { TidyScreen } from './TidyScreen';
import { defaultRules, loreTypeOf, parseTidy, planFor, rowsOfKind } from './tidy';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/?mod=admin&sec=adm-tidy'); });

const rule = (edits: number, records: number, def: boolean, sample?: Record<string, string>) =>
  ({ edits, records, enabled: def, default: def, samples: sample ? [sample] : [] });

const CHECK = {
  ok: true, checked_at: '2026-11-13T14:10:00Z', took_ms: 4200,
  scanned: { records: 9542, fields: 10304 },
  auto: {
    edits: 30, records: 6,
    rules: {
      shape: rule(20, 4, true, { type: 'KnowTask', id: 'SPRINT_A/X-1', field: 'note_md', old: 'ADR-LORE-050', new: '[[adr:ADR-LORE-050]]' }),
      lone_own_sprint: rule(6, 3, true),
      lone_unique: rule(4, 2, false, { type: 'KnowDecision', id: 'D-1', field: 'body_md', old: 'ONLY-1', new: '[[task:SPRINT_B/ONLY-1]]' }),
    },
    signatures: { shape: 2, 'lone_own_sprint,shape': 2, lone_own_sprint: 1, lone_unique: 2 },
  },
  manual: {
    records: 3, places: 6,
    groups: { ambiguous_code: { records: 2, places: 4 }, no_record: { records: 1, places: 2 } },
    rows: [
      { type: 'KnowSpec', id: 'SPEC-ADMIN-LORE-UC', places: 3, by_kind: { ambiguous_code: 1, no_record: 2 },
        issues: [{ kind: 'no_record', id: 'UC-1', field: 'content_md', snippet: 'см. UC-1 и UC-2' },
                 { kind: 'ambiguous_code', id: 'AL-1', field: 'content_md', snippet: 'задача AL-1', suggest: ['SPRINT_C/AL-1', 'SPRINT_E/AL-1'] }] },
      { type: 'KnowTask', id: 'SPRINT_A/PU-15', places: 2, by_kind: { ambiguous_code: 2 },
        issues: [{ kind: 'ambiguous_code', id: 'PU-15', field: 'note_md', snippet: 'после PU-15' }] },
      { type: 'KnowDoc', id: 'claude_rules_global', places: 1, by_kind: { ambiguous_code: 1 },
        issues: [{ kind: 'ambiguous_code', id: 'CO-11', field: 'content_md_ru', snippet: 'CO-11' }] },
    ],
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fake(o: { getStatus?: number; recheck?: unknown; recheckStatus?: number; record?: unknown;
  plan?: unknown; planStatus?: number; apply?: unknown; undo?: unknown; dismiss?: unknown } = {}) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url === '/lore/admin/tidy/apply') {
      if (body?.dry_run) return o.planStatus ? json({ error: 'FORBIDDEN', detail: 'superadmin only' }, o.planStatus) : json(o.plan ?? PLAN);
      if (body?.undo_of) return json(o.undo ?? { ok: true, restored: 3, changed_after: 1, failed: 0, items: [] });
      return json(o.apply ?? APPLIED);
    }
    if (url === '/lore/admin/tidy/dismiss') return json(o.dismiss ?? { ok: true, dismissal_key: 'k' });
    if (url === '/lore/admin/tidy') return o.getStatus ? json({ error: 'UPSTREAM', detail: 'ArcadeDB 503' }, o.getStatus) : json(CHECK);
    if (url === '/lore/admin/tidy/recheck') return o.recheckStatus ? json({ error: 'UPSTREAM', detail: 'ArcadeDB 503' }, o.recheckStatus) : json(o.recheck ?? CHECK);
    if (url.startsWith('/lore/admin/tidy/record')) return json(o.record ?? CHECK);
    return json({ error: 'NOPE' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const PLAN = { ok: true, dry_run: true, login: 'omiloreadmin', rules: ['shape', 'lone_own_sprint'], records: 5, fields: 5, edits: 26, diff: [] };
const APPLIED = {
  batch_id: 'tb-1794580000000-0a1b2c3d', ok: true, dry_run: false, applied: 4, failed: 1, atomic: false,
  undo_until: '2099-01-01T00:00:00Z',
  items: [{ type: 'KnowTask', id: 'SPRINT_A/X-1', field: 'note_md', status: 409, result: 'failed', error: { error: 'CONFLICT', detail: 'текст менялся после проверки' } }],
};
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><TidyScreen fetchImpl={f} /></KitLangProvider>);

describe('модель', () => {
  const c = parseTidy(CHECK);
  it('умолчания — как решил сервер: неподтверждённый межспринтовый код выключен', () => {
    expect([...defaultRules(c)].sort()).toEqual(['lone_own_sprint', 'shape']);
  });
  it('план по галочкам точный: записи — по наборам правил, а не долей от правок', () => {
    expect(planFor(c, new Set(['shape', 'lone_own_sprint']))).toEqual({ edits: 26, records: 5 });
    expect(planFor(c, new Set(['lone_own_sprint']))).toEqual({ edits: 6, records: 3 });
    expect(planFor(c, new Set(['shape', 'lone_own_sprint', 'lone_unique']))).toEqual({ edits: 30, records: 7 });
  });
  it('строки группы — записи с местами этого вида', () => {
    expect(rowsOfKind(c, 'no_record').map(r => r.id)).toEqual(['SPEC-ADMIN-LORE-UC']);
    expect(rowsOfKind(c, 'ambiguous_code')).toHaveLength(3);
  });
  it('тип записи для паспорта: задача — есть, док — открыть в v2 негде', () => {
    expect(loreTypeOf('KnowTask')).toBe('task');
    expect(loreTypeOf('KnowDoc')).toBeNull();
  });
});

describe('экран', () => {
  it('показывает план, группы по виду ошибки и одну строку на запись', async () => {
    mount(fake().f);
    expect((await screen.findByTestId('adm-tidy-plan')).textContent).toContain('26 правок в 5 записях');
    expect(screen.getByTestId('adm-tidy-kind-ambiguous_code').textContent).toContain('2');
    expect(screen.getAllByTestId('adm-tidy-row')).toHaveLength(3);
    expect(screen.getByText(/внешние ссылки не считаются/)).toBeTruthy();
  });

  it('галочка правила пересчитывает план; рискованное правило помечено', async () => {
    mount(fake().f);
    const box = await screen.findByTestId('adm-tidy-rule-lone_unique');
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(within(box.closest('tr')!).getByText('проверьте примеры')).toBeTruthy();
    fireEvent.click(box);
    expect((screen.getByTestId('adm-tidy-plan')).textContent).toContain('30 правок в 7 записях');
  });

  it('группа — в адресе: ?tidy= открывает её и переживает выбор', async () => {
    window.history.replaceState(null, '', '/?mod=admin&sec=adm-tidy&tidy=no_record');
    mount(fake().f);
    await screen.findByTestId('adm-tidy-rows');
    expect(screen.getAllByTestId('adm-tidy-row').map(r => r.getAttribute('data-id'))).toEqual(['SPEC-ADMIN-LORE-UC']);
    fireEvent.click(screen.getByTestId('adm-tidy-kind-ambiguous_code'));
    expect(new URLSearchParams(window.location.search).get('tidy')).toBe('ambiguous_code');
  });

  it('раскрытие строки показывает места, подсветку и кандидатов из контекста', async () => {
    mount(fake().f);
    const row = (await screen.findAllByTestId('adm-tidy-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: /Показать места/ }));
    expect(within(row).getByText('UC-1', { selector: 'mark' })).toBeTruthy();
    expect(within(row).getByText(/Кандидаты: SPRINT_C\/AL-1, SPRINT_E\/AL-1/)).toBeTruthy();
  });

  it('паспорт: у задачи — ссылка в новой вкладке; у дока — честно «паспорта в v2 нет»', async () => {
    mount(fake().f);
    const rows = await screen.findAllByTestId('adm-tidy-row');
    const task = rows.find(r => r.getAttribute('data-id') === 'SPRINT_A/PU-15')!;
    const link = within(task).getByTestId('adm-tidy-open');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('href')).toContain('open=SPRINT_A%2FPU-15');
    const doc = rows.find(r => r.getAttribute('data-id') === 'claude_rules_global')!;
    expect(within(doc).queryByTestId('adm-tidy-open')).toBeNull();
    expect(within(doc).getByText('паспорта в v2 нет')).toBeTruthy();
  });

  it('«Перепроверить» у строки: запись чиста — уходит из списка, счётчик убывает', async () => {
    const after = structuredClone(CHECK);
    after.manual.records = 2;
    after.manual.places = 4;
    after.manual.groups.ambiguous_code = { records: 1, places: 2 };
    after.manual.rows = after.manual.rows.filter(r => r.id !== 'SPRINT_A/PU-15');
    const { f, calls } = fake({ record: { ...after, record: { type: 'KnowTask', id: 'SPRINT_A/PU-15', found: true, row: null } } });
    mount(f);
    const rows = await screen.findAllByTestId('adm-tidy-row');
    fireEvent.click(within(rows.find(r => r.getAttribute('data-id') === 'SPRINT_A/PU-15')!).getByTestId('adm-tidy-recheck'));
    expect((await screen.findByTestId('adm-tidy-status')).textContent).toContain('SPRINT_A/PU-15 чиста — ушла из списка. Записей: 3 → 2.');
    expect(screen.getAllByTestId('adm-tidy-row')).toHaveLength(2);
    expect(calls.some(c => c.url === '/lore/admin/tidy/record?type=KnowTask&id=SPRINT_A%2FPU-15')).toBe(true);
  });

  it('«Перепроверить всё» — POST; сбой назван, прежний результат остаётся помеченным', async () => {
    const { f, calls } = fake({ recheckStatus: 502 });
    mount(f);
    await screen.findByTestId('adm-tidy-plan');
    fireEvent.click(screen.getByTestId('adm-tidy-recheck-all'));
    expect((await screen.findByTestId('adm-tidy-recheck-failed')).textContent).toContain('Не смогли перепроверить');
    expect(calls.some(c => c.url === '/lore/admin/tidy/recheck' && c.method === 'POST')).toBe(true);
    expect(screen.getAllByTestId('adm-tidy-row')).toHaveLength(3);
  });

  it('не смогли проверить ≠ всё чисто: ошибка загрузки — своя плашка', async () => {
    mount(fake({ getStatus: 502 }).f);
    expect(await screen.findByText('Не смогли проверить ссылки')).toBeTruthy();
    expect(screen.queryByTestId('adm-tidy-clean')).toBeNull();
  });

  it('всё чисто — только после успешной проверки без правок и мест', async () => {
    const clean = { ...CHECK, auto: { edits: 0, records: 0, rules: {}, signatures: {} }, manual: { records: 0, places: 0, groups: {}, rows: [] } };
    const f = vi.fn(async () => json(clean)) as unknown as typeof fetch;
    mount(f);
    expect((await screen.findByTestId('adm-tidy-clean')).textContent).toContain('Всё чисто');
  });

  it('применение: пробный прогон сервера → дифф по правилам → логин → пачка → отмена', async () => {
    const { f, calls } = fake();
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-tidy-apply-open'));
    expect((await screen.findByTestId('adm-tidy-apply-summary')).textContent).toContain('26 правок в 5 записях');
    const dry = calls.find(c => c.url === '/lore/admin/tidy/apply' && c.body?.dry_run)!;
    expect(dry.body!.rules).toEqual(['shape', 'lone_own_sprint']);
    expect(screen.getByTestId('kit-diff-row-shape')).toBeTruthy();
    expect(screen.queryByTestId('kit-diff-row-lone_unique')).toBeNull();
    const btn = screen.getByTestId('kit-diff-apply');
    // Без своего логина кнопка заперта (kit: aria-disabled) и запрос не уходит.
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(calls.some(c => c.body?.confirm_login)).toBe(false);
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'omiloreadmin' } });
    expect(btn.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(btn);
    expect((await screen.findByTestId('kit-batch-summary')).textContent).toContain('4');
    expect(screen.getByTestId('kit-batch-failed').textContent).toContain('текст менялся после проверки');
    const sent = calls.find(c => c.url === '/lore/admin/tidy/apply' && c.body?.confirm_login && !c.body?.undo_of)!;
    expect(sent.body).toEqual({ rules: ['shape', 'lone_own_sprint'], confirm_login: 'omiloreadmin' });
    await waitFor(() => expect(calls.some(c => c.url === '/lore/admin/tidy/recheck')).toBe(true));
    fireEvent.click(screen.getByTestId('kit-batch-undo'));
    expect((await screen.findByText(/Пачка отменена: вернули 3/)).textContent).toContain('правленные после пачки не тронуты — 1');
    expect(calls.find(c => c.body?.undo_of)!.body).toEqual({ undo_of: APPLIED.batch_id, confirm_login: 'omiloreadmin' });
  });

  it('применение: сервер не видит человека — окно говорит это словами, поля подтверждения нет', async () => {
    mount(fake({ plan: { ...PLAN, login: null } }).f);
    fireEvent.click(await screen.findByTestId('adm-tidy-apply-open'));
    expect((await screen.findByTestId('adm-tidy-apply-human')).textContent).toContain('только человек');
    expect(screen.queryByTestId('kit-diff-confirm')).toBeNull();
  });

  it('применение: не суперадмин — запрет назван', async () => {
    mount(fake({ planStatus: 403 }).f);
    fireEvent.click(await screen.findByTestId('adm-tidy-apply-open'));
    expect((await screen.findByTestId('adm-tidy-apply-forbidden')).textContent).toContain('суперадмин');
  });

  it('«Не ссылка»: отметка уходит на сервер, строка — в «скрытые», «Вернуть» снимает отметку', async () => {
    const after = structuredClone(CHECK) as typeof CHECK & { manual: { dismissed?: unknown[] } };
    after.manual.groups = { ambiguous_code: { records: 2, places: 4 } } as typeof CHECK.manual.groups;
    after.manual.rows = after.manual.rows.map(r => r.id === 'SPEC-ADMIN-LORE-UC'
      ? { ...r, places: 1, by_kind: { ambiguous_code: 1 }, issues: r.issues.filter(i => i.kind !== 'no_record') } : r);
    after.manual.places = 4;
    after.manual.dismissed = [{ type: 'KnowSpec', id: 'SPEC-ADMIN-LORE-UC', kind: 'no_record', places: 2 }];
    window.history.replaceState(null, '', '/?mod=admin&sec=adm-tidy&tidy=no_record');
    const { f, calls } = fake({ dismiss: { ...after, dismissal_key: 'k' } });
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-tidy-dismiss'));
    expect((await screen.findByTestId('adm-tidy-status')).textContent).toContain('отмечены «не ссылка»');
    expect(calls.find(c => c.url === '/lore/admin/tidy/dismiss')!.body).toEqual({ type: 'KnowSpec', id: 'SPEC-ADMIN-LORE-UC', kind: 'no_record', action: 'add' });
    fireEvent.click(screen.getByTestId('adm-tidy-hidden-toggle'));
    expect(screen.getAllByTestId('adm-tidy-hidden-row').map(r => r.getAttribute('data-id'))).toEqual(['SPEC-ADMIN-LORE-UC']);
    fireEvent.click(screen.getByTestId('adm-tidy-restore'));
    await waitFor(() => expect(calls.filter(c => c.url === '/lore/admin/tidy/dismiss').pop()!.body!.action).toBe('remove'));
  });

  it('«Не ссылка» есть только у видов, которые бывают не ссылкой', async () => {
    mount(fake().f);
    await screen.findAllByTestId('adm-tidy-row');
    expect(screen.queryByTestId('adm-tidy-dismiss')).toBeNull();   // группа «код без спринта»
  });
});
