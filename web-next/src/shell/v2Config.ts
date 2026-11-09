// Конфиг оболочки LORE v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-01) — KitConfig ядра
// Seiðr-kit (kit/src/core/contract.ts). Оболочку рисует KitShell; здесь только
// данные: приложения, меню, виды записей, статусы.
//
//   • Приложения наверху: рабочее — только Forseti. BRAGI/MUNINN/TYR в v2 не
//     переносятся этим спринтом — видны как «скоро» (planned), а не спрятаны.
//   • Меню — группы по смыслу, а не по таблицам БД: «работа» (спринты, задачи),
//     «знание» (ADR), «лента» (новости), «личное» (настройки). Разделы MVP —
//     D-2026-UXR-MVP. Экраны разделов подключаются в V2Shell (SCREENS) своими
//     задачами S4; до тех пор раздел честно говорит «экран не собран».
//   • Статусы — коды LORE; иконка и цвет из общей таблицы kit (statusMeta), чтобы
//     v2 и kit не разошлись; подпись — из локалей web-next.
import { ICON_CANON } from '@seidr/kit';
import { statusMeta, type KitConfig, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';

/** Разделы меню v2 — они же id пунктов меню и ключи экранов. */
export const V2_SECTIONS = ['sprint', 'task', 'adr', 'news', 'settings'] as const;
export type V2Section = (typeof V2_SECTIONS)[number];

type Category = KitConfig['statuses']['items'][number]['category'];

/** Коды статусов LORE (задачи, спринты, ADR) и их категория на оси v2. */
const STATUSES: [code: string, category: Category, allow: string[]][] = [
  ['backlog', 'todo', ['todo', 'cancelled']],
  ['todo', 'todo', ['in_progress', 'blocked', 'cancelled']],
  ['planned', 'todo', ['active', 'cancelled']],
  ['proposed', 'todo', ['accepted', 'rejected']],
  ['in_progress', 'active', ['done', 'blocked', 'todo']],
  ['active', 'active', ['done', 'cancelled']],
  ['blocked', 'active', ['in_progress', 'cancelled']],
  // Эти четыре кода были ПОТЕРЯНЫ: подписи для них в локалях есть
  // («Частично», «К выкатке», «Проектирование», «Отложено»), а записи в
  // словаре не было — и kit было нечем рисовать чип.
  //
  // Так и появились «задачи без статусов» из аудита 09.11 (D-03): по замеру
  // серверной сессии в корпусе 55 задач «🟡 PARTIAL» и 34 «🚀 READY FOR
  // DEPLOY», и у всех чип выходил пустым. Сервер при этом статус отдавал
  // всегда (null у нуля задач из 4802), и оба словаря клиента строку узнавали
  // правильно — ломалось на последнем шаге, в словаре конфига.
  //
  // Сторож `tasks/twoVocabularies.probe.test.ts` держит правило: код, который
  // может получиться из данных, обязан быть здесь.
  ['partial', 'active', ['done', 'blocked', 'cancelled']],
  ['ready_for_deploy', 'active', ['done', 'blocked']],
  ['design', 'todo', ['todo', 'planned', 'cancelled']],
  ['deferred', 'todo', ['todo', 'cancelled']],
  ['done', 'done', ['in_progress']],
  ['accepted', 'done', ['superseded']],
  ['cancelled', 'cancelled', ['backlog']],
  ['superseded', 'cancelled', []],
  ['rejected', 'cancelled', ['proposed']],
];

/**
 * Статьи словаря статусов, пришедшие из модели (S4-STATUS-AXIS-CONFIG).
 *
 * Передали — словарь берётся оттуда, и рукописный `STATUSES` ниже не
 * используется вовсе. Не передали (модель недоступна, старый сервер, витрина
 * без сети) — остаётся рукописный, и это НЕ молчаливый откат: тот, кто грузит
 * модель, обязан показать причину (`statusesFromModel` отдаёт её словами).
 *
 * Зачем так: словарь статусов — дело приложения и его данных, а не кода
 * клиента. Рукописный список уже стоил находки аудита 09.11 — четыре кода в
 * него не попали, и у 89 задач корпуса чип выходил пустым.
 */
export function v2Config(lang: KitLang, statusesFromModel?: KitConfig['statuses']['items']): KitConfig {
  const t = (key: AppKey) => appT(lang, key);
  const item = (id: V2Section, icon: string, view?: string) =>
    ({ id, title: t(`shell.sec.${id}` as AppKey), icon, ...(view ? { view } : {}) });
  return {
    modules: [
      { id: 'forseti', title: 'Forseti', icon: 'compass', status: 'active' },
      // S4-23: порядок как в прототипе v4 и в v1 (shellNav): Forseti · BRAGI · MUNINN · TYR.
      { id: 'bragi', title: 'BRAGI', icon: 'harp', status: 'planned' },
      { id: 'muninn', title: 'MUNINN', icon: 'raven', status: 'planned' },
      { id: 'tyr', title: 'TYR', icon: 'scales', status: 'planned' },
    ],
    menu: {
      myViews: true,
      recent: true,
      groups: [
        // S4-23: «Новости» — первой группой: с них начинается день.
        { id: 'feed', title: t('shell.grp.feed'), tone: 'var(--inf)', items: [item('news', ICON_CANON.sectionNews)] },
        { id: 'work', title: t('shell.grp.work'), tone: 'var(--acc)', items: [item('sprint', 'sprint'), item('task', ICON_CANON.sectionTask)] },
        { id: 'knowledge', title: t('shell.grp.knowledge'), tone: 'var(--suc)', items: [item('adr', 'scroll-quill')] },
        { id: 'personal', title: t('shell.grp.personal'), tone: 'var(--wrn)', items: [item('settings', 'cog', 'settings')] },
      ],
    },
    kinds: {
      sprint: { title: t('shell.sec.sprint'), icon: 'sprint' },
      task: { title: t('shell.sec.task'), icon: ICON_CANON.sectionTask },
      adr: { title: t('shell.sec.adr'), icon: 'scroll-quill' },
      news: { title: t('shell.sec.news'), icon: ICON_CANON.sectionNews },
    },
    statuses: {
      // Словарь из модели главнее: он данные, а рукописный список — умолчание.
      items: statusesFromModel?.length
        ? statusesFromModel
        : STATUSES.map(([code, category, allow]) => {
          const meta = statusMeta(code);
          return { code, title: t(`status.${code}` as AppKey), category, icon: meta.icon, color: meta.color, allow };
        }),
      // →done в LORE идёт через reviewer-гейт: себе не одобряют.
      selfApprove: false,
      undo: true,
    },
  };
}
