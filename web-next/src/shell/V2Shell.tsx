// Оболочка LORE v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-01): KitShell из Seiðr-kit
// по конфигу v2Config — приложения наверху, меню по смыслу со сворачиванием
// групп, drawer на телефоне, модуль/раздел/вид в URL (mod/sec/view). Своей
// разметки меню и drawer здесь нет — только выбор экрана раздела.
//
// Экраны разделов подключаются в SCREENS своими задачами S4 (списки спринтов,
// ADR…). Раздел без экрана честно говорит «экран не собран» (NotBuilt kit), а
// не рисует «пусто»: данных он не запрашивал.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react';
import { KitShell, NotBuilt, Skeleton, createSafeStorage, useKitLang, useKitShell, type KitNav, type KitShellApi, type SafeStorage, type UrlWindow } from '@seidr/kit';
import { ADMIN_MODULE, adminSectionTitle, isAdminSection } from '../admin/adminModule';
import { appT, type AppKey } from '../i18n';
import { switchNavUrl } from '../nav/navVersion';
import { ListScreen } from '../pages/ListScreen';
import { newsSource } from '../news/source';
import { NewsFeed } from '../news/feed';
import { planStatusOf } from '../sprints/taskStatus';
import { newsHrefV2, newsRefHrefV2 } from '../news/newsLinks';
import { NavSwitch } from '../settings/NavSwitch';
import { V2_SECTIONS, v2Config, type V2Section } from './v2Config';
import { SHELL_STORAGE_KEY, openRecent } from './recentNav';
import { useModelStatuses } from './useModelStatuses';
import { VersionCorner } from './VersionCorner';
import { lazyChunk } from './staleChunk';
import { StatusBar } from './StatusBar';


// S7B-01: экраны модуля «Админка» — свой чанк, оболочка за них не платит.
const AdminSectionView = lazyChunk(() => import('../admin/AdminScreens'));

/** Модуль из адреса (?mod=): от него зависит меню оболочки. */
function moduleOf(w: UrlWindow | undefined): string | null {
  return w ? new URLSearchParams(w.location.search).get('mod') : null;
}

/** Глобальные параметры URL v2 — не снимаются при смене раздела. */
export const V2_KEEP_PARAMS = ['proj'] as const;

/** id заголовка раздела: им подписан раздел, кто бы ни рисовал h1 — оболочка или шапка экрана. */
const SECTION_TITLE_ID = 'v2-screen-title';

/** Разделы, где h1 рисует сам экран (шапка экрана kit, S4-23), а не оболочка. */
const OWN_HEAD: ReadonlySet<V2Section> = new Set<V2Section>([
  'sprint', 'adr', 'task',
  // S4-V2-SECTIONS: у всех разделов-списков заголовок рисует шапка экрана kit.
  'milestone', 'release', 'decision', 'spec', 'question', 'component', 'tech', 'feature', 'project',
  // S4-PRODUCTS-NODE: нода «Продукт».
  'product', 'actor', 'pain', 'gain', 'job',
]);

/** Экраны разделов: ключ — id пункта меню. Нет ключа — «экран не собран». */
const SCREENS: Partial<Record<V2Section, ComponentType>> = {
  // Списки — один путь сборки (S4-22): общий ListScreen + описание экрана,
  // заголовок — шапка экрана kit (S4-23). Спринты раньше были своей страницей.
  // «Задачи x/y» и раскрытие с задачами — описанием экрана (lists/screens.ts, nested).
  sprint: () => <ListScreen screen="sprints" titleId={SECTION_TITLE_ID} />,
  // S4-23: заголовок ADR — шапка экрана kit (ScreenHead): виды в строке заголовка.
  adr: () => <ListScreen screen="adrs" titleId={SECTION_TITLE_ID} />,
  // S4-V2-SECTIONS: пункт «Задачи» был в меню с самого начала, а экрана под ним
  // не было — раздел отвечал «экран не собран». Источник — open_tasks (all_tasks
  // несёт note_md и даёт миллионы символов), и это сказано на экране словами.
  task: () => <ListScreen screen="tasks" titleId={SECTION_TITLE_ID} />,
  // S4-V2-SECTIONS, восемь оставшихся разделов v1. Все — тем же путём: общий
  // ListScreen + описание экрана в lists/screens.ts, своей страницы ни у кого.
  // У семи из восьми паспорта нет (фасад отдаёт sprint, task, adr, spec), и
  // щелчок по строке говорит это словами, а не открывает пустой паспорт.
  milestone: () => <ListScreen screen="milestones" titleId={SECTION_TITLE_ID} />,
  release: () => <ListScreen screen="releases" titleId={SECTION_TITLE_ID} />,
  decision: () => <ListScreen screen="decisions" titleId={SECTION_TITLE_ID} />,
  spec: () => <ListScreen screen="specs" titleId={SECTION_TITLE_ID} />,
  question: () => <ListScreen screen="questions" titleId={SECTION_TITLE_ID} />,
  component: () => <ListScreen screen="components" titleId={SECTION_TITLE_ID} />,
  tech: () => <ListScreen screen="tech" titleId={SECTION_TITLE_ID} />,
  feature: () => <ListScreen screen="features" titleId={SECTION_TITLE_ID} />,
  // S4-29 (53а): раздел «Проекты» — тем же путём; щелчок открывает паспорт проекта.
  project: () => <ListScreen screen="projects" titleId={SECTION_TITLE_ID} />,
  // S4-PRODUCTS-NODE: нода «Продукт» — тем же путём (общий ListScreen + описание экрана).
  // Паспорт — только у продукта; боли, выгоды, работы, роли отвечают «паспорта нет».
  product: () => <ListScreen screen="products" titleId={SECTION_TITLE_ID} />,
  actor: () => <ListScreen screen="actors" titleId={SECTION_TITLE_ID} />,
  pain: () => <ListScreen screen="pains" titleId={SECTION_TITLE_ID} />,
  gain: () => <ListScreen screen="gains" titleId={SECTION_TITLE_ID} />,
  job: () => <ListScreen screen="jobs" titleId={SECTION_TITLE_ID} />,
  // Лента новостей kit (SPRINT_UXR_S7A_NEWS/S7A-02); свой заголовок — у раздела.
  // Статусы в ленте читаются тем же planStatusOf, что у задач и спринтов (иконки совпадают).
  news: () => <NewsFeed source={newsSource} urlPrefix="n" title={null} statusOf={planStatusOf} hrefOf={newsHrefV2} refHrefOf={newsRefHrefV2} />,
  // Ссылка на витрину kit (S4-00d) и переключатель «новая навигация» (S3-07) —
  // раздел «Настройки» (S4-01). Сами личные настройки — под аватаром в шапке
  // (S4-02, AccountMenu в слоте account): здесь на них только указатель.
  settings: function SettingsScreen() {
    const lang = useKitLang();
    const targetUrl = typeof location === 'undefined' ? null : switchNavUrl(location, 'v1');
    return (
      <>
        <p className="setting-hint">{appT(lang, 'shell.settings.hint')}</p>
        <NavSwitch lang={lang} targetUrl={targetUrl} />
        <a className="shell-link" href="/kit">Seiðr-kit</a>
      </>
    );
  },
};

export interface V2ShellProps {
  storage?: SafeStorage;
  win?: UrlWindow;
  narrow?: boolean;
  /** Метка после имени в шапке (версия v2). */
  brandTag?: ReactNode;
  /** Сразу за приложениями — охват проектов (S4-23). */
  topStart?: ReactNode;
  /** Правый край шапки — поиск и команды. */
  topEnd?: ReactNode;
  /** Слот аккаунта справа в шапке (меню аватара, S4-02). */
  account?: ReactNode;
}

export function V2Shell({ storage: storageProp, win, narrow, brandTag, topStart, topEnd, account }: V2ShellProps) {
  const lang = useKitLang();
  // Хранилище одно на оболочку и на навигацию из «Недавнего»: у createSafeStorage
  // память своя у КАЖДОГО вызова (отказ localStorage), и второй экземпляр
  // прочитал бы мету недавних пусто.
  const storage = useMemo(() => storageProp ?? createSafeStorage(), [storageProp]);
  // Словарь статусов — из модели (S4-STATUS-AXIS-CONFIG): он данные приложения,
  // а не код клиента. Модель недоступна — остаётся рукописное умолчание, и
  // причина названа словами в `notes`, а не замолчана.
  const statuses = useModelStatuses();
  // S7B-01: модуль решает, какое меню у оболочки (у админки своё). KitShell
  // читает адрес по конфигу при монтировании, поэтому смена модуля
  // пересобирает оболочку (key ниже) — и раздел выбирается уже по новому меню.
  const urlWin = win ?? (typeof window === 'undefined' ? undefined : window);
  const [mod, setMod] = useState<string | null>(() => moduleOf(urlWin));
  const isAdmin = mod === ADMIN_MODULE;
  const config = useMemo(() => v2Config(lang, statuses.items, mod ?? undefined), [lang, statuses.items, mod]);
  useEffect(() => {
    if (!urlWin || typeof window === 'undefined' || urlWin !== window) return;
    const sync = () => setMod(moduleOf(window));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [urlWin]);
  const onNavigate = useCallback((next: KitNav) => {
    if ((next.module === ADMIN_MODULE) === isAdmin) return;
    // Другой модуль — другое меню: раздел прежнего в нём ничего не значит.
    if (urlWin) {
      const params = new URLSearchParams(urlWin.location.search);
      params.delete('sec');
      params.delete('view');
      urlWin.history.replaceState(null, '', `?${params.toString()}${urlWin.location.hash}`);
    }
    setMod(next.module);
  }, [isAdmin, urlWin]);
  // api оболочки ловим изнутри (мост ниже): onOpenRecord — проп KitShell, а
  // navigate живёт в api внутри оболочки. Клик по «Недавнему» KitShell
  // обрабатывает сам и зовёт onOpenRecord — без него клик лишь перестраивал
  // порядок пунктов (жалоба с прода v1.17.9), поэтому здесь он всегда есть.
  const apiRef = useRef<KitShellApi | null>(null);
  // Счётчик открытий из «Недавнего»: клик в ТОТ ЖЕ раздел не пересобирает
  // ListScreen (открытую запись он читает из URL только на монтировании),
  // поэтому после навигации экран поднимаем заново — он прочитает ?open=.
  const [openSeq, setOpenSeq] = useState(0);
  const onOpenRecord = useCallback((id: string) => {
    const api = apiRef.current;
    if (api && openRecent(api, storage, id)) setOpenSeq(n => n + 1);
  }, [storage]);
  return (
    <KitShell
      key={isAdmin ? 'admin' : 'main'}
      config={config}
      onNavigate={onNavigate}
      brand={appT(lang, 'shell.brand')}
      brandIcon="compass"
      brandTag={brandTag}
      topStart={topStart}
      topEnd={topEnd}
      onOpenRecord={onOpenRecord}
      // Выбор проектов (S4-03, ?proj=) — глобальный: переживает смену раздела (S4-13, B-07).
      keepParams={V2_KEEP_PARAMS}
      account={account}
      // S4-21 (ответ владелицы 7а): строка состояния внизу — сеть, проекты, свежесть, версия.
      statusBar={<StatusBar end={<VersionCorner />} />}
      storage={storage}
      storageKey={SHELL_STORAGE_KEY}
      win={win}
      narrow={narrow}
    >
      <ShellApiBridge sink={apiRef} />
      <SectionScreen key={openSeq} />
      {/* Версия сборки в правом нижнем углу (S4-30, просьба владелицы 09.11):
          одна метка, если сервер и фронт собраны из одного коммита, иначе
          обе — подписанными. Внутри оболочки, а не в App: метка про установку
          целиком, и она нужна на любом разделе. */}
      <VersionCorner />
    </KitShell>
  );
}

/**
 * Мост к api оболочки: onOpenRecord объявлен пропом KitShell, но navigate ему
 * нужен из api, который оболочка создаёт внутри себя. Ловим api из контекста
 * и отдаём наружу через ref — клик случится после монтирования, к тому
 * моменту ref уже заполнен.
 */
function ShellApiBridge({ sink }: { sink: RefObject<KitShellApi | null> }) {
  const api = useKitShell();
  useEffect(() => { sink.current = api; }, [api, sink]);
  return null;
}

function isSection(id: string | null): id is V2Section {
  return id !== null && (V2_SECTIONS as readonly string[]).includes(id);
}

function SectionScreen() {
  const lang = useKitLang();
  const { nav } = useKitShell();
  if (isAdminSection(nav.item)) {
    // S7B-01: заголовок рисует сам экран админки (h2) — здесь только подпись области.
    return (
      <section className="v2-screen" data-section={nav.item} aria-label={adminSectionTitle(lang, nav.item)}>
        <Suspense fallback={<Skeleton lines={6} />}><AdminSectionView id={nav.item} /></Suspense>
      </section>
    );
  }
  if (!isSection(nav.item)) return null;
  const section = nav.item;
  const title = appT(lang, `shell.sec.${section}` as AppKey);
  const Screen = SCREENS[section];
  return (
    <section className="v2-screen" data-section={section} aria-labelledby={SECTION_TITLE_ID}>
      {!(Screen && OWN_HEAD.has(section)) && <h1 id={SECTION_TITLE_ID} className="v2-screen__title">{title}</h1>}
      {Screen ? <Screen /> : <NotBuilt hint={appT(lang, 'shell.unbuilt.hint', { section: title })} />}
    </section>
  );
}
