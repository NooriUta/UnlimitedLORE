// Виды записей LORE для kit: подпись, значок и ЦВЕТ вида — одним местом
// (SPRINT_UXR_S13_KIT4/K4-MENTION-LOOK).
//
// Повод — владелица 11.11.2026: «все упоминания в объектах чужих объектов имели
// иконки и расцветку соответствующего канонического объекта и ссылку на него».
// Цвет вида — канон v1 (`--section-*`), его же называет модель сервера
// (`/lore/model` → types.<тип>.color, shared/model/lore-model.json `type_color`).
// В теме kit канон живёт токенами `--type-*`: `section-adrs` модели ↔ `--type-adrs`
// kit. Совпадение держит сторож `loreKinds.test.ts`. У вида без канона в модели
// (`no_type_color`) цвета нет — упоминание нейтральное, цвет не выдумываем.
import { ICON_CANON, SECTION_ICONS, type KitConfig, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';

/** Вид → токен цвета kit (канон v1). Только виды с каноном в модели. */
export const LORE_KIND_COLOR: Readonly<Record<string, string>> = {
  sprint: 'var(--type-sprints)',
  adr: 'var(--type-adrs)',
  decision: 'var(--type-decisions)',
  milestone: 'var(--type-milestones)',
  release: 'var(--type-releases)',
  component: 'var(--type-components)',
  tech: 'var(--type-tech)',
  feature: 'var(--type-features)',
};

export function loreKinds(lang: KitLang): KitConfig['kinds'] {
  const t = (key: AppKey) => appT(lang, key);
  const kinds: KitConfig['kinds'] = {
    // inherited — подпись значения, унаследованного от записи вида (K-14: слово LORE, не kit).
    sprint: { title: t('shell.sec.sprint'), icon: 'sprint', inherited: t('shell.inherited.sprint') },
    task: { title: t('shell.sec.task'), icon: ICON_CANON.sectionTask },
    adr: { title: t('shell.sec.adr'), icon: 'scroll-quill' },
    news: { title: t('shell.sec.news'), icon: ICON_CANON.sectionNews },
    // S4-V2-SECTIONS: виды записей новых разделов. Нужны палитре и
    // «Недавнему» — без вида запись в них рисуется безымянной.
    milestone: { title: t('shell.sec.milestone'), icon: 'crossed-axes' },
    release: { title: t('shell.sec.release'), icon: 'open-book' },
    decision: { title: t('shell.sec.decision'), icon: 'gavel' },
    spec: { title: t('shell.sec.spec'), icon: 'scroll-unfurled' },
    doc: { title: t('shell.sec.doc'), icon: 'bookshelf' },
    question: { title: t('shell.sec.question'), icon: 'help' },
    component: { title: t('shell.sec.component'), icon: 'cog' },
    tech: { title: t('shell.sec.tech'), icon: 'gears' },
    feature: { title: t('shell.sec.feature'), icon: 'gift-of-knowledge', inherited: t('shell.inherited.feature') },
    project: { title: t('shell.sec.project'), icon: 'open-folder' },
    user: { title: t('shell.sec.user'), icon: 'person' },
    agent: { title: t('shell.sec.agent'), icon: 'robot-golem' },
    product: { title: t('shell.sec.product'), icon: SECTION_ICONS.value },
    actor: { title: t('shell.sec.actor'), icon: 'hooded-figure' },
    pain: { title: t('shell.sec.pain'), icon: 'thorn-helix' },
    gain: { title: t('shell.sec.gain'), icon: 'gift-of-knowledge' },
    job: { title: t('shell.sec.job'), icon: 'archery-target' },
  };
  for (const [k, color] of Object.entries(LORE_KIND_COLOR)) if (kinds[k]) kinds[k] = { ...kinds[k], color };
  return kinds;
}

/**
 * Дополнить виды экрана обликом видов LORE: у паспорта в конфиге только свой вид
 * и виды детей, а упоминания ведут к записям ЛЮБОГО вида. Своё описание вида
 * главнее — облик (значок, цвет) добирается, где его нет.
 */
export function withLoreKindLook(lang: KitLang, kinds: KitConfig['kinds']): KitConfig['kinds'] {
  const look = loreKinds(lang);
  const out: KitConfig['kinds'] = { ...look };
  for (const [k, v] of Object.entries(kinds)) {
    const l = look[k];
    out[k] = l ? { ...v, ...(v.color ? {} : l.color ? { color: l.color } : {}), icon: v.icon || l.icon } : v;
  }
  return out;
}

/** Облик ссылки [[…]] в MD по типу ссылки (или форме кода — даёт вызывающий). */
export function loreKindLook(lang: KitLang, type: string | null | undefined): { icon?: string; color?: string; title?: string } | null {
  if (!type) return null;
  const k = loreKinds(lang)[type.toLowerCase()];
  return k ? { icon: k.icon, color: k.color, title: k.title } : null;
}
