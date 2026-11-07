// Вкладка «Журнал» (K-04): изменения этой записи из X_DATA.journal — новые
// сверху, агент помечен, кто согласовал — словами. Упавший блок журнала на
// сервере (meta.errors block 'journal') — ошибка, а не «журнал пуст».
import type { KitCtx, KitJournalEntry, KitRecord } from '../core/contract';
import { EmptyState, LoadError } from '../states/StateViews';
import { kitT, type KitLang } from '../i18n';
import { blockError } from './RecordLinks';
import { valueText } from './fmt';

export function recordJournal(id: string, journal: readonly KitJournalEntry[]): KitJournalEntry[] {
  return journal.filter(j => j.record_id === id).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function RecordJournal({ record, ctx, lang }: { record: KitRecord; ctx: KitCtx; lang: KitLang }) {
  const failed = blockError(ctx, 'journal');
  if (failed !== undefined) return <LoadError compact title={kitT(lang, 'kit.record.journal.failed')} error={failed} />;
  const rows = recordJournal(record.id, ctx.data.journal);
  if (rows.length === 0) {
    return <EmptyState compact title={kitT(lang, 'kit.record.journal.empty')} hint={kitT(lang, 'kit.record.journal.emptyHint')} />;
  }
  return (
    <ol className="sk-rec-journal">
      {rows.map((j, i) => (
        <li key={`${j.at}:${j.field}:${i}`} className="sk-rec-journal__row" data-testid="kit-journal-row"
          data-agent={j.is_agent ? 'true' : undefined}>
          <time className="sk-rec-journal__at" dateTime={j.at}>{j.at.replace('T', ' ').slice(0, 16)}</time>
          <span className="sk-rec-journal__who">
            {j.who}
            {j.is_agent && <span className="sk-pill sk-pill--value sk-rec-journal__agent">{kitT(lang, 'kit.record.journal.agent')}</span>}
          </span>
          <code className="sk-rec-journal__field">{j.field}</code>
          <span className="sk-rec-journal__change">
            <del className="sk-rec-journal__from">{valueText(j.from)}</del>
            <span aria-hidden="true"> → </span>
            <ins className="sk-rec-journal__to">{valueText(j.to)}</ins>
          </span>
          {j.approved_by && (
            <span className="sk-rec-journal__approved">{kitT(lang, 'kit.record.journal.approved', { who: j.approved_by })}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
