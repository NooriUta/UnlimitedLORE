import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type KcState } from '../kc-state';
import type { DictRow, KcUser, KcAgent, Preflight } from './types';
import { S } from './adminStyles';
import { NotEnforcedNotice } from './adminWidgets';

// RBAC scope per ADR-LORE-014 §3 (agent-profiles — файлы; read-only отображение).
const PROFILE_SCOPE: [string, string][] = [
  ['full', '"*": allow (primary — Claude/backfill)'],
  ['architect', 'adr_* · component_* · tech_* · spec_* · runbook_* · doc_* · decision_* · question_* · feature_* · uc_* · project_new · status_set'],
  ['developer', 'task_* · release_* · tech_* · spec_* · runbook_* · doc_* · adr_new · status_set · кроме doc_del · spec_del · release_mv'],
  ['tester', 'qg_* · task_* · status_set · status_set_batch'],
  ['pm', 'sprint_* · task_* · milestone_* · question_* · feature_* · uc_* · project_new · status_set · status_set_batch'],
  ['analyst', 'metric_* · insight_* · rec_* · question_* · task_set · status_set'],
  ['marketer', 'bragi_* · task_* · insight_* · rec_* · doc_* · status_set · кроме doc_del'],
];

// Обратная матрица (AL-32/36, SPEC-RBAC-OMILORE-AGENTS §4): «кто имеет доступ к X» —
// вопрос, который задают на ревью доступа. humanOnly-строки = запрет §4.
const REVERSE_MATRIX: { what: string; api: string; humanOnly: boolean; agents: string[] }[] = [
  { what: 'Словари', api: '/lore/dict/entry', humanOnly: true, agents: [] },
  { what: 'Учётные записи', api: '/lore/kc/*', humanOnly: true, agents: [] },
  // Решение владельца 30.08.2026: «раз full наследует от admin, то разрешается
  // только роли full». Строки в матрице не было ВООБЩЕ — путь человеческий, а
  // ревью доступа по этой таблице о нём молчало. Теперь он и открыт, и виден.
  //
  // Открыт ПОДПУТЬ, а не семейство: остальной /lore/user остаётся человеческим,
  // поэтому строка выше про учётные записи не меняется.
  { what: 'Роли в проектах', api: '/lore/user/role', humanOnly: false, agents: ['full'] },
  { what: 'Включение auth', api: 'LORE_AUTH_ENABLED', humanOnly: true, agents: [] },
  // AL-47 (регресс-гвард поймал): полная переиндексация корпуса документов, была
  // защищена только ролью admin — а её несут все семь узких агентных профилей.
  { what: 'Переиндексация корпуса', api: '/lore/admin/lore/ingest', humanOnly: true, agents: [] },
  { what: 'ADR', api: '/lore/adr*', humanOnly: false, agents: ['full', 'architect', 'developer'] },
  { what: 'Решения', api: '/lore/decision*', humanOnly: false, agents: ['full', 'architect'] },
  { what: 'Спеки/ранбуки/доки', api: '/lore/spec*, runbook*, doc*', humanOnly: false, agents: ['full', 'architect', 'developer', 'marketer'] },
  { what: 'Спринты и вехи', api: '/lore/sprint*, milestone*', humanOnly: false, agents: ['full', 'pm'] },
  { what: 'Задачи', api: '/lore/task*', humanOnly: false, agents: ['full', 'pm', 'developer', 'tester', 'marketer', 'analyst', 'architect', 'product-analyst'] },
  { what: 'Релизы', api: '/lore/release*', humanOnly: false, agents: ['full', 'developer'] },
  { what: 'Quality gates', api: '/lore/qg*', humanOnly: false, agents: ['full', 'tester'] },
  // QUAL-7: POST по форме, но ничего не пишет — спрашивает вердикт полноты по
  // существующим записям (метод выбран из-за списка id, не влезающего в URL).
  // Открыт всем профилям: узнать, чего не хватает в своей записи, обязан мочь
  // каждый, кто эти записи заводит.
  { what: 'Проверка полноты (без записи)', api: '/lore/quality', humanOnly: false,
    agents: ['full', 'architect', 'developer', 'pm', 'marketer', 'analyst', 'product-analyst', 'tester'] },
  { what: 'Вопросы', api: '/lore/question*', humanOnly: false, agents: ['full', 'architect', 'analyst', 'pm', 'product-analyst'] },
  // Метрики/Инсайты/Рекомендации СНЯТЫ (AL-47, регресс-гвард AgentScopeMatrixCoverageTest
  // поймал расхождение с бэкендом): metric_log/insight_new пишут в /lore/bragi/metric и
  // /lore/bragi/insight (строка «Публикации BRAGI» ниже), rec_new/rec_promote — в
  // /lore/qg/recommendation (строка «Гейты качества»). Отдельного /lore/metric|insight|rec
  // не существует — строки показывали права на несуществующий путь.
  // Продуктовый слой (ADR-LORE-022/030/032). Владелец — product-analyst, восьмой
  // профиль: он курирует VP-канву. До AL-17 эти строки в матрице отсутствовали, и
  // писать в них мог любой профиль — проверять было нечему.
  { what: 'Фичи', api: '/lore/feature*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'US (сценарии)', api: '/lore/uc*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'Боли', api: '/lore/pain*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst', 'marketer'] },
  { what: 'Ожидания', api: '/lore/gain*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst', 'marketer'] },
  { what: 'Работы', api: '/lore/job*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst', 'marketer'] },
  { what: 'VP-связи', api: '/lore/vp*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  // Две строки, а не одна: ADR-LORE-041 §4 развёл ЛИЧНОСТЬ и ОПИСАНИЕ по разным
  // типам вершин, и права у них разные. Слитая строка врала бы про обе — именно
  // такая слитность и дала дефект: RBAC-гейт личности резал описательную работу.
  { what: 'Агентные личности', api: '/lore/actor*', humanOnly: false, agents: ['full', 'architect', 'pm'] },
  { what: 'Акторы проектов', api: '/lore/project-actor', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  // Продуктовая ОСЬ (RM-P6) — не путать с продуктовым СЛОЕМ выше: там ценность
  // (Feature → UseCase), здесь «что мы делаем и продаём», носитель дорожной карты.
  // Сам продукт — запись справочника (dict_type='product'), поэтому его создание
  // идёт строкой «Словари» и остаётся за человеком; здесь только рёбра.
  { what: 'Продукты (ось)', api: '/lore/product/link', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'Компоненты', api: '/lore/component*', humanOnly: false, agents: ['full', 'architect'] },
  // Тех-реестр СНЯТ (AL-47, тем же гвардом): tech_set пишет через существующий
  // spec-upsert путь (/lore/spec, spec_id="SPEC-TECH-…") — строка «Спеки/ранбуки/доки» выше.
  // AL-84/ADR-LORE-025-D17, поправка 2026-08-11: строка была неверна ещё ДО этой
  // правки (заявляла architect/pm, а бэкенд не пускал вовсе — семейство сидело в
  // HUMAN_ONLY) и молчала, потому что coverage-тест пропускает пустые backend-сеты.
  // Теперь бэкенд взаправду допускает РОВНО full — строка выровнена по факту.
  // SE-11 (20.10.2026, D-2026-LORE-AGENT-MATRIX-WIDEN-PROFILES): плюс architect и pm —
  // их профили обещали project_new, а не пускал ни фильтр, ни замок в ресурсе.
  { what: 'Проекты', api: '/lore/project*', humanOnly: false, agents: ['full', 'architect', 'pm'] },
  { what: 'Публикации BRAGI', api: '/lore/bragi*', humanOnly: false, agents: ['full', 'marketer'] },
  // SE-11, точечные расширения (AgentScopeFilter.SUBPATH_GRANTS): подпуть открыт профилям,
  // которым семейство целиком не положено — аналитику не отдаются публикации BRAGI,
  // маркетологу — сами гейты качества. Подписчики = семейство + расширение.
  { what: 'Инсайты и метрики', api: '/lore/bragi/insight, /lore/bragi/metric', humanOnly: false, agents: ['full', 'marketer', 'analyst', 'product-analyst'] },
  { what: 'Рекомендации гейтов', api: '/lore/qg/recommendation, /lore/qg/promote', humanOnly: false, agents: ['full', 'tester', 'analyst', 'product-analyst', 'marketer'] },
  // AL-62: три семейства имели живой POST, но в матрице отсутствовали и попадали
  // в ветку «неизвестное — пропускаю». Держать синхронно с FAMILY_AGENTS в
  // AgentScopeFilter: расхождение = экран показывает не те права, что применяются.
  { what: 'Forgejo (PR, мерж)', api: '/lore/forgejo*', humanOnly: false, agents: ['full'] },
  { what: 'Файлы-ассеты', api: '/lore/asset*', humanOnly: false, agents: ['full'] },
  { what: 'Гейты качества', api: '/lore/quality-gate*, qg*', humanOnly: false, agents: ['full', 'tester'] },
  { what: 'Чтение (слайсы)', api: '/lore/slice/*', humanOnly: false, agents: ['все агенты'] },
];

// ── Роли и права: обе оси + обратная матрица (AL-32) ─────────────────────────
export function RolesTab({ dicts, users, agents, preflight }: {
  dicts: DictRow[]; users: KcState<KcUser>; agents: KcState<KcAgent>; preflight: Preflight | null;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'by-role' | 'by-object'>('by-role');
  const agentRoles = dicts.filter(r => r.dict_type === 'agent_profile');
  const humanCounts = useMemo(() => {
    if (users.k !== 'ok') return null;
    const m: Record<string, string[]> = { 'super-admin': [], admin: [], viewer: [] };
    users.rows.filter(u => u.enabled).forEach(u => (u.roles ?? []).forEach(r => { if (m[r]) m[r].push(u.username); }));
    return m;
  }, [users]);
  const agentByScope = useMemo(() => {
    if (agents.k !== 'ok') return null;
    const m: Record<string, string> = {};
    agents.rows.forEach(a => a.agent_scope.forEach(s => { m[s.replace(/^agent-/, '')] = a.clientId; }));
    return m;
  }, [agents]);

  const holders = (r: string) => humanCounts
    ? (humanCounts[r].length ? `${humanCounts[r].length} · ${humanCounts[r].join(', ')}` : 'никому')
    : 'н/д (KC недоступен)';

  return (
    <div>
      <div style={S.card}>{t('lore.admin.rolesNote2', 'Две оси, которые не смешиваются: люди входят паролем и несут realm-роли (seer_roles), агенты — секретом и несут agent_scope. Скоуп агентов правится в mcp-server/agent-profiles/*.json (D6, read-only здесь).')}</div>
      <NotEnforcedNotice pf={preflight} />
      <div style={{ marginBottom: 8 }}>
        <span style={S.seg}>
          <button style={S.segBtn(mode === 'by-role')} onClick={() => setMode('by-role')}>{t('lore.admin.byRole', 'Кто что может')}</button>
          <button style={S.segBtn(mode === 'by-object')} onClick={() => setMode('by-object')}>{t('lore.admin.byObject', 'Кто имеет доступ к…')}</button>
        </span>
      </div>

      {mode === 'by-role' && (
        <>
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['люди · realm-роль', 'что даёт', 'где назначается', 'кому выдана'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                <tr>
                  <td style={S.td}><span style={S.pill('var(--dng)')}>super-admin</span></td>
                  <td style={S.td}>{t('lore.admin.superAdminGives', 'Всё, включая выдачу admin')}</td>
                  <td style={S.td}>{t('lore.admin.kcConsoleOnly', 'Только консоль Keycloak (D11)')}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{holders('super-admin')}</td>
                </tr>
                <tr>
                  <td style={S.td}><span style={S.pill('var(--dng)')}>admin</span></td>
                  <td style={S.td}>{t('lore.admin.adminGives', 'Администрирование: люди, словари, настройки, включение auth')}</td>
                  <td style={S.td}>{t('lore.admin.herePeople', 'Здесь → Люди')}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{holders('admin')}</td>
                </tr>
                <tr>
                  <td style={S.td}><span style={S.pill('var(--t2)')}>viewer</span></td>
                  <td style={S.td}>{t('lore.admin.viewerGives', 'Только чтение LORE. В администрирование не пускает')}</td>
                  <td style={S.td}>{t('lore.admin.herePeople', 'Здесь → Люди')}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{holders('viewer')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ height: 12 }} />
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['агенты · роль', 'label (словарь)', 'что может писать', 'клиент'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {PROFILE_SCOPE.map(([p, allow]) => (
                  <tr key={p}>
                    <td style={S.td}><span style={S.pill('var(--inf)')}>agent-{p}</span></td>
                    <td style={S.td}>{agentRoles.find(r => r.code === p)?.label_ru ?? '—'}</td>
                    <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{allow}</td>
                    <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{agentByScope ? (agentByScope[p] ?? '—') : 'н/д'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === 'by-object' && (
        <>
          <div style={S.card}>{t('lore.admin.byObjectNote', 'Обратный вопрос — тот, который задают на ревью доступа: кто может трогать вот это? Красным подсвечены операции, доступные только людям (§4 спеки RBAC).')}</div>
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['что', 'люди', 'агенты'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {REVERSE_MATRIX.map(r => (
                  <tr key={r.what} style={r.humanOnly ? { background: 'color-mix(in srgb, var(--dng) 7%, transparent)' } : undefined}>
                    <td style={S.td}>
                      <b style={{ color: 'var(--t1)' }}>{r.what}</b>{' '}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{r.api}</span>
                    </td>
                    <td style={S.td}>
                      <span style={S.pill('var(--dng)')}>admin</span>
                      {r.what === 'Чтение (слайсы)' && <span style={{ ...S.pill('var(--t2)'), marginLeft: 4 }}>viewer</span>}
                    </td>
                    <td style={S.td}>
                      {r.humanOnly
                        ? <span style={{ color: 'var(--t3)' }}>{t('lore.admin.noAgents', 'никто — запрещено всем агентам, включая agent-full')}</span>
                        : r.agents.map(a => <span key={a} style={{ ...S.pill('var(--inf)'), marginRight: 4 }}>{a}</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
