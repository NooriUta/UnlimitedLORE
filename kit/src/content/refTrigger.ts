// Ссылка на запись прямо в MD — чистые правила без UI (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW,
// spec:SPEC-LORE-MD-INLINE-REF §2 и §3a, ADR-LORE-050).
//
// • detectRefTrigger — открывать ли мини-окно по тексту ДО курсора: «[[», «@», «#тип» / «@#тип».
// • refsInMd — какие ссылки [[…]] уже стоят в теле (проверка «есть / нет», меню «Дозавести»).
// • wrapBareRefs — голые ID при вставке копипастом → [[тип:ID]].
//
// Kit знает только ФОРМУ (K-14): какие слова после «#» — типы и как выглядят голые ID,
// передаёт приложение. Без них kit ничего не сужает и ничего не оборачивает.
// Внутри кода (inline и ``` блоки) ничто из этого не срабатывает — как у markdownWiki.ts.

export type RefTriggerKind = 'brackets' | 'at' | 'hash';

export interface RefTrigger {
  trigger: RefTriggerKind;
  /** тип записи, если поиск сужен; null — по всем типам */
  type: string | null;
  /** слово после «#», которого нет в словаре типов: окно говорит «тип не знаем» */
  unknownType?: string;
  /** набранное после вызова — запрос поиска */
  query: string;
  /** позиция начала вызова: отсюда до курсора текст заменяется ссылкой */
  start: number;
}

export interface RefTriggerOptions {
  /** «слово после #» (в нижнем регистре) → тип записи; синонимы — разными ключами */
  types: Record<string, string>;
}

export interface MdRef { id: string; type: string | null }

export interface BareRefForm { type: string; re: RegExp }

/** Курсор внутри кода? Незакрытый ``` выше или нечётное число ` в текущей строке. */
function inCode(before: string): boolean {
  const fences = before.match(/^```/gm)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}

const lineStartOf = (s: string, pos: number) => s.lastIndexOf('\n', pos - 1) + 1;

export function detectRefTrigger(before: string, opts: RefTriggerOptions): RefTrigger | null {
  if (inCode(before)) return null;
  const typeOf = (w: string) => opts.types[w.toLowerCase()] ?? null;

  // «[[» … до курсора, без закрывающих скобок
  let m = /\[\[([^[\]\n]{0,200})$/.exec(before);
  if (m) {
    const inner = m[1];
    const typed = /^([^\s:]+):(.*)$/.exec(inner);
    const ty = typed ? typeOf(typed[1]) : null;
    return { trigger: 'brackets', type: ty, query: ty && typed ? typed[2] : inner, start: m.index };
  }

  // «#тип» или «@#тип», дальше по желанию пробел и слова запроса
  m = /(^|\s)(@?)#([\p{L}\p{N}_-]+)(?:\s([^\n@#[]{0,80}))?$/u.exec(before);
  if (m) {
    const start = m.index + m[1].length;
    // «#…» без «@» в начале строки — это заголовок Markdown, а не вызов
    if (!m[2] && start === lineStartOf(before, start)) return null;
    const ty = typeOf(m[3]);
    if (!ty) return { trigger: 'hash', type: null, unknownType: m[3], query: '', start };
    return { trigger: 'hash', type: ty, query: m[4] ?? '', start };
  }

  // «@» только после пробела или в начале строки (a@b — почта)
  m = /(^|\s)@([^\s@#][^\n@#[]{0,80})?$/.exec(before);
  if (m) return { trigger: 'at', type: null, query: m[2] ?? '', start: m.index + m[1].length };

  return null;
}

/** Делит MD на куски «код / не код»: ``` блоки и `inline`. Остальные правила работают только по «не код». */
function splitCode(md: string): Array<{ code: boolean; text: string }> {
  const out: Array<{ code: boolean; text: string }> = [];
  const push = (code: boolean, text: string) => { if (text) out.push({ code, text }); };
  const blocks = md.split(/(^```[^\n]*\n[\s\S]*?(?:^```[^\n]*$|(?![\s\S])))/m);
  blocks.forEach((b, i) => {
    if (i % 2 === 1) { push(true, b); return; }
    const parts = b.split(/(`[^`\n]*`)/);
    parts.forEach((p, j) => push(j % 2 === 1, p));
  });
  return out;
}

const REF = /\[\[([^[\]\n]{1,200})\]\]/g;

export function refsInMd(md: string): MdRef[] {
  const seen = new Set<string>();
  const out: MdRef[] = [];
  for (const seg of splitCode(md)) {
    if (seg.code) continue;
    for (const m of seg.text.matchAll(REF)) {
      const inner = m[1].trim();
      const typed = /^([a-z]+):(.+)$/i.exec(inner);
      const id = typed ? typed[2].trim() : inner;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, type: typed ? typed[1].toLowerCase() : null });
    }
  }
  return out;
}

const EDGE = '[^\\p{L}\\p{N}_/-]';

export function wrapBareRefs(text: string, forms: BareRefForm[]): string {
  if (!forms.length) return text;
  for (const f of forms) {
    // число захватывающих групп формы: у пустого совпадения длина массива = 1 + групп
    const groups = new RegExp(`${f.re.source}|`, 'u').exec('')!.length - 1;
    if (groups > 0) throw new Error(`wrapBareRefs: в форме «${f.type}» есть захватывающие группы (${groups}) — используйте (?:…), иначе тип ссылки определится неверно`);
  }
  const re = new RegExp(`(^|${EDGE})(?:${forms.map(f => `(${f.re.source})`).join('|')})(?=$|${EDGE})`, 'gu');
  return splitCode(text).map(seg => {
    if (seg.code) return seg.text;
    // уже обёрнутые [[…]] не трогаем
    return seg.text.split(/(\[\[[^[\]\n]*\]\])/).map((part, i) => i % 2 === 1 ? part
      : part.replace(re, (whole, pre: string, ...groups: unknown[]) => {
        const k = groups.findIndex((g, gi) => gi < forms.length && typeof g === 'string');
        return k < 0 ? whole : `${pre}[[${forms[k].type}:${groups[k] as string}]]`;
      })).join('');
  }).join('');
}
