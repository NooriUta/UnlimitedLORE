import { useEffect, useMemo, useRef, useState } from 'react';
import { api, connectWs, EnvMode, RunEvent, RunMeta, TestNode, TestStatus, TestTree } from './api';
import { TestDetails } from './components/TestDetails';
import { SelectionPanel } from './components/SelectionPanel';
import { TestEditor } from './components/TestEditor';
import { NewTestModal } from './components/NewTestModal';
import { RunsList } from './components/RunsList';
import { LiveLog } from './components/LiveLog';
import { ReportFrame } from './components/ReportFrame';
import { SuiteList } from './components/SuiteList';
import { SuiteDetail } from './components/SuiteDetail';
import { buildSuites, Suite } from './lib/suites';
import { CatalogFilters, FilterState, emptyFilter, applyFilters } from './components/CatalogFilters';
import '../../styles/tyr.css';

type TopTab = 'plan' | 'current' | 'reports';
type PlanMode = 'catalog' | 'select';

export default function TyrApp() {
  const [tab, setTab] = useState<TopTab>('plan');
  const [planMode, setPlanMode] = useState<PlanMode>('catalog');
  const [suiteSearch, setSuiteSearch] = useState('');
  const [filterState, setFilterState] = useState<FilterState>(() => emptyFilter());
  const [mode, setMode] = useState<EnvMode>('dev');
  const [activeSuite, setActiveSuite] = useState<Suite | null>(null);
  const [activeTest, setActiveTest] = useState<TestNode | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const [tree, setTree] = useState<TestTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [busy, setBusy] = useState(false);
  /** Текущий прогон, который смотрим в "Тесты" — обновляется при запуске нового и при появлении running на сервере. */
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  /** Прогон, выбранный в "Отчёты и история". */
  const [historyRunId, setHistoryRunId] = useState<string | null>(null);
  const [reportTab, setReportTab] = useState<'log' | 'report'>('report');

  const wsRef = useRef<WebSocket | null>(null);
  const logBuffer = useRef<Map<string, string[]>>(new Map());
  const [, force] = useState(0);

  const reload = async (): Promise<void> => {
    const r = await api.runs();
    setRuns(r.runs);
    setBusy(r.busy);
    // Сразу подхватить «running» (если кто-то стартовал из CLI/другого окна)
    const live = r.runs.find((x) => x.status === 'running' || x.status === 'queued');
    if (live && !currentRunId) setCurrentRunId(live.id);
  };

  const loadTree = async (m: EnvMode): Promise<void> => {
    setTreeError(null);
    setTree(null);
    try { setTree(await api.tests(m)); }
    catch (e) { setTreeError((e as Error).message); }
  };

  useEffect(() => { void loadTree(mode); }, [mode]);
  useEffect(() => { void reload(); }, []);

  useEffect(() => {
    const ws = connectWs((e: RunEvent) => {
      if (e.kind === 'log') {
        const buf = logBuffer.current.get(e.runId) ?? [];
        buf.push(e.line);
        if (buf.length > 5_000) buf.splice(0, buf.length - 5_000);
        logBuffer.current.set(e.runId, buf);
        if (e.runId === currentRunId || e.runId === historyRunId) force((n) => n + 1);
      } else {
        void reload();
      }
    });
    wsRef.current = ws;
    return () => ws.close();
  }, [currentRunId, historyRunId]);

  const selectedNodes = useMemo(
    () => (tree?.nodes ?? []).filter((n) => selected.has(n.id)),
    [tree, selected],
  );

  const allSuites = useMemo(
    () => (tree ? buildSuites(tree) : []),
    [tree],
  );

  // Apply catalog filters to nodes, then build suites showing only matching tests
  const filteredNodes = useMemo(
    () => tree ? applyFilters(tree.nodes, filterState) : [],
    [tree, filterState],
  );

  const suites = useMemo(() => {
    if (!tree) return [];
    const hasFilter = (
      filterState.statuses.size > 0 || filterState.kinds.size > 0 ||
      filterState.modules.size > 0 || filterState.ucs.size > 0 || filterState.frontends.size > 0
    );
    if (!hasFilter) return allSuites;
    const filteredIds = new Set(filteredNodes.map((n) => n.id));
    return allSuites
      .map((s) => ({ ...s, tests: s.tests.filter((t) => filteredIds.has(t.id)) }))
      .filter((s) => s.tests.length > 0);
  }, [allSuites, filteredNodes, filterState]);

  // Switching suite resets the open test detail
  const pickSuite = (s: Suite): void => {
    setActiveSuite(s);
    setActiveTest(null);
  };

  const toggleSuite = (suite: Suite): void => {
    const ids = suite.tests.map((t) => t.id);
    const allSel = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleTest = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startRun = async (descr: string, filterOrChunks: string | string[]): Promise<void> => {
    const body = typeof filterOrChunks === 'string'
      ? { mode, filter: filterOrChunks, filterDescr: descr }
      : { mode, filter: '', filterDescr: descr, chunks: filterOrChunks };
    const { id } = await api.start(body);
    setCurrentRunId(id);
    setTab('current');
    logBuffer.current.set(id, []);
    await reload();
  };

  /** Патчим конкретный TestNode в дереве — чтобы фильтры и список мгновенно отразили новый статус. */
  const patchNode = (id: string, patch: { status?: TestStatus }): void => {
    setTree((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === id ? { ...n, allure: { ...n.allure, ...patch } } : n,
        ),
      };
    });
  };

  const runAll      = (): Promise<void> => startRun(`Все тесты · ${mode}`, '');
  const runSelected = (): Promise<void> => {
    if (!selectedNodes.length) return Promise.resolve();

    const projectTotal = new Map<string, number>();
    for (const n of tree!.nodes) projectTotal.set(n.project, (projectTotal.get(n.project) ?? 0) + 1);

    const selectedByProject = new Map<string, TestNode[]>();
    for (const n of selectedNodes) {
      const arr = selectedByProject.get(n.project) ?? [];
      arr.push(n);
      selectedByProject.set(n.project, arr);
    }

    // Build the filter string for a single project.
    const projectFilter = (proj: string, nodes: TestNode[]): string => {
      const flag = `--project=${proj}`;
      if (nodes.length === (projectTotal.get(proj) ?? 0)) return flag;
      const titles = nodes.map((n) => n.testTitle.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'));
      return `${flag} --grep "${titles.join('|')}"`;
    };

    const allProjects = [...selectedByProject.keys()];
    const descr = `Выбрано: ${selectedNodes.length} тест${plural(selectedNodes.length)} · ${mode}`;

    // Large selection (> 500): auto-split into per-project chunks → one report.
    if (selectedNodes.length > 500) {
      const chunks = allProjects.map((p) => projectFilter(p, selectedByProject.get(p)!));
      return startRun(`${descr} · ${chunks.length} разделов`, chunks);
    }

    // Small selection: single playwright invocation.
    const partialNodes = selectedNodes.filter(
      (n) => (selectedByProject.get(n.project)?.length ?? 0) < (projectTotal.get(n.project) ?? 0),
    );
    const projectFlags = allProjects.map((p) => `--project=${p}`).join(' ');
    if (partialNodes.length === 0) return startRun(descr, projectFlags);

    const titles = partialNodes.map((n) => n.testTitle.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'));
    return startRun(descr, `${projectFlags} --grep "${titles.join('|')}"`);
  };
  const runFailed = async (): Promise<void> => {
    const lastFinished = runs.find((r) => r.status === 'failed' || r.status === 'passed');
    if (!lastFinished) { alert('Нет прошлых прогонов — нечего перезапускать.'); return; }
    return startRun(`Перезапуск упавших · ${mode}`, '--last-failed');
  };
  const runByTag = async (): Promise<void> => {
    const tag = prompt('Тэг (например smoke, rbac):', 'smoke');
    if (!tag) return;
    return startRun(`Тег @${tag} · ${mode}`, `--grep @${tag}`);
  };

  const currentRun = runs.find((r) => r.id === currentRunId) ?? null;
  const historyRun = runs.find((r) => r.id === historyRunId) ?? null;

  return (
    <div className="app" style={{ height: '100%' }}>
      <header className="topbar">
        <h1>AIDA UI Tests</h1>
        <nav className="top-tabs">
          <button className={tab === 'plan'    ? 'on' : ''} onClick={() => setTab('plan')}>
            📋 Тест-планы
          </button>
          <button className={tab === 'current' ? 'on' : ''} onClick={() => setTab('current')}>
            {currentRun?.status === 'running' || currentRun?.status === 'queued' ? '🟢' : '⚪'} Тесты (текущий прогон)
            {currentRun && <span className="badge">{currentRun.id.slice(0, 8)}</span>}
          </button>
          <button className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>
            📊 Отчёты и история
            {runs.length > 0 && <span className="badge">{runs.length}</span>}
          </button>
        </nav>
        <div className="mode-toggle">
          <span>Env</span>
          <button className={mode === 'dev'    ? 'on' : ''} onClick={() => setMode('dev')}>Dev</button>
          <button className={mode === 'docker' ? 'on' : ''} onClick={() => setMode('docker')}>Docker</button>
          <span className="mode-sep" />
          <button className={mode === 'preprod' ? 'on' : ''} onClick={() => setMode('preprod')}>Preprod</button>
        </div>
        <button
          onClick={() => { void loadTree(mode); void reload(); }}
          title="Перезагрузить каталог тестов и список прогонов"
          style={{
            background: 'transparent',
            color: 'var(--t2)',
            border: '1px solid var(--bd)',
            padding: '3px 10px',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          ↻
        </button>
        {busy && <span className="busy-pill">▶ Прогон</span>}
      </header>

      {tab === 'plan' && (
        <div className="plan-wrap">
          <div className="plan-subtabs">
            <button className={planMode === 'catalog' ? 'on' : ''} onClick={() => { setPlanMode('catalog'); setActiveTest(null); }}>
              📖 Каталог
            </button>
            <button className={planMode === 'select' ? 'on' : ''} onClick={() => { setPlanMode('select'); setActiveTest(null); }}>
              🎯 Выбор для прогона
              {selectedNodes.length > 0 && <span className="badge">{selectedNodes.length}</span>}
            </button>
          </div>

          <div className="layout-plan layout-plan-browse">
            {/* ── Left pane: suite cards ──────────────────────────────────── */}
            <section className="cat-list-pane">
              <div className="cat-search" style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  style={{ flex: 1 }}
                  placeholder="🔎 Фильтр по suite или тесту…"
                  value={suiteSearch}
                  onChange={(e) => setSuiteSearch(e.target.value)}
                />
                {planMode === 'catalog' && (
                  <button
                    className="editor-btn editor-btn-primary"
                    onClick={() => setShowNewModal(true)}
                    title="Создать новый тест из шаблона"
                  >+ Новый</button>
                )}
                {planMode === 'select' && selectedNodes.length > 0 && (
                  <button onClick={() => setSelected(new Set())} title="Снять весь выбор">☐</button>
                )}
              </div>
              {treeError && <div className="error">Не удалось загрузить план: {treeError}</div>}
              {!tree && !treeError && <div className="muted" style={{ padding: 16 }}>Загружаю…</div>}
              {tree && (
                <CatalogFilters
                  nodes={tree.nodes}
                  filtered={filteredNodes}
                  state={filterState}
                  onChange={setFilterState}
                />
              )}
              {tree && (
                <SuiteList
                  suites={suites}
                  activeSuiteId={activeSuite?.id ?? null}
                  selected={selected}
                  selectable={planMode === 'select'}
                  searchText={suiteSearch}
                  onPick={pickSuite}
                  onToggleSuite={toggleSuite}
                />
              )}
            </section>

            {/* ── Right pane ──────────────────────────────────────────────── */}
            <section className="detail-pane">

              {/* ── CATALOG mode ──────────────────────────────────────────── */}
              {planMode === 'catalog' && !activeSuite && (
                <div className="empty">
                  <h2>📖 Каталог тестов</h2>
                  <p>Слева — {suites.length} suite-групп. Кликни на любую — откроется список тест-кейсов:</p>
                  <ul>
                    <li>🏷 Статус теста — клик по бейджу меняет (<strong>active → planned → deprecated</strong>)</li>
                    <li>🔍 Клик по строке теста — полная карточка с исходником и мета</li>
                    <li>⛓ Hound — все 4 шага как один комплексный тест</li>
                    <li>▶ <strong>Запустить suite</strong> прямо из панели</li>
                  </ul>
                  <p className="muted">Для выбора группы переключись на <strong>🎯 Выбор для прогона</strong>.</p>
                </div>
              )}

              {/* Suite list (catalog, no active test) */}
              {planMode === 'catalog' && activeSuite && !activeTest && (
                <SuiteDetail
                  suite={activeSuite}
                  selected={selected}
                  selectable={false}
                  busy={busy}
                  onToggleTest={toggleTest}
                  onToggleSuite={toggleSuite}
                  onNodeChange={patchNode}
                  onRun={startRun}
                  onPickTest={(n) => setActiveTest(n)}
                />
              )}

              {/* Individual test detail (catalog) */}
              {planMode === 'catalog' && activeTest && (
                <div className="suite-back-wrap">
                  <div className="suite-back-bar">
                    <button
                      className="suite-back-btn"
                      onClick={() => setActiveTest(null)}
                    >
                      ← {activeSuite?.label ?? 'назад'}
                    </button>
                    <span className="muted suite-back-title">{activeTest.testTitle}</span>
                  </div>
                  <TestDetails
                    node={activeTest}
                    busy={busy}
                    onRun={startRun}
                    onEdit={(file) => setEditingFile(file)}
                    onNodeChange={patchNode}
                  />
                </div>
              )}

              {/* ── SELECT mode ───────────────────────────────────────────── */}
              {planMode === 'select' && activeSuite && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  {selectedNodes.length > 0 && (
                    <div className="sel-run-bar">
                      <span>Выбрано: <b>{selectedNodes.length}</b></span>
                      <button className="primary" disabled={busy} onClick={() => void runSelected()}>
                        ▶ Запустить выбранные
                      </button>
                      <button disabled={busy} onClick={() => setSelected(new Set())}>☐ Очистить</button>
                    </div>
                  )}
                  <SuiteDetail
                    suite={activeSuite}
                    selected={selected}
                    selectable={true}
                    busy={busy}
                    onToggleTest={toggleTest}
                    onToggleSuite={toggleSuite}
                    onNodeChange={patchNode}
                    onRun={startRun}
                    onPickTest={undefined}
                  />
                </div>
              )}
              {planMode === 'select' && !activeSuite && tree && (
                <SelectionPanel
                  tree={tree}
                  selected={selected}
                  selectedNodes={selectedNodes}
                  busy={busy}
                  onToggleMany={(ids, on) => {
                    const next = new Set(selected);
                    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
                    setSelected(next);
                  }}
                  onClear={() => setSelected(new Set())}
                  onRunSelected={runSelected}
                  onRunAll={runAll}
                  onRunFailed={runFailed}
                  onRunByTag={runByTag}
                />
              )}
            </section>
          </div>
        </div>
      )}

      {tab === 'current' && (
        <div className="layout-single">
          {!currentRun && (
            <div className="empty">
              <h2>⚪ Сейчас ничего не запущено</h2>
              <p>Зайди в <strong>📋 Тест-планы</strong> и нажми <strong>▶ Все</strong> / <strong>▶ Выбранные</strong>. Прогон откроется здесь автоматически.</p>
            </div>
          )}
          {currentRun && (
            <>
              <div className="detail-tabs">
                <span className={`status-chip status-${currentRun.status}`}>{statusIcon(currentRun.status)} {currentRun.status}</span>
                <span className="run-meta-current"><strong>{currentRun.filterDescr}</strong></span>
                <span className="muted"><code>{currentRun.id}</code></span>
                {currentRun.passed + currentRun.failed > 0 && (
                  <span>✓ <b>{currentRun.passed}</b> · ✗ <b>{currentRun.failed}</b></span>
                )}
                <span style={{ marginLeft: 'auto' }} className="muted">
                  {currentRun.durationMs ? `${(currentRun.durationMs / 1000).toFixed(1)}s` : 'в процессе…'}
                </span>
              </div>
              <LiveLog runId={currentRun.id} bufferedLines={logBuffer.current.get(currentRun.id)} />
              {currentRun.reportUrl && (
                <div style={{ padding: 8, borderTop: '1px solid var(--border)', textAlign: 'center', background: 'var(--panel-2)' }}>
                  <button
                    className="primary"
                    onClick={() => { setHistoryRunId(currentRun.id); setReportTab('report'); setTab('reports'); }}
                  >📊 Открыть Allure-отчёт →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Spacer so the 3rd grid row (statusbar) doesn't collapse main content */}
      {tab === 'reports' && (
        <div className="layout-reports">
          <aside className="sidebar">
            <h2>📜 История прогонов{runs.length > 0 && <span className="muted"> · {runs.length}</span>}</h2>
            <RunsList
              runs={runs}
              activeId={historyRunId}
              onPick={(id) => { setHistoryRunId(id); setReportTab('report'); }}
            />
          </aside>
          <section className="detail-pane">
            {!historyRun && runs.length === 0 && (
              <div className="empty">
                <h2>📊 Прогонов ещё не было</h2>
                <p>Перейди в <strong>📋 Тест-планы</strong> и запусти.</p>
              </div>
            )}
            {!historyRun && runs.length > 0 && (
              <div className="empty">
                <h2>👈 Выберите прогон слева</h2>
              </div>
            )}
            {historyRun && (
              <>
                <div className="detail-tabs">
                  <button className={reportTab === 'report' ? 'on' : ''} onClick={() => setReportTab('report')} disabled={!historyRun.reportUrl}>📊 Allure отчёт</button>
                  <button className={reportTab === 'log' ? 'on' : ''} onClick={() => setReportTab('log')}>📟 Лог</button>
                  <span className="run-meta">
                    <code>{historyRun.id}</code> · {historyRun.filterDescr} ·
                    <b className={`status-${historyRun.status}`}> {historyRun.status}</b>
                    {historyRun.passed + historyRun.failed > 0 && <> · ✓ {historyRun.passed} · ✗ {historyRun.failed}</>}
                  </span>
                </div>
                {historyRun.status !== 'queued' && historyRun.status !== 'running' &&
                 historyRun.passed + historyRun.failed + historyRun.skipped === 0 && (
                  <div className="run-warning">
                    <strong>⚠️ В этом прогоне не выполнилось ни одного теста</strong>
                    <p>
                      Скорее всего упал <code>globalSetup</code> (например vite dev-серверы не подняты,
                      или Keycloak недоступен в Docker). Allure-отчёт пуст потому что тесты не запускались.
                      Открой <strong>📟 Лог</strong> — там будет точное сообщение об ошибке окружения.
                    </p>
                  </div>
                )}
                {reportTab === 'log' && (
                  <LiveLog runId={historyRun.id} bufferedLines={logBuffer.current.get(historyRun.id)} />
                )}
                {reportTab === 'report' && historyRun.reportUrl && (
                  <ReportFrame url={historyRun.reportUrl} runId={historyRun.id} failed={historyRun.failed} />
                )}
              </>
            )}
          </section>
        </div>
      )}

      {editingFile && (
        <TestEditor
          file={editingFile}
          onClose={() => setEditingFile(null)}
          onSaved={() => { void loadTree(mode); }}
        />
      )}

      {showNewModal && (
        <NewTestModal
          onClose={() => setShowNewModal(false)}
          onCreated={(file) => {
            setShowNewModal(false);
            setEditingFile(file);
            void loadTree(mode);
          }}
        />
      )}

      <footer className="statusbar">
        <span className="sb-item">
          <code style={{ color: 'var(--acc)' }}>SEER</code>
        </span>
        <span className="sb-item">{tree?.nodes.length ?? '—'} тестов</span>
        <span className="sb-item">{runs.length} прогон{plural(runs.length)}</span>
        <span className="sb-item">env: <code>{mode}</code></span>
        {currentRun && (
          <span className="sb-item">
            текущий: <code>{currentRun.id.slice(0, 12)}…</code> · <span className={`status-${currentRun.status}`}>{currentRun.status}</span>
          </span>
        )}
      </footer>
    </div>
  );
}

function statusIcon(s: RunMeta['status']): string {
  switch (s) {
    case 'queued':  return '⏸';
    case 'running': return '⏳';
    case 'passed':  return '✓';
    case 'failed':  return '✗';
    case 'error':   return '!';
    default: return '·';
  }
}

function plural(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'ов';
  const m10 = n % 10;
  if (m10 === 1) return '';
  if (m10 >= 2 && m10 <= 4) return 'а';
  return 'ов';
}
