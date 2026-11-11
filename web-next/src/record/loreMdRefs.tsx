// Ссылки на записи прямо в MD-полях LORE (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050,
// spec:SPEC-LORE-MD-INLINE-REF). Kit (TipTapField, RefPicker) знает только форму окна;
// здесь — смысл: какие слова после «#» и в «[[тип:» означают типы LORE, их подписи и поиск.
//
// Поиск — существующий слайс search (тот же, что у палитры): отказ сервера бросается
// с причиной, и окно говорит «не смогли загрузить», а не «не нашлось».
// Карточки «Новый» пока нет: создание из окна ждёт SPRINT_UXR_S10_SEIDR_KIT_2/MD-REQUIRED
// (обязательные поля из модели) — без него форма требовала бы поля наугад.
import { useMemo } from 'react';
import { useKitLang, type KitLang, type MdEditorSlotProps } from '@seidr/kit';
import { MdInlineEdit, type TipTapRefSource, type RefItem } from '@seidr/kit/content';
import { fetchSearchSlice, type SearchSliceOptions } from '../api/searchSlice';
import { appT, type AppKey } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import { loreRefPeek } from './lorePeek';
import { typeByForm } from './loreRefForms';

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

/** Сколько пунктов показывать в окне: длиннее — уточняют запрос. */
const MAX_ITEMS = 20;

export function loreMdRefs(lang: KitLang, opts: Pick<SearchSliceOptions, 'fetchImpl' | 'headers'> = {}): TipTapRefSource {
  const typeLabels = Object.fromEntries(Object.entries(LABEL_KEY).map(([t, k]) => [t, appT(lang, k)]));
  return {
    types: WORDS,
    typeLabels,
    minQuery: 2,
    async search(query, type): Promise<RefItem[]> {
      const { rows } = await fetchSearchSlice(query.trim(), { ...opts, lang });
      return rows
        .filter(r => r.type in LABEL_KEY && (!type || r.type === type))
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

/** Правка MD-поля записи с окном ссылок — то же MdInlineEdit, плюс источник ссылок LORE. */
export function MdInlineEditWithRefs(props: MdEditorSlotProps) {
  const lang = useKitLang();
  const refs = useMemo(() => loreMdRefs(lang), [lang]);
  const peek = useMemo(() => loreRefPeek(lang), [lang]);
  return <MdInlineEdit {...props} refs={refs} refHref={loreRefHref} refPeek={peek} />;
}
