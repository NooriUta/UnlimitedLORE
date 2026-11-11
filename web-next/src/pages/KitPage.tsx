// /kit — витрина Seiðr-kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00d).
// Страница web-next, собранная ТОЛЬКО из компонентов kit (D-2026-UXR-KIT-REACT):
// своих элементов здесь нет — витрина показывает ровно то, что получит любой
// экран v2. Её axe-прогон (KitPage.test.tsx) — гейт a11y фронтового CI.
// Эталон вида — docs/prototypes/ux-redesign-shell-v4.tpl.html (как картинка).
import { ICON_CANON } from '@seidr/kit';
import { useMemo, useState } from 'react';
import {
  CommandPalette, EmptyState, Ear, Forbidden, GameIcon, IconButton, Kbd, LoadError, Pill, SECTION_ICONS, Sheet,
  BatchUndo, CalendarMonth, FreshCell, LibraryView, ChainExplain, ContentRelease, DiffPreview, Matrix, SecretOnce, Skeleton, StatusStar, Steps, Tabs, Toolbar, Tooltip, Truncated, createRecentList, createSafeStorage, useKitPalette,
  DENSITIES, FieldEditor, type Density, type FieldEditorDef, type KitCtx, type Mode,
} from '@seidr/kit';
import { PALETTE_DEMO_DATA, PALETTE_DEMO_KINDS } from './kitPaletteDemo';
import { MartProse, SandboxedHtmlFrame, TipTapField } from '@seidr/kit/content';
import { ValueChips } from '@seidr/kit/record';
import { useAppT, type AppKey } from '../i18n';
import './KitPage.css';

const SECTIONS = ['tokens', 'elements', 'states', 'shell', 'flow', 'fields', 'palette', 'content'] as const;
type SectionId = (typeof SECTIONS)[number];
const SECTION_KEY: Record<SectionId, AppKey> = {
  tokens: 'kitPage.sec.tokens',
  elements: 'kitPage.sec.elements',
  states: 'kitPage.sec.states',
  shell: 'kitPage.sec.shell',
  flow: 'kitPage.sec.flow',
  fields: 'kitPage.sec.fields',
  palette: 'kitPage.sec.palette',
  content: 'kitPage.sec.content',
};

const COLOR_TOKENS = ['--bg0', '--bg1', '--bg2', '--bg3', '--bd', '--t1', '--t2', '--t3', '--acc', '--suc', '--wrn', '--dng', '--inf'] as const;
const FS_TOKENS = ['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl'] as const;
const SHOWN_STATUSES = ['done', 'active', 'partial', 'planned', 'backlog', 'blocked', 'cancelled'] as const;
/** Пороги свежести на витрине (K4-FRESHNESS): с 10 мин — предупреждение, с 60 — устарело. */
const FRESH_DEMO = { warnAfter: 10, staleAfter: 60 };
const TAB_IDS = ['list', 'board', 'plan'] as const;
type TabId = (typeof TAB_IDS)[number];
const TAB_KEY: Record<TabId, AppKey> = { list: 'kitPage.sh.tab.list', board: 'kitPage.sh.tab.board', plan: 'kitPage.sh.tab.plan' };

/** Вкладка витрины — в URL (?tab=), как любое состояние выбора в v2. */
function readTab(): TabId {
  if (typeof window === 'undefined') return 'list';
  const v = new URLSearchParams(window.location.search).get('tab');
  return (TAB_IDS as readonly string[]).includes(v ?? '') ? (v as TabId) : 'list';
}
function writeTab(tab: TabId): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  window.history.replaceState(window.history.state, '', url);
}

export default function KitPage() {
  const t = useAppT();
  const [mode, setMode] = useState<Mode>('dark');
  const [density, setDensity] = useState<Density>('roomy');
  const [filterOn, setFilterOn] = useState(true);
  const [filterShown, setFilterShown] = useState(true);
  const [fav, setFav] = useState(false);
  const [tab, setTab] = useState<TabId>(readTab);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flowPick, setFlowPick] = useState<'a' | 'b' | null>(null);
  const [flowDone, setFlowDone] = useState(false);
  const [diffApplied, setDiffApplied] = useState<number | null>(null);
  // Пачка показывается ровно так, как её отдаст сервер: окно отмены считается
  // от срока, а не от таймера на клиенте (K2-BATCH-UNDO).
  const [batch, setBatch] = useState<{ id: string; applied: number; total: number; undoUntil: number } | null>(null);
  const [batchUndone, setBatchUndone] = useState(false);
  const [proposed, setProposed] = useState<number | null>(null);
  const [activated, setActivated] = useState<string | null>(null);
  const [earOpen, setEarOpen] = useState(false);
  const [freshNow] = useState(() => Date.now());
  const [md, setMd] = useState(() => t('kitPage.md.sample'));
  // Палитра Ctrl+K / поиск «/» (K-07): недавние — в хранилище с откатом в память.
  const palette = useKitPalette();
  const recent = useMemo(() => createRecentList(createSafeStorage(), { key: 'seidr.kit.vitrine.recent' }), []);
  const [openedRecord, setOpenedRecord] = useState<string | null>(null);
  const paletteCtx = useMemo<KitCtx>(() => ({
    data: PALETTE_DEMO_DATA,
    config: {
      modules: [],
      menu: { groups: [] },
      kinds: PALETTE_DEMO_KINDS,
      statuses: { items: [] },
      palette: {
        commands: [
          { id: 'toggle-mode', title: t('kitPage.pal.cmdMode'), run: () => setMode(m => (m === 'dark' ? 'light' : 'dark')) },
          { id: 'toggle-density', title: t('kitPage.pal.cmdDensity'), run: () => setDensity(d => DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]) },
          { id: 'open-sheet', title: t('kitPage.pal.cmdSheet'), run: () => setSheetOpen(true) },
        ],
      },
    },
    href: id => `#rec=${encodeURIComponent(id)}`,
    esc: s => s,
    md: s => s,
  }), [t]);

  return (
    // Тема и плотность витрины — атрибутами на её корне: селекторы seidr.css
    // ([data-mode], [data-density]) переопределяют токены во всём поддереве.
    <div className="kitp" data-lore-page="kit" data-mode={mode === 'light' ? 'light' : undefined} data-density={density === 'roomy' ? undefined : density}>
      <header className="kitp__head">
        <h1 className="kitp__title">{t('kitPage.title')}</h1>
        <p className="kitp__lead">{t('kitPage.lead')}</p>
        <Toolbar label={t('kitPage.theme')}>
          <Pill variant="filter" pressed={mode === 'dark'} onToggle={() => setMode('dark')}>{t('kitPage.mode.dark')}</Pill>
          <Pill variant="filter" pressed={mode === 'light'} onToggle={() => setMode('light')}>{t('kitPage.mode.light')}</Pill>
          <Pill variant="filter" pressed={density === 'roomy'} onToggle={() => setDensity('roomy')}>{t('kitPage.density.roomy')}</Pill>
          <Pill variant="filter" pressed={density === 'compact'} onToggle={() => setDensity('compact')}>{t('kitPage.density.compact')}</Pill>
          <Pill variant="filter" pressed={density === 'comfortable'} onToggle={() => setDensity('comfortable')}>{t('kitPage.density.comfortable')}</Pill>
        </Toolbar>
        <nav className="kitp__nav" aria-label={t('kitPage.nav')}>
          {SECTIONS.map(id => <a key={id} href={`#kit-${id}`} className="kitp__navlink">{t(SECTION_KEY[id])}</a>)}
        </nav>
      </header>

      <main className="kitp__main">
        <section id="kit-tokens" className="kitp__sec" aria-labelledby="kit-tokens-h">
          <h2 id="kit-tokens-h" className="kitp__h2">{t('kitPage.sec.tokens')}</h2>
          <h3 className="kitp__h3">{t('kitPage.tokens.colors')}</h3>
          <ul className="kitp__swatches">
            {COLOR_TOKENS.map(tok => (
              <li key={tok} className="kitp__swatch">
                <span className="kitp__chip" style={{ background: `var(${tok})` }} aria-hidden />
                <code>{tok}</code>
              </li>
            ))}
          </ul>
          <h3 className="kitp__h3">{t('kitPage.tokens.scale')}</h3>
          <ul className="kitp__scale">
            {FS_TOKENS.map(tok => (
              <li key={tok} style={{ fontSize: `var(${tok})` }}><code className="kitp__tok">{tok}</code> Seiðr LORE</li>
            ))}
          </ul>
          <h3 className="kitp__h3">{t('kitPage.tokens.type')}</h3>
          <p className="kitp__display">{t('kitPage.tokens.display')}</p>
          <p>{t('kitPage.tokens.text')}</p>
          <p className="kitp__mono">{t('kitPage.tokens.mono')}</p>
        </section>

        <section id="kit-elements" className="kitp__sec" aria-labelledby="kit-elements-h">
          <h2 id="kit-elements-h" className="kitp__h2">{t('kitPage.sec.elements')}</h2>
          <h3 className="kitp__h3">{t('kitPage.el.pills')}</h3>
          <div className="kitp__row">
            <Pill>value</Pill>
            <Pill variant="id">SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00d</Pill>
            <Pill tone="suc">done</Pill>
            <Pill tone="wrn">wrn</Pill>
            <Pill tone="dng">dng</Pill>
            {filterShown && (
              <Pill
                variant="filter"
                pressed={filterOn}
                onToggle={setFilterOn}
                onRemove={() => setFilterShown(false)}
                removeLabel={t('kitPage.el.removeFilter')}
              >{t('kitPage.el.filter')}</Pill>
            )}
          </div>
          <h3 className="kitp__h3">{t('kitPage.el.buttons')}</h3>
          <div className="kitp__row">
            <IconButton icon={SECTION_ICONS.search} label={t('kitPage.el.search')} shortcut="Control+K" />
            <IconButton icon={ICON_CANON.myViews} label={t('kitPage.el.favorite')} pressed={fav} onClick={() => setFav(f => !f)} />
            {Object.entries(SECTION_ICONS).slice(0, 8).map(([name, slug]) => <GameIcon key={name} slug={slug} size={18} label={name} />)}
          </div>
          <h3 className="kitp__h3">{t('kitPage.el.statuses')}</h3>
          <div className="kitp__row">
            {SHOWN_STATUSES.map(s => <StatusStar key={s} status={s} label={t('kitPage.el.status', { status: s })} showLabel />)}
          </div>
          <h3 className="kitp__h3">{t('kitPage.el.keys')}</h3>
          <div className="kitp__row">
            <Kbd keys={['Ctrl', 'K']} />
            <Tooltip text={t('kitPage.el.tooltip')}>
              <button type="button" className="sk-btn">{t('kitPage.el.tooltip')}</button>
            </Tooltip>
          </div>
          {/* K4-FRESHNESS: три тона по порогам приложения и «времени нет» — не «давно». */}
          <h3 className="kitp__h3">{t('kitPage.el.fresh')}</h3>
          <div className="kitp__row">
            {[3, 30, 125].map(m => (
              <FreshCell key={m} value={new Date(freshNow - m * 60_000).toISOString()} now={freshNow} thresholds={FRESH_DEMO} />
            ))}
            <FreshCell value={null} now={freshNow} thresholds={FRESH_DEMO} />
          </div>
          <Toolbar label={t('kitPage.el.toolbar')}>
            <IconButton icon={SECTION_ICONS.filter} label={t('kitPage.el.filter')} />
            <IconButton icon={SECTION_ICONS.views} label={t('kitPage.sh.tabs')} />
            <IconButton icon={SECTION_ICONS.commands} label={t('kitPage.el.toolbar')} />
          </Toolbar>
        </section>

        <section id="kit-states" className="kitp__sec" aria-labelledby="kit-states-h">
          <h2 id="kit-states-h" className="kitp__h2">{t('kitPage.sec.states')}</h2>
          <div className="kitp__grid">
            <Skeleton lines={3} />
            <EmptyState compact />
            <LoadError compact error={{ status: 502, message: 'Bad Gateway' }} onRetry={() => {}} />
            <Forbidden compact reason={t('kitPage.st.reason')} />
            <Truncated meta={{ truncated: true, limit: 1000 }} shown={1000} />
          </div>
        </section>

        <section id="kit-shell" className="kitp__sec" aria-labelledby="kit-shell-h">
          <h2 id="kit-shell-h" className="kitp__h2">{t('kitPage.sec.shell')}</h2>
          <Tabs
            label={t('kitPage.sh.tabs')}
            value={tab}
            onChange={id => { const next = id as TabId; setTab(next); writeTab(next); }}
            items={TAB_IDS.map((id, i) => ({ id, label: t(TAB_KEY[id]), count: [42, 7, 3][i] }))}
          >
            <p className="kitp__panel">{t('kitPage.sh.panel', { tab: t(TAB_KEY[tab]) })}</p>
          </Tabs>
          <div className="kitp__row">
            <button type="button" className="sk-btn" onClick={() => setSheetOpen(true)}>{t('kitPage.sh.openSheet')}</button>
            <Ear label={t('kitPage.sh.ear')} expanded={earOpen} controls="kit-ear-col" onToggle={() => setEarOpen(o => !o)} />
          </div>
          {earOpen && <div id="kit-ear-col" className="kitp__earcol"><MartProse text={'**' + t('kitPage.sh.ear') + '**'} /></div>}
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('kitPage.sh.sheetTitle')}>
            <p>{t('kitPage.sh.sheetBody')}</p>
          </Sheet>
        </section>

        <section id="kit-flow" className="kitp__sec" aria-labelledby="kit-flow-h">
          <h2 id="kit-flow-h" className="kitp__h2">{t('kitPage.sec.flow')}</h2>
          <p>{t('kitPage.flow.lead')}</p>
          <Steps
            flow="kit-demo"
            urlKey="demoStep"
            onDone={() => setFlowDone(true)}
            manual={{
              title: t('kitPage.flow.manualTitle'),
              items: [
                { text: t('kitPage.flow.manual1'), hint: t('kitPage.flow.manualHint') },
                { text: t('kitPage.flow.manual2'), href: 'https://git.seidrstudio.pro' },
              ],
            }}
            steps={[
              {
                key: 'pick',
                title: t('kitPage.flow.s1'),
                // Причина отказа — словами, а не серой кнопкой молча.
                blocked: flowPick ? null : t('kitPage.flow.blocked'),
                render: () => (
                  <div className="kitp__row" role="radiogroup" aria-label={t('kitPage.flow.pick')}>
                    {(['a', 'b'] as const).map(id => (
                      <button
                        key={id}
                        type="button"
                        className="sk-btn"
                        role="radio"
                        aria-checked={flowPick === id}
                        onClick={() => setFlowPick(id)}
                      >
                        {t(id === 'a' ? 'kitPage.flow.optA' : 'kitPage.flow.optB')}
                      </button>
                    ))}
                  </div>
                ),
              },
              {
                key: 'fill',
                title: t('kitPage.flow.s2'),
                render: () => (
                  <label className="kitp__panel">
                    {t('kitPage.flow.note')}
                    {/* Без класса kit: общего правила для полей ввода в
                        seidr.css нет, и выдумывать имя класса здесь нельзя —
                        вид разошёлся бы с голым HTML молча (S4-00e). */}
                    <input defaultValue="" />
                  </label>
                ),
              },
              { key: 'check', title: t('kitPage.flow.s3'), render: () => <p className="kitp__panel">{t('kitPage.flow.s3lead')}</p> },
            ]}
          />
          {flowDone && <p className="kitp__panel" role="status">{t('kitPage.flow.doneSaid')}</p>}
          <h3 className="kitp__h3">{t('kitPage.flow.diffHead')}</h3>
          {/* Все три вида строк и все три исхода проверки: именно их
              различимость и надо видеть глазами (K2-DIFF). */}
          <DiffPreview
            label={t('kitPage.flow.diffLabel')}
            rows={[
              { id: 'a', kind: 'add', text: t('kitPage.flow.diffAdd'), detail: 'editor', check: { state: 'checked' } },
              { id: 'b', kind: 'remove', text: t('kitPage.flow.diffRemove'), check: { state: 'checked' } },
              { id: 'c', kind: 'same', text: t('kitPage.flow.diffSame'), check: { state: 'checked' } },
              // Смена — ОДНА строка «было → стало», а не пара «снимется» +
              // «добавится»: пара читается как два действия и как провал
              // между ними (K2-DIFF, запрос сессии администрирования).
              {
                id: 'ch', kind: 'change', text: t('kitPage.flow.diffChange'),
                from: t('kitPage.flow.diffChangeFrom'), to: t('kitPage.flow.diffChangeTo'),
                check: { state: 'checked' },
              },
              { id: 'd', kind: 'add', text: t('kitPage.flow.diffUnver'), check: { state: 'unverified', reason: t('kitPage.flow.diffUnverWhy') } },
              { id: 'e', kind: 'add', text: t('kitPage.flow.diffForbid'), check: { state: 'forbidden', reason: t('kitPage.flow.diffForbidWhy') } },
            ]}
            // Опасную пачку подтверждают словом. Какое слово и что считать
            // опасным — знает приложение: kit его не выдумывает.
            confirm={{ word: t('kitPage.flow.diffConfirmWord'), label: t('kitPage.flow.diffConfirmLabel') }}
            onApply={applied => {
              setDiffApplied(applied.length);
              setBatchUndone(false);
              setBatch({ id: 'demo-op', applied: applied.length, total: applied.length + 1, undoUntil: Date.now() + 10_000 });
            }}
          />
          {diffApplied !== null && <p className="kitp__panel" role="status">{t('kitPage.flow.diffApplied', { n: diffApplied })}</p>}
          {batch && (
            <>
              <h3 className="kitp__h3">{t('kitPage.flow.batchHead')}</h3>
              <BatchUndo
                batch={{
                  ...batch,
                  failed: [{ id: 'f', text: t('kitPage.flow.batchFail'), reason: t('kitPage.flow.batchFailWhy') }],
                }}
                undone={batchUndone}
                onUndo={() => setBatchUndone(true)}
              />
            </>
          )}
          <h3 className="kitp__h3">{t('kitPage.flow.matrixHead')}</h3>
          <p>{t('kitPage.flow.matrixLead')}</p>
          {/* Четыре исхода ячейки: значение · значения нет · не смогли
              проверить · нет прав. Матрица ничего не применяет — предложения
              уходят в дифф выше (K2-MATRIX). */}
          <Matrix
            labels={{ rows: t('kitPage.flow.matrixRows'), cols: t('kitPage.flow.matrixCols') }}
            rows={[{ key: 'r1', title: t('kitPage.flow.matrixR1') }, { key: 'r2', title: t('kitPage.flow.matrixR2') }]}
            cols={[{ key: 'c1', title: t('kitPage.flow.matrixC1') }, { key: 'c2', title: t('kitPage.flow.matrixC2') }]}
            options={[{ value: 'o1', title: t('kitPage.flow.matrixO1') }, { value: 'o2', title: t('kitPage.flow.matrixO2') }]}
            cell={(r, c) => (
              r === 'r1' && c === 'c1' ? { state: 'value', value: 'o1' }
                : r === 'r1' ? { state: 'none' }
                  : c === 'c1' ? { state: 'unverified', reason: t('kitPage.flow.diffUnverWhy') }
                    : { state: 'forbidden', reason: t('kitPage.flow.diffForbidWhy') }
            )}
            onPropose={changes => setProposed(changes.length)}
          />
          {proposed !== null && <p className="kitp__panel" role="status">{t('kitPage.flow.matrixProposed', { n: proposed })}</p>}
          <h3 className="kitp__h3">{t('kitPage.flow.chainHead')}</h3>
          <p>{t('kitPage.flow.chainLead')}</p>
          {/* Пять исходов шага, помеченный решающий шаг и оборванный хвост:
              вердикт, шаги и исходы приходят ДАННЫМИ — что из чего следует,
              знает приложение, а не kit (K2-CHAIN-EXPLAIN). */}
          <ChainExplain
            label={t('kitPage.flow.chainLabel')}
            verdict={t('kitPage.flow.chainVerdict')}
            tone="suc"
            decidedBy="s2"
            stopped={{ notRun: 2, reason: t('kitPage.flow.chainStopWhy') }}
            steps={[
              { id: 's1', title: t('kitPage.flow.chainS1'), outcome: { state: 'confirmed', detail: t('kitPage.flow.chainDetail') } },
              { id: 's2', title: t('kitPage.flow.chainS2'), outcome: { state: 'denied', detail: t('kitPage.flow.chainDetail') } },
              { id: 's3', title: t('kitPage.flow.chainS3'), outcome: { state: 'unverified', reason: t('kitPage.flow.diffUnverWhy') } },
              { id: 's4', title: t('kitPage.flow.chainS4'), outcome: { state: 'forbidden', reason: t('kitPage.flow.diffForbidWhy') } },
              { id: 's5', title: t('kitPage.flow.chainS5'), outcome: { state: 'unasked', reason: t('kitPage.flow.chainUnaskedWhy') } },
            ]}
          />
          <h3 className="kitp__h3">{t('kitPage.flow.relHead')}</h3>
          <p>{t('kitPage.flow.relLead')}</p>
          {/* Класс выпуска считает сервер; витрина показывает присланный. */}
          <ContentRelease
            diff={{
              from: 7,
              to: 8,
              class: 'hotfix',
              added: [{ id: 'A-1', title: t('kitPage.flow.relAdded') }],
              changed: [{
                id: 'C-1',
                title: t('kitPage.flow.relChanged'),
                fields: { title: { from: t('kitPage.flow.relWas'), to: t('kitPage.flow.relNow') } },
              }],
              removed: [{ id: 'R-1', title: t('kitPage.flow.relRemoved') }],
            }}
            log={[{ version: 7, who: t('kitPage.flow.relWho'), when: '2026-11-01T10:00:00Z', action: 'activate' }]}
            onActivate={v => setActivated(String(v))}
            onRollback={v => setActivated(t('kitPage.flow.relRolledBack', { v: String(v) }))}
          />
          {activated && <p className="kitp__panel" role="status">{t('kitPage.flow.relDone', { v: activated })}</p>}
          <h3 className="kitp__h3">{t('kitPage.cal.head')}</h3>
          <p>{t('kitPage.cal.lead')}</p>
          <CalendarMonth
            config={{ modules: [], menu: { groups: [] }, kinds: {}, statuses: { items: [{ code: 'todo', title: t('kitPage.cal.todo'), category: 'todo', icon: 'calendar', color: 'var(--t3)' }, { code: 'done', title: t('kitPage.cal.done'), category: 'done', icon: 'check-mark', color: 'var(--suc)' }] } }}
            records={[
              { id: 'c1', kind: 'k', title: t('kitPage.cal.e1'), status: 'done', fields: { d: '2026-11-11' } },
              { id: 'c2', kind: 'k', title: t('kitPage.cal.e2'), status: 'todo', fields: { d: '2026-11-11' } },
              { id: 'c3', kind: 'k', title: t('kitPage.cal.e3'), status: 'todo', fields: { d: '2026-11-11' } },
              { id: 'c4', kind: 'k', title: t('kitPage.cal.e4'), status: 'todo', fields: { d: '2026-11-11' } },
              { id: 'c5', kind: 'k', title: t('kitPage.cal.e5'), status: 'todo', fields: { d: '2026-11-18' } },
              { id: 'c6', kind: 'k', title: t('kitPage.cal.e6'), status: 'todo', fields: {} },
            ]}
            date="d" month="2026-11" today="2026-11-11"
          />
          <h3 className="kitp__h3">{t('kitPage.lib.head')}</h3>
          <p>{t('kitPage.lib.lead')}</p>
          <LibraryView
            href={id => `#${id}`}
            groups={[
              { key: 'adr', title: t('kitPage.lib.g1'), docs: [
                { id: 'L1', code: 'ADR-049', title: t('kitPage.lib.d1'), state: t('kitPage.lib.accepted'), meta: t('kitPage.lib.meta1'), body: t('kitPage.lib.body1') },
                { id: 'L2', code: 'ADR-047', title: t('kitPage.lib.d2'), state: t('kitPage.lib.accepted') },
                { id: 'L3', code: 'ADR-031', title: t('kitPage.lib.d3'), state: t('kitPage.lib.replaced'), stale: true },
                { id: 'L4', code: 'ADR-030', title: t('kitPage.lib.d4'), state: t('kitPage.lib.accepted') },
                { id: 'L5', code: 'ADR-028', title: t('kitPage.lib.d5'), state: t('kitPage.lib.accepted') },
                { id: 'L6', code: 'ADR-021', title: t('kitPage.lib.d6'), state: t('kitPage.lib.accepted') },
              ] },
              { key: 'doc', title: t('kitPage.lib.g2'), total: 9, docs: [
                { id: 'L7', title: t('kitPage.lib.d7'), state: t('kitPage.lib.stale'), stale: true },
                { id: 'L8', title: t('kitPage.lib.d8') },
              ] },
            ]}
          />
          <h3 className="kitp__h3">{t('kitPage.flow.secretHead')}</h3>
          {/* Значение здесь показное: витрина не выдаёт настоящих секретов. */}
          <SecretOnce value="demo-0000-0000" label={t('kitPage.flow.secretLabel')} />
        </section>

        <FieldsDemo />

        <section id="kit-palette" className="kitp__sec" aria-labelledby="kit-palette-h">
          <h2 id="kit-palette-h" className="kitp__h2">{t('kitPage.sec.palette')}</h2>
          <p>{t('kitPage.pal.lead')}</p>
          <div className="kitp__row">
            <button type="button" className="sk-btn" aria-keyshortcuts="Control+K" onClick={palette.openPalette}>
              {t('kitPage.pal.open')}<Kbd keys={['Ctrl', 'K']} />
            </button>
            <button type="button" className="sk-btn" aria-keyshortcuts="/" onClick={palette.openSearch}>
              {t('kitPage.pal.search')}<Kbd keys={['/']} />
            </button>
            {openedRecord && <Pill variant="id">{openedRecord}</Pill>}
          </div>
          <CommandPalette
            open={palette.open}
            mode={palette.mode}
            onClose={palette.close}
            ctx={paletteCtx}
            recent={recent}
            onOpenRecord={r => setOpenedRecord(r.id)}
          />
        </section>

        <section id="kit-content" className="kitp__sec" aria-labelledby="kit-content-h">
          <h2 id="kit-content-h" className="kitp__h2">{t('kitPage.sec.content')}</h2>
          <div className="kitp__split">
            <div>
              <h3 className="kitp__h3">{t('kitPage.md.edit')}</h3>
              <TipTapField value={md} onChange={setMd} ariaLabel={t('kitPage.md.editLabel')} minHeight={140} />
            </div>
            <div>
              <h3 className="kitp__h3">{t('kitPage.md.read')}</h3>
              <MartProse text={md} />
            </div>
          </div>
          {/*
            Ряд значений-чипов (S4-29). Показан ЗДЕСЬ, а не в «Элементах»:
            это значение поля, и смысл виден только рядом с текстом и подписью.

            В примере намеренно три случая сразу: свой чип, унаследованный (с
            подписью «от спринта» и кодом источника в подсказке) и чип без
            подписи — он показывает КОД, а не пустоту. И седьмой чип за «ещё N»,
            чтобы свёртку было видно живой.
          */}
          <h3 className="kitp__h3">{t('kitPage.chips.title')}</h3>
          <p>{t('kitPage.chips.lead')}</p>
          <dl className="kitp__chips">
            <dt>{t('kitPage.chips.projects')}</dt>
            <dd>
              <ValueChips href={paletteCtx.href} value={[
                { id: 'NooriUta/UnlimitedLORE', label: 'UnlimitedLORE', inherited_from: null },
                { id: 'NooriUta/BRAGI', label: 'BRAGI', inherited_from: null },
                { id: 'NooriUta/FORSETI', label: null, inherited_from: null },
                { id: 'NooriUta/MIDGARD', label: 'MIDGARD', inherited_from: { type: 'sprint', id: 'SPRINT_UXR_S4_UI_SHELL_LISTS' } },
                { id: 'NooriUta/VOLVA', label: 'VÖLVA', inherited_from: { type: 'sprint', id: 'SPRINT_UXR_S4_UI_SHELL_LISTS' } },
                { id: 'NooriUta/BRAGI_WEB', label: 'BRAGI web', inherited_from: { type: 'feature', id: 'FEAT-PUBLISH' } },
              ]} />
            </dd>
          </dl>
          <h3 className="kitp__h3">{t('kitPage.md.html')}</h3>
          <SandboxedHtmlFrame html={t('kitPage.md.htmlSample')} title={t('kitPage.md.htmlTitle')} />
        </section>
      </main>
    </div>
  );
}

/**
 * Редакторы по видам полей (S4-FIELD-EDITORS) — вживую: каждый вид, «не
 * задано» у числа и логического поля, значение вне списка, неизвестный вид
 * только чтением, пометка обязательного по кнопке «Проверить».
 */
function FieldsDemo() {
  const t = useAppT();
  const defs: FieldEditorDef[] = [
    { key: 'title', label: t('kitPage.fields.text'), kind: 'text', required: 'block' },
    { key: 'effort', label: t('kitPage.fields.number'), kind: 'number' },
    { key: 'flag', label: t('kitPage.fields.boolean'), kind: 'boolean' },
    { key: 'due', label: t('kitPage.fields.date'), kind: 'date', required: 'warn' },
    { key: 'at', label: t('kitPage.fields.time'), kind: 'time' },
    { key: 'when', label: t('kitPage.fields.datetime'), kind: 'datetime' },
    { key: 'prio', label: t('kitPage.fields.enum'), kind: 'enum', options: ['P1', 'P2', 'P3'] },
    { key: 'tags', label: t('kitPage.fields.multi'), kind: 'enum', options: ['ui', 'api', 'data'], multi: true, ordered: true },
    { key: 'body', label: t('kitPage.fields.md'), kind: 'md' },
    { key: 'geo', label: t('kitPage.fields.unknown'), kind: 'geo' },
  ];
  const [vals, setVals] = useState<Record<string, unknown>>({ title: '', effort: null, flag: null, due: null, at: '09:30', when: null, prio: 'P9', geo: '55.75,37.62', tags: ['api', 'ui'], body: '**MD** через TipTapField' });
  const [check, setCheck] = useState(false);
  return (
    <section id="kit-fields" className="kitp__sec" aria-labelledby="kit-fields-h">
      <h2 id="kit-fields-h" className="kitp__h2">{t('kitPage.sec.fields')}</h2>
      <p>{t('kitPage.fields.lead')}</p>
      <div className="kitp__fields">
        {defs.map(d => (
          <FieldEditor key={d.key} def={d} value={vals[d.key]} showRequired={check}
            onChange={v => setVals(m => ({ ...m, [d.key]: v }))}
            mdEditor={({ value, onChange, label }) => <TipTapField value={value} onChange={onChange} ariaLabel={label} minHeight={80} />} />
        ))}
      </div>
      <button type="button" className="sk-btn" onClick={() => setCheck(true)}>{t('kitPage.fields.check')}</button>
    </section>
  );
}
