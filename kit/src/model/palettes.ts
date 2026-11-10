// Палитры из модели (SPRINT_UXR_S10_SEIDR_KIT/K-14, п. 5).
//
// Список палитр — прикладной словарь, такой же, как список статусов, и внутри
// kit ему не место: завтра на kit собирают другое приложение, и его палитры
// kit отверг бы. Поэтому список приходит данными, а в kit остаётся только
// ТЕМА — значения цветов (`--swatch-*`), потому что это оформление, а не
// словарь (согласовано с серверной сессией 10.11.2026).
//
// Форма раздела — от сервера (PR #1069), не угадана:
//   palettes: {source, default, entries: [{code, title, title_en, order, in_dictionary}]}
// Коды и умолчание — из того же белого списка, что принимает настройка
// `palette`: модель не предложит палитру, которую сервер не даст сохранить.
//
// Три разных «нет», и они не сливаются в одно:
//  1. раздела не прислали (старый сервер) — `sent: false`; приложение покажет
//     свой список как УМОЛЧАНИЕ и скажет об этом;
//  2. палитра есть, статьи в справочнике нет — показан код плюс оговорка;
//  3. палитра есть в модели, цветов нет в теме — образца нет плюс оговорка.

export interface ModelPaletteEntry {
  code: string;
  /** Подпись из справочника; её нет — код (и об этом есть оговорка). */
  title: string;
  titleEn?: string;
  order?: number;
  inDictionary: boolean;
  /** Токен образца, если тема его знает; иначе null — рисовать нечем. */
  swatch: string | null;
}

export interface ModelPalettes {
  /** Раздел пришёл (пусть и пустым). false — «не прислали». */
  sent: boolean;
  entries: ModelPaletteEntry[];
  /** Умолчание сервера; null — не прислали. */
  default: string | null;
  source: string | null;
  /** Честные оговорки для экрана; пусто — сказать нечего. */
  notes: string[];
}

export interface PalettesFromModelOptions {
  /** Коды палитр, цвета которых есть в теме. Не задано — проверку не делаем. */
  known?: readonly string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function palettesFromModel(model: unknown, opts: PalettesFromModelOptions = {}): ModelPalettes {
  const root = obj(model);
  const notes: string[] = [];
  const missing = Array.isArray(root?.missing) ? (root!.missing as unknown[]).map(str) : [];
  const section = obj(root?.palettes);

  // ЛОВУШКА, на которой я уже обжигался с surfaces (S4-29): загрузчик
  // нормализует отсутствующий раздел в ПУСТОЙ ОБЪЕКТ (`obj(doc.palettes)`).
  // Поэтому «ключей нет вовсе» — это «не прислали», а не «прислали мусор»:
  // иначе старый сервер на проде получал бы жалобу «раздел пришёл не списком»
  // о разделе, которого он не присылал.
  const absent = !root || !section || Object.keys(section).length === 0 || missing.includes('palettes');
  if (absent) {
    notes.push('Раздел палитр модель не прислала — список взят из темы kit как умолчание.');
    return { sent: false, entries: [], default: null, source: null, notes };
  }

  const rows = Array.isArray(section.entries) ? section.entries : null;
  if (!rows) {
    notes.push('Раздел палитр пришёл не списком — читать его нечем, список взят из темы kit как умолчание.');
    return { sent: false, entries: [], default: null, source: str(section.source) || null, notes };
  }

  const noTitle: string[] = [];
  const noTheme: string[] = [];
  const entries: ModelPaletteEntry[] = [];
  for (const raw of rows) {
    const r = obj(raw);
    if (!r) continue;
    const code = str(r.code);
    // Пункт без кода в выбор не ставим: пустая кнопка хуже отсутствующей.
    if (!code) continue;
    const inDict = r.in_dictionary === true;
    const title = str(r.title);
    if (!inDict || !title) noTitle.push(code);
    const known = opts.known;
    const hasTheme = known ? known.includes(code) : true;
    if (!hasTheme) noTheme.push(code);
    entries.push({
      code,
      title: inDict && title ? title : code,
      ...(str(r.title_en) ? { titleEn: str(r.title_en) } : {}),
      ...(num(r.order) !== undefined ? { order: num(r.order) } : {}),
      inDictionary: inDict,
      swatch: hasTheme ? `var(--swatch-${code})` : null,
    });
  }

  // Порядок устойчивый: order, затем код. Иначе список прыгает между ответами.
  entries.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code));

  const def = str(section.default) || null;
  if (!entries.length) notes.push('Раздел палитр пришёл пустым — выбирать нечего.');
  if (noTitle.length) notes.push(`Палитры без статьи в справочнике — показан код: ${noTitle.join(', ')}.`);
  if (noTheme.length) notes.push(`Палитры есть в модели, а цветов в теме kit нет — образец не нарисован: ${noTheme.join(', ')}.`);
  if (def && entries.length && !entries.some(e => e.code === def)) {
    notes.push(`Умолчание модели «${def}» в списке палитр отсутствует.`);
  }

  return { sent: true, entries, default: def, source: str(section.source) || null, notes };
}
