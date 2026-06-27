import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type {
  AspectOriginRow, AspectRow, CategoryRow, DecisionRow,
  DetailedCategoryRow, GoldShapeRow, HopKindRow, LevelRow, TaskRow,
} from '../../utils/muninnData';
import { pickLocale, short } from '../../utils/muninnData';
import { MartProse } from './MartProse';
import { PanelMsg, ScreenTitle } from './shared';

const EMPTY_PARAMS: Record<string, string> = {};

/**
 * Dictionaries — the reference vocabularies the whole experiment speaks in:
 * tasks (what is being tested), levels, hop kinds (how the walk is defined)
 * and method decisions (WHY we measure the way we do — MD rationale per
 * decision). Lives at the end of the Registries section.
 */
export function DictionariesScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tasks      = useMartSlice<TaskRow>('tasks', EMPTY_PARAMS);
  const levels     = useMartSlice<LevelRow>('levels', EMPTY_PARAMS);
  const hopKinds   = useMartSlice<HopKindRow>('hop_kinds', EMPTY_PARAMS);
  const decisions  = useMartSlice<DecisionRow>('decisions', EMPTY_PARAMS);
  const aspects    = useMartSlice<AspectRow>('aspects', EMPTY_PARAMS);
  const categories = useMartSlice<CategoryRow>('categories', EMPTY_PARAMS);
  const dCats      = useMartSlice<DetailedCategoryRow>('detailed_categories', EMPTY_PARAMS);
  const goldShapes = useMartSlice<GoldShapeRow>('gold_shapes', EMPTY_PARAMS);
  const origins    = useMartSlice<AspectOriginRow>('aspect_origins', EMPTY_PARAMS);

  if (tasks.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={tasks.reload} />;
  if (tasks.error) return <PanelMsg kind="error" text={tasks.error} onRetry={tasks.reload} />;
  if (!tasks.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  return (
    <div>
      <ScreenTitle text={t('bench.dict.title', 'Dictionaries — the vocabulary of the experiment')}
                   hint={t('bench.dict.hint', 'tasks, levels, hop kinds and the method decisions behind how we measure')} />

      <div className="analytics-card" style={{ marginBottom: 12 }}>
        <div className="analytics-card-title">{t('bench.dict.tasks', 'Tasks')}</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>{t('bench.dict.nCases', 'Cases')}</th>
              <th>{t('bench.dict.metric', 'Metric')}</th>
              <th>{t('bench.reg.status', 'Status')}</th>
              <th>{t('bench.dict.whatTests', 'What it tests')}</th>
            </tr>
          </thead>
          <tbody>
            {(tasks.rows ?? []).map(x => {
              const label = pickLocale(lang, undefined, x.label_en, x.task_id, x.label_ru);
              const whatTests = pickLocale(lang, x.what_tests_ru_sci, x.what_tests_en, x.what_tests, x.what_tests_ru);
              return (
                <tr key={x.task_id}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {x.task_id}
                    {label && label !== x.task_id && (
                      <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'inherit' }}>{label}</div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{x.n_cases ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{x.metric_default ?? '—'}</td>
                  <td>{x.status ? <span className="badge badge-neutral">{x.status}</span> : '—'}
                    {x.gated_on && <span style={{ fontSize: 10, color: 'var(--t3)' }}> gated: {x.gated_on}</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--t2)', maxWidth: 460 }}>{whatTests ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="analytics-card" style={{ marginBottom: 12 }}>
        <div className="analytics-card-title">{t('bench.dict.levels', 'Levels')}</div>
        {(levels.rows ?? []).map(x => (
          <div key={x.level_id} style={{ padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--bd)' }}>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{x.level_id}</span>
            {x.gold_graph && <span className="scope-tag" style={{ marginLeft: 6 }}>{x.gold_graph}</span>}
            {x.description && <div style={{ color: 'var(--t2)', fontSize: 11, marginTop: 2 }}>{x.description}</div>}
          </div>
        ))}
      </div>

      <div className="analytics-card" style={{ marginBottom: 12 }}>
        <div className="analytics-card-title">{t('bench.dict.hopKinds', 'Hop kinds')}</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>{t('bench.dict.definition', 'Definition')}</th>
              <th>{t('bench.dict.walk', 'Walk function')}</th>
              <th>{t('bench.dict.metricRec', 'Recommended metric')}</th>
            </tr>
          </thead>
          <tbody>
            {(hopKinds.rows ?? []).map(x => {
              const hkLabel = pickLocale(lang, undefined, x.label_en, x.hop_kind_id, x.label_ru);
              return (
                <tr key={x.hop_kind_id}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {x.hop_kind_id}
                    {hkLabel && hkLabel !== x.hop_kind_id && (
                      <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'inherit' }}>{hkLabel}</div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--t2)', maxWidth: 380 }}>{x.definition ?? ''}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{x.walk_function ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{x.metric_recommended ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="analytics-card" style={{ marginBottom: 12 }}>
        <div className="analytics-card-title">{t('bench.dict.decisions', 'Method decisions — why we measure this way')}</div>
        {(decisions.rows ?? []).map(d => {
          const rationale = pickLocale(lang, d.rationale_ru_sci, d.rationale_en, d.rationale, d.rationale_ru);
          const decisionText = pickLocale(lang, d.decision_ru_sci, d.decision_en, d.decision, d.decision_ru);
          return (
            <details key={d.decision_id} style={{ marginBottom: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{d.decision_id}</span>
                {d.topic && <span className="scope-tag" style={{ marginLeft: 6 }}>{d.topic}</span>}
                {d.status && <span className="badge badge-neutral" style={{ marginLeft: 4 }}>{d.status}</span>}
                {decisionText && <span style={{ color: 'var(--t2)', fontSize: 12 }}> · {decisionText}</span>}
              </summary>
              {rationale && <MartProse text={rationale} style={{ maxWidth: 940, padding: '4px 0 0 16px' }} />}
            </details>
          );
        })}
      </div>

      {/* ── C+D namespace: gold classification axes (2026-06-13) ───────────── */}
      {(aspects.rows ?? []).length > 0 && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.dict.aspects', 'Aspects — gold classification axes')}</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('bench.reg.status', 'Status')}</th>
                <th>{t('bench.dict.metric', 'Default metric')}</th>
                <th>{t('bench.dict.goldShape', 'Gold shape')}</th>
                <th>{t('bench.dict.origin', 'Origin')}</th>
                <th>{t('bench.dict.label', 'Label')}</th>
              </tr>
            </thead>
            <tbody>
              {(aspects.rows ?? []).map(x => {
                const label = pickLocale(lang, undefined, x.label_en, short(x.aspect_id), x.label_ru);
                return (
                  <tr key={x.aspect_id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{x.aspect_id}</td>
                    <td>{x.status && <span className="badge badge-neutral">{x.status}</span>}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{x.metric_default ?? '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{x.gold_shape ?? '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{x.origin ? short(x.origin) : '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--t2)' }}>{label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(goldShapes.rows ?? []).length > 0 && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.dict.goldShapes', 'Gold shapes')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(goldShapes.rows ?? []).map(x => {
              const label = pickLocale(lang, undefined, x.label_en, short(x.shape_id), x.label_ru);
              return (
                <span key={x.shape_id} className="scope-tag" title={x.shape_id}>
                  <span style={{ fontFamily: 'var(--mono)' }}>{short(x.shape_id)}</span>
                  {label && label !== short(x.shape_id) && <> · {label}</>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {((categories.rows ?? []).length > 0 || (dCats.rows ?? []).length > 0) && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.dict.categories', 'Case categories')}</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {(categories.rows ?? []).length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>cat:*</div>
                {(categories.rows ?? []).map(x => {
                  const label = pickLocale(lang, undefined, x.label_en, short(x.category_id), x.label_ru);
                  return (
                    <div key={x.category_id} style={{ fontSize: 12, padding: '2px 0' }}>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{x.category_id}</span>
                      {label && label !== x.category_id && <span style={{ color: 'var(--t3)', marginLeft: 6 }}>{label}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {(dCats.rows ?? []).length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>dcat:*</div>
                {(dCats.rows ?? []).map(x => {
                  const label = pickLocale(lang, undefined, x.label_en, short(x.dcat_id), x.label_ru);
                  return (
                    <div key={x.dcat_id} style={{ fontSize: 12, padding: '2px 0' }}>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{x.dcat_id}</span>
                      {label && label !== x.dcat_id && <span style={{ color: 'var(--t3)', marginLeft: 6 }}>{label}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {(origins.rows ?? []).length > 0 && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.dict.aspectOrigins', 'Aspect origins')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(origins.rows ?? []).map(x => {
              const label = pickLocale(lang, undefined, x.label_en, short(x.origin_id), x.label_ru);
              return (
                <span key={x.origin_id} className="scope-tag" title={x.origin_id}>
                  <span style={{ fontFamily: 'var(--mono)' }}>{short(x.origin_id)}</span>
                  {label && label !== short(x.origin_id) && <> · {label}</>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
