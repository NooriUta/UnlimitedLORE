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
import { ICON_CANON, SECTION_ICONS } from '@seidr/kit';
import { statusMeta, type KitConfig, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { ADMIN_MODULE, adminMenu } from '../admin/adminModule';

/**
 * Разделы меню v2 — они же id пунктов меню и ключи экранов.
 *
 * S4-V2-SECTIONS: было пять, стало тринадцать. Одиннадцать разделов v1 плюс
 * «Новости» и «Настройки». Порядок внутри набора значения не имеет — он задан
 * группами меню ниже (группы по смыслу, а не по таблицам БД).
 */
export const V2_SECTIONS = [
  'sprint', 'task', 'milestone', 'release',
  'adr', 'decision', 'spec', 'doc', 'question',
  'component', 'tech', 'feature', 'project',
  // S4-PRODUCTS-NODE (владелица 11.11): нода «Продукт» — продукты и профиль клиента.
  'product', 'actor', 'pain', 'gain', 'job',
  'news', 'settings',
] as const;
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
  ['ready_for_deploy', 'active', ['uat', 'done', 'blocked']],
  // 13.11.2026: агент проверил на стенде → приёмка человеком; done ставит только человек.
  ['uat', 'active', ['done', 'in_progress', 'blocked']],
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
 * модель, обязан показать причину: генератор kit `configFromModel` отдаёт её
 * словами, и `useModelStatuses` берёт из его замечаний только те, что про
 * статусы.
 *
 * Зачем так: словарь статусов — дело приложения и его данных, а не кода
 * клиента. Рукописный список уже стоил находки аудита 09.11 — четыре кода в
 * него не попали, и у 89 задач корпуса чип выходил пустым.
 */
/** Группа общего меню из модели (`surfaces.nav` в /lore/model, MC-07). Разделы — только уровня everywhere. */
export interface ModelNavGroup {
  id: string;
  label_key: string;
  tone: string;
  pin_top?: boolean;
  items: { section: string; icon: string; view?: string }[];
}

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-07 (D-2026-LORE-MODEL-AUDIENCE-VISIBILITY): общее меню — из модели, а
 * не из списка в коде. Видимость раздела (everywhere / detail / admin / hidden) решает сервер по
 * конфигу модели; сюда приходят только пункты уровня everywhere. Раздел, которого клиент не знает
 * (нет в V2_SECTIONS — нет экрана), отбрасывается, а не рисуется пустым пунктом.
 */
export function menuFromModel(lang: KitLang, nav: readonly ModelNavGroup[]): KitConfig['menu']['groups'] {
  const t = (key: AppKey) => appT(lang, key);
  const known = new Set<string>(V2_SECTIONS);
  return nav
    .map(g => ({
      id: g.id,
      title: t(g.label_key as AppKey),
      tone: g.tone,
      ...(g.pin_top ? { pinTop: true } : {}),
      items: g.items.filter(i => known.has(i.section)).map(i => ({
        id: i.section, title: t(`shell.sec.${i.section}` as AppKey), icon: i.icon, ...(i.view ? { view: i.view } : {}),
      })),
    }))
    .filter(g => g.items.length > 0);
}

export function v2Config(lang: KitLang, statusesFromModel?: KitConfig['statuses']['items'], module?: string, navFromModel?: readonly ModelNavGroup[]): KitConfig {
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
      // S7B-01: админка — модулем оболочки (?mod=admin), но в шапке он есть,
      // только пока открыт: вход — из меню аватара (прототип v6), а среди
      // рабочих приложений админке не место.
      ...(module === ADMIN_MODULE ? [{ id: ADMIN_MODULE, title: t('shell.mod.admin'), icon: 'cog', status: 'active' as const }] : []),
    ],
    // S7B-01: у модуля admin своё меню — группы по смыслу и риску (adminMenu).
    menu: module === ADMIN_MODULE ? adminMenu(lang) : navFromModel && navFromModel.length ? {
      myViews: true,
      recent: true,
      // MC-07: меню из модели (surfaces.nav); рукописное ниже — только когда модели нет.
      groups: menuFromModel(lang, navFromModel),
    } : {
      myViews: true,
      recent: true,
      groups: [
        // S4-23: «Новости» — первой группой: с них начинается день.
        // S4-MENU-STATES, слова владелицы 09.11 с прода: «новости должны
        // стоять до моих видов и недавних и при сворачивании левого меню».
        // Группа первая в наборе, но личные блоки («Мои виды», «Недавние») в
        // kit рисуются выше групп, и до новостей приходилось проскроллить
        // личное. `pinTop` поднимает ИМЕННО эту группу — что важнее, решает
        // приложение, kit предметных имён не знает.
        { id: 'feed', title: t('shell.grp.feed'), tone: 'var(--inf)', pinTop: true, items: [item('news', ICON_CANON.sectionNews)] },
        // «Работа» — что делаем и когда: спринты, задачи, вехи, релизы.
        {
          id: 'work', title: t('shell.grp.work'), tone: 'var(--acc)',
          items: [item('sprint', 'sprint'), item('task', ICON_CANON.sectionTask), item('milestone', 'crossed-axes'), item('release', 'open-book')],
        },
        // «Знание» — почему так: ADR, решения, спеки, вопросы.
        {
          id: 'knowledge', title: t('shell.grp.knowledge'), tone: 'var(--suc)',
          // S5-DOC-PASSPORT (владелица 13.11: «подготовить для docs в LORE паспорт — их нет»): документы — рядом со спеками.
          items: [item('adr', 'scroll-quill'), item('decision', 'gavel'), item('spec', 'scroll-unfurled'), item('doc', 'bookshelf'), item('question', 'help')],
        },
        // «Продукт» — зачем всё это (глава «Зачем» v1): продукты, фичи и сценарии,
        // роли, боли, выгоды, работы (S4-PRODUCTS-NODE). «Фичи» переехали сюда из
        // «Устройства» (S4-PRODUCT-HILITE) — перенос, раздел и его экран те же.
        // Иконки — канон: bullseye — SECTION_ICONS.value kit; остальные — слаги v1
        // (LorePage SECTIONS, product/icons.ts VP_ICON).
        {
          id: 'product', title: t('shell.grp.product'), tone: 'var(--wrn)',
          items: [
            item('product', SECTION_ICONS.value), item('feature', 'gift-of-knowledge'), item('actor', 'hooded-figure'),
            item('pain', 'thorn-helix'), item('gain', 'gift-of-knowledge'), item('job', 'archery-target'),
          ],
        },
        // «Устройство» — из чего система сделана: проекты, компоненты, технологии.
        {
          id: 'system', title: t('shell.grp.system'), tone: 'var(--inf)',
          items: [item('project', 'open-folder'), item('component', 'cog'), item('tech', 'gears')],
        },
        { id: 'personal', title: t('shell.grp.personal'), tone: 'var(--wrn)', items: [item('settings', 'cog', 'settings')] },
      ],
    },
    kinds: {
      sprint: { title: t('shell.sec.sprint'), icon: 'sprint' },
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
      feature: { title: t('shell.sec.feature'), icon: 'gift-of-knowledge' },
      project: { title: t('shell.sec.project'), icon: 'open-folder' },
      product: { title: t('shell.sec.product'), icon: SECTION_ICONS.value },
      actor: { title: t('shell.sec.actor'), icon: 'hooded-figure' },
      pain: { title: t('shell.sec.pain'), icon: 'thorn-helix' },
      gain: { title: t('shell.sec.gain'), icon: 'gift-of-knowledge' },
      job: { title: t('shell.sec.job'), icon: 'archery-target' },
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
