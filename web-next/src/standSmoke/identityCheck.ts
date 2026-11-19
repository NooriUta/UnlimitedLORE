// AP-09 «Вы не опознаны у заведённой учётки» (SPRINT_LORE_ADMIN_POLISH/AP-09): дефект — только когда учётка
// заведена в графе LORE (whoami: identity.state = known), а экран всё равно говорит «Вы не опознаны».
// whoami: unknown — сообщение честное: учётку на стенде не завели; это причина «не выполнен», а не красный.
// whoami не ответил — не знаем, судим по экрану, как раньше.
export type Ap09Verdict = { kind: 'ok' } | { kind: 'defect' } | { kind: 'not-enrolled' };

export function ap09Verdict(identityState: string | undefined, unknownShown: boolean): Ap09Verdict {
  if (identityState === 'unknown') return { kind: 'not-enrolled' };
  return unknownShown ? { kind: 'defect' } : { kind: 'ok' };
}
