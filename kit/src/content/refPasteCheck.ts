// Проверка ссылок при вставке (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW §3a, D-2026-LORE-MD-REF-PASTE-CHECK,
// spec:SPEC-LORE-MD-INLINE-REF §3a). Две чистые части, которые TipTapField собирает вместе:
//  · pasteRefNodes — текст вставки → узлы: голые ID по формам приложения становятся атомами
//    [[тип:ID]] (как круг «MD → TipTap → MD»: текстом сериализатор экранировал бы «[[»);
//  · refCheckStates — ответ приложения «есть / нет / не смогли» → отметка: ok | missing | unknown.
//    «Не смогли проверить» НЕ красится в красный: отказ проверки — не «записи нет».
import { refsInMd, wrapBareRefs, type BareRefForm } from './refTrigger';

export type PasteNode =
  | { type: 'text'; text: string }
  | { type: 'hardBreak' }
  | { type: 'mdRaw'; attrs: { raw: string; kind: 'wikilink' } };

export type RefCheckState = 'ok' | 'missing' | 'unknown';

/** Узлы вставки с обёрнутыми ID; нечего оборачивать — null (вставка идёт обычным путём). */
export function pasteRefNodes(text: string, forms: readonly BareRefForm[]): PasteNode[] | null {
  if (!forms.length || !text) return null;
  const wrapped = wrapBareRefs(text, [...forms]);
  if (wrapped === text) return null;
  const out: PasteNode[] = [];
  const pushText = (s: string) => {
    s.split('\n').forEach((line, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (line) out.push({ type: 'text', text: line });
    });
  };
  for (const [i, part] of wrapped.split(/(\[\[[^[\]\n]*\]\])/).entries()) {
    if (i % 2 === 1) out.push({ type: 'mdRaw', attrs: { raw: part, kind: 'wikilink' } });
    else if (part) pushText(part);
  }
  return out;
}

/** Ответ проверки → отметки; ID без ответа — «не смогли проверить». */
export function refCheckStates(ids: readonly string[], answer: Record<string, boolean | null | undefined>): Record<string, RefCheckState> {
  return Object.fromEntries(ids.map(id => [id, answer[id] === true ? 'ok' : answer[id] === false ? 'missing' : 'unknown']));
}

/** Ключ отметки по исходнику атома: «[[тип:ID]]» / «[[ID]]» → ID. */
export function refIdOfRaw(raw: string): string | null {
  const r = refsInMd(raw)[0];
  return r ? r.id : null;
}
