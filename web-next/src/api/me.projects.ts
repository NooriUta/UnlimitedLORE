// «Мои проекты» с сервера (SPRINT_UXR_S7B_ADMIN/S7B-14).
//
// GET /lore/me/projects → {projects:[{slug, role}], count} — проекты, где у
// вызывающего есть роль, а не все проекты LORE. Источник для «Все мои (N
// своих)» в выборе проектов (S9-04) и для карточки человека.
//
// Чем это лучше прежнего пути через срез `user_project_roles?kc_sub=`: сервер
// сам знает, кто спрашивает. Поэтому «не опознан» приходит как 401 и перестаёт
// быть догадкой по отсутствию kc_sub на клиенте, а пустой список значит именно
// «ролей нет» — два разных ответа вместо одного «пусто».
import { loreFetch } from '../auth/session';

export interface MyProject { slug: string; role: string | null }

/** Слаги моих проектов. 401 и сбой не глотаются — зовущий решает, что показать. */
export async function myProjects(signal?: AbortSignal, fetchImpl: typeof fetch = loreFetch): Promise<MyProject[]> {
  const res = await fetchImpl('/lore/me/projects', signal ? { signal } : undefined);
  let body: Record<string, unknown> = {};
  try {
    const v = (await res.json()) as unknown;
    if (v && typeof v === 'object') body = v as Record<string, unknown>;
  } catch {
    // не-JSON — станет ошибкой ниже, а не пустым списком
  }
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(res.status === 401 ? `401 ${code}` : code);
  }
  const rows = Array.isArray(body.projects) ? body.projects : [];
  return rows
    .map(r => {
      const row = (r ?? {}) as Record<string, unknown>;
      return { slug: String(row.slug ?? ''), role: typeof row.role === 'string' ? row.role : null };
    })
    .filter(p => p.slug !== '');
}
