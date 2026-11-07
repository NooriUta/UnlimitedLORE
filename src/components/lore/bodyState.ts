// SPRINT_UXR_S1_HONEST_API/S1-05 (B-04): у тела записи три исхода.
// Бэкенд (AidaLoreResource.redactIfNoRole) обнуляет тело, если у читателя нет
// роли ни в одном проекте записи, и ставит body_redacted + body_redacted_reason.
// Судить по пустоте поля нельзя: «скрыто правами» читалось бы как «не написано».

export interface RedactableRow {
  body_redacted?: boolean | null;
  body_redacted_reason?: string | null;
}

export type BodyState =
  | { k: 'present' }
  | { k: 'empty' }
  | { k: 'redacted'; reason: string | null };

export function bodyStateOf<T extends RedactableRow>(
  row: T,
  bodyFields: readonly string[],
): BodyState {
  // Признак важнее остатков тела: скрытое не выдаётся за написанное.
  if (row.body_redacted === true) {
    const r = row.body_redacted_reason;
    return { k: 'redacted', reason: typeof r === 'string' && r.trim() ? r : null };
  }
  const rec = row as unknown as Record<string, unknown>;
  const has = bodyFields.some(f => {
    const v = rec[f];
    return typeof v === 'string' && v.length > 0;
  });
  return has ? { k: 'present' } : { k: 'empty' };
}

/** Правка скрытого тела стартовала бы с пустого черновика и затёрла бы настоящее содержимое. */
export function canEditBody(s: BodyState): boolean {
  return s.k !== 'redacted';
}
