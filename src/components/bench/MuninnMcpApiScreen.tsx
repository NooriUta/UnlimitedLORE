// MuninnMcpApiScreen — published API reference for MUNINN (Исследования)
// side of the aida-lore MCP server. Separate page from the LORE MCP reference
// (which lives at /lore?section=mcp). Documents the planned bench tools, pings
// the live bench backend for health + the real mart-slice catalog.
import { useEffect, useState } from 'react';
import {
  fetchMartCatalog, fetchMuninnStatus,
  type MartSliceDescriptor,
} from '../../api/muninn';
import type { MuninnStatus } from '../../utils/muninnData';

interface ToolDoc {
  name: string;
  state: 'live' | 'planned';
  backend: string;
  params: string;
  desc: string;
}

// Read tools mirror the LORE read tools 1:1 — the backend already serves them;
// the MCP wrappers are Phase 2 (mcp-server/src/tools/bench.ts, currently a stub).
const TOOLS: ToolDoc[] = [
  { name: 'bench_list_slices', state: 'live', backend: 'GET /bench/mart/slices', params: '—',
    desc: 'Каталог именованных слайсов витрины эксперимента RAGVSDL с их параметрами. Вызывать первым — узнать, что можно запросить (campaigns, hypotheses, findings, runs, trace, substrates, references, biblio…).' },
  { name: 'bench_query_slice', state: 'live', backend: 'GET /bench/mart/slice/{slice}', params: 'slice, params?',
    desc: 'Выполнить слайс витрины и получить rows[]. params — map строк, напр. {"run":"…","case_id":"…","substrate":"…"} для slice "trace". SQL и whitelisting — на бэкенде.' },
  { name: 'bench_status', state: 'live', backend: 'GET /bench/api/status', params: '—',
    desc: 'Живой STATUS.json текущего прогона эксперимента: manifest, done/total, current, errors, elapsed_min, updated.' },
];

const MCP_JSON = `{
  "mcpServers": {
    "aida-lore": {
      "command": "node",
      "args": ["C:/AIDA/UnlimitedLORE/mcp-server/dist/index.js"],
      "env": {
        "LORE_BACKEND_URL": "http://localhost:9100",
        "LORE_SEER_ROLE": "admin"
      }
    }
  }
}`;

export default function MuninnMcpApiScreen() {
  const [slices, setSlices] = useState<MartSliceDescriptor[] | null>(null);
  const [status, setStatus] = useState<MuninnStatus | null>(null);
  const [health, setHealth] = useState<'checking' | 'up' | 'down'>('checking');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetchMartCatalog(ctrl.signal),
      fetchMuninnStatus(ctrl.signal).catch(() => null),
    ])
      .then(([cat, st]) => { setSlices(cat); setStatus(st); setHealth('up'); })
      .catch(() => { if (!ctrl.signal.aborted) setHealth('down'); });
    return () => ctrl.abort();
  }, []);

  const shown = (slices ?? []).filter(s =>
    !filter || s.id.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div style={S.scroll}>
      <div style={S.wrap}>

        <div style={S.head}>
          <h1 style={S.h1}>MCP · <span style={{ color: 'var(--acc)' }}>Исследования</span></h1>
          <HealthPill health={health} count={slices?.length} />
        </div>
        <p style={S.lead}>
          BENCHMARK-сторона того же MCP-сервера <code style={S.codeAcc}>aida-lore</code>:
          доступ ИИ-агента к витрине эксперимента <b>RAG vs Parse</b> (база RAGVSDL)
          по протоколу MCP. Инструменты по LORE (план/спринты/ADR) — на{' '}
          <b>отдельной</b> странице «MCP API» в разделе «Проекты»
          (<code style={S.code}>/lore?section=mcp</code>). Сервер один, конфиг общий.
        </p>

        <div style={S.pipe}>
          <Node>Claude</Node><Arrow label="stdio" />
          <Node accent>aida-lore-mcp</Node><Arrow label="HTTP" />
          <Node>backend :9100</Node><Arrow label="REST" />
          <Node>ArcadeDB · RAGVSDL</Node>
        </div>

        <Section title="Инструменты (bench)">
          <div style={S.banner}>
            Read-инструменты <b>реализованы</b> (<code style={S.code}>mcp-server/src/tools/muninn.ts</code>) —
            после пересборки <code style={S.code}>npm run build</code> и перезапуска клиента доступны как
            <code style={S.code}>bench_*</code>. Витрина пишется только Python-движком
            <code style={S.code}>rag-vs-parse/scripts/mart.py</code>; эти тулзы — только чтение.
            Write-инструменты (кампании/гипотезы/прогоны) — отдельно, по спеке.
          </div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><Th>Инструмент</Th><Th>Статус</Th><Th>Backend-вызов</Th><Th>Параметры</Th><Th>Назначение</Th></tr></thead>
              <tbody>
                {TOOLS.map(t => (
                  <tr key={t.name} style={S.tr}>
                    <Td><code style={S.codeAcc}>{t.name}</code></Td>
                    <Td><StateTag state={t.state} /></Td>
                    <Td><code style={S.code}>{t.backend}</code></Td>
                    <Td><code style={S.code}>{t.params}</code></Td>
                    <Td style={{ color: 'var(--t2)' }}>{t.desc}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Live run status */}
        <Section title="Статус прогона">
          {health === 'down' && (
            <div style={S.down}>backend <code style={S.code}>:9100</code> не отвечает — статус недоступен.</div>
          )}
          {health === 'checking' && <div style={S.note}>Загрузка…</div>}
          {status && (
            <div style={S.statusGrid}>
              <Stat k="manifest" v={status.manifest ?? '—'} />
              <Stat k="прогресс" v={`${status.done ?? 0} / ${status.total ?? 0}`} />
              <Stat k="current" v={String(status.current ?? '—')} />
              <Stat k="ошибок" v={String((status.errors ?? []).length)} />
              <Stat k="elapsed" v={status.elapsed_min != null ? `${status.elapsed_min} мин` : '—'} />
              <Stat k="updated" v={status.updated ?? '—'} />
            </div>
          )}
          {health === 'up' && !status && (
            <div style={S.note}>STATUS.json недоступен (нет активного прогона) — каталог витрины ниже всё равно живой.</div>
          )}
        </Section>

        {/* Live mart-slice catalog */}
        <Section title={`Каталог витрины${slices ? ` · ${slices.length}` : ''}`}>
          <p style={S.note}>
            То, что отдал бы <code style={S.codeAcc}>bench_list_slices</code> — живой
            whitelist слайсов RAGVSDL. Каждый зовётся через{' '}
            <code style={S.codeAcc}>bench_query_slice</code>.
          </p>
          {health === 'down' && <div style={S.down}>каталог недоступен — backend не отвечает.</div>}
          {slices && slices.length > 0 && (
            <>
              <input style={S.filter} placeholder="фильтр по имени слайса…"
                aria-label="фильтр слайсов" value={filter} onChange={e => setFilter(e.target.value)} />
              <div style={S.chips}>
                {shown.map(s => (
                  <span key={s.id} style={S.chip} title={paramHint(s)}>
                    <code style={S.codeAcc}>{s.id}</code>
                    {s.required.length > 0 && <span style={S.req}>({s.required.join(', ')})</span>}
                    {s.optional.length > 0 && <span style={S.opt}>[{s.optional.join(', ')}]</span>}
                  </span>
                ))}
                {shown.length === 0 && <span style={S.note}>Ничего не найдено.</span>}
              </div>
            </>
          )}
        </Section>

        <Section title="Конфиг (env)">
          <p style={S.note}>
            Один сервер на LORE + bench — тот же <code style={S.code}>.mcp.json</code>
            (абсолютный путь к <code style={S.code}>dist/index.js</code> работает и для
            Claude Desktop, и для Claude Code):
          </p>
          <Pre>{MCP_JSON}</Pre>
        </Section>

        <p style={S.foot}>
          Полный runbook: <code style={S.code}>C:/AIDA/docs/change/sprints/MCP_AIDA_LORE_SERVER.md</code>
          {' · '}код: <code style={S.code}>C:/AIDA/UnlimitedLORE/mcp-server/</code>
        </p>
      </div>
    </div>
  );
}

// ── building blocks ───────────────────────────────────────────────────────────
function paramHint(s: MartSliceDescriptor): string {
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
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11,
      padding: '3px 10px', borderRadius: 20,
      background: `color-mix(in srgb, ${map.c} 14%, transparent)`, color: map.c,
      border: `1px solid color-mix(in srgb, ${map.c} 35%, transparent)`, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: map.c }} />
      {map.t}
    </span>
  );
}

function StateTag({ state }: { state: 'live' | 'planned' }) {
  const c = state === 'live' ? 'var(--suc)' : 'var(--wrn)';
  const label = state === 'live' ? 'live' : 'план';
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
      background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c,
      border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
    }}>{label}</span>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: 'var(--t3)' }}>{k}</span>
      <span style={{ fontSize: 12, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  );
}

function Node({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span style={{
      padding: '4px 10px', borderRadius: 5, fontSize: 11, whiteSpace: 'nowrap', fontFamily: 'var(--mono)',
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
function Th({ children }: { children: React.ReactNode }) { return <th style={S.th}>{children}</th>; }
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ ...S.td, ...style }}>{children}</td>;
}
function Pre({ children }: { children: React.ReactNode }) { return <pre style={S.pre}>{children}</pre>; }

const S: Record<string, React.CSSProperties> = {
  scroll:  { flex: 1, overflowY: 'auto', fontFamily: 'var(--font)' },
  wrap:    { maxWidth: 920, margin: '0 auto', padding: '22px 26px 60px' },
  head:    { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  h1:      { fontSize: 22, fontWeight: 700, fontFamily: 'var(--display)', color: 'var(--t1)' },
  h2:      { fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--b2)' },
  lead:    { marginTop: 12, fontSize: 13, lineHeight: 1.65, color: 'var(--t2)' },
  pipe:    { marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  banner:  { padding: '8px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.55, marginBottom: 10,
             background: 'color-mix(in srgb, var(--wrn) 10%, transparent)',
             border: '1px solid color-mix(in srgb, var(--wrn) 30%, transparent)', color: 'var(--t2)' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--b2)', borderRadius: 6 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:      { textAlign: 'left', padding: '7px 10px', color: 'var(--t3)', fontWeight: 600, fontSize: 11,
             borderBottom: '1px solid var(--b2)', background: 'var(--b1)', whiteSpace: 'nowrap' },
  tr:      { borderBottom: '1px solid var(--b2)' },
  td:      { padding: '7px 10px', verticalAlign: 'top', color: 'var(--t1)' },
  note:    { marginTop: 10, fontSize: 12, lineHeight: 1.6, color: 'var(--t3)' },
  code:    { fontFamily: 'var(--mono)', fontSize: 11, padding: '1px 5px', borderRadius: 3, background: 'var(--b2)', color: 'var(--t2)' },
  codeAcc: { fontFamily: 'var(--mono)', fontSize: 11, padding: '1px 5px', borderRadius: 3,
             background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)' },
  pre:     { marginTop: 8, padding: '10px 12px', borderRadius: 6, overflowX: 'auto', background: 'var(--b1)',
             border: '1px solid var(--b2)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.6, color: 'var(--t2)', whiteSpace: 'pre' },
  filter:  { marginTop: 10, width: '100%', maxWidth: 320, height: 28, padding: '0 10px', background: 'var(--b1)',
             border: '1px solid var(--b3)', borderRadius: 5, color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit', outline: 'none' },
  chips:   { marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip:    { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 4px', borderRadius: 4, background: 'var(--b1)', border: '1px solid var(--b2)' },
  req:     { fontSize: 10, color: 'var(--wrn)' },
  opt:     { fontSize: 10, color: 'var(--t3)' },
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12,
                padding: '12px', border: '1px solid var(--b2)', borderRadius: 6, background: 'var(--b1)' },
  down:    { marginTop: 10, padding: '10px 12px', borderRadius: 6, fontSize: 12,
             background: 'color-mix(in srgb, var(--dng) 10%, transparent)',
             border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)', color: 'var(--t2)' },
  foot:    { marginTop: 30, fontSize: 11, color: 'var(--t3)', lineHeight: 1.7, paddingTop: 12, borderTop: '1px solid var(--b2)' },
};
