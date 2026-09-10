// SE-10: чтение отметки сборки, записанной scripts/write-build-info.mjs.
import { readFileSync } from 'node:fs';

export type BuildInfo = { commit: string; built_at: string };

/** Отметка сборки; без файла — «unknown», а не исключение: отсутствие отметки
 *  не должно ронять сервер, оно должно быть ВИДНО как unknown. */
export function readBuildInfo(): BuildInfo {
  try {
    const raw = readFileSync(new URL('./build-info.json', import.meta.url), 'utf8');
    const j = JSON.parse(raw) as Partial<BuildInfo>;
    return { commit: j.commit || 'unknown', built_at: j.built_at || '' };
  } catch {
    return { commit: 'unknown', built_at: '' };
  }
}
