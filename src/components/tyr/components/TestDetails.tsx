import { useEffect, useRef, useState } from 'react';
import { api, TestDetail, TestNode, TestStatus } from '../api';

interface Props {
  node: TestNode;
  onRun: (descr: string, filter: string) => void;
  onEdit?: (file: string) => void;
  /** Вызывается после любого изменения мета — чтобы App обновил tree.nodes и перерисовал фильтры. */
  onNodeChange?: (id: string, patch: { status?: TestStatus }) => void;
  busy: boolean;
}

const SEVERITY_COLOR: Record<string, string> = {
  blocker:  'var(--danger)',
  critical: 'var(--danger)',
  normal:   'var(--wrn)',
  minor:    'var(--inf)',
  trivial:  'var(--t3)',
};

const SEVERITY_OPTIONS = ['blocker', 'critical', 'normal', 'minor', 'trivial'];

type Meta = NonNullable<TestDetail['meta']>;

// ── Inline tag-chip input ─────────────────────────────────────────────────────
function TagsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string): void => {
    const tag = raw.trim().replace(/^#/, '');
    if (!tag || value.includes(tag)) { setInput(''); return; }
    onChange([...value, tag]);
    setInput('');
  };

  const remove = (tag: string): void => onChange(value.filter((t) => t !== tag));

  return (
    <div className="tags-input" onClick={() => inputRef.current?.focus()}>
      {value.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
          <button type="button" className="tag-chip-remove" onClick={(e) => { e.stopPropagation(); remove(t); }}>×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="tags-input-field"
        value={input}
        placeholder={value.length === 0 ? 'тег, Enter' : '+'}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); }
          if (e.key === 'Backspace' && !input && value.length > 0) remove(value[value.length - 1]);
        }}
        onBlur={() => { if (input.trim()) add(input); }}
      />
    </div>
  );
}

// ── Meta edit form ────────────────────────────────────────────────────────────
function MetaEditForm({
  detail,
  onSave,
  onCancel,
}: {
  detail: TestDetail;
  onSave: (patch: Omit<Meta, 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
}) {
  const src = detail.allure;
  const ov: NonNullable<TestDetail['meta']> = detail.meta ?? { updatedAt: '' };

  const [status,   setStatus]   = useState<TestStatus | ''>(ov.status ?? '');
  const [note,     setNote]     = useState(ov.note     ?? '');
  const [owner,    setOwner]    = useState(ov.owner    ?? src.owner    ?? '');
  const [severity, setSeverity] = useState(ov.severity ?? src.severity ?? '');
  const [tags,     setTags]     = useState<string[]>(ov.tags    ?? src.tags    ?? []);
  const [epic,     setEpic]     = useState(ov.epic     ?? src.epic     ?? '');
  const [feature,  setFeature]  = useState(ov.feature  ?? src.feature  ?? '');
  const [story,    setStory]    = useState(ov.story    ?? src.story    ?? '');
  const [saving,   setSaving]   = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave({
        status:   status   || undefined,
        note:     note     || undefined,
        owner:    owner    || undefined,
        severity: severity || undefined,
        tags:     tags.length > 0 ? tags : undefined,
        epic:     epic     || undefined,
        feature:  feature  || undefined,
        story:    story    || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meta-edit-form">
      <div className="mef-title">✏️ Редактировать метаданные <span className="mef-note">хранится в БД, не меняет spec</span></div>

      <div className="mef-grid">
        <label className="mef-label">Статус</label>
        <select className="mef-select" value={status} onChange={(e) => setStatus(e.target.value as TestStatus | '')}>
          <option value="">— не задан —</option>
          <option value="active">✓ active</option>
          <option value="planned">📝 planned</option>
          <option value="blocked">🚧 blocked</option>
          <option value="freeze">❄️ freeze</option>
          <option value="deprecated">✗ deprecated</option>
        </select>

        <label className="mef-label">Severity</label>
        <select className="mef-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">— из кода —</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label className="mef-label">Owner</label>
        <input className="mef-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="@username или команда" />

        <label className="mef-label">Epic</label>
        <input className="mef-input" value={epic} onChange={(e) => setEpic(e.target.value)} placeholder="название эпика" />

        <label className="mef-label">Feature</label>
        <input className="mef-input" value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="название фичи" />

        <label className="mef-label">Story</label>
        <input className="mef-input" value={story} onChange={(e) => setStory(e.target.value)} placeholder="описание истории" />

        <label className="mef-label">Теги</label>
        <TagsInput value={tags} onChange={setTags} />

        <label className="mef-label">Заметка</label>
        <textarea
          className="mef-textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="причина, ссылка на задачу…"
        />
      </div>

      <div className="mef-actions">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохраняю…' : '💾 Сохранить'}
        </button>
        <button className="editor-btn" onClick={onCancel} disabled={saving}>Отмена</button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function TestDetails({ node, onRun, onEdit, onNodeChange, busy }: Props) {
  const [detail, setDetail] = useState<TestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    setEditingMeta(false);
    api.detail({
      file: node.file,
      line: node.line,
      project: node.project,
      testTitle: node.testTitle,
    })
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [node.id]);

  const runOnly = (): void => {
    const safeTitle = node.testTitle.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    onRun(
      node.testTitle.length > 60 ? node.testTitle.slice(0, 60) + '…' : node.testTitle,
      `--project=${node.project} --grep "^${safeTitle}$"`,
    );
  };

  const isSetup = node.project === 'setup' || node.project === 'teardown';
  const [savingStatus, setSavingStatus] = useState(false);

  const setStatus = async (s: TestStatus | null): Promise<void> => {
    if (!detail) return;
    setSavingStatus(true);
    try {
      if (s === null) {
        await api.clearMeta(detail.id);
        setDetail({ ...detail, meta: null });
        onNodeChange?.(detail.id, { status: 'active' });
      } else {
        const ov = await api.setMeta({ testId: detail.id, status: s });
        setDetail({ ...detail, meta: ov });
        onNodeChange?.(detail.id, { status: s });
      }
    } finally { setSavingStatus(false); }
  };

  const saveMeta = async (patch: Omit<NonNullable<TestDetail['meta']>, 'updatedAt'>): Promise<void> => {
    if (!detail) return;
    const ov = await api.setMeta({ testId: detail.id, ...patch });
    const allure = { ...detail.allure };
    if (patch.owner    != null) allure.owner    = patch.owner;
    if (patch.severity != null) allure.severity = patch.severity;
    if (patch.tags     != null) allure.tags     = patch.tags;
    if (patch.epic     != null) allure.epic     = patch.epic;
    if (patch.feature  != null) allure.feature  = patch.feature;
    if (patch.story    != null) allure.story    = patch.story;
    setDetail({ ...detail, meta: ov, allure });
    if (patch.status) onNodeChange?.(detail.id, { status: patch.status });
    setEditingMeta(false);
  };

  const currentStatus = detail?.meta?.status ?? detail?.allure.status ?? 'active';

  return (
    <div className="test-details">
      <div className="td-toolbar">
        <button className="primary" onClick={runOnly} disabled={busy}>
          ▶ Запустить
        </button>
        {onEdit && (
          <button
            className="editor-btn"
            onClick={() => onEdit(node.file)}
            title="Открыть spec в редакторе (Monaco)"
          >✎ Редактор</button>
        )}

        {detail && !isSetup && (
          <>
            <div className="td-status-control" title="Статус теста (хранится в DB)">
              <span className="td-status-label">статус:</span>
              <select
                className={`td-status-select status-${currentStatus}`}
                value={currentStatus}
                disabled={savingStatus}
                onChange={(e) => setStatus(e.target.value as TestStatus)}
              >
                <option value="active">✓ active</option>
                <option value="planned">📝 planned</option>
                <option value="blocked">🚧 blocked</option>
                <option value="freeze">❄️ freeze</option>
                <option value="deprecated">✗ deprecated</option>
              </select>
            </div>

            <button
              className={`editor-btn${editingMeta ? ' active' : ''}`}
              onClick={() => setEditingMeta((v) => !v)}
              title="Редактировать owner / severity / tags / epic / feature / заметку"
            >✏️ Мета</button>
          </>
        )}

        <span className={`td-loc${isSetup ? ' td-loc-setup' : ''}`}>{node.project}</span>
      </div>

      <div className="td-body">
        {isSetup && (
          <div className="td-setup-banner">
            <strong>🔐 Это не тест-кейс, а подготовка</strong>
            <p>
              Этот файл выполняется <b>автоматически перед</b> тест-кейсами в зависимых проектах
              (см. <code>dependencies: ['setup']</code> в <code>playwright.config.ts</code>).
              Вручную запускать обычно не нужно — он подключится сам.
            </p>
          </div>
        )}

        <h1 className="td-title">{node.testTitle}</h1>
        <div className="td-path">
          <code>{node.file}</code>
          <span className="td-path-sep">:</span>
          <code className="td-path-line">{node.line}</code>
          <span className="td-path-sep">·</span>
          <span className="td-path-proj">{node.project}</span>
        </div>

        {!detail && !error && <div className="muted">Загружаю описание из исходника…</div>}
        {error && <div className="error">Не удалось загрузить детали: {error}</div>}

        {detail && (
          <>
            {/* Inline meta edit form */}
            {editingMeta && (
              <MetaEditForm
                detail={detail}
                onSave={saveMeta}
                onCancel={() => setEditingMeta(false)}
              />
            )}

            {/* Pills row */}
            <div className="td-meta">
              {detail.allure.epic && <Pill k="Эпик" v={detail.allure.epic} />}
              {detail.allure.feature && <Pill k="Фича" v={detail.allure.feature} />}
              {detail.allure.story && <Pill k="История" v={detail.allure.story} />}
              {detail.allure.severity && (
                <Pill k="Severity" v={detail.allure.severity} color={SEVERITY_COLOR[detail.allure.severity.toLowerCase()] ?? 'var(--t3)'} />
              )}
              {detail.allure.owner && <Pill k="Owner" v={detail.allure.owner} />}
              {detail.allure.tags.map((t) => (
                <Pill key={t} k="#" v={t} color="var(--inf)" />
              ))}
              {detail.allure.parameters.map((p) => (
                <Pill key={p.name} k={p.name} v={p.value} />
              ))}
              {detail.meta?.note && (
                <span className="pill pill-note" title={detail.meta.note}>
                  <span className="pill-k">📝</span> {detail.meta.note.length > 50 ? detail.meta.note.slice(0, 50) + '…' : detail.meta.note}
                </span>
              )}
            </div>

            {/* Traceability */}
            {(detail.allure.ucs.length > 0 ||
              detail.allure.frontends.length > 0 ||
              detail.allure.modules.length > 0) && (
              <div className="td-trace">
                {detail.allure.ucs.length > 0 && (
                  <div className="trace-row">
                    <span className="trace-key">📑 Use Cases</span>
                    <div className="trace-vals">
                      {detail.allure.ucs.map((u) => (
                        <span key={u} className="trace-pill trace-uc">{u}</span>
                      ))}
                    </div>
                  </div>
                )}
                {detail.allure.frontends.length > 0 && (
                  <div className="trace-row">
                    <span className="trace-key">🎨 Фронтенды</span>
                    <div className="trace-vals">
                      {detail.allure.frontends.map((f) => (
                        <span key={f} className="trace-pill trace-frontend">{f}</span>
                      ))}
                    </div>
                  </div>
                )}
                {detail.allure.modules.length > 0 && (
                  <div className="trace-row">
                    <span className="trace-key">⚙️ Модули</span>
                    <div className="trace-vals">
                      {detail.allure.modules.map((m) => (
                        <span key={m} className="trace-pill trace-module">{m}</span>
                      ))}
                    </div>
                    <span className="trace-hint">если упало — ищи проблему здесь</span>
                  </div>
                )}
              </div>
            )}

            {detail.allure.links.length > 0 && (
              <div className="td-links">
                <strong>Ссылки</strong>
                {detail.allure.links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>
                    {l.name ?? l.url}
                  </a>
                ))}
              </div>
            )}

            {detail.allure.descriptionHtml && (
              <div
                className="td-description"
                dangerouslySetInnerHTML={{ __html: detail.allure.descriptionHtml }}
              />
            )}
            {!detail.allure.descriptionHtml && detail.allure.description && (
              <pre className="td-description-md">{detail.allure.description}</pre>
            )}

            {!detail.allure.descriptionHtml && detail.autoSteps.length > 0 && (
              <div className="td-fallback">
                <h3>Сценарий <span className="muted">(извлечено автоматически из <code>test.step(...)</code>)</span></h3>
                <ol className="auto-steps">
                  {detail.autoSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}

            {!detail.allure.descriptionHtml && detail.autoSteps.length === 0 && detail.autoActions.length > 0 && (
              <div className="td-fallback">
                <h3>Что делает тест <span className="muted">(эвристика)</span></h3>
                <ul className="auto-actions">
                  {detail.autoActions.map((a, i) => (
                    <li key={i}>
                      <code className={`act-kind act-${a.kind}`}>{a.kind}</code>
                      <span>{a.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!detail.allure.descriptionHtml && !detail.allure.description && detail.autoSteps.length === 0 && detail.autoActions.length === 0 && (
              <div className="td-description-empty">
                <strong>Нет описания.</strong>
                <p>Чтобы здесь появилась карточка с целью / шагами / ожидаемым результатом — добавь в тест <code>await allure.descriptionHtml(`...`)</code>.</p>
              </div>
            )}

            <details className="td-source" open={!detail.allure.descriptionHtml}>
              <summary>Исходник теста · {Math.round(detail.fileBytes / 1024)} KB · {detail.sourceSnippet.split('\n').length} строк</summary>
              <pre className="td-source-pre">{detail.sourceSnippet}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function Pill({ k, v, color }: { k: string; v: string; color?: string }) {
  const style = color
    ? {
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
      }
    : undefined;
  return (
    <span className="pill" style={style}>
      <span className="pill-k">{k}:</span> {v}
    </span>
  );
}
