export type TestStatus = 'active' | 'planned' | 'blocked' | 'freeze' | 'deprecated';
export type TestKind   = 'e2e-ui' | 'api' | 'unit' | 'visual' | 'a11y' | 'setup';

export interface TestNodeAllure {
  epic?: string;
  feature?: string;
  story?: string;
  severity?: string;
  owner?: string;
  tags: string[];
  ucs: string[];
  frontends: string[];
  modules: string[];
  environments: string[];
  status: TestStatus;
  testKind?: TestKind;
}

export type TestRunStatusValue = 'passed' | 'failed' | 'broken' | 'skipped';

export interface TestNodeHistory {
  recent: TestRunStatusValue[];   // newest first
  lastStatus?: TestRunStatusValue;
  lastRunAt?: string;
  flakyScore: number;             // 0..1
  total: number;
}

export interface TestNode {
  id: string;
  project: string;
  file: string;
  line: number;
  title: string;
  testTitle: string;
  describePath: string[];
  allure: TestNodeAllure;
  /** Последние N прогонов из ArcadeDB (если есть). */
  history?: TestNodeHistory;
}

export type EnvMode = 'dev' | 'docker' | 'preprod';

export interface TestRunRecord {
  testId: string;
  runId: string;
  status: TestRunStatusValue;
  durationMs: number;
  startedAt: string;
  commit?: string;
  mode: EnvMode;
  filterDescr: string;
}
export interface TestTree {
  nodes: TestNode[];
  generatedAt: number;
  projectLabels: Record<string, string>;
}

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled';

export interface RunMeta {
  id: string;
  mode: EnvMode;
  filter: string;
  filterDescr: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: RunStatus;
  exitCode?: number | null;
  passed: number;
  failed: number;
  skipped: number;
  reportUrl?: string;
  commit?: string;
  trigger: string;
}

export type RunEvent =
  | { kind: 'log';      runId: string; line: string }
  | { kind: 'status';   runId: string; status: RunStatus }
  | { kind: 'finished'; runId: string; status: RunStatus; passed: number; failed: number; durationMs: number };

const j = async <T>(p: Promise<Response>): Promise<T> => {
  const r = await p;
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
};

export interface AllureMeta {
  epic?: string;
  feature?: string;
  story?: string;
  severity?: string;
  tags: string[];
  owner?: string;
  links: { url: string; name?: string }[];
  description?: string;
  descriptionHtml?: string;
  parameters: { name: string; value: string }[];
  labels: { name: string; value: string }[];
  ucs: string[];
  frontends: string[];
  modules: string[];
  environments: string[];
  /** Статус теста из БД (всегда 'active' если не задан). Код теста его не определяет. */
  status: TestStatus;
}

export interface TestDetail {
  id: string;
  file: string;
  line: number;
  testTitle: string;
  describePath: string[];
  project: string;
  allure: AllureMeta;
  autoSteps: string[];
  autoActions: { kind: string; text: string }[];
  sourceSnippet: string;
  fileBytes: number;
  /** Метаданные из БД (статус, severity, owner и т.д.). */
  meta?: {
    status?: TestStatus;
    note?: string;
    owner?: string;
    severity?: string;
    tags?: string[];
    epic?: string;
    feature?: string;
    story?: string;
    updatedAt: string;
  } | null;
}

export const api = {
  health:   () => j<{ ok: boolean; version: string }>(fetch('/tyr-api/health')),
  tests:    (mode: EnvMode) => j<TestTree>(fetch(`/tyr-api/tests?mode=${mode}`)),
  runs:     () => j<{ runs: RunMeta[]; busy: boolean; pending: number }>(fetch('/tyr-api/runs')),
  run:      (id: string) => j<RunMeta>(fetch(`/tyr-api/runs/${id}`)),
  log:      async (id: string) => (await fetch(`/tyr-api/runs/${id}/log`)).text(),
  start:    (body: { mode: EnvMode; filter: string; filterDescr: string; chunks?: string[] }) =>
            j<{ id: string; queued: number }>(
              fetch('/tyr-api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
            ),
  detail:   (body: { file: string; line: number; project: string; testTitle: string }) =>
            j<TestDetail>(
              fetch('/tyr-api/tests/detail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
            ),
  setMeta: (body: {
    testId: string;
    status?: TestStatus;
    note?: string;
    owner?: string;
    severity?: string;
    tags?: string[];
    epic?: string;
    feature?: string;
    story?: string;
  }) =>
            j<TestDetail['meta']>(
              fetch('/tyr-api/tests/meta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
            ),
  clearMeta: (testId: string) =>
            j<{ deleted: boolean }>(
              fetch('/tyr-api/tests/meta', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testId }) }),
            ),
  testHistory: (testId: string, limit = 20) =>
            j<TestRunRecord[]>(
              fetch(`/tyr-api/tests/history?testId=${encodeURIComponent(testId)}&limit=${limit}`),
            ),
  sourceGet: (file: string) =>
            j<{ file: string; content: string; mtime: number; bytes: number }>(
              fetch(`/tyr-api/tests/source?file=${encodeURIComponent(file)}`),
            ),
  sourceSave: (body: { file: string; content: string; mtimeSeen?: number; skipValidate?: boolean }) =>
            j<{ ok: boolean; file: string; mtime: number; created: boolean }>(
              fetch('/tyr-api/tests/source', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
            ),
  template: (body: { area: 'chur' | 'heimdall' | 'verdandi' | 'visual' | 'a11y'; epic?: string; feature?: string; title?: string }) =>
            j<{ content: string }>(
              fetch('/tyr-api/tests/template', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
            ),
};

export function connectWs(onEvent: (e: RunEvent) => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/tyr-ws`);
  ws.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data) as RunEvent); } catch { /* ignore */ }
  };
  return ws;
}
