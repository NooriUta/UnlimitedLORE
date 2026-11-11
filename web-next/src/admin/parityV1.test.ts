// SPRINT_UXR_S7B_ADMIN/S7B-31 — функциональный паритет старой админки v1 и v2.
//
// Сторож: каждый текст (ключ i18n) старых вкладок v1 «Словари», «Теги»,
// «Настройки», «Быстрые команды» либо нашёл место в v2 (ключ существует в ОБЕИХ
// локалях web-next), либо отпущен с названной причиной. Новая строка в v1 без
// решения здесь — красный тест: функция не потеряется молча.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

const V1 = join(__dirname, '../../../src/components/lore/admin');
const FILES = ['DictsTab.tsx', 'TagsTab.tsx', 'SettingsTab.tsx', 'QuickCommandsTab.tsx', 'quickCommands.ts'];

/** v1-ключ (без префикса lore.admin.) → ключ v2, kit-элемент или причина, почему места нет. */
type Where = string | { kit: string } | { dropped: string };

const MAP: Record<string, Where> = {
  // ── Словари ──
  addValue: 'admin.dicts.addValue', cancel: 'admin.dicts.cancel', canonChip: 'admin.dicts.canonChip',
  canonConfirm: 'admin.dicts.confirmCanon', canonWarn: 'admin.dicts.canonWarn', codeLocked: 'admin.dicts.codeLocked',
  codeLockedHint: 'admin.dicts.codeLocked', codeRequired: 'admin.dicts.codeRequired', collapse: 'admin.dicts.collapse',
  colorCustom: 'admin.dicts.colorCustom', deact: 'admin.dicts.f.active', deactConfirm: 'admin.dicts.confirmDeact',
  dictEmptyActiveH: 'admin.dicts.emptyActiveH', dictEmptyB: 'admin.dicts.emptyB', dictEmptyH: 'admin.dicts.emptyH',
  dictEmptyQ: 'admin.dicts.emptyQ', dictSearch: 'admin.dicts.searchPh', edit: 'admin.dicts.edit', fCode: 'admin.dicts.f.code',
  fColor: 'admin.dicts.f.color', fIcon: 'admin.dicts.f.icon', fLabel: 'admin.dicts.f.labelRu', fOrder: 'admin.dicts.f.order',
  fltActive: 'admin.dicts.fltActive', fltAll: 'admin.dicts.fltAll', iconBad: 'admin.dicts.iconBad', iconMaybe: 'admin.dicts.iconMaybe',
  inactive: 'admin.dicts.off', na: 'admin.dicts.na', newTypeBad: 'admin.dicts.newTypeBad', newTypeCreate: 'admin.dicts.newTypeCreate',
  newTypeHint: 'admin.dicts.newTypeHint', newTypeLabel: 'admin.dicts.newType', newTypeOpen: 'admin.dicts.newTypeOpen',
  newTypePlaceholder: 'admin.dicts.newTypePh', preview: 'admin.dicts.preview', reactivate: 'admin.dicts.reactivate',
  reactivateNote: 'admin.dicts.reactivateNote', save: { kit: 'DiffPreview: «Применить N изменение»' },
  thActive: 'admin.dicts.col.active', thCode: 'admin.dicts.col.code', thLabel: 'admin.dicts.col.label', thLook: 'admin.dicts.col.look',
  thOrder: 'admin.dicts.col.order', thUses: 'admin.dicts.col.uses', usageNA: 'admin.dicts.usageNA', usageWarn: 'admin.dicts.usageWarn',
  usageWarn2: 'admin.dicts.usageWarn',
  // ── Теги ──
  byAlpha: 'admin.tags.byAlpha', byUses: 'admin.tags.byUses', tagOrphan: 'admin.tags.orphan', tagSearch: 'admin.tags.searchPh',
  tagsNote: 'admin.tags.note', thTag: 'admin.tags.col.tag',
  // ── Настройки: чеклист → Главная ──
  authBlockH: 'admin.pf.title', authOffLine: 'admin.pf.authOff', authOnLine: 'admin.pf.authOn', cantEnableH: 'admin.pf.cantEnable',
  chkAdmins: 'admin.pf.admins', chkAdminsN: 'admin.pf.adminsN', chkAdminsUnknown: 'admin.pf.adminsUnknown', chkKc: 'admin.pf.kc',
  chkKcDown: 'admin.pf.kcDown', chkKcOff: 'admin.pf.kcOff', chkKcOk: 'admin.pf.kcOk', chkScope: 'admin.pf.scope',
  chkScopeOn: 'admin.pf.scopeOn', chkScopeSub: 'admin.pf.scopeOff', pfLoading: 'admin.pf.loading', setProj: 'admin.pf.activeProject',
  enableAuthNote: 'admin.pf.enableNote',
  enableAuth: { dropped: 'кнопка в v1 всегда была disabled («рантайм-ручки нет») — в v2 вместо кнопки-обманки сказано словами (admin.pf.enableNote)' },
  roleNow: { dropped: 'клиент v2 своей роли не знает (права решает сервер); вкл/выкл auth берём из ответа сервера, а не из сборки' },
  // ── Настройки: отказы → Журнал ──
  denialsEmpty: 'admin.denials.empty', denialsH: 'admin.denials.title', denialsNA: 'admin.denials.forbidden', denialsSrc: 'admin.denials.src',
  thError: 'admin.denials.col.error', thMethod: 'admin.denials.col.method', thPath: 'admin.denials.col.path',
  thRole: 'admin.denials.col.role', thStatus: 'admin.denials.col.status', thWhen: 'admin.denials.col.when',
  // ── Настройки: параметры приложения → Флаги ──
  paramsH: 'admin.set.title', remove: 'admin.set.remove', removeConfirm: { kit: 'DiffPreview: «Применить» после «Что снимется»' },
  settingChartLayerDescr: 'admin.set.descr.chartLayer', settingChartLayerHint: 'admin.set.hint.chartLayer', settingEdit: 'admin.set.edit',
  settingMdImageMaxDescr: 'admin.set.descr.mdImageMax', settingMdImagesDescr: 'admin.set.descr.mdImages',
  settingMdImagesHint: 'admin.set.hint.mdImages', settingNotSet: 'admin.set.notSet', settingQgProjectsDef: 'admin.set.def.qgProjects',
  settingQgProjectsDescr: 'admin.set.descr.qgProjects', settingQgProjectsHint: 'admin.set.hint.qgProjects', settingSave: 'admin.set.save',
  settingTypeBool: 'admin.set.type.bool', settingTypeChartLayer: 'admin.set.type.chartLayer', settingTypeDef: 'admin.set.typeDef',
  settingTypeMb: 'admin.set.type.mb', settingTypeProjects: 'admin.set.type.projects', settingTypeUrl: 'admin.set.type.url',
  settingVolvaUrlDef: 'admin.set.def.volvaUrl', settingVolvaUrlDescr: 'admin.set.descr.volvaUrl', settingVolvaUrlHint: 'admin.set.hint.volvaUrl',
  thDescr: 'admin.set.col.descr', thKey: 'admin.set.col.key', thValue: 'admin.set.col.value',
  unknownB: 'admin.set.unknownB', unknownH: 'admin.set.unknownH', volvaCheckBtn: 'admin.set.volva.btn', volvaCheckError: 'admin.set.volva.error',
  volvaCheckForbidden: 'admin.set.volva.forbidden', volvaCheckNotConfigured: 'admin.set.volva.notConfigured', volvaCheckNote: 'admin.set.volva.note',
  volvaCheckOk: 'admin.set.volva.ok', volvaCheckUnknown: 'admin.set.volva.unknownChart',
  noKnownSettings: { dropped: 'ветка «реестр пуст» мертва и в v1: реестр известных ключей не пуст (5 ключей)' },
  // ── Быстрые команды → MCP ──
  copied: 'admin.quick.copied', copyFailed: 'admin.quick.failed', copyTitle: 'admin.quick.copy', copyUnavailable: 'admin.quick.unavailable',
  quickNote: 'admin.quick.note', quickAidaRoot: 'admin.quick.aidaRoot', quickAttach: 'admin.quick.attach',
  quickGrpChannel: 'admin.quick.grpChannel', quickGrpProject: 'admin.quick.grpProject', quickMobilepoc: 'admin.quick.mobilepoc',
  quickUnlimitedLore: 'admin.quick.unlimitedLore',
};

function v1Keys(): string[] {
  const keys = new Set<string>();
  for (const f of FILES) {
    const src = readFileSync(join(V1, f), 'utf8');
    for (const m of src.matchAll(/['"]lore\.admin\.([A-Za-z0-9]+)['"]/g)) keys.add(m[1]);
  }
  return [...keys].sort();
}

describe('S7B-31 · паритет старых вкладок v1 и админки v2', () => {
  it('у каждого текста v1 есть место в v2 или названная причина', () => {
    const missing = v1Keys().filter(k => !(k in MAP));
    expect(missing).toEqual([]);
  });

  it('каждый ключ v2 из таблицы есть в обеих локалях', () => {
    const r = ru as Record<string, string>;
    const e = en as Record<string, string>;
    const bad = Object.entries(MAP)
      .filter(([, w]) => typeof w === 'string' && (!(w in r) || !(w in e)))
      .map(([k, w]) => `${k} → ${w as string}`);
    expect(bad).toEqual([]);
  });

  it('отпущенное — с причиной, а не пустой строкой', () => {
    for (const [k, w] of Object.entries(MAP)) {
      if (typeof w === 'object' && 'dropped' in w) expect(w.dropped.length, k).toBeGreaterThan(20);
    }
  });
});
