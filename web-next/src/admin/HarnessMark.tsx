// Знак harness рядом с агентом (SPRINT_UXR_S7B_ADMIN/S7B-22).
//
// Логотип — только официальный, из справочника harness (поле icon → вшитый
// набор harnessLogos). Нет логотипа — НИЧЕГО не рисуем: подпись/имя рядом уже
// есть, а общий значок вместо логотипа был бы самодельным знаком.
import { GameIcon, Pill, type ValueIcon } from '@seidr/kit';
import type { AgentRow } from './agents';

export function HarnessMark({ logo, label }: { logo: string | null | undefined; label: string | null | undefined }) {
  if (!logo) return null;
  const name = label ?? undefined;
  return (
    <span className="adm-hmark" data-testid="adm-harness-mark" data-logo={logo} title={name}>
      <GameIcon slug={logo} size={12} label={name} />
    </span>
  );
}

/** Агент пилюлей: знак harness + имя; подсказка — harness словами (или «не указан»). */
export function AgentChip({ row, noneLabel }: { row: AgentRow; noneLabel?: string }) {
  return (
    <Pill variant="id" title={row.harness_label ?? noneLabel ?? row.harness ?? undefined}>
      <HarnessMark logo={row.harness_logo} label={row.harness_label} />
      {row.name ?? row.actor_id}
    </Pill>
  );
}

/**
 * Журнал: caller — client_id учётки или actor_id. Знак — только если все
 * агенты под этим именем одного harness с логотипом; учётка общая у агентов
 * разных harness — знак был бы угадкой, его нет.
 */
export function callerHarness(caller: string | null | undefined, rows: readonly AgentRow[]): { logo: string; label: string } | null {
  if (!caller) return null;
  const mine = rows.filter(r => r.client_id === caller || r.actor_id === caller);
  if (mine.length === 0) return null;
  const codes = new Set(mine.map(r => r.harness));
  if (codes.size !== 1) return null;
  const r = mine[0];
  return r.harness_logo ? { logo: r.harness_logo, label: r.harness_label ?? r.harness ?? '' } : null;
}

/**
 * ListView.valueIcon для поля harness, где значения — подписи справочника
 * (экран «Доступ к машинам»): подпись → код → логотип. Логотипа нет — null
 * (без значка); другие поля — undefined (решает kit).
 */
export function harnessValueIcon(labels: Record<string, string>, logos: Record<string, string>) {
  const byLabel = new Map<string, string>();
  for (const [code, logo] of Object.entries(logos)) {
    byLabel.set(code, logo);
    if (labels[code]) byLabel.set(labels[code], logo);
  }
  return (key: string, value: string): ValueIcon | null | undefined => {
    if (key !== 'harness' && key !== 'fields.harness') return undefined;
    const logo = byLabel.get(value);
    return logo ? { icon: logo } : null;
  };
}
