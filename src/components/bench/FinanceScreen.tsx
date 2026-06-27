import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type {
  CampaignRow, ModelRow, PhaseRow, PriceEpochRow, RunRow,
} from '../../utils/muninnData';
import { formatTokens, formatUsd, num, runCostAt, strArr } from '../../utils/muninnData';
import { PanelMsg, ScreenTitle, StatusBadge } from './shared';

const EMPTY_PARAMS: Record<string, string> = {};

function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0' }}>
      <span style={{ width: 170, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis',
                     whiteSpace: 'nowrap' }} title={label}>{label}</span>
      <div style={{ flex: 1, height: 10, background: 'var(--bg3)', borderRadius: 5 }}>
        <div style={{ width: `${max > 0 ? Math.max(1, (value / max) * 100) : 0}%`, height: '100%',
                      background: 'var(--acc)', borderRadius: 5 }} />
      </div>
      <span style={{ fontFamily: 'var(--mono)', width: 90, textAlign: 'right' }}>
        {formatUsd(value)}{suffix}
      </span>
    </div>
  );
}

/** SCD2 price strip of one model: promo dashed, superseded struck. */
function PriceStrip({ epochs }: { epochs: PriceEpochRow[] }) {
  return (
    <span>
      {epochs.map((e, i) => (
        <span key={e.price_id}>
          {i > 0 && <span style={{ color: 'var(--t3)', fontSize: 10 }}> → </span>}
          <span className="scope-tag"
                title={`$${e.in_per_1m}/$${e.out_per_1m} per 1M · ${e.valid_from ?? ''} → ${e.valid_to || 'now'} · as_of ${e.as_of ?? '?'}${e.source ? `\n${e.source}` : ''}`}
                style={{ textDecoration: e.superseded ? 'line-through' : undefined,
                         borderStyle: e.is_promo ? 'dashed' : undefined,
                         opacity: e.superseded ? 0.6 : 1 }}>
            {e.price_epoch}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Finance dashboard (v8.2). Source of truth = ExpModel + ExpPriceEpoch SCD2
 * in the mart — Fin-1: not a single price lives in this code; the V3-tariff
 * incident ($73 → $37) is the reason. F2 recomputes every total on an
 * arbitrary price epoch from run tokens × epoch rates.
 */
export function FinanceScreen({ runs }: { runs: RunRow[] }) {
  const { t } = useTranslation();
  const models = useMartSlice<ModelRow>('models', EMPTY_PARAMS);
  const epochs = useMartSlice<PriceEpochRow>('price_epochs', EMPTY_PARAMS);
  const campaigns = useMartSlice<CampaignRow>('campaigns', EMPTY_PARAMS);
  const phases = useMartSlice<PhaseRow>('phases', EMPTY_PARAMS);

  // F2: chosen price epoch per model ('' = stamped cost_usd from the mart)
  const [picked, setPicked] = useState<Record<string, string>>({});

  const epochsByModel = useMemo(() => {
    const m = new Map<string, PriceEpochRow[]>();
    for (const e of epochs.rows ?? []) {
      if (!e.model_id) continue;
      if (!m.has(e.model_id)) m.set(e.model_id, []);
      m.get(e.model_id)!.push(e);
    }
    return m;
  }, [epochs.rows]);

  const currentEpoch = (modelId: string | undefined): PriceEpochRow | undefined =>
    (epochsByModel.get(modelId ?? '') ?? []).find(e => !e.superseded); // Fin-5

  const costOf = (r: RunRow): number | undefined => {
    const chosen = picked[r.model ?? ''];
    if (!chosen) return num(r.cost_usd);
    const epoch = (epochsByModel.get(r.model ?? '') ?? []).find(e => e.price_epoch === chosen);
    return runCostAt(r, epoch) ?? num(r.cost_usd);
  };

  if (models.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={models.reload} />;
  if (models.error) return <PanelMsg kind="error" text={models.error} onRetry={models.reload} />;
  if (!models.rows || !epochs.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const recomputed = Object.values(picked).some(Boolean);
  const total = runs.reduce((s, r) => s + (costOf(r) ?? 0), 0);
  const tokensIn = runs.reduce((s, r) => s + (num(r.tokens_in_total) ?? 0), 0);
  const tokensOut = runs.reduce((s, r) => s + (num(r.tokens_out_total) ?? 0), 0);

  const byModel = new Map<string, number>();
  for (const r of runs) byModel.set(r.model ?? '?', (byModel.get(r.model ?? '?') ?? 0) + (costOf(r) ?? 0));

  const runCost = new Map(runs.map(r => [r.run_id, costOf(r) ?? 0]));
  const byCampaign = (campaigns.rows ?? []).map(c => ({
    id: c.campaign_id,
    cost: [...new Set(strArr(c.run_ids))].reduce((s, id) => s + (runCost.get(id) ?? 0), 0),
  })).filter(x => x.cost > 0).sort((a, b) => b.cost - a.cost);
  const campCost = new Map(byCampaign.map(x => [x.id, x.cost]));
  const byPhase = (phases.rows ?? []).map(p => ({
    id: p.label ?? p.phase_id,
    cost: [...new Set(strArr(p.campaigns))].reduce((s, id) => s + (campCost.get(id) ?? 0), 0),
  })).filter(x => x.cost > 0);

  const maxModel = Math.max(0, ...byModel.values());
  const maxCamp = Math.max(0, ...byCampaign.map(x => x.cost));
  const maxPhase = Math.max(0, ...byPhase.map(x => x.cost));

  return (
    <div data-testid="bench-finance">
      <ScreenTitle text={t('bench.fin.title', 'Finance — what the experiment cost, with price provenance')}
                   hint={t('bench.fin.hint', 'every number resolves to ExpPriceEpoch (SCD2) — no price lives in the page code (Fin-1)')} />

      {/* F1 + F2: total with provenance and the epoch switcher */}
      <div className="analytics-card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: 30, fontFamily: 'var(--mono)', color: 'var(--t1)' }}
                 data-testid="fin-total">{formatUsd(total)}</div>
            <div style={{ fontSize: 11, color: 'var(--t3)' }}>
              {recomputed
                ? t('bench.fin.recomputed', 'recomputed from run tokens × chosen epoch rates')
                : t('bench.fin.stamped', 'as stamped in the mart (ExpRun.cost_usd rollup)')}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>
            <div>{t('bench.fin.tokens', 'Tokens')}: <span style={{ fontFamily: 'var(--mono)' }}>
              {formatTokens(tokensIn)} in / {formatTokens(tokensOut)} out</span></div>
            <StatusBadge tone="warn" text={t('bench.fin.cacheMiss', 'cache-MISS = upper bound')} />
          </div>
        </div>

        {/* Fin-2: the price provenance per model + F2 switcher */}
        <table className="data-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>{t('bench.fin.model', 'Model')}</th>
              <th>{t('bench.fin.priceTimeline', 'Price epochs (SCD2)')}</th>
              <th>{t('bench.fin.countOn', 'Count on epoch')}</th>
              <th>{t('bench.fin.provenance', 'Provenance')}</th>
              <th>$</th>
            </tr>
          </thead>
          <tbody>
            {models.rows.map(m => {
              const chain = epochsByModel.get(m.model_id) ?? [];
              const active = picked[m.model_id]
                ? chain.find(e => e.price_epoch === picked[m.model_id])
                : currentEpoch(m.model_id);
              return (
                <tr key={m.model_id}>
                  <td>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{m.model_id}</span>
                    {m.tier && <span className="scope-tag" style={{ marginLeft: 4 }}>{m.tier}</span>}
                    <div style={{ fontSize: 10, color: 'var(--t3)' }}>
                      {m.provider} · {m.endpoint} · ctx {formatTokens(num(m.context_len))}
                    </div>
                    {m.note && <div style={{ fontSize: 10, color: 'var(--t3)', maxWidth: 280 }}>{m.note}</div>}
                  </td>
                  <td><PriceStrip epochs={chain} /></td>
                  <td>
                    <select value={picked[m.model_id] ?? ''}
                            data-testid={`fin-epoch-${m.model_id}`}
                            onChange={e => setPicked(p => ({ ...p, [m.model_id]: e.target.value }))}
                            style={{ padding: '3px 6px', fontSize: 11, background: 'var(--bg2)',
                                     color: 'var(--t1)', border: '1px solid var(--bd)', borderRadius: 6 }}>
                      <option value="">{t('bench.fin.asStamped', 'as stamped')}</option>
                      {chain.map(e => (
                        <option key={e.price_id} value={e.price_epoch}>
                          {e.price_epoch}{e.is_promo ? ' (promo)' : ''}{e.superseded ? ' (superseded)' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {/* Fin-2: a total without epoch+date+source is unusable */}
                    {active ? (
                      <>
                        <span style={{ fontFamily: 'var(--mono)' }}>{active.price_epoch}</span>
                        <span style={{ color: 'var(--t3)' }}> · as_of {active.as_of ?? '?'}</span>
                        {active.is_promo && (
                          <span className="badge badge-warn" style={{ marginLeft: 4 }}
                                title={t('bench.fin.promoRisk', 'promo rate — plan for a return to the reference price')}>
                            promo
                          </span>
                        )}
                        {active.source && (active.source.startsWith('http')
                          ? <div><a href={active.source} target="_blank" rel="noopener noreferrer"
                                    style={{ color: 'var(--acc)', fontSize: 10 }}>{active.source}</a></div>
                          : <div style={{ fontSize: 10, color: 'var(--t3)' }}>{active.source}</div>)}
                      </>
                    ) : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'right' }}>
                    {formatUsd(byModel.get(m.model_id) ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* F1: breakdowns */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="analytics-card" style={{ flex: '1 1 300px', marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.fin.byCampaign', 'By campaign')}</div>
          {byCampaign.map(x => <Bar key={x.id} label={x.id} value={x.cost} max={maxCamp} />)}
        </div>
        <div className="analytics-card" style={{ flex: '1 1 300px', marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.fin.byPhase', 'By phase')}</div>
          {byPhase.map(x => <Bar key={x.id} label={x.id} value={x.cost} max={maxPhase} />)}
          <div className="analytics-card-title" style={{ marginTop: 12 }}>{t('bench.fin.byModel', 'By model')}</div>
          {[...byModel.entries()].map(([id, v]) => <Bar key={id} label={id} value={v} max={maxModel} />)}
        </div>
      </div>

      {/* F3 pointer: quality per dollar lives in Pareto (the $-axis) */}
      <div style={{ fontSize: 11, color: 'var(--t3)' }}>
        {t('bench.fin.f3Hint', 'Quality per dollar (F1 × $) — the Pareto tab, $ axis; tierA = 0 LLM cost (deterministic), I5 pinned there')}
      </div>
    </div>
  );
}
