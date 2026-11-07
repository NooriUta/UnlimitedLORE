import { describe, expect, it } from 'vitest';
import {
  NO_PRODUCT, isFrozenMilestone, milestonesOfProduct, productScope, unplannedOfProduct,
  sprintInProduct, hiddenAsPast, isStreamSprint, unplannedShare, productRepos, productServes,
  type ProductRow,
} from './milestoneProducts';

/**
 * RM-P5 / RM-U2 / RM-U6 (прототип RM-U1 v4, «да» владелицы 06.11.2026):
 * карта вех строится по ПРОДУКТУ, подпродукты показываются внутри родителя,
 * история заморожена и в счёт открытой работы не входит, «вне плана» — открытые
 * спринты продукта без вехи.
 */
const P: ProductRow[] = [
  { code: 'AIDA', label_ru: 'AIDA', parent_code: [], sub_products: ['HOUND', 'SEIDR'], components: ['DALI', 'AIDA'] },
  { code: 'HOUND', label_ru: 'HOUND', parent_code: ['AIDA'], sub_products: [], components: ['HND'] },
  { code: 'SEIDR', label_ru: 'SEIDR', parent_code: ['AIDA'], sub_products: [], components: ['LOOM'] },
  { code: 'MIDGARD', label_ru: 'Мидгард', parent_code: [], sub_products: [], components: ['GLADSHEIM'] },
];
const ms = (id: string, products: string[], sprints: string[] = []) =>
  ({ milestone_id: id, label: id, week: null, date_display: null, goal_md: null, priority: null,
     products, direct_sprint_ids: sprints });
const sp = (id: string, status: string, components: string[]) =>
  ({ sprint_id: id, name: id, status_raw: status, components });

describe('milestoneProducts', () => {
  it('подпродукты входят в карту родителя, но не наоборот', () => {
    expect([...productScope('AIDA', P)].sort()).toEqual(['AIDA', 'HOUND', 'SEIDR']);
    expect([...productScope('HOUND', P)]).toEqual(['HOUND']);
  });

  it('веха подпродукта видна в карте AIDA; чужая — нет; «без продукта» — отдельно', () => {
    const M = [ms('M-AIDA-A1', ['AIDA']), ms('M-HOUND-H1', ['HOUND']), ms('M-MIDGARD-D2', ['MIDGARD']), ms('M-X', [])];
    expect(milestonesOfProduct(M, 'AIDA', P).map(m => m.milestone_id)).toEqual(['M-AIDA-A1', 'M-HOUND-H1']);
    expect(milestonesOfProduct(M, 'HOUND', P).map(m => m.milestone_id)).toEqual(['M-HOUND-H1']);
    expect(milestonesOfProduct(M, NO_PRODUCT, P).map(m => m.milestone_id)).toEqual(['M-X']);
    expect(milestonesOfProduct(M, null, P)).toHaveLength(4);
  });

  it('заморожены забег M0–M7 и вехи истории по сериям релизов, прогноз — нет', () => {
    for (const id of ['M0', 'M7', 'M-AIDA-HIST-1.3', 'M-GLADSHEIM-HIST-0.1-0.6']) expect(isFrozenMilestone(id)).toBe(true);
    for (const id of ['M-AIDA-A1', 'M-LORE-CLIENT-SAFE', 'M8', 'M10']) expect(isFrozenMilestone(id)).toBe(false);
  });

  it('«вне плана»: открытые спринты компонентов продукта (с подпродуктами) без вехи', () => {
    const M = [ms('M-AIDA-A1', ['AIDA'], ['SPRINT_IN_PLAN'])];
    const S = [
      sp('SPRINT_IN_PLAN', '📋 PLANNED', ['DALI']),
      sp('SPRINT_FREE', '🔄 IN PROGRESS', ['HND']),
      sp('SPRINT_DONE', '✅ DONE', ['DALI']),
      sp('SPRINT_CANCELLED', '🚫 CANCELLED', ['DALI']),
      sp('SPRINT_OTHER', '📋 PLANNED', ['GLADSHEIM']),
    ];
    expect(unplannedOfProduct(S, M, 'AIDA', P).map(s => s.sprint_id)).toEqual(['SPRINT_FREE']);
    expect(unplannedOfProduct(S, M, 'MIDGARD', P).map(s => s.sprint_id)).toEqual(['SPRINT_OTHER']);
    // без выбора продукта — все открытые без вехи
    expect(unplannedOfProduct(S, M, null, P).map(s => s.sprint_id).sort()).toEqual(['SPRINT_FREE', 'SPRINT_OTHER']);
  });
});

/**
 * Доделка RM-P5 / RM-U2 / RM-U6 / RM-V4 (06.11.2026, «а почему до конца не
 * доделаешь задачи?»): фильтр продукта на Ганте, просрочка не прячется,
 * «вне плана» числом и с делением «поток / забыли».
 */
describe('milestoneProducts · доделка плана', () => {
  const sp2 = (id: string, comps: string[]) => ({ sprint_id: id, name: id, status_raw: '📋 PLANNED', components: comps });

  it('спринт входит в продукт через компоненты, подпродукты — в карту родителя', () => {
    expect(sprintInProduct(sp2('A', ['HND']), 'AIDA', P)).toBe(true);
    expect(sprintInProduct(sp2('A', ['HND']), 'HOUND', P)).toBe(true);
    expect(sprintInProduct(sp2('A', ['DALI']), 'HOUND', P)).toBe(false);
    expect(sprintInProduct(sp2('A', ['GLADSHEIM']), 'AIDA', P)).toBe(false);
    expect(sprintInProduct(sp2('A', ['GLADSHEIM']), null, P)).toBe(true);
    // «Без продукта» — ни один компонент спринта не принадлежит ни одному продукту
    expect(sprintInProduct(sp2('A', ['NOWHERE']), NO_PRODUCT, P)).toBe(true);
    expect(sprintInProduct(sp2('A', ['HND']), NO_PRODUCT, P)).toBe(false);
  });

  it('«Прошлые» прячет только закрытое прошлое; открытая просрочка видна всегда', () => {
    const today = new Date('2026-11-06');
    const past = new Date('2026-10-01');
    const future = new Date('2026-12-01');
    expect(hiddenAsPast(past, today, true, true)).toBe(true);    // закрыт и прошёл — прячем
    expect(hiddenAsPast(past, today, false, true)).toBe(false);  // открыт и просрочен — НЕ прячем
    expect(hiddenAsPast(future, today, true, true)).toBe(false);
    expect(hiddenAsPast(past, today, true, false)).toBe(false);  // тумблер «Прошлые» включён
  });

  it('поток (уборка, апгрейды, CI, зависимости) отделяется от «правда забыли»', () => {
    for (const id of ['SPRINT_HOUSEKEEPING_NOV26', 'SPRINT_ARCADEDB_26_11_ALL', 'SPRINT_DEPS_JUNE26', 'SPRINT_BACKUP_STRATEGY', 'SPRINT_LORE_DB_UPGRADE_REGRESSION', 'SPRINT_CI_SELECTIVE_FAST', 'SPRINT_SECURITY_DEPS_MAY26'])
      expect(isStreamSprint(id)).toBe(true);
    for (const id of ['SPRINT_DALI_UC3_UC4', 'SPRINT_ODIN_VEC_ARCH', 'SPRINT_BOKVIT_FOUNDATION'])
      expect(isStreamSprint(id)).toBe(false);
  });

  it('доля «вне плана» — от открытых спринтов продукта, с делением', () => {
    const M = [ms('M-AIDA-A1', ['AIDA'], ['SPRINT_IN'])];
    const S = [
      sp('SPRINT_IN', '📋 PLANNED', ['DALI']),
      sp('SPRINT_HOUSEKEEPING_X', '📋 PLANNED', ['DALI']),
      sp('SPRINT_FORGOT', '📋 PLANNED', ['HND']),
      sp('SPRINT_OLD', '✅ DONE', ['DALI']),
    ];
    expect(unplannedShare(S, M, 'AIDA', P)).toEqual({ open: 3, unplanned: 2, stream: 1, intentional: 0, forgotten: 1, pct: 67 });
    expect(unplannedShare(S, M, 'MIDGARD', P)).toEqual({ open: 0, unplanned: 0, stream: 0, intentional: 0, forgotten: 0, pct: 0 });
  });

  it('«вне плана намеренно» снимает спринт из «забыли», но оставляет в доле (RM-U6, 07.11.2026)', () => {
    const M = [ms('M-AIDA-A1', ['AIDA'], ['SPRINT_IN'])];
    const S = [
      sp('SPRINT_IN', '📋 PLANNED', ['DALI']),
      { ...sp('SPRINT_SPIKE', '📋 PLANNED', ['DALI']), unplanned_intentional: true },
      sp('SPRINT_FORGOT', '📋 PLANNED', ['HND']),
      { ...sp('SPRINT_HOUSEKEEPING_Y', '📋 PLANNED', ['DALI']), unplanned_intentional: true },
    ];
    // поток по имени не считается дважды: HOUSEKEEPING — поток, а не «намеренно»
    expect(unplannedShare(S, M, 'AIDA', P)).toEqual({ open: 4, unplanned: 3, stream: 1, intentional: 1, forgotten: 1, pct: 75 });
  });

  it('репозитории продукта с ролью связи: owner развивает, consumer пользуется, без роли — честно null (WK-02)', () => {
    const row = { code: 'HARPA', label_ru: 'HARPA', parent_code: [], sub_products: [], components: [],
      git_projects: ['NooriUta/seidr-site', 'NooriUta/UnlimitedLORE', 'AIDA/x'], git_project_roles: ['owner', 'consumer', null] };
    expect(productRepos(row)).toEqual([
      { slug: 'NooriUta/seidr-site', role: 'owner' },
      { slug: 'NooriUta/UnlimitedLORE', role: 'consumer' },
      { slug: 'AIDA/x', role: null },
    ]);
    // старый ответ бэкенда без ролей — роли неизвестны, а не «owner»
    expect(productRepos({ ...row, git_project_roles: undefined })[0]).toEqual({ slug: 'NooriUta/seidr-site', role: null });
    expect(productRepos({ ...row, git_projects: null })).toEqual([]);
  });

  it('кому продукт служит — по видам, неизвестный вид не подставляется (WK-03)', () => {
    expect(productServes({ serves_codes: ['MIDGARD', 'AIDA', 'AIDA', 'DW', 'X'], serves_kinds: ['sell', 'sell', 'support', 'sell', 'advertise'] }))
      .toEqual({ count: [], sell: ['AIDA', 'DW', 'MIDGARD'], support: ['AIDA'] });
    expect(productServes({})).toEqual({ count: [], sell: [], support: [] });
  });
});
