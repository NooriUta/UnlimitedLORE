// LoreMcpApiScreen — published API reference for the `aida-lore` MCP server.
// Lives at /lore?section=mcp. Documents the LORE write/read tools, the backend
// contract, env and runbook, and pings the live backend to show health + the
// real slice catalog that `lore_list_slices` exposes. bench_* (MUNINN) tools
// live on the same server but are documented on /benchmark?tab=mcp instead.
import { useEffect, useState } from 'react';
import { fetchLoreSliceCatalog, type LoreSliceDescriptor } from '../../api/lore';

interface ToolDoc {
  name: string;
  kind: 'read' | 'write';
  backend: string;
  params: string;
  desc: string;
}

const TOOLS: ToolDoc[] = [
  // ── Read ──────────────────────────────────────────────────────────────────
  { name: 'lore_list_slices', kind: 'read', backend: 'GET /lore/slices', params: '—',
    desc: 'Каталог именованных слайсов с их обязательными/опциональными параметрами. Вызывать первым.' },
  { name: 'lore_query_slice', kind: 'read', backend: 'GET /lore/slice/{slice}', params: 'slice, params?',
    desc: 'Выполнить слайс и получить rows[]. params — map строк: {"id":"ADR-FE-001"}, {"sprint_id":"SPRINT_X"} и т.п. SQL и whitelisting на бэкенде.' },

  // ── Sprint ─────────────────────────────────────────────────────────────────
  { name: 'lore_create_sprint', kind: 'write', backend: 'POST /lore/sprint/create',
    params: 'sprint_id, name, status?, item_id?, plan_id?, priority?, outcome_md?, context_md?',
    desc: 'Создать KnowSprint напрямую (без plan-item). Идемпотентен (upsert by sprint_id). Сеет начальную HAS_STATE hist-строку.' },
  { name: 'lore_register_sprint', kind: 'write', backend: 'POST /lore/sprint',
    params: 'item_id, sprint_id?, name?, status?',
    desc: 'Зарегистрировать реальный спринт для placeholder plan-item: создаёт KnowSprint, линкует REPRESENTS. Используй, когда plan-item уже есть.' },
  { name: 'lore_update_sprint', kind: 'write', backend: 'POST /lore/sprint/update',
    params: 'sprint_id, name?, outcome_md?, context_md?, priority?, plan_id?, effort_days?',
    desc: 'Partial-update метаданных KnowSprint. Не меняет статус (для статуса — lore_set_status). Всегда заполнять context_md, если известен контекст.' },
  { name: 'lore_update_sprint_refs', kind: 'write', backend: 'POST /lore/sprint/refs',
    params: 'sprint_id, pr_numbers[], git_project?',
    desc: 'Добавить PR-ссылки в pr_refs открытой KnowSprintHist строки. Пропускает уже присутствующие. Возвращает updated pr_refs.' },
  { name: 'lore_link_sprint_project', kind: 'write', backend: 'POST /lore/sprint/project',
    params: 'sprint_id, git_project, action?',
    desc: 'Добавить/убрать BELONGS_TO_PROJECT edge (KnowSprint → KnowGitProject). action = add | remove.' },
  { name: 'lore_link_sprint_dep', kind: 'write', backend: 'POST /lore/sprint/dep',
    params: 'from_sprint, to_sprint, kind?, reason?, action?',
    desc: 'DEPENDS_ON edge между спринтами. kind = hard|soft|gate|informs. Сервер отклоняет рёбра, создающие цикл. action = add | remove.' },
  { name: 'lore_link_sprint_component', kind: 'write', backend: 'POST /lore/sprint/component',
    params: 'sprint_id, component_id, action?',
    desc: 'Явное BELONGS_TO edge (спринт → компонент) — перекрывает нечёткий матч по имени в component_sprints. action = add | remove.' },
  { name: 'lore_link_sprint_milestone', kind: 'write', backend: 'POST /lore/milestone/sprint',
    params: 'sprint_id, milestone_id, action?',
    desc: 'Прямое TARGETS_MILESTONE edge для спринтов без PlanItem-моста. Для спринтов с PlanItem — предпочтительнее lore_update_plan_item. action = add | remove.' },

  // ── Status ─────────────────────────────────────────────────────────────────
  { name: 'lore_set_status', kind: 'write', backend: 'POST /lore/status',
    params: 'entity_type, id, status',
    desc: 'Сменить статус (SCD2: закрыть старую hist-строку valid_to=now, открыть новую). entity_type: plan_item|sprint|task|checkpoint. status ∈ todo|planned|active|partial|done|blocked|high|cancelled|backlog|design|ready_for_deploy.' },
  { name: 'lore_batch_set_status', kind: 'write', backend: 'POST /lore/status/batch',
    params: 'entity_type, ids[], status',
    desc: 'Массово сменить статус: каждый id проходит полный SCD2-переход. Ошибки per-item, не прерывают остальных. Возвращает {ok, updated, errors[]}.' },

  // ── Task ───────────────────────────────────────────────────────────────────
  { name: 'lore_create_task', kind: 'write', backend: 'POST /lore/task',
    params: 'sprint_id, task_id, title, note_md?',
    desc: 'Создать задачу в спринте (order_index = max+1, начальный статус PLANNED с HAS_STATE hist-строкой).' },
  { name: 'lore_edit_task', kind: 'write', backend: 'POST /lore/task/edit',
    params: 'task_uid+title | tasks[]',
    desc: 'Изменить заголовок/заметку/effort_days задачи. Одиночный режим: task_uid + title (+ note_md?, effort_days?). Batch: tasks=[{task_uid, title, note_md?, effort_days?}].' },
  { name: 'lore_link_task_component', kind: 'write', backend: 'POST /lore/task/component',
    params: 'task_uid, component_id, action?',
    desc: 'TAGGED_WITH edge между задачей и компонентом (many-to-many). action = add | remove.' },

  // ── Plan item / milestone ─────────────────────────────────────────────────
  { name: 'lore_update_plan_item', kind: 'write', backend: 'POST /lore/plan-item/milestone',
    params: 'item_id, milestone_id?, action?',
    desc: 'CONTRIBUTES_TO edge (PlanItem → Milestone). Канонический путь привязки спринта к вехе, когда у спринта есть plan-item. action="remove" без milestone_id снимает все связи.' },

  // ── ADR / Decision ─────────────────────────────────────────────────────────
  { name: 'lore_create_adr', kind: 'write', backend: 'POST /lore/adr',
    params: 'adr_id, name, status?, date_created?, component_id(s)?, context_md?, decision_md?, consequences_md?, depends_on_ids?, supersedes_ids?, tags?, file_path?',
    desc: 'Создать/обновить KnowADR (upsert by adr_id). Полная SCD2-структура: вершина + открытая KnowADRHist + HAS_STATE edge. Партиальные вызовы БЕЗОПАСНЫ (LH-44, 2026-07): непереданные поля (context_md/decision_md/consequences_md/date_created/component_id) остаются нетронутыми, не обнуляются. depends_on_ids/supersedes_ids/component_ids/tags при передаче ЗАМЕНЯЮТ весь набор рёбер.' },
  { name: 'lore_update_adr', kind: 'write', backend: 'POST /lore/adr',
    params: 'adr_id, name, status?, date_created?, component_id(s)?, context_md?, decision_md?, consequences_md?, depends_on_ids?, supersedes_ids?, tags?, file_path?',
    desc: 'Тонкая обёртка над тем же эндпоинтом, что и lore_create_adr — сигнатура заточена под точечный amend: правь один раздел (например только decision_md), остальные секции гарантированно не тронутся. name всё ещё обязателен (бэкенд пишет его на каждый вызов).' },
  { name: 'lore_create_decision', kind: 'write', backend: 'POST /lore/decision',
    params: 'decision_id, title, body_md?, date_created?, refs_raw?',
    desc: 'Создать/обновить KnowDecision (upsert by decision_id). Для записи ключевых решений, принятых в ходе спринта или дизайн-сессии.' },

  // ── Spec / QG / Runbook / Doc ─────────────────────────────────────────────
  { name: 'lore_create_spec', kind: 'write', backend: 'POST /lore/spec',
    params: 'spec_id, title, version?, component_id?, content_md?, summary?, file_path?',
    desc: 'Создать/обновить KnowSpec + SCD2 hist (upsert by spec_id). Body-поля (content_md/version/summary) пишутся в ОТКРЫТУЮ KnowSpecHist-строку (создаётся при отсутствии) — именно её читает spec_by_id. Партиальные вызовы БЕЗОПАСНЫ — непереданные поля не обнуляются.' },
  { name: 'lore_update_spec', kind: 'write', backend: 'POST /lore/spec',
    params: 'spec_id, title, version?, component_id?, content_md?, summary?, file_path?',
    desc: 'Тонкая обёртка над тем же эндпоинтом — сигнатура под точечный amend (зеркало lore_update_adr): bump version или правка content_md без пересылки всей спеки; остальные поля не тронутся. title обязателен на каждый вызов.' },
  { name: 'lore_delete_spec', kind: 'write', backend: 'POST /lore/spec/delete',
    params: 'spec_id',
    desc: 'Безвозвратно удалить вершину KnowSpec по spec_id.' },
  { name: 'lore_create_quality_gate', kind: 'write', backend: 'POST /lore/quality-gate',
    params: 'qg_id, name, description?, component_id?, status?, content_md?, sprint_id?',
    desc: 'Создать/обновить QualityGate (upsert by qg_id).' },
  { name: 'lore_create_runbook', kind: 'write', backend: 'POST /lore/runbook',
    params: 'runbook_id, name, area?, date_created?, content_md?',
    desc: 'Создать/обновить KnowRunbook (upsert by runbook_id).' },
  { name: 'lore_create_doc', kind: 'write', backend: 'POST /lore/doc',
    params: 'doc_id, title, kind?, has_ext_deps?, component_id?, file_path?, content_html?',
    desc: 'Создать/обновить KnowDoc — HTML-документ/фрагмент (upsert by doc_id). content_html ≤100 КБ.' },

  // ── QG рутина: прогон → job-task → рекомендация → задача ──────────────────
  { name: 'lore_record_qg_run', kind: 'write', backend: 'POST /lore/qg/run',
    params: 'routine_name, run_date, status, metrics[]?, started_at?, finished_at?, flags?, run_id?',
    desc: 'Записать завершённый прогон QG-рутины (ClRoutineRun + ClRoutineMetric). Вызывать один раз в конце каждого прогона. metrics[] — SMART-метрики (ADR-QG-002): key/value/unit/target/status/source (file:line evidence).' },
  { name: 'lore_create_qg_job_task', kind: 'write', backend: 'POST /lore/qg/job-task',
    params: 'job_id, qg_id, inv_id?, run_date?, severity?, status?, note_md?',
    desc: 'Upsert QGJobTask + YIELDED edge от родительской QualityGate. Вызывать после FAIL инварианта. При PASS того же qg_id+inv_id закрывает открытые job-task как resolved.' },
  { name: 'lore_create_recommendation', kind: 'write', backend: 'POST /lore/qg/recommendation',
    params: 'rec_id, job_id, title, body_md?, status?, priority?, severity?, effort_days?, tags?, component_id?, qg_id?, inv_id?, fix_cmd?, how_to_verify?',
    desc: 'Upsert QGRecommendation + PRODUCED edge от QGJobTask. status стартует как pending, до подтверждения пользователем.' },
  { name: 'lore_promote_recommendation', kind: 'write', backend: 'POST /lore/qg/promote',
    params: 'rec_id, sprint_id?, task_uid?, title?, note_md?',
    desc: 'Подтвердить рекомендацию → создать KnowTask в SPRINT_QG_VIOLATIONS (или указанном спринте). Бэкенд сам обогащает note_md из полей рекомендации, если не переданы. Использовать после явного «да» пользователя.' },

  // ── Component ──────────────────────────────────────────────────────────────
  { name: 'lore_create_component', kind: 'write', backend: 'POST /lore/component/create',
    params: 'component_id, full_name?, area?, team?, game_icon?, owner?, parent_id?',
    desc: 'Создать новый LoreComponent (upsert by component_id). Для компонентов, которых ещё нет в графе.' },
  { name: 'lore_update_component', kind: 'write', backend: 'POST /lore/component/update',
    params: 'component_id, full_name?, area?, team?, game_icon?, owner?, parent_id?',
    desc: 'Partial-update существующего LoreComponent (только переданные поля). Переименование, смена владельца/команды/иконки, репарент.' },

  // ── Release ────────────────────────────────────────────────────────────────
  { name: 'lore_create_release', kind: 'write', backend: 'POST /lore/release',
    params: 'release_id, release_date?, git_tag?, type?, description_md?, is_current?, week?, git_project?',
    desc: 'Создать KnowRelease. is_current=true автоматически сбрасывает флаг у предыдущего текущего релиза. Сеет KnowReleaseHist + HAS_STATE edge.' },
  { name: 'lore_update_release', kind: 'write', backend: 'POST /lore/release/update',
    params: 'release_id, git_tag?, release_date?, description_md?, is_current?, git_project?',
    desc: 'Partial-update существующего KnowRelease (только переданные поля). Удобно для добавления description_md / git_tag после выпуска.' },
  { name: 'lore_link_release', kind: 'write', backend: 'POST /lore/release/link',
    params: 'release_id, sprint_ids[], git_project',
    desc: 'Прикрепить спринты к релизу (IMPLEMENTED_IN_RELEASE edges). Использовать, когда спринт завершён и вошёл в релиз.' },
  { name: 'lore_link_release_pr', kind: 'write', backend: 'POST /lore/release/link',
    params: 'release_id, pr_numbers[], git_project',
    desc: 'Прикрепить PR к релизу (SHIPPED_IN edges, upsert KnowPR). Всегда передавать git_project для multi-repo корректности.' },
  { name: 'lore_unlink_release', kind: 'write', backend: 'POST /lore/release/unlink',
    params: 'release_id, git_project, sprint_ids?, pr_numbers?',
    desc: 'Удалить IMPLEMENTED_IN_RELEASE или SHIPPED_IN edges. Для исправления случайных двойных линков.' },
  { name: 'lore_move_to_project', kind: 'write', backend: 'POST /lore/project/move',
    params: 'entity_type, id, git_project',
    desc: 'Исправить git_project у PR или Release: перевешивает BELONGS_TO_PROJECT edge, обновляет pr_uid / release_uid. entity_type = pr | release.' },
];

const ENV_ROWS: [string, string, string][] = [
  ['LORE_BACKEND_URL', 'http://localhost:9100', 'Базовый URL backend UnlimitedLORE'],
  ['LORE_SEER_ROLE',   'admin',                 'Заголовок X-Seer-Role для write-инструментов'],
];

const SMOKE = `cd C:/AIDA/UnlimitedLORE/mcp-server
printf '%s\\n' \\
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \\
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \\
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \\
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lore_query_slice","arguments":{"slice":"plan_config"}}}' \\
 | node dist/index.js`;

const MCP_JSON = `{
  "mcpServers": {
    "aida-lore": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {
        "LORE_BACKEND_URL": "http://localhost:9100",
        "LORE_SEER_ROLE": "admin"
      }
    }
  }
}`;

export default function LoreMcpApiScreen() {
  const [slices, setSlices]   = useState<LoreSliceDescriptor[] | null>(null);
  const [health, setHealth]   = useState<'checking' | 'up' | 'down'>('checking');
  const [filter, setFilter]   = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSliceCatalog(ctrl.signal)
      .then(s => { setSlices(s); setHealth('up'); })
      .catch(() => { if (!ctrl.signal.aborted) setHealth('down'); });
    return () => ctrl.abort();
  }, []);

  const shownSlices = (slices ?? []).filter(s =>
    !filter || s.id.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div style={S.scroll}>
      <div style={S.wrap}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={S.head}>
          <h1 style={S.h1}>MCP-сервер <span style={{ color: 'var(--acc)' }}>aida-lore</span></h1>
          <HealthPill health={health} count={slices?.length} />
        </div>
        <p style={S.lead}>
          Прямой доступ ИИ-агента (Claude Desktop / Claude Code / Cursor) к движку
          LORE по протоколу MCP: читать план / спринты / ADR / решения / релизы и
          писать статусы и задачи — без ручного SQL. Сервер — тонкая обёртка над
          backend <code style={S.code}>:9100</code>; вся композиция SQL-слайсов и
          whitelisting остаётся на сервере.
        </p>

        {/* ── Pipeline ───────────────────────────────────────────────────────── */}
        <div style={S.pipe}>
          <Node>Claude</Node><Arrow label="stdio" />
          <Node accent>aida-lore-mcp</Node><Arrow label="HTTP" />
          <Node>backend :9100</Node><Arrow label="REST" />
          <Node>ArcadeDB :2480</Node>
        </div>

        {/* ── Tools ──────────────────────────────────────────────────────────── */}
        <Section title={`Инструменты (${TOOLS.length})`}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <Th>Инструмент</Th><Th>Тип</Th><Th>Backend-вызов</Th><Th>Параметры</Th><Th>Назначение</Th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map(t => (
                  <tr key={t.name} style={S.tr}>
                    <Td><code style={S.codeAcc}>{t.name}</code></Td>
                    <Td><KindTag kind={t.kind} /></Td>
                    <Td><code style={S.code}>{t.backend}</code></Td>
                    <Td><code style={S.code}>{t.params}</code></Td>
                    <Td style={{ color: 'var(--t2)' }}>{t.desc}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={S.note}>
            Write-инструменты идут с заголовком <code style={S.code}>X-Seer-Role: admin</code>,
            версионны (SCD2 — история не теряется) и мутируют общую{' '}
            <code style={S.code}>system_aida_lore</code> — применять осознанно.
            <code style={S.code}>lore_create_adr</code> создаёт полную SCD2-структуру:
            вершина + KnowADRHist (valid_to=null) + HAS_STATE edge — тело ADR читается
            именно из hist-строки.{' '}
            Партиальные (amend) вызовы <code style={S.code}>/lore/adr</code> и{' '}
            <code style={S.code}>/lore/spec</code> с 2026-07 безопасны — SQL SET собирается
            динамически, непереданное поле не трогается (раньше пропущенный параметр
            молча обнулялся). Из набора пока не реализован только{' '}
            <code style={S.code}>checkpoint</code> (бэкенд → 501).
            Инструменты по <b>Исследованиям</b> (витрина RAGVSDL) — на отдельной странице
            «MCP API» в разделе «Исследования» (<code style={S.code}>/benchmark?tab=mcp</code>).
          </p>
        </Section>

        {/* ── Live slice catalog ─────────────────────────────────────────────── */}
        <Section title={`Каталог слайсов${slices ? ` · ${slices.length}` : ''}`}>
          <p style={S.note}>
            То, что отдаёт <code style={S.codeAcc}>lore_list_slices</code> — живой
            whitelist параметризованных запросов. Каждый слайс зовётся через{' '}
            <code style={S.codeAcc}>lore_query_slice</code>.
          </p>
          {health === 'down' && (
            <div style={S.down}>
              backend <code style={S.code}>:9100</code> не отвечает — каталог
              недоступен. Поднять backend (см. «Эксплуатация» ниже).
            </div>
          )}
          {health === 'checking' && <div style={S.note}>Загрузка каталога…</div>}
          {slices && slices.length > 0 && (
            <>
              <input
                style={S.filter}
                placeholder="фильтр по имени слайса…"
                aria-label="фильтр слайсов"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
              <div style={S.chips}>
                {shownSlices.map(s => (
                  <span key={s.id} style={S.chip} title={paramHint(s)}>
                    <code style={S.codeAcc}>{s.id}</code>
                    {s.required.length > 0 && (
                      <span style={S.req}>({s.required.join(', ')})</span>
                    )}
                    {s.optional.length > 0 && (
                      <span style={S.opt}>[{s.optional.join(', ')}]</span>
                    )}
                  </span>
                ))}
                {shownSlices.length === 0 && <span style={S.note}>Ничего не найдено.</span>}
              </div>
            </>
          )}
        </Section>

        {/* ── Config ─────────────────────────────────────────────────────────── */}
        <Section title="Конфиг (env)">
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><Th>Переменная</Th><Th>Дефолт</Th><Th>Назначение</Th></tr></thead>
              <tbody>
                {ENV_ROWS.map(([k, v, d]) => (
                  <tr key={k} style={S.tr}>
                    <Td><code style={S.codeAcc}>{k}</code></Td>
                    <Td><code style={S.code}>{v}</code></Td>
                    <Td style={{ color: 'var(--t2)' }}>{d}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={S.note}>Регистрация у клиента (Claude Code) — <code style={S.code}>.mcp.json</code> в корне репо:</p>
          <Pre>{MCP_JSON}</Pre>
        </Section>

        {/* ── Ops ────────────────────────────────────────────────────────────── */}
        <Section title="Эксплуатация — поднять / поднять если упал">
          <ol style={S.ol}>
            <li>Проверить backend (частая причина «MCP не отвечает»):
              <Pre>curl http://localhost:9100/lore/slices   # ждём 200 + JSON-каталог</Pre>
            </li>
            <li>Если backend лежит — поднять его (Docker — рекомендуется):
              <Pre>{`cd C:/AIDA/UnlimitedLORE
$env:ARCADEDB_ROOT_PASSWORD='...'
docker compose up -d lore-backend     # backend на :9100`}</Pre>
            </li>
            <li>Собрать MCP-сервер (если не собран):
              <Pre>{`cd C:/AIDA/UnlimitedLORE/mcp-server
npm install && npm run build          # → dist/index.js`}</Pre>
            </li>
            <li>Клиент сам запускает процесс по stdio — отдельно «держать живым» не
              нужно. После правок <code style={S.code}>.mcp.json</code> или пересборки —
              перезапустить клиент.</li>
          </ol>
          <p style={S.note}>Смоук-тест без клиента (прямой stdio JSON-RPC):</p>
          <Pre>{SMOKE}</Pre>
        </Section>

        {/* ── Diagnostics ────────────────────────────────────────────────────── */}
        <Section title="Диагностика">
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><Th>Симптом</Th><Th>Причина</Th><Th>Что делать</Th></tr></thead>
              <tbody>
                {([
                  ['Инструменты есть, любой вызов = ошибка', 'backend :9100 не поднят', 'поднять backend'],
                  ['403 на write', 'нет/неверный X-Seer-Role', 'env LORE_SEER_ROLE=admin'],
                  ['MART_UPSTREAM / 500', 'ArcadeDB недоступен или неверный пароль', 'проверить :2480 и ARCADEDB_ROOT_PASSWORD'],
                  ['Сервер не стартует под клиентом', 'не собран dist/', 'npm run build в mcp-server'],
                ] as [string, string, string][]).map(([a, b, c]) => (
                  <tr key={a} style={S.tr}>
                    <Td style={{ color: 'var(--t1)' }}>{a}</Td>
                    <Td style={{ color: 'var(--t2)' }}>{b}</Td>
                    <Td style={{ color: 'var(--t2)' }}>{c}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <p style={S.foot}>
          Полный runbook: <code style={S.code}>C:/AIDA/docs/change/sprints/MCP_AIDA_LORE_SERVER.md</code>
          {' · '}код: <code style={S.code}>C:/AIDA/UnlimitedLORE/mcp-server/</code>
        </p>
      </div>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function paramHint(s: LoreSliceDescriptor): string {
  const r = s.required.length ? `обяз: ${s.required.join(', ')}` : '';
  const o = s.optional.length ? `опц: ${s.optional.join(', ')}` : '';
  return [r, o].filter(Boolean).join(' · ') || 'без параметров';
}

function HealthPill({ health, count }: { health: 'checking' | 'up' | 'down'; count?: number }) {
  const map = {
    checking: { c: 'var(--t3)', t: 'проверка…' },
    up:       { c: 'var(--suc)', t: `backend :9100 жив${count != null ? ` · ${count} слайсов` : ''}` },
    down:     { c: 'var(--dng)', t: 'backend :9100 не отвечает' },
  }[health];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11, padding: '3px 10px', borderRadius: 20,
      background: `color-mix(in srgb, ${map.c} 14%, transparent)`,
      color: map.c, border: `1px solid color-mix(in srgb, ${map.c} 35%, transparent)`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: map.c }} />
      {map.t}
    </span>
  );
}

function KindTag({ kind }: { kind: 'read' | 'write' }) {
  const c = kind === 'write' ? 'var(--wrn)' : 'var(--inf)';
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
      background: `color-mix(in srgb, ${c} 16%, transparent)`,
      color: c, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
    }}>{kind}</span>
  );
}

function Node({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span style={{
      padding: '4px 10px', borderRadius: 5, fontSize: 11, whiteSpace: 'nowrap',
      fontFamily: 'var(--mono)',
      background: accent ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'var(--b2)',
      color: accent ? 'var(--acc)' : 'var(--t2)',
      border: `1px solid ${accent ? 'color-mix(in srgb, var(--acc) 35%, transparent)' : 'var(--b3)'}`,
    }}>{children}</span>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', color: 'var(--t3)' }}>
      <span style={{ fontSize: 8, lineHeight: 1 }}>{label}</span>
      <span style={{ fontSize: 13, lineHeight: 1 }}>→</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={S.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={S.th}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ ...S.td, ...style }}>{children}</td>;
}
function Pre({ children }: { children: React.ReactNode }) {
  return <pre style={S.pre}>{children}</pre>;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  scroll:  { flex: 1, overflowY: 'auto', fontFamily: 'var(--font)' },
  wrap:    { maxWidth: 920, margin: '0 auto', padding: '22px 26px 60px' },
  head:    { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  h1:      { fontSize: 22, fontWeight: 700, fontFamily: 'var(--display)', color: 'var(--t1)' },
  h2:      { fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 10,
             paddingBottom: 5, borderBottom: '1px solid var(--bd)' },
  lead:    { marginTop: 12, fontSize: 13, lineHeight: 1.65, color: 'var(--t2)' },
  pipe:    { marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 6 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:      { textAlign: 'left', padding: '7px 10px', color: 'var(--t3)', fontWeight: 600,
             fontSize: 11, borderBottom: '1px solid var(--bd)', background: 'var(--b1)',
             whiteSpace: 'nowrap' },
  tr:      { borderBottom: '1px solid var(--bd)' },
  td:      { padding: '7px 10px', verticalAlign: 'top', color: 'var(--t1)' },
  note:    { marginTop: 10, fontSize: 12, lineHeight: 1.6, color: 'var(--t3)' },
  code:    { fontFamily: 'var(--mono)', fontSize: 11, padding: '1px 5px', borderRadius: 3,
             background: 'var(--b2)', color: 'var(--t2)' },
  codeAcc: { fontFamily: 'var(--mono)', fontSize: 11, padding: '1px 5px', borderRadius: 3,
             background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)' },
  pre:     { marginTop: 8, padding: '10px 12px', borderRadius: 6, overflowX: 'auto',
             background: 'var(--b1)', border: '1px solid var(--bd)',
             fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.6, color: 'var(--t2)',
             whiteSpace: 'pre' },
  ol:      { marginTop: 4, paddingLeft: 20, fontSize: 12.5, lineHeight: 1.7, color: 'var(--t2)',
             display: 'flex', flexDirection: 'column', gap: 6 },
  filter:  { marginTop: 10, width: '100%', maxWidth: 320, height: 28, padding: '0 10px',
             background: 'var(--b1)', border: '1px solid var(--b3)', borderRadius: 5,
             color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit', outline: 'none' },
  chips:   { marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip:    { display: 'inline-flex', alignItems: 'center', gap: 4,
             padding: '3px 4px', borderRadius: 4, background: 'var(--b1)',
             border: '1px solid var(--bd)' },
  req:     { fontSize: 10, color: 'var(--wrn)' },
  opt:     { fontSize: 10, color: 'var(--t3)' },
  down:    { marginTop: 10, padding: '10px 12px', borderRadius: 6, fontSize: 12,
             background: 'color-mix(in srgb, var(--dng) 10%, transparent)',
             border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)',
             color: 'var(--t2)' },
  foot:    { marginTop: 30, fontSize: 11, color: 'var(--t3)', lineHeight: 1.7,
             paddingTop: 12, borderTop: '1px solid var(--bd)' },
};
