// Автор правки: ответ сервера LORE → нейтральный автор kit (K-14, S7B-23_2).
// Сервер LORE отдаёт автора в своей модели учёток: человек — kc_sub и имя,
// агент — client_id, его актор, сессия и kc_sub владельца. kit этой модели не знает:
// ему нужен идентификатор вызывающего (им же фильтрует сервер), подпись и владелец.
import type { KitHistoryAuthor } from '@seidr/kit';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function loreAuthor(raw: unknown): KitHistoryAuthor {
  if (!raw || typeof raw !== 'object') return { kind: 'unknown' };
  const a = raw as Record<string, unknown>;
  if (a.kind === 'human') return { kind: 'human', id: str(a.kc_sub) ?? str(a.caller) ?? '', name: str(a.display_name) };
  if (a.kind === 'agent') return { kind: 'agent', id: str(a.client_id) ?? str(a.caller) ?? '', name: null, owner: str(a.owner_kc_sub) };
  // Автора не установили — так и говорим. «unknown» ≠ «правил никто».
  return { kind: 'unknown' };
}
