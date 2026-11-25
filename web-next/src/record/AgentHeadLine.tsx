// Шапка карточки агента вне админки (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE; прототип
// docs/prototypes/ap-people-page.html, согласован владелицей 21.11.2026: «агенты вне админки тоже сделай личная
// карта — минимум просто чьи они»).
//   • значок harness + имя harness · профиль · машина — правило AO-AGENT-HUMAN-NAME («Claude Code · full · LEGION»;
//     машины нет — без третьей части);
//   • «чей он» — владелец-человек (OWNED_BY) ссылкой на его личную страницу; нет — «владелец не указан»,
//     не прочитали — так и сказано (это не «не указан»).
// Учётки (client_id), секретов, ролей доступа и доступов здесь нет: учётку сервер не-админу не отдаёт (поле уровня
// admin), а шапка её и не читает. Правка, права и доступы агента — в админке.
import { useMemo } from 'react';
import { rowsOf, useKitLang, useLoadState, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { chartLoader, type ChartLoader } from '../charts/chartCommon';
import { HarnessMark } from '../admin/HarnessMark';
import { parseHarnessDict } from '../admin/agents';
import { harnessLogo } from '../admin/harnessLogos';
import { recordHref } from '../nav/loreRoutes';
import type { LoreLink } from './loreRecordContract';

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export interface AgentHeadLineProps {
  /** Значения паспорта агента (фасад lore.record/1): agent_role, harness, owner (kc_sub). */
  values: Record<string, unknown>;
  /** Связи паспорта: машины — USES_MACHINE. */
  links: readonly LoreLink[];
  /** Загрузчик среза; по умолчанию — /lore/slice приложения. */
  load?: ChartLoader;
  fetchImpl?: typeof fetch;
  lang?: KitLang;
}

export function AgentHeadLine({ values, links, load, fetchImpl, lang }: AgentHeadLineProps) {
  const appLang = useKitLang();
  const l = lang ?? appLang;
  const t = (k: AppKey) => appT(l, k);
  const get = useMemo(() => chartLoader(load, fetchImpl), [load, fetchImpl]);
  const harness = s(values.harness), role = s(values.agent_role), owner = s(values.owner);
  const machines = [...new Set(links.filter(x => x.rel === 'USES_MACHINE').map(x => s(x.title) ?? s(x.id)).filter((x): x is string => !!x))];

  // Справочник harness не прочитан — код словом и без значка (самодельный знак вместо логотипа был бы выдумкой).
  const dict = useLoadState(signal => get('dictionary', { dict_type: 'harness' }, signal), [get]);
  const h = useMemo(() => {
    if (!harness || !dict.data) return null;
    const row = parseHarnessDict((rowsOf(dict.data) ?? []) as Array<Record<string, unknown>>, l === 'en' ? 'en' : 'ru').find(d => d.code === harness);
    return row ? { label: row.label, logo: harnessLogo(row.icon) } : null;
  }, [dict.data, harness, l]);

  const who = useLoadState(signal => (owner ? get('user_by_id', { kc_sub: owner }, signal) : Promise.resolve(null)), [owner, get]);
  const ownerRow = who.data ? ((rowsOf(who.data) ?? [])[0] as Record<string, unknown> | undefined) : undefined;

  const parts = [h?.label ?? harness, role, machines.length ? machines.join(', ') : null].filter((x): x is string => !!x);
  return (
    <div className="agent-head">
      <p className="agent-head__who" aria-label={t('agentHead.who')}>
        {h?.logo && <HarnessMark logo={h.logo} label={h.label} />}
        <b data-testid="agent-who">{parts.length ? parts.join(' · ') : t('agentHead.noHarness')}</b>
      </p>
      <p className="agent-head__owner" data-testid="agent-owner">
        <span className="agent-head__k">{t('agentHead.owner')}</span>{' '}
        {!owner ? <span data-testid="agent-owner-none">{t('agentHead.noOwner')}</span>
          : who.state === 'loading' ? <span className="agent-head__muted">…</span>
          : who.state === 'error' || who.state === 'forbidden'
            ? <span className="agent-head__err" role="status" data-testid="agent-owner-error">
                {t('agentHead.ownerError')}: {who.error instanceof Error ? who.error.message : String(who.error ?? '')}
              </span>
            : !ownerRow ? <span data-testid="agent-owner-missing">{t('agentHead.ownerMissing')}</span>
            : (
              <>
                <a data-testid="agent-owner-link" href={recordHref('user', owner) ?? undefined}>{s(ownerRow.display_name) ?? s(ownerRow.login) ?? owner}</a>
                {s(ownerRow.login) && s(ownerRow.login) !== s(ownerRow.display_name) && <span className="agent-head__muted"> ({s(ownerRow.login)})</span>}
              </>
            )}
      </p>
    </div>
  );
}
