// SPRINT_QG_REBUILD/QG-09: решение владельца — список проектов для гейтов задаётся
// в админке. Первый реальный ключ реестра KNOWN_SETTINGS (AL-38): строка в реестре
// + чтение в коде (LoreQgActionsPoller) одним PR. Известный ключ обязан быть
// редактируемым — иначе реестр показывает значение, которое нельзя поменять.
import { describe, it, expect } from 'vitest';
import ru from '../../../i18n/locales/ru/common.json';
import en from '../../../i18n/locales/en/common.json';

const SRC = import.meta.glob('./SettingsTab.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = SRC['./SettingsTab.tsx'];
const admin = (l: unknown) => (l as { lore: { admin: Record<string, string> } }).lore.admin;

describe('Настройки: известные ключи app_setting', () => {
  it('реестр содержит qg.actions_projects', () => {
    const reg = src.slice(src.indexOf('const KNOWN_SETTINGS'), src.indexOf('export function SettingsTab'));
    expect(reg).toContain("key: 'qg.actions_projects'");
  });

  it('известный ключ редактируем: сохранение через /dict/entry с label_ru и is_active', () => {
    const save = src.slice(src.indexOf('async function saveKnown'));
    expect(src).toContain('async function saveKnown');
    expect(save).toMatch(/loreMutate\('\/dict\/entry',\s*\{[^}]*dict_type: 'app_setting'[^}]*label_ru:[^}]*is_active: true/);
    // ошибка сохранения не глотается
    expect(save.slice(0, save.indexOf('\n  }\n'))).toContain('onError(e)');
  });

  it('незаданный известный ключ показывается строкой «не задано»', () => {
    expect(src).toContain("t('lore.admin.settingNotSet'");
  });

  it('строки редактирования есть в обеих локалях', () => {
    for (const k of ['settingEdit', 'settingSave', 'settingNotSet', 'settingQgProjectsDescr', 'settingQgProjectsDef', 'settingQgProjectsHint', 'settingTypeProjects']) {
      expect(admin(ru)[k], `ru ${k}`).toBeTruthy();
      expect(admin(en)[k], `en ${k}`).toBeTruthy();
    }
  });
});
