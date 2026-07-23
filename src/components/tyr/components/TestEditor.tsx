import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../api';

interface Props {
  file: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function TestEditor({ file, onClose, onSaved }: Props) {
  const [content, setContent] = useState<string>('');
  const [original, setOriginal] = useState<string>('');
  const [mtime, setMtime] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.sourceGet(file)
      .then((r) => { if (!alive) return; setContent(r.content); setOriginal(r.content); setMtime(r.mtime); setLoading(false); })
      .catch((e) => { if (alive) { setError((e as Error).message); setLoading(false); } });
    return () => { alive = false; };
  }, [file]);

  const dirty = content !== original;

  const save = async (skipValidate = false): Promise<void> => {
    setSaving(true); setError(null);
    try {
      const r = await api.sourceSave({ file, content, mtimeSeen: mtime, skipValidate });
      setOriginal(content);
      setMtime(r.mtime);
      setSavedAt(Date.now());
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <code className="editor-file">{file}</code>
        {dirty && <span className="editor-dirty" title="Несохранённые изменения">●</span>}
        {savedAt && !dirty && (
          <span className="editor-saved">сохранено · {new Date(savedAt).toLocaleTimeString()}</span>
        )}
        <span style={{ flex: 1 }} />
        <button className="editor-btn" onClick={onClose} disabled={saving}>✕ Закрыть</button>
        <button
          className="editor-btn editor-btn-secondary"
          onClick={() => void save(true)}
          disabled={!dirty || saving}
          title="Сохранить без проверки через playwright --list"
        >Сохранить (без validate)</button>
        <button
          className="editor-btn editor-btn-primary"
          onClick={() => void save(false)}
          disabled={!dirty || saving}
        >{saving ? 'Сохраняю…' : '✓ Сохранить + validate'}</button>
      </div>
      {error && (
        <div className="editor-error">
          <strong>Ошибка:</strong>{' '}
          <pre>{error}</pre>
        </div>
      )}
      <div className="editor-monaco">
        {loading
          ? <div className="muted" style={{ padding: 24 }}>Загружаю…</div>
          : (
            <Editor
              height="100%"
              defaultLanguage="typescript"
              theme="vs-dark"
              value={content}
              onChange={(v) => setContent(v ?? '')}
              options={{
                // Monaco принимает ЧИСЛО, а не CSS-значение: это опция редактора,
                // а не стиль DOM-узла, и токен шкалы сюда не подставляется.
                fontSize: 13,
                fontFamily: '"Fira Code", monospace',
                fontLigatures: true,
                minimap: { enabled: false },
                lineNumbers: 'on',
                tabSize: 2,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                automaticLayout: true,
              }}
            />
          )
        }
      </div>
    </div>
  );
}
