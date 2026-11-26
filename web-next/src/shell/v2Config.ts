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
import { appliedStatusConfirm } from '../settings/applied';
import { ICON_CANON, SECTION_ICONS } from '@seidr/kit';
import { listContractOf } from '../lists/listContract';
import { navFromModel, statusMeta, type KitConfig, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { ADMIN_MODULE, adminMenu } from '../admin/adminModule';
import { loreKinds } from './loreKinds';

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
  // SPRINT_LORE_MODEL_DOCS_TIDY/MD-04: ранбуки — раздел «Знания» с паспортом.
  'runbook',
  // MD-04, второй заход по QG: гейты качества — раздел «Работа» с паспортом (только чтение).
  'quality_gate',
  'component', 'tech', 'feature', 'project',
  // D-2026-MIG-REPOSITORY-ORGANIZATION: репозитории и организации — раздел «Система» с паспортом (только чтение).
  'repository', 'organization',
  // 1.18 (владелица 21.11.2026: «в меню под релизы вход в PR сделай»): раздел PR — список и паспорт (только чтение).
  'pr',
  // S9-05 A: люди и агенты — паспорта «шапка + таблица детей».
  'user', 'agent',
  // S4-PRODUCTS-NODE (владелица 11.11): нода «Продукт» — продукты и профиль клиента.
  'product', 'actor', 'pain', 'gain', 'job',
  'news', 'analytics', 'settings',
  // SUPERTAGS-SPIKE: «Теги» — сущности по тегу с полями; раздел «Знание» (экран тот же, что по адресу /tags).
  'tags',
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
  // WK-05 (PU-29 п.8): статусы ядра; без них запасной словарь не предлагал их в меню.
  ['waiting', 'active', ['in_progress', 'review', 'blocked', 'failed']],
  ['review', 'active', ['done', 'in_progress', 'failed']],
  ['failed', 'cancelled', ['todo', 'in_progress']],
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
/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-07 (D-2026-LORE-MODEL-AUDIENCE-VISIBILITY): общее меню — из модели, а
 * не из списка в коде. Видимость раздела (everywhere / detail / admin / hidden) решает сервер по
 * конфигу модели; сюда приходят только пункты уровня everywhere. Раздел, которого клиент не знает
 * (нет в V2_SECTIONS — нет экрана), отбрасывается, а не рисуется пустым пунктом.
 *
 * SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS: разбор документа — в kit (`navFromModel`); здесь только
 * то, что знает приложение: словарь подписей, подпись раздела по умолчанию и список своих экранов.
 * `model` — документ /lore/model как есть.
 */
export function menuFromModel(lang: KitLang, model: unknown): KitConfig['menu']['groups'] {
  return navGroups(lang, model);
}

function navGroups(lang: KitLang, model: unknown): KitConfig['menu']['groups'] {
  const known = new Set<string>(V2_SECTIONS);
  return navFromModel(model, {
    t: key => appT(lang, key as AppKey),
    sectionTitle: s => appT(lang, `shell.sec.${s}` as AppKey),
    // KREG-13: раздел типа модели со списком в контракте (surfaces.list) — тоже «знаком»: его рисует ModelListScreen.
    knows: s => known.has(s) || listContractOf(model, s) !== null,
  }).groups;
}

/**
 * Вход в админку — пункт левого меню (владелица 21.11.2026: «админку пересадить на иконку настройки и показывать
 * только логинам с admin, superadmin» · «не в шапке а в левом меню» · «у тебя есть шестерёнка в конце»): в группе
 * «Личное» сразу после «Настроек». Пункт не раздел — оболочка по нему переключает модуль (V2Shell).
 */
export const ADMIN_ENTRY = 'admin-entry';

/** Видеть ли вход в админку: admin/superadmin; копия без входа — да (ролей нет, решают 403 сервера); не прочитано — нет. */
export function canSeeAdmin(b: { auth_enabled?: boolean; seer_role?: string | null } | null | undefined): boolean {
  if (!b) return false;
  if (b.auth_enabled === false) return true;
  return b.seer_role === 'admin' || b.seer_role === 'superadmin';
}

export function v2Config(lang: KitLang, statusesFromModel?: KitConfig['statuses']['items'], module?: string, model?: unknown, canAdmin = false): KitConfig {
  const modelMenu = model === undefined ? [] : navGroups(lang, model);
  const t = (key: AppKey) => appT(lang, key);
  const item = (id: V2Section, icon: string, view?: string) =>
    ({ id, title: t(`shell.sec.${id}` as AppKey), icon, ...(view ? { view } : {}) });
  const cfg: KitConfig = {
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
    menu: module === ADMIN_MODULE ? adminMenu(lang) : modelMenu.length ? {
      myViews: true,
      recent: true,
      // MC-07: меню из модели (surfaces.nav, разбор — kit navFromModel); рукописное ниже — только когда модели нет.
      groups: modelMenu,
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
        { id: 'feed', title: t('shell.grp.feed'), tone: 'var(--inf)', pinTop: true, items: [item('news', ICON_CANON.sectionNews), item('analytics', 'lucide:chart-column')] },
        // «Работа» — что делаем и когда: спринты, задачи, вехи, релизы.
        {
          id: 'work', title: t('shell.grp.work'), tone: 'var(--acc)',
          items: [item('sprint', 'sprint'), item('task', ICON_CANON.sectionTask), item('milestone', 'crossed-axes'), item('release', 'open-book'), item('pr', 'branch-arrow'), item('quality_gate', 'checkered-flag')],
        },
        // «Знание» — почему так: ADR, решения, спеки, вопросы.
        {
          id: 'knowledge', title: t('shell.grp.knowledge'), tone: 'var(--suc)',
          // S5-DOC-PASSPORT (владелица 13.11: «подготовить для docs в LORE паспорт — их нет»): документы — рядом со спеками.
          items: [item('adr', 'scroll-quill'), item('decision', 'gavel'), item('spec', 'scroll-unfurled'), item('doc', 'bookshelf'), item('runbook', 'spell-book'), item('question', 'help'),
            // SUPERTAGS-SPIKE: срез знаний по тегу — рядом с ADR, решениями и спеками, которые теги и метят.
            item('tags', ICON_CANON.sectionTags)],
        },
        // «Организация» (владелица 21.11.2026: «Организация — организации, продукты, проекты, люди»): кто и что
        // делает. Продукт — логическая группа проектов (PS-PRODUCT-FILTER); люди — общий список без прав и ролей.
        {
          id: 'org', title: t('shell.grp.org'), tone: 'var(--inf)',
          items: [item('organization', 'castle'), item('product', SECTION_ICONS.value), item('project', 'open-folder'), item('user', 'person')],
        },
        // «Продукт» — зачем всё это (глава «Зачем» v1): продукты, фичи и сценарии,
        // роли, боли, выгоды, работы (S4-PRODUCTS-NODE). «Фичи» переехали сюда из
        // «Устройства» (S4-PRODUCT-HILITE) — перенос, раздел и его экран те же.
        // Иконки — канон: bullseye — SECTION_ICONS.value kit; остальные — слаги v1
        // (LorePage SECTIONS, product/icons.ts VP_ICON).
        {
          id: 'product', title: t('shell.grp.product'), tone: 'var(--wrn)',
          items: [
            item('feature', 'gift-of-knowledge'), item('actor', 'hooded-figure'),
            item('pain', 'thorn-helix'), item('gain', 'gift-of-knowledge'), item('job', 'archery-target'),
          ],
        },
        // «Устройство» — из чего система сделана: проекты, компоненты, технологии.
        {
          id: 'system', title: t('shell.grp.system'), tone: 'var(--inf)',
          // Владелица 21.11.2026: «в Устройстве оставила бы технологии, репозитории, компоненты».
          items: [item('tech', 'gears'), item('repository', 'chest'), item('component', 'cog')],
        },
        // S9-05 A: «Участники» — кто делает работу: люди и агенты, у каждого паспорт с его задачами.
        { id: 'personal', title: t('shell.grp.personal'), tone: 'var(--wrn)', items: [item('settings', ICON_CANON.sectionSettings, 'settings')] },
      ],
    },
    // K4-MENTION-LOOK: виды с подписью, значком и цветом — одним местом (loreKinds).
    kinds: loreKinds(lang),
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
      // S4-18: по умолчанию смена сразу и 8 с «Вернуть»; «подтверждать» — личная настройка.
      undo: true,
      confirmChange: appliedStatusConfirm(),
    },
  };
  if (module === ADMIN_MODULE) return cfg;
  if (canAdmin) {
    const entry = { id: ADMIN_ENTRY, title: t('shell.mod.admin'), icon: 'cog' };
    cfg.menu.groups = cfg.menu.groups.map(g => {
      if (g.id !== 'personal') return g;
      const at = g.items.findIndex(i => i.id === 'settings');
      const items = [...g.items];
      items.splice(at < 0 ? items.length : at + 1, 0, entry);
      return { ...g, items };
    });
  }
  // S9-05 × MC-07 (приёмка v1.17.20): разделы, которых нет в меню (люди и агенты — уровень
  // admin), открываются по ссылке ?sec=…&open=… своим паспортом; без этого оболочка
  // откатывалась к первому пункту меню, и вместо паспорта человека открывались «Новости».
  // Права решает сервер: нет доступа — экран раздела говорит об этом сам.
  const inMenu = new Set(cfg.menu.groups.flatMap(g => g.items.map(i => i.id)));
  const offMenu = V2_SECTIONS.filter(s => !inMenu.has(s));
  return offMenu.length ? { ...cfg, menu: { ...cfg.menu, offMenu } } : cfg;
}
