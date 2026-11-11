// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-18 — UC-5 «завести проект как у похожего».
// Прототип: docs/prototypes/s7b-admin-v6.html, раздел UC-5.
//
// Сервер (всё уже есть, мастер только собирает):
//   GET  /lore/slice/git_projects            → зарегистрированные проекты (slug уже есть — не перезаписываем)
//   POST /lore/project {slug,name,hosts,default_branch} → {ok, outcome, roles_granted, roles_warning}
//   GET  /lore/forgejo/ci?git_project&ref    → репозиторий и ветка видны мосту Forgejo (sha);
//        404 REF_NOT_RESOLVED — не нашли; 404 PROJECT_NOT_RESOLVABLE — hosts без primary;
//        503 FORGEJO_NOT_CONFIGURED и прочее — «проверить не смогли»
//   GET  /lore/slice/role_matrix             → люди и роли похожего проекта (с состоянием ячейки)
//   POST /lore/user/role/batch               → пачка на ОДНОГО человека: dry_run → применить → отмена
//
// Правила:
//   • копируются только ПРОВЕРЕННЫЕ роли похожего; роль можно сменить, человека — снять;
//   • пачки идут по людям последовательно, итог — по каждому; частичный отказ назван;
//   • «проверить не смогли» ≠ «репозитория нет»; ссылка на Forgejo — всегда;
//   • существующий проект повторной регистрацией не перезаписывается.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { parseRoleMatrix } from './roles';
import {
  forgejoHosts, likeProjectBatches, projectPeople, repoCheckOf, repoProblem, slugProblem, batchVerdict,
} from './projectLike';
import { WizardsScreen } from './WizardsScreen';
import { WhoWhereScreen } from './WhoWhereScreen';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* нет хранилища */ }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const cell = (project: string, role: string, state = 'checked') => ({ project, role, state, source: 'graph' });
const SRC = 'NooriUta/UnlimitedLORE';
const NEW = 'AIDA/new-service';
const MATRIX = {
  rows: [
    { kc_sub: 'u-me', display_name: 'omiloreadmin', state: 'checked', cells: [cell(SRC, 'owner'), cell('AIDA/miniLORE', 'owner')] },
    { kc_sub: 'u-volva', display_name: 'volva', state: 'checked', cells: [cell(SRC, 'developer'), cell('NooriUta/volva', 'owner')] },
    { kc_sub: 'u-ghost', display_name: 'ghost', state: 'checked', cells: [cell(SRC, 'reader', 'unavailable')] },
  ],
  sources_asked: ['graph'],
};
const GIT_PROJECTS = { rows: [{ slug: SRC, name: 'UnlimitedLORE', default_branch: 'develop', hosts: null }, { slug: 'AIDA/miniLORE', name: 'miniLORE' }] };

// ── модель ────────────────────────────────────────────────────────────────

describe('модель · UC-5', () => {
  const data = parseRoleMatrix(MATRIX);

  it('slug — те же символы, что у сервера (SAFE_ID); репозиторий — владелец/имя', () => {
    expect(slugProblem('AIDA/new-service')).toBeNull();
    expect(slugProblem('')).toBe('empty');
    expect(slugProblem('новый проект')).toBe('chars');
    expect(repoProblem('AIDA/new-service')).toBeNull();
    expect(repoProblem('new-service')).toBe('shape');
    expect(repoProblem('')).toBe('empty');
  });

  it('hosts — primary на Forgejo в том же виде, что у зарегистрированных проектов', () => {
    expect(forgejoHosts('AIDA/new-service', 'develop')).toEqual([{
      remote: 'origin', role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/new-service',
      file_url_template: '{base}/src/branch/{branch}/{path}', pr_url_template: '{base}/pulls/{n}', default_branch: 'develop',
    }]);
  });

  it('люди похожего проекта — с ролью и состоянием, по имени', () => {
    expect(projectPeople(data, SRC).map(p => [p.name, p.role, p.state])).toEqual([
      ['ghost', 'reader', 'unavailable'], ['omiloreadmin', 'owner', 'checked'], ['volva', 'developer', 'checked'],
    ]);
  });

  it('пачки по людям: только проверенные, без снятых, роль можно сменить; в новый проект', () => {
    expect(likeProjectBatches(data, SRC, NEW, new Set(), { 'u-volva': 'reader' })).toEqual([
      { kc_sub: 'u-me', changes: [{ project: NEW, role: 'owner' }] },
      { kc_sub: 'u-volva', changes: [{ project: NEW, role: 'reader' }] },
    ]);
    expect(likeProjectBatches(data, SRC, NEW, new Set(['u-me']), {}).map(b => b.kc_sub)).toEqual(['u-volva']);
    expect(likeProjectBatches(data, SRC, SRC, new Set(), {})).toEqual([]);
  });

  it('проверка репо: «не смогли» отличается от «нет»', () => {
    expect(repoCheckOf(200, { sha: 'abc123', resolved_via: 'branches' })).toEqual({ kind: 'found', sha: 'abc123', via: 'branches' });
    expect(repoCheckOf(404, { error: 'REF_NOT_RESOLVED', detail: 'нет' }).kind).toBe('missing');
    expect(repoCheckOf(404, { error: 'PROJECT_NOT_RESOLVABLE', detail: 'hosts' }).kind).toBe('unresolvable');
    expect(repoCheckOf(503, { error: 'FORGEJO_NOT_CONFIGURED', detail: 'x' }).kind).toBe('unchecked');
    expect(repoCheckOf(502, { error: 'REF_NOT_RESOLVED', detail: 'Forgejo ответил 500' }).kind).toBe('unchecked');
    expect(repoCheckOf(200, {}).kind).toBe('unchecked');
  });

  it('итог пачек: ждут, применено, частично, пропущено', () => {
    const v = batchVerdict(['a', 'b', 'c', 'd'], {
      a: { kind: 'applied', applied: 1, total: 1, failed: [], batchId: 'b1' },
      b: { kind: 'applied', applied: 0, total: 1, failed: [{ id: NEW, text: NEW, reason: 'FORBIDDEN' }], batchId: 'b2' },
      c: { kind: 'skipped' },
    });
    expect(v).toEqual({ pending: ['d'], applied: ['a'], partial: ['b'], skipped: ['c'], undone: [] });
  });
});

// ── экран ─────────────────────────────────────────────────────────────────

interface Opts {
  register?: { status: number; body: unknown };
  ci?: { status: number; body: unknown };
  failFor?: string;
  /** role_matrix в сыром виде среза (projects/roles) — так его читает раздел «Проекты». */
  rawMatrix?: boolean;
}

const RAW_MATRIX = {
  rows: MATRIX.rows.map(r => ({
    kc_sub: r.kc_sub, display_name: r.display_name,
    projects: r.cells.map(c => c.project), roles: r.cells.map(c => c.role),
  })),
};

function mockFetch(opts: Opts = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/lore/slice/git_projects')) return json(GIT_PROJECTS);
    if (url.startsWith('/lore/slice/role_matrix')) return json(opts.rawMatrix ? RAW_MATRIX : MATRIX);
    if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: [] });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
    if (url === '/lore/project' && method === 'POST') {
      const r = opts.register ?? { status: 200, body: { ok: true, slug: NEW, outcome: 'CREATED', roles_granted: ['u-me'] } };
      return json(r.body, r.status);
    }
    if (url.startsWith('/lore/forgejo/ci')) {
      const r = opts.ci ?? { status: 200, body: { ref: 'develop', sha: 'abc1234', resolved_via: 'branches', status: 'NO_RUN', checks: {} } };
      return json(r.body, r.status);
    }
    if (url === '/lore/user/role/batch') {
      const b = JSON.parse(String(init?.body)) as { kc_sub: string; dry_run?: boolean; changes: { project: string; role: string }[] };
      const c = b.changes[0];
      if (b.dry_run) {
        return json({ kc_sub: b.kc_sub, dry_run: true, plan: [{ project: c.project, before: null, after: c.role, kind: 'grant', check: { state: 'checked' } }] });
      }
      const fail = opts.failFor === b.kc_sub;
      return json({
        batch_id: `batch-${b.kc_sub}`,
        items: [fail ? { project: c.project, result: 'failed', status: 403, error: { error: 'FORBIDDEN', detail: 'нет прав' } } : { project: c.project, result: 'applied' }],
        undo: fail ? [] : [{ project: c.project, action: 'remove' }],
        undo_until: '2099-01-01T00:00:00Z',
      });
    }
    return json({ error: 'unexpected ' + url }, 500);
  });
}

const calls = (f: ReturnType<typeof mockFetch>, path: string) =>
  f.mock.calls.filter(([u]) => String(u) === path).map(([, i]) => JSON.parse(String((i as RequestInit).body)) as Record<string, unknown>);

function renderScreen(f: typeof fetch) {
  window.history.replaceState(null, '', '/?adm-wiz=project');
  return render(
    <KitLangProvider lang="ru">
      <WizardsScreen fetchImpl={f} meSub="u-me" env={{ backend: 'https://lore.example/_backend', issuer: 'https://kc.example/realms/omilore' }} />
    </KitLangProvider>,
  );
}

const next = () => fireEvent.click(screen.getByTestId('kit-steps-next'));
const nextBlocked = () => screen.getByTestId('kit-steps-next').getAttribute('aria-disabled') === 'true';

async function fillProject() {
  fireEvent.change(await screen.findByTestId('adm-wiz-pslug'), { target: { value: NEW } });
  fireEvent.change(screen.getByTestId('adm-wiz-pname'), { target: { value: 'New service' } });
}

describe('экран · UC-5 проект как у похожего', () => {
  it('карточка мастера есть среди мастеров', () => {
    renderScreen(mockFetch() as unknown as typeof fetch);
    expect(screen.getByTestId('adm-wiz-pick-project')).toBeTruthy();
  });

  it('регистрация → репо есть → люди похожего → пачки по каждому с итогом и частичным отказом', async () => {
    const f = mockFetch({ failFor: 'u-volva' });
    renderScreen(f as unknown as typeof fetch);
    await fillProject();
    expect(nextBlocked()).toBe(true);
    fireEvent.click(screen.getByTestId('adm-wiz-register'));
    await waitFor(() => expect(calls(f, '/lore/project')).toHaveLength(1));
    const reg = calls(f, '/lore/project')[0];
    expect(reg).toMatchObject({ slug: NEW, name: 'New service', default_branch: 'develop' });
    expect(JSON.parse(String(reg.hosts))).toEqual(forgejoHosts(NEW, 'develop'));
    expect((await screen.findByTestId('adm-wiz-registered')).textContent).toContain(NEW);
    next();

    // (б) проверка репо — серверным контрактом моста Forgejo
    expect((await screen.findByTestId('adm-wiz-repo-found')).textContent).toContain('abc1234');
    const ci = f.mock.calls.map(([u]) => String(u)).find(u => u.startsWith('/lore/forgejo/ci'));
    expect(ci).toBe(`/lore/forgejo/ci?git_project=${encodeURIComponent(NEW)}&ref=develop`);
    next();

    // (в) как у похожего
    fireEvent.change(await screen.findByTestId('adm-wiz-psrc'), { target: { value: SRC } });
    expect((screen.getByTestId('adm-wiz-pperson-u-ghost') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('adm-wiz-prole-u-volva'), { target: { value: 'reader' } });
    next();

    // (г) первый — omiloreadmin
    await waitFor(() => expect(calls(f, '/lore/user/role/batch').length).toBe(1));
    expect(calls(f, '/lore/user/role/batch')[0]).toMatchObject({ kc_sub: 'u-me', dry_run: true, changes: [{ project: NEW, role: 'owner' }] });
    expect(nextBlocked()).toBe(true);
    fireEvent.change(await screen.findByTestId('kit-diff-confirm'), { target: { value: 'omiloreadmin' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    await screen.findByTestId('kit-batch');
    fireEvent.click(screen.getByTestId('adm-danger-cancel'));

    // второй — volva с ролью reader, сервер отказал
    await waitFor(() => expect(calls(f, '/lore/user/role/batch').length).toBe(3));
    expect(calls(f, '/lore/user/role/batch')[2]).toMatchObject({ kc_sub: 'u-volva', dry_run: true, changes: [{ project: NEW, role: 'reader' }] });
    fireEvent.change(await screen.findByTestId('kit-diff-confirm'), { target: { value: 'volva' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    await screen.findByTestId('kit-batch-failed');
    fireEvent.click(screen.getByTestId('adm-danger-cancel'));

    const sum = await screen.findByTestId('adm-wiz-pbatch-summary');
    expect(screen.getByTestId('adm-wiz-pout-u-me').textContent).toContain('1/1');
    expect(screen.getByTestId('adm-wiz-pout-u-volva').textContent).toContain('нет прав');
    expect(sum.textContent).toMatch(/частично|не применилось/i);
    expect(nextBlocked()).toBe(false);
    next();
    // (д) осталось руками — Forgejo-доступ к репо
    expect(screen.getByText(/Forgejo: доступ людей к репозиторию/)).toBeTruthy();
  });

  it('мост Forgejo не настроен — «проверить не смогли» и ссылка, вперёд можно', async () => {
    const f = mockFetch({ ci: { status: 503, body: { error: 'FORGEJO_NOT_CONFIGURED', detail: 'FORGEJO_API_TOKEN unset' } } });
    renderScreen(f as unknown as typeof fetch);
    await fillProject();
    fireEvent.click(screen.getByTestId('adm-wiz-register'));
    await screen.findByTestId('adm-wiz-registered');
    next();
    const u = await screen.findByTestId('adm-wiz-repo-unchecked');
    expect(u.textContent).toContain('FORGEJO_API_TOKEN');
    expect(screen.getByTestId('adm-wiz-repo-link').getAttribute('href')).toBe(`https://git.seidrstudio.pro/${NEW}`);
    expect(nextBlocked()).toBe(false);
  });

  it('регистрация без прав (403) — причина названа, вперёд нельзя', async () => {
    const f = mockFetch({ register: { status: 403, body: { error: 'FORBIDDEN', detail: 'нужен superadmin' } } });
    renderScreen(f as unknown as typeof fetch);
    await fillProject();
    fireEvent.click(screen.getByTestId('adm-wiz-register'));
    expect((await screen.findByTestId('adm-wiz-register-error')).textContent).toContain('нужен superadmin');
    expect(nextBlocked()).toBe(true);
  });

  it('проект уже зарегистрирован — не перезаписывается, а берётся как есть', async () => {
    const f = mockFetch();
    renderScreen(f as unknown as typeof fetch);
    fireEvent.change(await screen.findByTestId('adm-wiz-pslug'), { target: { value: 'AIDA/miniLORE' } });
    expect(await screen.findByTestId('adm-wiz-pexists')).toBeTruthy();
    expect(screen.queryByTestId('adm-wiz-register')).toBeNull();
    expect(nextBlocked()).toBe(false);
    expect(calls(f, '/lore/project')).toHaveLength(0);
  });
});

// ── вход из раздела «Проекты» (S7B-28: проекты — свой раздел админки) ──────
//
// Завести проект — действие раздела «Проекты», как «+ Человек» у людей: мастер
// открывается на месте, в выдвижной панели. Из раскрытого проекта — «Завести
// похожий»: мастер сразу знает, с кого копировать (?adm-psrc=slug).
describe('экран · UC-5 вход из «Проектов»', () => {
  const mountProjects = (f: typeof fetch, search = '/') => {
    window.history.replaceState(null, '', search);
    return render(<KitLangProvider lang="ru"><WhoWhereScreen view="projects" fetchImpl={f} meSub="u-me" /></KitLangProvider>);
  };

  it('«+ Проект как у похожего» в разделе «Проекты» открывает мастер на месте', async () => {
    const f = mockFetch({ rawMatrix: true }) as unknown as typeof fetch;
    mountProjects(f);
    fireEvent.click(await screen.findByTestId('adm-projects-add'));
    expect(await screen.findByTestId('adm-wiz-pslug')).toBeTruthy();
  });

  it('«Завести похожий» в раскрытом проекте — мастер с этим проектом-образцом', async () => {
    const f = mockFetch({ rawMatrix: true }) as unknown as typeof fetch;
    mountProjects(f, `/?adm-open=${encodeURIComponent(SRC)}`);
    fireEvent.click(await screen.findByTestId(`adm-project-like-${SRC}`));
    expect(await screen.findByTestId('adm-wiz-pslug')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('adm-psrc')).toBe(SRC);
  });

  it('закрыли мастер — его параметры не остаются в адресе', async () => {
    const f = mockFetch({ rawMatrix: true }) as unknown as typeof fetch;
    mountProjects(f, `/?adm-open=${encodeURIComponent(SRC)}`);
    fireEvent.click(await screen.findByTestId(`adm-project-like-${SRC}`));
    await screen.findByTestId('adm-wiz-pslug');
    fireEvent.click(document.querySelector('.sk-sheet-backdrop')!);
    await waitFor(() => expect(screen.queryByTestId('adm-wiz-pslug')).toBeNull());
    expect(new URLSearchParams(window.location.search).get('adm-psrc')).toBeNull();
  });
});
