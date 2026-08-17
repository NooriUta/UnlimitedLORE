// AN-10 (ADR-LORE-030, экран 8 прототипа PL-01): вкладка «Аналитика →
// Продуктовый слой». Ни одна цифра не вводится руками — всё вычислено из графа.
// Порядок блоков — как в прототипе: гигиена (E) ПЕРВОЙ («пока тут не ноль —
// остальные цифры врут»), затем VP-таблица, затем срезы A/B/D/F, затем честные
// заглушки C/G/I «включаются позже» и ссылка H в реестр акторов.
//
// Данные грузятся лениво: компонент монтируется только при активации вкладки
// (диспетчер LoreAnalytics), поэтому обычный useEffect и есть отложенная
// загрузка — в общий Promise.all из 16 слайсов экрана не добавляемся.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  fetchLoreSlice, fetchUcQualityAll, fetchLoreSelfCheck,
  type LoreActorLoadRow, type LoreCoverageFindingRow,
  type LoreInvestProfileRow, type LoreUcQualityAllRow, type LoreVpAnalyticsRow,
  type LoreSelfCheckRun, type LoreSelfCheckFinding,
} from '../../api/lore';
import { investShares, investCoverage, mergeActorLoad, vpFit, type VpFit } from './analyticsProduct';
import { useProjectScope } from '../../context/ProjectScopeContext';
import { GameIcon } from './GameIcon';
import { ListSearch, FilterChips } from './product/shared';

const WC_COLOR: Record<string, string> = {
  // Палитра work_class из прототипа — СВОЯ, не пересекается со статусами.
  uc: 'var(--inf)', jtd: 'var(--wrn)', enb: 'var(--acc)', none: 'var(--t3)',
};

interface Props { onError: (e: unknown) => void }

export default function LoreAnalyticsProduct({ onError }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { project, projects } = useProjectScope();

  const [vpRows, setVpRows] = useState<LoreVpAnalyticsRow[]>([]);
  const [hygiene, setHygiene] = useState<LoreCoverageFindingRow[]>([]);
  const [coverage, setCoverage] = useState<LoreCoverageFindingRow[]>([]);
  const [invest, setInvest] = useState<LoreInvestProfileRow[]>([]);
  const [actorLoad, setActorLoad] = useState<LoreActorLoadRow[]>([]);
  const [quality, setQuality] = useState<{ threshold: number; rows: LoreUcQualityAllRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  // По срезу на исход: падение одного не гасит остальные (урок AL-85).
  const [failed, setFailed] = useState<string[]>([]);
  const [openFit, setOpenFit] = useState<string | null>(null);
  const [openQuality, setOpenQuality] = useState(false);
  // AL-115: список нарушений гигиены рос молча — 489 строк без единого способа
  // сузить выборку, единственный список в приложении без поиска/фильтра.
  const [hygieneSearch, setHygieneSearch] = useState('');
  const [hygieneFilter, setHygieneFilter] = useState<string>('all');

  // MT-10: самопроверка — ПО КНОПКЕ, не в общий Promise.allSettled выше. Девять
  // сверок дороже шести обычных срезов (три ходят построчно по всем задачам/
  // ADR/UC корпуса), и включать их в каждую загрузку вкладки значило бы платить
  // эту цену, даже когда никто не смотрит на панель самопроверки.
  const [selfCheck, setSelfCheck] = useState<LoreSelfCheckRun | null>(null);
  const [selfCheckLoading, setSelfCheckLoading] = useState(false);
  const [selfCheckError, setSelfCheckError] = useState(false);
  const [openCheck, setOpenCheck] = useState<string | null>(null);

  const runSelfCheck = () => {
    setSelfCheckLoading(true);
    setSelfCheckError(false);
    fetchLoreSelfCheck()
      .then(r => setSelfCheck(r))
      .catch(e => { setSelfCheckError(true); onError(e); })
      .finally(() => setSelfCheckLoading(false));
  };

  const goFinding = (f: LoreSelfCheckFinding) => {
    if (!f.section) return;
    navigate(`/lore?section=${f.section}&passport=${encodeURIComponent(f.passport)}`);
  };

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setFailed([]);
    // Срез A требует project (D18): выбран скоуп — один вызов; «все проекты» —
    // вызов на каждый slug из git_projects и слияние (дедуп в mergeActorLoad).
    const actorSlugs = project ? [project] : projects.map(p => p.slug);
    Promise.allSettled([
      fetchLoreSlice<LoreVpAnalyticsRow>('feature_vp_analytics', undefined, ctrl.signal),
      fetchLoreSlice<LoreCoverageFindingRow>('product_hygiene', undefined, ctrl.signal),
      fetchLoreSlice<LoreCoverageFindingRow>('strategic_coverage', undefined, ctrl.signal),
      fetchLoreSlice<LoreInvestProfileRow>('invest_profile', undefined, ctrl.signal),
      Promise.all(actorSlugs.map(slug =>
        fetchLoreSlice<LoreActorLoadRow>('actor_load', { project: slug }, ctrl.signal))),
      fetchUcQualityAll(ctrl.signal),
    ]).then(([vp, hyg, cov, inv, act, q]) => {
      if (ctrl.signal.aborted) return;
      const bad: string[] = [];
      if (vp.status === 'fulfilled') setVpRows(vp.value); else bad.push('VP');
      if (hyg.status === 'fulfilled') setHygiene(hyg.value); else bad.push('E');
      if (cov.status === 'fulfilled') setCoverage(cov.value); else bad.push('B');
      if (inv.status === 'fulfilled') setInvest(inv.value); else bad.push('D');
      if (act.status === 'fulfilled') setActorLoad(mergeActorLoad(act.value)); else bad.push('A');
      if (q.status === 'fulfilled') setQuality(q.value); else bad.push('F');
      setFailed(bad);
      if (bad.length) onError(
        [vp, hyg, cov, inv, act, q].find(r => r.status === 'rejected' && (r as PromiseRejectedResult).reason)
          ? ([vp, hyg, cov, inv, act, q].find(r => r.status === 'rejected') as PromiseRejectedResult).reason
          : new Error('product analytics load failed'));
      setLoading(false);
    });
    return () => ctrl.abort();
  }, [project, projects, onError]);

  const fits = useMemo(() => {
    const m = new Map<string, VpFit>();
    vpRows.forEach(r => m.set(r.uc_id, vpFit(r)));
    return m;
  }, [vpRows]);

  const avgFit = useMemo(() => {
    const vals = [...fits.values()].filter(f => f.total > 0).map(f => f.closed / f.total);
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) : 0;
  }, [fits]);

  const shares = useMemo(() => investShares(invest), [invest]);
  const classCoverage = useMemo(() => investCoverage(invest), [invest]); // MT-02
  const belowThreshold = useMemo(() => (quality?.rows ?? []).filter(r => r.below_threshold), [quality]);
  const covNoMs = coverage.filter(c => c.finding === 'feature_without_milestone');
  const covNoFeat = coverage.filter(c => c.finding === 'milestone_without_features');

  const goFeature = (id: string) => navigate(`/lore?section=features&passport=${encodeURIComponent(id)}`);
  const goSprint = (id: string) => navigate(`/lore?section=sprints&passport=${encodeURIComponent(id)}`);

  if (loading) return <div style={S.hint}>{t('lore.analytics.product.loading', 'загрузка продуктового слоя…')}</div>;

  const hygieneFindingLabel = (f: string) => t(`lore.analytics.product.finding.${f}`, {
    uc_task_without_realizes: 'uc-задача без REALIZES',
    enb_task_without_justification: 'enb-задача без ADR',
    uc_without_acceptance: 'UC без приёмки',
    pain_without_relief: 'боль без снятия',
  }[f] ?? f);

  // AL-115: фасет собирается из встреченных `finding` — как проектный фасет в
  // LoreActors.tsx (не жёсткий список), иначе новый тип нарушения появится в
  // данных раньше, чем в чипах фильтра, и будет невидим до правки кода.
  const hygieneFindingCounts = new Map<string, number>();
  hygiene.forEach(h => hygieneFindingCounts.set(h.finding, (hygieneFindingCounts.get(h.finding) ?? 0) + 1));
  const hygieneFilterDefs = [
    { key: 'all', label: `${t('lore.analytics.product.hygieneAll', 'все')} ${hygiene.length}` },
    ...[...hygieneFindingCounts.entries()].map(([f, n]) => ({ key: f, label: `${hygieneFindingLabel(f)} ${n}` })),
  ];
  const hygieneQuery = hygieneSearch.trim().toLowerCase();
  const filteredHygiene = hygiene.filter(h => {
    if (hygieneFilter !== 'all' && h.finding !== hygieneFilter) return false;
    if (!hygieneQuery) return true;
    return h.ref_id.toLowerCase().includes(hygieneQuery) || (h.title ?? '').toLowerCase().includes(hygieneQuery);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {failed.length > 0 && (
        <div style={S.errBanner}>
          {t('lore.analytics.product.partialError', 'Часть срезов не загрузилась ({{list}}) — их плитки пусты, остальные цифры честные.', { list: failed.join(', ') })}
        </div>
      )}

      {/* ── Самопроверка (MT-10): девять уже написанных сверок в один прогон ── */}
      <div style={S.panel}>
        <div style={S.panelHead}>
          <GameIcon slug="checked-shield" size={15} style={{ color: 'var(--acc)' }} />
          <b>{t('lore.analytics.product.selfCheck.title', 'Самопроверка корпуса')}</b>
          <button style={S.selfCheckBtn} onClick={runSelfCheck} disabled={selfCheckLoading}>
            {selfCheckLoading
              ? t('lore.analytics.product.selfCheck.running', 'проверяю…')
              : t('lore.analytics.product.selfCheck.run', 'Проверить')}
          </button>
          {selfCheck && (
            <span style={S.meta}>
              {t('lore.analytics.product.selfCheck.ranAt', 'прогон {{time}}', { time: new Date(selfCheck.run_at).toLocaleString() })}
            </span>
          )}
        </div>

        {selfCheckError && !selfCheck && (
          <div style={{ ...S.hint, color: 'var(--dng)' }}>
            {t('lore.analytics.product.selfCheck.loadError', 'прогон не удался целиком — попробуй ещё раз')}
          </div>
        )}

        {!selfCheck && !selfCheckLoading && !selfCheckError && (
          <div style={S.hint}>
            {t('lore.analytics.product.selfCheck.empty', 'нажми «Проверить» — прогон займёт несколько секунд')}
          </div>
        )}

        {selfCheck && (
          <div style={S.list}>
            {selfCheck.checks.map(c => {
              // Три состояния, не два: unavailable — «сверку не удалось
              // выполнить», это НЕ то же самое, что passed. Подменять одно
              // другим — тот самый дефект, из-за которого проверка темы в CD
              // однажды обвинила успешный выкат.
              const color = c.state === 'passed' ? 'var(--suc)' : c.state === 'unavailable' ? 'var(--dng)' : 'var(--wrn)';
              const icon = c.state === 'passed' ? '✓' : c.state === 'unavailable' ? '✕' : '⚠';
              const isOpen = openCheck === c.id;
              const clickable = c.findings.length > 0;
              return (
                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div
                    style={{ ...S.listRow, cursor: clickable ? 'pointer' : 'default' }}
                    onClick={() => clickable && setOpenCheck(isOpen ? null : c.id)}>
                    <span style={{ color }}>{icon}</span>
                    <span>{c.title}</span>
                    <span style={S.mono}>
                      {c.state === 'unavailable'
                        ? t('lore.analytics.product.selfCheck.unavailable', 'не удалось проверить')
                        : t('lore.analytics.product.selfCheck.foundOf', '{{found}} из {{denom}}', { found: c.found, denom: c.denominator })}
                    </span>
                    {clickable && <span style={S.dim}>{t('lore.analytics.product.selfCheck.clickToOpen', '(клик — список)')}</span>}
                  </div>
                  {c.state === 'unavailable' && c.error && (
                    <div style={{ ...S.dim, paddingLeft: 18, fontSize: 'var(--fs-sm)' }}>{c.error}</div>
                  )}
                  {isOpen && (
                    <div style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {c.findings.map(f => (
                        <div key={`${c.id}:${f.ref_id}`} style={S.listRow}>
                          <span
                            style={f.section ? { ...S.link, ...S.mono } : S.mono}
                            onClick={() => goFinding(f)}>
                            {f.ref_id}
                          </span>
                          {f.title && <span style={S.dim}>{f.title}</span>}
                          {f.detail && <span style={{ ...S.dim, fontSize: 'var(--fs-xs)' }}>· {f.detail}</span>}
                        </div>
                      ))}
                      {c.truncated && (
                        <div style={{ ...S.dim, fontSize: 'var(--fs-xs)' }}>
                          {t('lore.analytics.product.selfCheck.truncated', 'показаны первые {{n}} из {{total}} — остальное не выведено, а не отсутствует', { n: c.findings.length, total: c.found })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── E · Гигиена связок — ПЕРВОЙ очередью ── */}
      <div style={{ ...S.panel, borderLeft: `3px solid ${hygiene.length ? 'var(--wrn)' : 'var(--suc)'}` }}>
        <div style={S.panelHead}>
          <GameIcon slug="magnifying-glass" size={15} style={{ color: hygiene.length ? 'var(--wrn)' : 'var(--suc)' }} />
          <b>{t('lore.analytics.product.hygieneTitle', 'E · Гигиена связок')}</b>
          <span style={S.badge}>{hygiene.length}</span>
          <span style={S.meta}>{t('lore.analytics.product.hygieneWarn', 'срез первой очереди: пока тут не ноль — остальные цифры врут')}</span>
        </div>
        {hygiene.length === 0 ? (
          <div style={{ ...S.hint, color: 'var(--suc)' }}>{t('lore.analytics.product.hygieneClean', 'связки чистые — цифрам ниже можно верить')}</div>
        ) : (
          <>
            {/* AL-115: 489 строк без поиска были нечинибельны — единственный
                список в приложении без search/фильтра. ListSearch/FilterChips —
                те же общие компоненты, что у списков продуктового слоя. */}
            <div style={{ margin: '-10px -14px 10px' }}>
              <ListSearch value={hygieneSearch} onChange={setHygieneSearch}
                placeholder={t('lore.analytics.product.hygieneSearchPh', 'найти по id или названию…')} />
              {hygieneFilterDefs.length > 2 &&
                <FilterChips options={hygieneFilterDefs} value={hygieneFilter} onChange={setHygieneFilter} />}
            </div>
            {filteredHygiene.length === 0 ? (
              <div style={S.hint}>{t('lore.analytics.product.hygieneNoMatch', 'ничего не найдено по фильтру/поиску')}</div>
            ) : (
              <div style={S.list}>
                {filteredHygiene.map(h => (
                  <div key={`${h.finding}:${h.ref_id}`} style={S.listRow}>
                    <span style={{ color: 'var(--wrn)' }}>⚠</span>
                    <span style={S.mono}>{hygieneFindingLabel(h.finding)}:</span>
                    <span
                      style={h.entity_type === 'task' && h.sprint_id ? S.link : h.entity_type === 'uc' ? S.link : undefined}
                      onClick={() => {
                        if (h.entity_type === 'task' && h.sprint_id) goSprint(h.sprint_id);
                        else if (h.entity_type === 'uc') goFeature(h.ref_id);
                      }}>
                      {h.ref_id}
                    </span>
                    <span style={S.dim}>{h.title}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── VP-таблица по фичам ── */}
      <div style={S.panel}>
        <div style={S.panelHead}>
          <GameIcon slug="bullseye" size={15} style={{ color: 'var(--acc)' }} />
          <b>{t('lore.analytics.product.vpTitle', 'Ценность по фичам — Value Proposition')}</b>
          <span style={S.meta}>
            {t('lore.analytics.product.vpSubtitle', '{{n}} фич · средний fit {{fit}}%', { n: vpRows.length, fit: avgFit })}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>{t('lore.analytics.product.col.feature', 'Фича')}</th>
                <th style={S.th}>{t('lore.analytics.product.col.fit', 'fit')}</th>
                <th style={S.th}>{t('lore.analytics.product.col.actors', 'для кого')}</th>
                <th style={S.th}>{t('lore.analytics.product.col.shipped', 'ценность доехала')}</th>
                <th style={S.th}>{t('lore.analytics.product.col.milestone', 'веха')}</th>
              </tr>
            </thead>
            <tbody>
              {vpRows.map(r => {
                const f = fits.get(r.uc_id)!;
                const bad = f.total > 0 && f.closed < f.total;
                return (
                  <>
                    <tr key={r.uc_id}>
                      <td style={S.td}>
                        <span style={S.link} onClick={() => goFeature(r.uc_id)}>
                          <span style={{ ...S.mono, color: 'var(--acc)' }}>{r.uc_id}</span> {r.title}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span
                          style={{ ...S.fitChip, color: bad ? 'var(--wrn)' : 'var(--suc)', cursor: f.missing.length ? 'pointer' : 'default' }}
                          title={t('lore.analytics.product.fitHint', 'клик — что не замкнуто')}
                          onClick={() => setOpenFit(openFit === r.uc_id ? null : r.uc_id)}>
                          {f.closed}/{f.total}{bad && ' ⚠'}
                        </span>
                      </td>
                      <td style={S.td}>{(r.actor_ids ?? []).filter(Boolean).map(a => (
                        <span key={a} style={S.actorChip}>{a}</span>
                      ))}</td>
                      <td style={S.td}>
                        {f.claimedJobs > 0
                          ? t('lore.analytics.product.shippedJobs', '{{done}} из {{all}} работ', { done: f.shippedJobs, all: f.claimedJobs })
                          : '—'}
                      </td>
                      <td style={S.td}>
                        {r.milestone_id
                          ? <span style={{ ...S.link, ...S.mono }} onClick={() => navigate('/lore?section=milestones')}>{r.milestone_id}</span>
                          : <span style={{ color: 'var(--wrn)' }}>{t('lore.analytics.product.noMilestone', 'без вехи ⚠')}</span>}
                      </td>
                    </tr>
                    {openFit === r.uc_id && f.missing.length > 0 && (
                      <tr key={`${r.uc_id}:missing`}>
                        <td colSpan={5} style={{ ...S.td, background: 'var(--b1)' }}>
                          {f.missing.map(m => <div key={m} style={{ ...S.dim, fontSize: 'var(--fs-sm)' }}>· {m}</div>)}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {vpRows.length === 0 && (
                <tr><td colSpan={5} style={{ ...S.td, ...S.hint }}>{t('lore.analytics.product.vpEmpty', 'корней линейки (cloud/kite) пока нет')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Плитки срезов ── */}
      <div style={S.tiles}>
        {/* A · Карта нагрузки ролей */}
        <div style={S.panel}>
          <div style={S.panelHead}>
            <b>{t('lore.analytics.product.loadTitle', 'A · Карта нагрузки ролей')}</b>
            {project && <span style={S.meta}>{project}</span>}
          </div>
          <div style={S.list}>
            {actorLoad.map(a => (
              <div key={a.actor_id} style={S.listRow}>
                <span style={S.mono}>{a.name ?? a.actor_id}</span>
                <span>{t('lore.analytics.product.ucCount', '{{n}} UC', { n: a.uc_count ?? 0 })}</span>
                {(a.uc_count ?? 0) === 0 && <span style={{ color: 'var(--wrn)' }}>{t('lore.analytics.product.deadRole', '⚠ мёртвая роль')}</span>}
              </div>
            ))}
            {actorLoad.length === 0 && <div style={S.hint}>{t('lore.analytics.product.loadEmpty', 'акторов в скоупе нет')}</div>}
          </div>
        </div>

        {/* B · Стратегическое покрытие */}
        <div style={S.panel}>
          <div style={S.panelHead}><b>{t('lore.analytics.product.coverageTitle', 'B · Стратегическое покрытие')}</b></div>
          <div style={S.list}>
            <div style={S.listRow}>
              <span style={{ color: covNoMs.length ? 'var(--wrn)' : 'var(--suc)' }}>{covNoMs.length ? '⚠' : '✓'}</span>
              <span>{t('lore.analytics.product.featNoMs', 'фичи без вехи: {{n}}', { n: covNoMs.length })}</span>
              {covNoMs.map(c => <span key={c.ref_id} style={{ ...S.link, ...S.mono }} onClick={() => goFeature(c.ref_id)}>{c.ref_id}</span>)}
            </div>
            <div style={S.listRow}>
              <span style={{ color: covNoFeat.length ? 'var(--wrn)' : 'var(--suc)' }}>{covNoFeat.length ? '⚠' : '✓'}</span>
              <span>{t('lore.analytics.product.msNoFeat', 'вехи без фич: {{n}}', { n: covNoFeat.length })}</span>
              {covNoFeat.map(c => <span key={c.ref_id} style={{ ...S.link, ...S.mono }} onClick={() => navigate('/lore?section=milestones')}>{c.ref_id}</span>)}
            </div>
          </div>
        </div>

        {/* D · Инвестиционный профиль */}
        <div style={S.panel}>
          <div style={S.panelHead}>
            <b>{t('lore.analytics.product.investTitle', 'D · Инвестиционный профиль')}</b>
            <span style={S.meta}>{t('lore.analytics.product.investHint', '«всё в jtd» = сигнал, что ценность стоит')}</span>
          </div>
          {/* MT-02: доля покрытия классами — размер выборки, на которой держится профиль */}
          <div
            style={{
              ...S.coverageNote,
              ...(classCoverage.shareTasks < 0.5 ? S.coverageWarn : null),
            }}
            title={t('lore.analytics.product.coverageTitle',
              'Профиль баланса uc/jtd/enb осмыслен только на задачах С классом. work_class задан не у всех (D3 это допускает) — строка показывает, на какой доле корпуса посчитан профиль.')}
          >
            {t('lore.analytics.product.coverage',
              'Классами размечено: {{tasksPct}}% задач ({{tasksClassified}}/{{tasksTotal}}) · {{daysPct}}% трудоёмкости ({{daysClassified}}/{{daysTotal}} чел-дн)',
              {
                tasksPct: Math.round(classCoverage.shareTasks * 100),
                tasksClassified: classCoverage.tasksClassified,
                tasksTotal: classCoverage.tasksTotal,
                daysPct: Math.round(classCoverage.shareDays * 100),
                daysClassified: Math.round(classCoverage.daysClassified),
                daysTotal: Math.round(classCoverage.daysTotal),
              })}
          </div>
          <div style={S.list}>
            {shares.slice(0, 6).map(s => (
              <div key={s.release} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={S.mono}>{s.release}</span>
                  <span style={S.dim}>
                    UC {Math.round(s.uc * 100)}% · JTD {Math.round(s.jtd * 100)}% · ENB {Math.round(s.enb * 100)}%
                    {s.none > 0 && ` · без класса ${Math.round(s.none * 100)}%`}
                  </span>
                  {s.byCount && <span style={{ ...S.dim, color: 'var(--wrn)' }} title={t('lore.analytics.product.byCountHint', 'у части задач нет effort_days')}>{t('lore.analytics.product.byCount', 'по штукам')}</span>}
                </div>
                <div style={S.stack}>
                  <div style={{ width: `${s.uc * 100}%`, background: WC_COLOR.uc }} />
                  <div style={{ width: `${s.jtd * 100}%`, background: WC_COLOR.jtd }} />
                  <div style={{ width: `${s.enb * 100}%`, background: WC_COLOR.enb }} />
                  <div style={{ width: `${s.none * 100}%`, background: WC_COLOR.none }} />
                </div>
              </div>
            ))}
            {shares.length === 0 && <div style={S.hint}>{t('lore.analytics.product.investEmpty', 'задач с привязкой к релизам нет')}</div>}
          </div>
        </div>

        {/* F · Качество оформления */}
        <div style={S.panel}>
          <div style={S.panelHead}>
            <b>{t('lore.analytics.product.qualityTitle', 'F · Качество оформления')}</b>
            <span style={S.meta}>{t('lore.analytics.product.qualityNorm', 'нормировано score/max своего веса')}</span>
          </div>
          <div style={S.list}>
            <div style={{ ...S.listRow, cursor: belowThreshold.length ? 'pointer' : 'default' }} onClick={() => setOpenQuality(o => !o)}>
              <span style={{ color: belowThreshold.length ? 'var(--wrn)' : 'var(--suc)' }}>{belowThreshold.length ? '⚠' : '✓'}</span>
              <span>{t('lore.analytics.product.qualityBelow', 'ниже порога: {{n}} UC', { n: belowThreshold.length })}</span>
              {belowThreshold.length > 0 && <span style={S.dim}>{t('lore.analytics.product.qualityClick', '(клик — список)')}</span>}
            </div>
            {openQuality && belowThreshold.map(r => (
              <div key={r.uc_id} style={{ ...S.listRow, paddingLeft: 18 }}>
                <span style={{ ...S.link, ...S.mono }} onClick={() => goFeature(r.uc_id)}>{r.uc_id}</span>
                <span style={S.dim}>{r.score}/{r.max} · {r.title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── C · G · I — включаются позже; H — ссылка ── */}
      <div style={{ ...S.panel, opacity: 0.75 }}>
        <div style={S.panelHead}><b>{t('lore.analytics.product.laterTitle', 'C · G · I — включаются позже')}</b></div>
        <div style={{ ...S.list, color: 'var(--t3)', fontSize: 'var(--fs-sm)' }}>
          <div>{t('lore.analytics.product.laterC', 'C · shipped-динамика / lead time — после накопления shipped_at (ADR-029)')}</div>
          <div>{t('lore.analytics.product.laterG', 'G · граф линейки «опирается → открывает» — после наполнения «Мест в линейке»')}</div>
          <div>{t('lore.analytics.product.laterI', 'I · реинжиниринг-нагрузка — после in_rework (ADR-029)')}</div>
          <div>
            {t('lore.analytics.product.laterH', 'H · RBAC-матрица живёт в реестре акторов —')}{' '}
            <span style={S.link} onClick={() => navigate('/lore?section=actors')}>{t('lore.analytics.product.actorsLink', 'открыть')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel:    { background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 },
  panelHead:{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  badge:    { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', border: '1px solid var(--bd)', borderRadius: 999, padding: '0 8px', color: 'var(--t2)' },
  meta:     { fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  hint:     { fontSize: 'var(--fs-base)', color: 'var(--t3)' },
  // MT-02: строка покрытия классами над профилем
  coverageNote: {
    fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 8,
    padding: '4px 8px', borderRadius: 4, border: '1px solid var(--bd)',
    background: 'color-mix(in srgb, var(--t3) 6%, transparent)',
  },
  coverageWarn: {
    color: 'var(--wrn)',
    border: '1px solid color-mix(in srgb, var(--wrn) 40%, transparent)',
    background: 'color-mix(in srgb, var(--wrn) 8%, transparent)',
  },
  dim:      { color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mono:     { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' },
  link:     { cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 },
  list:     { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-base)' },
  listRow:  { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' },
  tiles:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 },
  table:    { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-base)' },
  th:       { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--bd)', color: 'var(--t3)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  td:       { padding: '7px 10px', borderBottom: '1px solid color-mix(in srgb, var(--bd) 55%, transparent)', verticalAlign: 'top' },
  fitChip:  { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', border: '1px solid var(--bd)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' },
  actorChip:{ display: 'inline-block', border: '1px solid var(--bd)', borderRadius: 999, padding: '0 7px', fontSize: 'var(--fs-sm)', color: 'var(--t2)', marginRight: 4 },
  stack:    { display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--b3)' },
  errBanner:{ padding: '7px 11px', borderRadius: 6, fontSize: 'var(--fs-sm)', color: 'var(--wrn)', border: '1px solid color-mix(in srgb, var(--wrn) 35%, transparent)', background: 'color-mix(in srgb, var(--wrn) 8%, transparent)' },
  selfCheckBtn: { marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--acc)', background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' },
};
