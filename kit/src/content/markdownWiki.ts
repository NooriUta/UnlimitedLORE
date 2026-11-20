// Вики-ссылки [[…]] в чтении MD (владелица 08.11: «рамочка вокруг, а не явное повторение [[ ]]»).
// Расширение marked — подключено в общем markdown.ts, поэтому работает во всех читающих рендерах.
// Исходник не меняется: [[ID]] остаётся в markdown, правка и экспорт видят его как есть.
// Формы — как у ссылок LORE в miniLORE (splitLoreRefs): [[ID]] и [[тип:ID]]; тип уходит в подсказку.
// Внутри кода не срабатывает: inline-код и блоки кода marked разбирает раньше нашего правила.
import type { MarkedExtension, Tokens } from 'marked';

interface WikiToken extends Tokens.Generic { type: 'wikiRef'; raw: string; ref: string; refType: string | null }

const RE = /^\[\[([^\[\]\n]{1,200})\]\]/;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function markedWiki(): MarkedExtension {
  return {
    extensions: [{
      name: 'wikiRef',
      level: 'inline',
      start: (src: string) => { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
      tokenizer(src: string): WikiToken | undefined {
        const m = RE.exec(src);
        if (!m) return undefined;
        const inner = m[1].trim();
        const typed = /^([a-z]+):(.+)$/i.exec(inner);
        return { type: 'wikiRef', raw: m[0], ref: typed ? typed[2].trim() : inner, refType: typed ? typed[1].toLowerCase() : null };
      },
      renderer(token) {
        const t = token as WikiToken;
        // SUPERTAGS: [[ЗАПИСЬ#тег]] — чип тега (значения полей — на ребре, в тексте только токен)
        const tg = /^(.+?)#([\p{L}\p{N}][\p{L}\p{N}_.-]*)$/u.exec(t.ref);
        if (tg) return `<span class="sk-wref sk-wref--tag" data-ref="${esc(tg[1])}" data-tag="${esc(tg[2])}" title="${esc(`${tg[1]} · #${tg[2]}`)}">#${esc(tg[2])}</span>`;
        const type = t.refType ? ` data-ref-type="${esc(t.refType)}" title="${esc(`${t.refType}: ${t.ref}`)}"` : ` title="${esc(t.ref)}"`;
        return `<span class="sk-wref" data-ref="${esc(t.ref)}"${type}>${esc(t.ref)}</span>`;
      },
    }],
  };
}
