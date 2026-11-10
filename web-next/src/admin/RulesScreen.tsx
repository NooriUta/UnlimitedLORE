// Экран «Правила CLAUDE» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-06).
//
// Слева — доки claude-rules, выбранный — в адресе (?adm-rule=doc_id). Справа —
// тело дока (MartProse) и блок версий. Вид блока версий выбирается по данным
// сервера (см. rules.ts): построчный дифф (kit DiffPreview) · смена тела по
// хешу · «сравнивать нечего». Дифф с ФАЙЛОМ на машине здесь не рисуется и не
// изображается: его считает MCP claude_rules_diff, и экран говорит это прямо.
import { EmptyState, Forbidden, LoadError, Pill, Skeleton, DiffPreview, useKitLang, useLoadState, useUrlParam } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { MartProse } from '@seidr/kit/content';
import { useAppT } from '../i18n';
import {
  diffView, fetchDocHistory, fetchRuleDoc, fetchRuleDocs, versionChange, versionDiff,
  type DocHistory, type RuleDoc, type RuleDocBody,
} from './rules';
import './Admin.css';

export interface RulesScreenProps {
  fetchImpl?: typeof fetch;
}

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : undefined);

export function RulesScreen({ fetchImpl }: RulesScreenProps) {
  const t = useAppT();
  const [sel, setSel] = useUrlParam('adm-rule');
  const res = useLoadState<RuleDoc[]>(signal => fetchRuleDocs({ signal, fetchImpl }), [fetchImpl]);
  const docs = res.data;

  let body;
  if (res.state === 'loading' && !docs) body = <Skeleton lines={6} label={t('admin.rules.loading')} />;
  else if (res.state === 'forbidden') body = <Forbidden reason={reasonOf(res.error)} />;
  else if (res.state === 'error' || !docs) body = <LoadError error={res.error} onRetry={res.reload} />;
  else if (docs.length === 0) body = <div data-testid="adm-rules-empty"><EmptyState title={t('admin.rules.empty')} /></div>;
  else {
    const current = docs.find(d => d.doc_id === sel) ?? null;
    body = (
      <>
        <div className="adm-chips" role="radiogroup" aria-label={t('admin.rules.pick')}>
          {docs.map(d => (
            <button key={d.doc_id} type="button" role="radio" className="adm-chip" aria-checked={current?.doc_id === d.doc_id}
              aria-pressed={current?.doc_id === d.doc_id} data-testid={`adm-rule-${d.doc_id}`} title={d.title ?? undefined}
              onClick={() => setSel(d.doc_id)}>{d.doc_id}</button>
          ))}
        </div>
        {sel && !current && <p className="adm-note" role="status">{t('admin.rules.unknownDoc', { id: sel })}</p>}
        {current ? <RuleDetail key={current.doc_id} id={current.doc_id} fetchImpl={fetchImpl} />
          : !sel && <p className="adm-dim">{t('admin.rules.pickHint')}</p>}
      </>
    );
  }
  return (
    <section className="adm" aria-labelledby="adm-rules-h">
      <h2 id="adm-rules-h" className="adm-h">{t('admin.rules.title')}</h2>
      <p className="adm-lead">{t('admin.rules.lead')}</p>
      <p className="adm-note" data-tone="inf" role="note" data-testid="adm-rules-file-note">{t('admin.rules.fileNote')}</p>
      {body}
    </section>
  );
}

function RuleDetail({ id, fetchImpl }: { id: string; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const doc = useLoadState<RuleDocBody>(signal => fetchRuleDoc(id, { signal, fetchImpl }), [id, fetchImpl]);
  const hist = useLoadState<DocHistory>(signal => fetchDocHistory(id, { signal, fetchImpl }), [id, fetchImpl], { rows: d => d.rows });

  let bodyEl;
  if (doc.state === 'loading' && !doc.data) bodyEl = <Skeleton lines={4} label={t('admin.rules.loadingDoc')} />;
  else if (doc.state === 'forbidden') bodyEl = <Forbidden reason={reasonOf(doc.error)} />;
  else if (doc.state === 'error' || !doc.data) bodyEl = <LoadError error={doc.error} onRetry={doc.reload} />;
  else if (doc.data.md === null) {
    bodyEl = <p className="adm-note" role="status">{doc.data.htmlOnly ? t('admin.rules.htmlOnly') : t('admin.rules.noBody')}</p>;
  } else bodyEl = <div className="adm-prose" data-testid="adm-rule-body"><MartProse text={doc.data.md} /></div>;

  let histEl;
  if (hist.state === 'loading' && !hist.data) histEl = <Skeleton lines={3} label={t('admin.rules.loadingHist')} />;
  else if (hist.state === 'forbidden') histEl = <Forbidden reason={reasonOf(hist.error)} />;
  else if (hist.state === 'error' || !hist.data) histEl = <LoadError error={hist.error} onRetry={hist.reload} />;
  else histEl = <VersionsBlock hist={hist.data} />;

  return (
    <div className="adm-rule">
      <div className="adm-access">
        <h3 className="adm-access__h">{t('admin.rules.versions')}</h3>
        {histEl}
      </div>
      {bodyEl}
    </div>
  );
}

function VersionsBlock({ hist }: { hist: DocHistory }) {
  const t = useAppT();
  const lang = useKitLang();
  const [ver, setVer] = useUrlParam('adm-ver');
  const view = diffView(hist.rows);
  const rows = hist.rows;
  const notes = (
    <>
      {hist.outsideScope && <p className="adm-note" role="status">{t('admin.rules.outsideScope')}</p>}
      {hist.attributionProblem !== null && (
        <p className="adm-note" role="status">{t('admin.rules.noAuthor', { reason: hist.attributionProblem })}</p>
      )}
    </>
  );

  if (view === 'none') {
    return (
      <div data-testid="adm-rule-diff" data-view="none">
        {notes}
        <p className="adm-note" data-tone="inf" role="status">
          {rows.length === 0 ? t('admin.rules.noVersions') : t('admin.rules.oneVersion')}
        </p>
      </div>
    );
  }

  const when = (iso: string | null) => {
    const m = kitMinute(iso);
    return m ? <span className="adm-mono" title={m.title}>{m.text}</span> : <span className="adm-missing">{t('admin.rules.noTime')}</span>;
  };

  if (view === 'bodies') {
    // Сравнивается выбранная версия с предыдущей; выбор — в адресе (?adm-ver=state_uid).
    const found = rows.findIndex(r => r.state_uid === ver);
    const to = found >= 1 ? found : rows.length - 1;
    const d = versionDiff(rows[to - 1].content_md ?? '', rows[to].content_md ?? '');
    return (
      <div data-testid="adm-rule-diff" data-view="bodies">
        {notes}
        <div className="adm-chips" role="radiogroup" aria-label={t('admin.rules.pickVersion')}>
          {rows.slice(1).map((r, i) => (
            <button key={r.state_uid} type="button" role="radio" className="adm-chip" aria-checked={i + 1 === to}
              aria-pressed={i + 1 === to} onClick={() => setVer(i + 1 === rows.length - 1 ? null : r.state_uid)}>
              {t('admin.rules.versionN', { n: i + 2 })}
            </button>
          ))}
        </div>
        <p className="adm-dim">{t('admin.rules.comparing', { from: to, to: to + 1 })} {when(rows[to].valid_from)}</p>
        {!d.exact && <p className="adm-note" role="status">{t('admin.rules.coarse')}</p>}
        <DiffPreview rows={d.rows} lang={lang} label={t('admin.rules.diffLabel')} />
      </div>
    );
  }

  return (
    <div data-testid="adm-rule-diff" data-view="hashes">
      {notes}
      <p className="adm-note" role="status" data-testid="adm-rules-no-bodies">{t('admin.rules.noBodies')}</p>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t('admin.col.since')}</th>
              <th scope="col">{t('admin.col.author')}</th>
              <th scope="col">{t('admin.col.hash')}</th>
              <th scope="col">{t('admin.col.body')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ch = versionChange(rows, i);
              return (
                <tr key={r.state_uid} data-testid={`adm-ver-${r.state_uid}`} data-change={ch}>
                  <th scope="row">{i + 1}</th>
                  <td>{when(r.valid_from)}</td>
                  <td>{r.author ?? <span className="adm-missing">{t('admin.rules.noAuthorShort')}</span>}</td>
                  <td>{r.content_hash ? <span className="adm-mono" title={r.content_hash}>{r.content_hash.slice(0, 10)}</span> : <span className="adm-missing">—</span>}</td>
                  <td>
                    {ch === 'changed' && <Pill>{t('admin.rules.change.changed')}</Pill>}
                    {ch === 'same' && <span className="adm-dim">{t('admin.rules.change.same')}</span>}
                    {ch === 'first' && <span className="adm-dim">{t('admin.rules.change.first')}</span>}
                    {ch === 'unknown' && <span className="adm-missing">{t('admin.rules.change.unknown')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
