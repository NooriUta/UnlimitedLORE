// Ряд фасетов в одну строку со свёрткой «+N» (SPRINT_UXR_POLISH_UAT_1113/PU-12).
//
// Общий для ListView и ControlBar (полоса таблиц паспорта): частный фикс обобщён до правила —
// любой ряд фасетов в сегменте фильтра не переносится, лишнее уходит в «+N фильтров».
//
// Бюджет — от КОНТЕЙНЕРА (переносится ли ряд), а не от окна: с открытым паспортом окно то же,
// а места у списка меньше. Усадка по факту переноса (offsetTop, допуск полвысоты), сброс — по
// ResizeObserver контейнера. Слот с заданным условием не прячется никогда. На телефоне ряд
// под кнопкой «Фильтры» и раскрывается целиком — свёртки нет.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { kitPlural, kitT, type KitLang } from '../i18n';

export interface FacetFold<K extends string> {
  /** На контейнер полосы (`.sk-list__controls`). */
  ref: RefObject<HTMLDivElement | null>;
  /** Слоты, которые рисовать (в исходном порядке). */
  shown: readonly K[];
  /** Кнопка «+N» / «Свернуть» — null, если сворачивать нечего. */
  more: React.ReactNode;
}

export function useFacetFold<K extends string>(
  slots: readonly K[], isActive: (k: K) => boolean, opts: { narrow: boolean; lang: KitLang },
): FacetFold<K> {
  const { narrow, lang } = opts;
  // Infinity — «ещё не мерили»: рисуем все и усаживаем по переносу.
  const [fits, setFits] = useState(Infinity);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fold = !narrow && !open && fits < slots.length;
  const activeSig = slots.map(k => (isActive(k) ? '1' : '0')).join('');
  const shown = useMemo(() => {
    if (!fold) return slots;
    const active = new Set(slots.filter(isActive));
    let room = Math.max(1, fits - 1) - active.size; // одно место — кнопке «+N»
    return slots.filter(k => active.has(k) || room-- > 0);
  }, [fold, fits, slots, activeSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = slots.length - shown.length;
  const sig = slots.join('|');
  useEffect(() => { setFits(Infinity); }, [sig]);
  // Ширина контейнера изменилась — мерить заново. Только ширина: высота меняется от наших же
  // правок, реакция на неё дала бы петлю. Первый вызов лишь запоминает ширину: clientWidth
  // (с отступами) и contentRect (без) различаются, и сравнение сбрасывало усадку (замер 13.11).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last: number | null = null;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (last === null) { last = w; return; }
      if (Math.abs(w - last) < 8) return;
      last = w;
      setFits(Infinity);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Усадка: ряд сегмента фильтра перенёсся — одним местом меньше. Перенос — сдвиг вниз больше
  // полувысоты (кнопка «+N» ниже фасета на 1 px из-за выравнивания по центру). Только вниз и
  // не меньше двух мест — петли нет. Группировка и порядок на узком списке стоят своими
  // строками и раньше — по ним не усаживаем.
  useEffect(() => {
    if (narrow || open) return;
    const seg = ref.current?.querySelector<HTMLElement>(':scope > .sk-list__seg[data-seg="filter"]');
    if (!seg) return;
    const els = Array.from(seg.children).filter(c => c.classList.contains('sk-facet') || c.classList.contains('sk-list__facetmore')) as HTMLElement[];
    const wraps = els.length > 1 && els.some(x => x.offsetTop > els[0].offsetTop + els[0].offsetHeight / 2);
    const used = shown.length + (hidden > 0 ? 1 : 0);
    if (used > 2 && wraps) setFits(used - 1);
  });
  const more = hidden > 0 || (open && !narrow && fits < slots.length) ? (
    <button type="button" className="sk-list__facetmore" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      {open ? kitT(lang, 'kit.list.facetsLess') : kitPlural(lang, 'kit.list.facetsMore', hidden)}
    </button>
  ) : null;
  return { ref, shown, more };
}
