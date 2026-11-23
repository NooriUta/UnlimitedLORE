// Шапка паспорта PR (SPRINT_LORE_MODEL_DOCS_TIDY/MD-05) — по прототипу docs/prototypes/md05-pr-passport.html,
// одобренному владельцем 23.11.2026: «все рекомендации ок».
//
// Что добавляет к общему паспорту (поля, вкладки и поле «Спринты» рисует он сам):
//  • ветки «откуда → куда» одной строкой и вид PR словом (1а) — из ветки-цели, тем же правилом, что сервер
//    различает промо при мерже (LoreForgejoResource: base preprod/main — промо или релиз);
//  • PR без заголовка — плашка kit sk-banner--warn общей фразой (3б): причины у PR не хранится, её знает только
//    отчёт дотяжки; поле причины — «3а после 1.19»;
//  • открытый PR — «не влит, ещё не в релизе» словами, а не пустое «Влит: —».
import { useKitLang, type KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';

export type PrKind = 'work' | 'promo' | 'release' | 'hotfix';

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * Вид PR по ветке-цели: develop — работа; preprod — промо; main из preprod или promote/* — релиз, иное в main —
 * срочная правка. Ветки-цели нет или она другая — null: вид не угадывается.
 */
export function prKind(head: unknown, base: unknown): PrKind | null {
  const b = s(base), h = s(head) ?? '';
  if (b === 'develop') return 'work';
  if (b === 'preprod') return 'promo';
  if (b === 'main') return h === 'preprod' || h.startsWith('promote/') ? 'release' : 'hotfix';
  return null;
}

export interface PrHeadLineProps {
  /** Значения паспорта PR (фасад lore.record/1): title, code, head_ref, base_ref, state, merged_at. */
  values: Record<string, unknown>;
  /** Язык; нет — язык приложения. */
  lang?: KitLang;
}

export function PrHeadLine({ values, lang }: PrHeadLineProps) {
  const appLang = useKitLang();
  const t = (k: AppKey) => appT(lang ?? appLang, k);
  const head = s(values.head_ref), base = s(values.base_ref);
  const kind = prKind(head, base);
  // Сервер подписывает PR без заголовка ключом (FIRST_OF title, pr_uid): подпись = код — заголовка нет.
  const code = s(values.code);
  const noTitle = !s(values.title) || (code !== null && s(values.title) === code);
  const notMerged = s(values.state) === 'open' && !s(values.merged_at);
  if (!head && !base && !noTitle && !notMerged) return null;
  return (
    <div className="pr-head">
      {(head || base) && (
        <p className="pr-head__branches" data-testid="pr-head" aria-label={t('prHead.branches')}>
          {kind && <span className="pr-head__kind" data-testid="pr-kind">{t(`prHead.kind.${kind}` as AppKey)}</span>}
          <b>{head ?? '—'}</b><span aria-hidden="true">→</span><b>{base ?? '—'}</b>
        </p>
      )}
      {notMerged && <p className="pr-head__note" data-testid="pr-notmerged">{t('prHead.notMerged')}</p>}
      {noTitle && <div role="status" className="sk-banner sk-banner--warn" data-testid="pr-notitle">{t('prHead.noTitle')}</div>}
    </div>
  );
}
