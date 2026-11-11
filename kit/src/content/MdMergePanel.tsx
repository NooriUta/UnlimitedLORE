// MdMergePanel (SPRINT_UXR_S5_RECORD_TASKS/S5-08) — спор при сохранении:
// построчный дифф ТОЛЬКО спорных блоков и выбор «моё / их» по каждому.
// Неспорные блоки сюда не попадают — они уже слиты (blockMerge.mergeBlocks).
// Состояние выбора держит вызывающий (MdInlineEdit), панель только рисует.
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';
import { lineDiff, resolveMerge, type MergeChunk, type MergePicks } from './blockMerge';

export interface MdMergePanelProps {
  /** Куски слияния: ok — уже слито, conflict — спор. */
  chunks: readonly MergeChunk[];
  /** Кто правил запись, если сервер назвал. */
  by?: string | null;
  /** Выбор по спорам: индекс спора → чью версию взять. */
  picks: MergePicks;
  onPick: (index: number, pick: 'mine' | 'theirs') => void;
  /** Все споры решены — собрать текст. */
  onApply: () => void;
}

export function MdMergePanel({ chunks, by, picks, onPick, onApply }: MdMergePanelProps) {
  const lang = useKitLang();
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const disputes = chunks.filter((c): c is Extract<MergeChunk, { kind: 'conflict' }> => c.kind === 'conflict');
  return (
    <div className="sk-mdmerge" role="group" aria-label={t('kit.mdedit.merge.title', { n: disputes.length })}>
      <p className="sk-mdmerge__lead">
        {by ? t('kit.mdedit.merge.leadBy', { who: by }) : t('kit.mdedit.merge.lead')}
      </p>
      {disputes.map((c, k) => {
        const pick = picks[k];
        return (
          <section key={k} className="sk-mdmerge__block" aria-label={t('kit.mdedit.merge.block', { n: k + 1 })}>
            {/* Построчно: «их» → «моё». Общие строки — для опоры глаза. */}
            <ol className="sk-mdmerge__diff">
              {lineDiff(c.theirs, c.mine).map((d, i) => (
                <li key={i} className={`sk-mdmerge__line sk-mdmerge__line--${d.op}`}>
                  <span className="sk-mdmerge__who">
                    {d.op === 'del' ? t('kit.mdedit.merge.theirs') : d.op === 'add' ? t('kit.mdedit.merge.mine') : ''}
                  </span>
                  <span className="sk-mdmerge__text">{d.line}</span>
                </li>
              ))}
              {!c.mine && <li className="sk-mdmerge__line sk-mdmerge__line--note">{t('kit.mdedit.merge.mine')}: {t('kit.mdedit.merge.removed')}</li>}
              {!c.theirs && <li className="sk-mdmerge__line sk-mdmerge__line--note">{t('kit.mdedit.merge.theirs')}: {t('kit.mdedit.merge.removed')}</li>}
            </ol>
            <span className="sk-mdmerge__picks">
              <button type="button" className="sk-btn" aria-pressed={pick === 'mine'} onClick={() => onPick(k, 'mine')}>{t('kit.mdedit.merge.keepMine')}</button>
              <button type="button" className="sk-btn" aria-pressed={pick === 'theirs'} onClick={() => onPick(k, 'theirs')}>{t('kit.mdedit.merge.takeTheirs')}</button>
            </span>
          </section>
        );
      })}
      <button
        type="button"
        className="sk-btn sk-btn--primary"
        disabled={resolveMerge(chunks, picks) === null}
        onClick={onApply}
      >{t('kit.mdedit.merge.apply')}</button>
    </div>
  );
}
