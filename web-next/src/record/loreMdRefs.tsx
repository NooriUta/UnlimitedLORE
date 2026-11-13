// Ссылки на записи прямо в MD-полях LORE (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050,
// spec:SPEC-LORE-MD-INLINE-REF). Kit (TipTapField, RefPicker) знает только форму окна;
// здесь — смысл: какие слова после «#» и в «[[тип:» означают типы LORE, их подписи и поиск.
//
// Поиск — существующий слайс search (тот же, что у палитры): отказ сервера бросается
// с причиной, и окно говорит «не смогли загрузить», а не «не нашлось».
// Карточка «Новый» (11.11.2026, после MD-REQUIRED): поля — из модели LORE, правила
// владелицы — в loreRefCreate.ts (родитель обязателен, автор — кто пишет, исполнитель — «Себя»).
import { useMemo, type ComponentType } from 'react';
import { useKitLang, type KitLang, type MdEditorSlotProps } from '@seidr/kit';
import { MdInlineEdit, type LiveBlocks, type TipTapRefSource, type RefItem } from '@seidr/kit/content';
import { fetchSearchSlice, type SearchSliceOptions } from '../api/searchSlice';
import { appT, type AppKey } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import { loreRefPeek } from './lorePeek';
import { appliedPeekHover } from '../settings/applied';
import { typeByForm } from './loreRefForms';
import { LORE_ID_FORMS, loreRefsExist } from './loreRefPaste';
import { cachedModelType, createLoreRecord, createSpecFor, warmCreateModel } from './loreRefCreate';
import { v2Auth } from '../auth/session';

export { typeByForm };

/** Слово (нижний регистр) → тип LORE. Латиница — как в [[тип:ID]], русские синонимы — для набора. */
const WORDS: Record<string, string> = {
  adr: 'adr', 'адр': 'adr',
  task: 'task', 'задача': 'task',
  spec: 'spec', 'спека': 'spec',
  decision: 'decision', 'решение': 'decision',
  doc: 'doc', 'док': 'doc',
  sprint: 'sprint', 'спринт': 'sprint',
  runbook: 'runbook', 'ранбук': 'runbook',
  uc: 'use_case', 'сценарий': 'use_case',
};

const LABEL_KEY: Record<string, AppKey> = {
  adr: 'mdref.type.adr',
  task: 'mdref.type.task',
  spec: 'mdref.type.spec',
  decision: 'mdref.type.decision',
  doc: 'mdref.type.doc',
  sprint: 'mdref.type.sprint',
  runbook: 'mdref.type.runbook',
  use_case: 'mdref.type.use_case',
};

/**
 * Люди — только на «@» (развилка 7, вариант б владелицы 12.11.2026: «@» — объекты и люди одним
 * списком). «[[» и «#тип» остаются ссылками на записи.
 */
const PEOPLE_KEY: Record<string, AppKey> = { actor: 'mdref.type.actor' };

/** Сколько пунктов показывать в окне: длиннее — уточняют запрос. */
const MAX_ITEMS = 20;

/** Контекст карточки «Новый»: родители записи, в которой пишут, и кто пишет. */
export interface LoreRefCreateCtx { parents: Record<string, string>; me?: () => string | null }

export function loreMdRefs(lang: KitLang, opts: Pick<SearchSliceOptions, 'fetchImpl' | 'headers'> & { create?: LoreRefCreateCtx } = {}): TipTapRefSource {
  const typeLabels = Object.fromEntries(Object.entries({ ...LABEL_KEY, ...PEOPLE_KEY }).map(([t, k]) => [t, appT(lang, k)]));
  const create = opts.create;
  const me = () => (create?.me ? create.me() : v2Auth.getState().user?.name ?? null);
  if (create) warmCreateModel(opts.fetchImpl);
  return {
    ...(create ? {
      createSpec: (type: string) => {
        const { model, loading } = cachedModelType(type);
        if (!model && loading) return { denied: appT(lang, 'mdref.modelLoading') };
        return createSpecFor(type, model, { me: me(), parents: create.parents }, lang);
      },
      onCreate: (type: string, values: Record<string, string>) =>
        createLoreRecord(type, values, { me: me(), parents: create.parents }, opts.fetchImpl),
    } : {}),
    types: WORDS,
    typeLabels,
    minQuery: 2,
    // MD-WINDOW §3a: голые ID при вставке → [[тип:ID]], и сразу проверка, есть ли записи.
    forms: LORE_ID_FORMS,
    exists: refs => loreRefsExist(refs, opts.fetchImpl),
    async search(query, type, trigger): Promise<RefItem[]> {
      const { rows } = await fetchSearchSlice(query.trim(), { ...opts, lang });
      const allowed = (t: string) => t in LABEL_KEY || (trigger === 'at' && t in PEOPLE_KEY);
      return rows
        .filter(r => allowed(r.type) && (!type || r.type === type))
        .slice(0, MAX_ITEMS)
        .map(r => ({ id: r.ref_id, type: r.type, title: r.title ?? '' }));
    },
  };
}

/**
 * Куда ведёт [[ссылка]] в чтении (SPRINT_UXR_S10_SEIDR_KIT_2/MD-READ-PEEK): паспорт записи её типа.
 * Тип не задан и не узнан по форме или его в v2 открыть негде — null: рамка остаётся без ссылки.
 */
export function loreRefHref(ref: { id: string; type: string | null }): string | null {
  const type = ref.type ?? typeByForm(ref.id);
  return type ? recordHref(type, ref.id) : null;
}

/**
 * Редактор MD-полей записи с окном ссылок и карточкой «Новый», знающий контекст записи
 * (её родителей): новая задача из текста спринта сразу кладётся в этот спринт.
 * blocks — живые блоки записи (S6-04): lore-query/lore-graph исполняются и в правимом поле.
 */
export function mdEditorWithRefs(parents: Record<string, string>, blocks?: (lang: KitLang) => LiveBlocks): ComponentType<MdEditorSlotProps> {
  return function MdInlineEditWithRefsIn(props: MdEditorSlotProps) {
    const lang = useKitLang();
    const key = JSON.stringify(parents);
    const refs = useMemo(() => loreMdRefs(lang, { create: { parents } }), [lang, key]); // eslint-disable-line react-hooks/exhaustive-deps
    const peek = useMemo(() => loreRefPeek(lang, { enabled: appliedPeekHover() }), [lang]);
    return <MdInlineEdit {...props} refs={refs} refHref={loreRefHref} refPeek={peek} blocks={blocks?.(lang)} />;
  };
}

/** Правка MD-поля записи с окном ссылок — то же MdInlineEdit, плюс источник ссылок LORE. */
export function MdInlineEditWithRefs(props: MdEditorSlotProps) {
  const lang = useKitLang();
  const refs = useMemo(() => loreMdRefs(lang), [lang]);
  const peek = useMemo(() => loreRefPeek(lang, { enabled: appliedPeekHover() }), [lang]);
  return <MdInlineEdit {...props} refs={refs} refHref={loreRefHref} refPeek={peek} />;
}
