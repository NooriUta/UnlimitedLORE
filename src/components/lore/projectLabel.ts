/**
 * Короткие подписи проектов для чипов и строк.
 *
 * Хвост slug-а («udwe-mig-gen» из «AIDA/udwe-mig-gen») показывается, только
 * пока он однозначен среди переданных slug-ов. Совпал хвост у двух разных
 * проектов — оба подписываются полным slug-ом: короткое имя, общее для двух
 * проектов, неотличимо и выглядит как дубль (найдено 05.11.2026 на карточке
 * человека в админке: AIDA/… и ciadmin/udwe-mig-gen).
 *
 * Сравнение хвостов без учёта регистра: «Lore» и «lore» на экране различимы
 * плохо, и отдельной подписи это не стоит.
 */
/**
 * Роли человека после одной успешной записи `/user/role` — то, что попап
 * показывает сразу, не дожидаясь перезагрузки карты ролей. add заменяет роль в
 * проекте (у человека в проекте одна роль), remove убирает проект.
 */
export function applyRoleChange(
  cur: { project: string; role: string }[], project: string, role: string, action: 'add' | 'remove',
): { project: string; role: string }[] {
  const rest = cur.filter(x => x.project !== project);
  return action === 'remove' ? rest : [...rest, { project, role }];
}

export function projectLabels(slugs: Iterable<string>): Map<string, string> {
  const unique = [...new Set(slugs)];
  const tail = (s: string) => s.split('/').pop() ?? s;
  const count = new Map<string, number>();
  for (const s of unique) {
    const k = tail(s).toLowerCase();
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const s of unique) out.set(s, (count.get(tail(s).toLowerCase()) ?? 0) > 1 ? s : tail(s));
  return out;
}
