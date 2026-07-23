import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubstrateFactRow, SubstrateRevRow } from '../../utils/muninnData';
import { fmtF1, pickLocale, revFactStats } from '../../utils/muninnData';
import { MartProse } from './MartProse';

/**
 * SCD2 revision timeline of one actor (v8). The architecture of each
 * revision is markdown prose (often with mermaid) — too heavy for an
 * accordion list, so the timeline is a horizontal selector strip and the
 * selected revision gets a full-width prose panel below it. Each chip also
 * carries the revision's evidence footprint (facts/runs measured under it,
 * via fact.config_rev) — I3 made visible: you SEE which epoch the numbers
 * belong to.
 */
export function RevisionTimeline({ revs, facts }: { revs: SubstrateRevRow[]; facts: SubstrateFactRow[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const stats = useMemo(() => revFactStats(facts), [facts]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = revs.find(r => r.rev_id === picked)
    ?? revs.find(r => r.is_current)
    ?? revs[revs.length - 1];
  const changeWhy = selected ? pickLocale(lang, selected.change_why_ru_sci, selected.change_why_en, selected.change_why, selected.change_why_ru) : undefined;
  const arch = selected ? pickLocale(lang, selected.architecture_ru_sci, selected.architecture_en, selected.architecture, selected.architecture_ru) : undefined;

  if (!revs.length) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap', marginBottom: 10 }}>
        {revs.map((r, i) => {
          const u = r.config_rev ? stats.get(r.config_rev) : undefined;
          const active = selected?.rev_id === r.rev_id;
          return (
            <span key={r.rev_id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 0 && <span style={{ color: 'var(--t3)', margin: '0 6px', fontSize: 'var(--fs-lg)' }}>→</span>}
              <button type="button" onClick={() => setPicked(r.rev_id)}
                      data-testid={`rev-chip-${r.rev_id}`}
                      aria-pressed={active}
                      style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 8, padding: '7px 10px',
                               background: 'var(--bg2)', maxWidth: 250,
                               border: `1px solid ${active ? 'var(--acc)' : 'var(--bd)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)',
                                 color: r.is_current ? 'var(--t1)' : 'var(--t3)',
                                 textDecoration: r.is_current ? undefined : 'line-through' }}>
                    {r.config_rev ?? r.rev_id}
                  </span>
                  {r.is_current && <span className="badge badge-suc">current</span>}
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginTop: 2 }}>
                  {(r.valid_from ?? '—').slice(0, 16)} → {r.valid_to ? r.valid_to.slice(0, 16) : 'now'}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', marginTop: 2,
                              color: u ? 'var(--t2)' : 'var(--t3)' }}>
                  {u
                    ? `${u.nFacts} ${t('bench.sub.revFacts', 'facts')} · ${u.runs.length} ${t('bench.sub.revRuns', 'runs')} · F1 ${fmtF1(u.meanF1)}`
                    : t('bench.sub.revNoFacts', 'not measured')}
                </div>
              </button>
            </span>
          );
        })}
      </div>

      {selected && (
        <div data-testid="rev-detail" style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          <div style={{ fontSize: 'var(--fs-base)', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{selected.config_rev ?? selected.rev_id}</span>
            <span style={{ color: 'var(--t3)' }}>
              {' '}· {selected.valid_from ?? '—'} → {selected.valid_to || 'now'}
            </span>
            {changeWhy && (
              <span style={{ color: 'var(--t2)' }}> · {changeWhy}</span>
            )}
          </div>
          {arch
            ? <MartProse text={arch} style={{ maxWidth: 980 }} />
            : <span style={{ fontSize: 'var(--fs-base)', color: 'var(--t3)' }}>
                {t('bench.sub.revNoArch', 'no architecture prose recorded for this revision')}
              </span>}
        </div>
      )}
    </div>
  );
}
