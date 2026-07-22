// Подписи словарных значений продуктового слоя (PL-35).
//
// В корпусе значения хранятся техническими строками (`proposed`,
// `fully-dressed`, `sea-level`) — их понимают слайсы, MCP и валидация
// бэкенда. На экране они показывались КАК ЕСТЬ: интерфейс русский, значения
// английские. Это не недоперевод, а показ ключа хранения вместо подписи.
//
// Значения здесь НЕ меняются — только отображение. Обратное (перевести данные)
// сломало бы фильтры и запись.
import type { TFunction } from 'i18next';

/**
 * Общий разрешатель: ключ i18n по словарному значению, а неизвестное значение
 * возвращается КАК ЕСТЬ.
 *
 * Именно «как есть», а не «—»: словари в корпусе пополняются, и подмена
 * незнакомого значения прочерком спрятала бы новое значение ровно тогда, когда
 * его надо заметить — запись выглядела бы как запись без значения.
 */
function label(t: TFunction, ns: string, value: string | null | undefined, glyphs: Record<string, string> = {}): string {
  const v = (value ?? '').trim();
  if (!v) return '—';
  const key = `lore.product.vocab.${ns}.${v}`;
  const translated = t(key, { defaultValue: '' });
  if (!translated) return v;
  const g = glyphs[v];
  return g ? `${g} ${translated}` : translated;
}

/** Статус сценария/корня: proposed | active | shipped | dropped. */
export const ucStatusLabel = (t: TFunction, v: string | null | undefined) =>
  label(t, 'ucStatus', v);

/** Строгость изложения по Кокберну: casual | fully-dressed. */
export const rigorLabel = (t: TFunction, v: string | null | undefined) =>
  label(t, 'rigor', v, { casual: '⚡', 'fully-dressed': '📋' });

/** Уровень цели по Кокберну: cloud | kite | sea-level | subfunction. */
export const goalLevelLabel = (t: TFunction, v: string | null | undefined) =>
  label(t, 'goalLevel', v, { cloud: '☁', kite: '🪁', 'sea-level': '🌊', subfunction: '🐟' });

/** Тип работы по Остервальдеру: functional | social | emotional | supporting. */
export const jobKindLabel = (t: TFunction, v: string | null | undefined) =>
  label(t, 'jobKind', v);

/** Острота боли / важность работы: high | normal | low. */
export const levelLabel = (t: TFunction, v: string | null | undefined) =>
  label(t, 'level', v);

/** Ранг выгоды: essential | expected | desired | unexpected. */
export const gainRankLabel = (t: TFunction, v: string | null | undefined) =>
  label(t, 'gainRank', v);

/** Вид актора: human-role | system | agent. */
export const actorKindLabel = (t: TFunction, v: string | null | undefined) =>
  label(t, 'actorKind', v);
