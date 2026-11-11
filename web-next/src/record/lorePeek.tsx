// Peek для LORE (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD, прототип одобрен 11.11.2026).
// Kit рисует карточку (PeekCard) и отвечает за наведение и лист (MartProse refPeek); здесь — смысл:
// какую запись грузить, какие 2–3 свойства показать у типа, какой раздел тела, какие счётчики.
//
// Свойства — кандидаты по типу (подписи одобренного прототипа); берутся только те, что ЕСТЬ в схеме
// записи. Нет ни одного — первые два заполненных из «Свойств»: новый тип не останется пустым.
// ASSUMED до переноса в модель сервера (рядом с required): список живёт в приложении, сервер не трогали
// — любой ./gradlew test мигрирует прод-схему.
import { useCallback, useEffect, useState } from 'react';
import { Pill, PeekCard, type KitLang, type ListPeek, type PeekCardData, type PeekState } from '@seidr/kit';
import type { MartPeekRef, MartRefPeek } from '@seidr/kit/content';
import { RecordForbidden, RecordNotFound, fetchLoreRecord } from '../api/liveRecord';
import { recordHref } from '../nav/loreRoutes';
import { appT } from '../i18n';
import { typeByForm } from './loreRefForms';
import type { LoreRecord1 } from './loreRecordContract';

/** 2–3 свойства карточки по типу — кандидаты по порядку показа. */
const PEEK_FIELDS: Record<string, readonly string[]> = {
  adr: ['components', 'date'],
  task: ['sprint', 'executor', 'effort'],
  sprint: ['priority', 'planned_end'],
  spec: ['version', 'component'],
  decision: ['adr', 'date'],
  question: ['priority', 'due_date'],
  milestone: ['date', 'week'],
  release: ['date', 'type'],
  component: ['area', 'children'],
  tech: ['component', 'checked_at'],
  feature: ['goal_level', 'children'],
  project: ['default_branch', 'is_private'],
};
const MAX_PROPS = 3;
const MAX_COUNTERS = 3;

const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const show = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(' · ') : typeof v === 'boolean' ? (v ? '✓' : '✗') : String(v));

export function toPeekCard(r: LoreRecord1, lang: KitLang): PeekCardData {
  const fields = r.schema.fields;
  const byKey = new Map(fields.map(f => [f.key, f]));
  const wanted = (PEEK_FIELDS[r.record.type] ?? []).filter(k => byKey.has(k));
  const keys = wanted.length > 0
    ? wanted
    : fields.filter(f => f.group === 'props' && !empty(r.values[f.key])).map(f => f.key).slice(0, 2);
  const props = keys.slice(0, MAX_PROPS).map(k => ({ label: byKey.get(k)!.label, value: empty(r.values[k]) ? null : show(r.values[k]) }));

  const body = fields.find(f => f.group === 'body' && typeof r.values[f.key] === 'string' && (r.values[f.key] as string).trim() !== '');
  const section = body
    ? { title: body.label, paras: (r.values[body.key] as string).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean) }
    : null;

  const counters = r.schema.relations
    .filter(rel => rel.place !== 'prop' && typeof rel.count === 'number' && rel.count > 0)
    .slice(0, MAX_COUNTERS)
    .map(rel => ({ label: rel.label, n: rel.count }));

  return {
    kind: r.schema.label || appT(lang, 'peek.kind.unknown'),
    id: r.record.id,
    title: r.record.title,
    status: r.record.status ? <Pill>{r.record.status}</Pill> : undefined,
    props,
    section,
    counters,
    href: recordHref(r.record.type, r.record.id),
  };
}

export async function loadPeek(ref: MartPeekRef, lang: KitLang, opts: { fetchImpl?: typeof fetch } = {}): Promise<PeekState> {
  const type = ref.type ?? typeByForm(ref.id);
  if (!type) return { state: 'error', reason: appT(lang, 'peek.err.noType') };
  try {
    return { state: 'ok', data: toPeekCard(await fetchLoreRecord(type, ref.id, { fetchImpl: opts.fetchImpl }), lang) };
  } catch (e) {
    if (e instanceof RecordNotFound) return { state: 'missing' };
    if (e instanceof RecordForbidden) return { state: 'forbidden', reason: e.message };
    return { state: 'error', reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Карточка по ссылке: грузит запись и рисует PeekCard; «Повторить» — перезапрос. */
export function LorePeek({ peekRef, lang, fetchImpl }: { peekRef: MartPeekRef; lang: KitLang; fetchImpl?: typeof fetch }) {
  const [st, setSt] = useState<PeekState>({ state: 'loading' });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setSt({ state: 'loading' });
    void loadPeek(peekRef, lang, { fetchImpl }).then(s => { if (live) setSt(s); });
    return () => { live = false; };
  }, [peekRef.id, peekRef.type, lang, fetchImpl, n]);
  const retry = useCallback(() => setN(x => x + 1), []);
  return <PeekCard peek={st} id={peekRef.id} onRetry={retry} absoluteHref={h => new URL(h, window.location.href).toString()} />;
}

/** Источник Peek для MartProse: карточка LORE по ссылке [[…]]. */
export function loreRefPeek(lang: KitLang, opts: { enabled?: boolean; fetchImpl?: typeof fetch } = {}): MartRefPeek {
  return {
    render: r => <LorePeek peekRef={r} lang={lang} fetchImpl={opts.fetchImpl} />,
    title: r => appT(lang, 'peek.sheetTitle', { id: r.id }),
    enabled: opts.enabled,
  };
}

/** Источник Peek для списка: строка → карточка LORE; тип записи — вид строки (kind = тип LORE). */
export function loreListPeek(lang: KitLang, kindOf: (id: string) => string | null, fetchImpl?: typeof fetch): ListPeek {
  return {
    render: id => <LorePeek peekRef={{ id, type: kindOf(id) }} lang={lang} fetchImpl={fetchImpl} />,
    title: id => appT(lang, 'peek.sheetTitle', { id }),
  };
}
