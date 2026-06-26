import { useState } from 'react';
import { api } from '../api';

interface Props {
  onClose: () => void;
  onCreated: (file: string) => void;
}

const AREAS: { v: 'chur' | 'heimdall' | 'verdandi' | 'visual' | 'a11y'; label: string }[] = [
  { v: 'chur',     label: 'chur · BFF API / auth / RBAC (без браузера)' },
  { v: 'heimdall', label: 'heimdall · админка / RBAC / tenants' },
  { v: 'verdandi', label: 'verdandi · LOOM canvas / inspector / dali' },
  { v: 'visual',   label: 'visual · screenshot regression' },
  { v: 'a11y',     label: 'a11y · axe-core checks' },
];

export function NewTestModal({ onClose, onCreated }: Props) {
  const [area, setArea] = useState<'chur' | 'heimdall' | 'verdandi' | 'visual' | 'a11y'>('heimdall');
  const [folder, setFolder] = useState('');           // подпапка опционально
  const [filename, setFilename] = useState('');       // без .spec.ts
  const [feature, setFeature] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fullFile = (): string => {
    const sub = folder.trim().replace(/^\/+|\/+$/g, '');
    const name = filename.trim().replace(/\.spec\.ts$/, '');
    return [`${area}`, sub, `${name}.spec.ts`].filter(Boolean).join('/');
  };

  const create = async (): Promise<void> => {
    setErr(null);
    if (!filename.trim()) { setErr('Имя файла обязательно'); return; }
    if (!/^[a-z0-9-]+$/.test(filename.trim().replace(/\.spec\.ts$/, ''))) {
      setErr('Имя — только lowercase, цифры и дефис (kebab-case)');
      return;
    }
    setCreating(true);
    try {
      const tpl = await api.template({ area, feature: feature || undefined, title: title || undefined });
      await api.sourceSave({ file: fullFile(), content: tpl.content, skipValidate: true });
      onCreated(fullFile());
    } catch (e) {
      setErr((e as Error).message);
    } finally { setCreating(false); }
  };

  return (
    <div className="ntm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ntm-modal">
        <div className="ntm-head">+ Новый тест</div>
        <div className="ntm-body">
          <div className="ntm-field">
            <label>Куда положить (project / area)</label>
            <select value={area} onChange={(e) => setArea(e.target.value as 'chur' | 'heimdall' | 'verdandi' | 'visual' | 'a11y')}>
              {AREAS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </select>
          </div>
          <div className="ntm-field">
            <label>Подпапка (опционально, например <code>tenants</code>)</label>
            <input
              type="text"
              placeholder="tenants"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
          </div>
          <div className="ntm-field">
            <label>Имя файла (без .spec.ts)</label>
            <input
              type="text"
              placeholder="tenant-create"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              autoFocus
            />
          </div>
          <div className="ntm-field">
            <label>Allure feature (опционально, шаблон подставит)</label>
            <input
              type="text"
              placeholder="Управление тенантами"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
            />
          </div>
          <div className="ntm-field">
            <label>Заголовок теста (опционально)</label>
            <input
              type="text"
              placeholder="MT-XX: Создание тенанта"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            Будет создан файл: <code>tests/{fullFile()}</code>
          </div>
          {err && <div className="error" style={{ marginTop: 4 }}>{err}</div>}
        </div>
        <div className="ntm-foot">
          <button className="editor-btn" onClick={onClose} disabled={creating}>Отмена</button>
          <button className="editor-btn editor-btn-primary" onClick={create} disabled={creating || !filename}>
            {creating ? 'Создаю…' : '✓ Создать и открыть в редакторе'}
          </button>
        </div>
      </div>
    </div>
  );
}
