// SPRINT_LORE_MD_ARCHIVE/MDA-04 — «Выгрузить в MD» в паспорте git-проекта: zip-архив
// папки .md под Obsidian (GET /lore/export/project/{owner}/{repo}, MDA-02). С телефона и из
// браузера MCP недоступен — нужна кнопка. Ошибки — словами и раздельно: 403 — «нет прав на
// проект», прочее — «выгрузка не удалась (HTTP N)». Пустой файл вместо ошибки не скачивается.
import { useState } from 'react';
import { loreFetch } from '../auth/session';
import { useAppT } from '../i18n';

/** Сохранить файл в браузере: ссылка на Blob с атрибутом download. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface ProjectExportButtonProps {
  /** git_project slug «owner/repo». */
  slug: string;
  /** Подмена сети (тесты). */
  fetchImpl?: typeof fetch;
  /** Подмена сохранения файла (тесты). */
  save?: (blob: Blob, name: string) => void;
}

export function ProjectExportButton({ slug, fetchImpl, save = saveBlob }: ProjectExportButtonProps) {
  const t = useAppT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owner, repo] = slug.split('/');

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const http = fetchImpl ?? loreFetch;
      const res = await http(`/lore/export/project/${owner}/${repo}`);
      if (res.status === 403) { setError(t('projectExport.forbidden')); return; }
      if (!res.ok) { setError(t('projectExport.failed', { status: res.status })); return; }
      const blob = await res.blob();
      if (blob.size === 0) { setError(t('projectExport.failed', { status: res.status })); return; }
      save(blob, `${owner}__${repo}.zip`);
    } catch (e) {
      setError(t('projectExport.failed', { status: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="project-export" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
      <button type="button" className="sk-btn" data-testid="project-export" disabled={busy} onClick={() => { void run(); }}
        title={t('projectExport.hint')}>
        {busy ? t('projectExport.busy') : t('projectExport.button')}
      </button>
      {error && (
        <span role="alert" data-testid="project-export-error" style={{ color: 'var(--dng)' }}>{error}</span>
      )}
    </div>
  );
}
