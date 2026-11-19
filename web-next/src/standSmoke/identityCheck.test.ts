// AP-09 «Вы не опознаны у заведённой учётки» (смоук 37997, 19.11.2026): под test-sa все 13 разделов админки
// показали «Вы не опознаны: … нет в графе LORE». Это дефект, только если учётка заведена (whoami: known).
// Если whoami сам говорит unknown — сообщение честное, а сценарий называет причину: учётку не завели на стенде.
import { describe, expect, it } from 'vitest';
import { ap09Verdict } from './identityCheck';

describe('ap09Verdict', () => {
  it('учётка заведена, а на экране «Вы не опознаны» — дефект AP-09', () => {
    expect(ap09Verdict('known', true)).toEqual({ kind: 'defect' });
  });
  it('учётка заведена, сообщения нет — в порядке', () => {
    expect(ap09Verdict('known', false)).toEqual({ kind: 'ok' });
  });
  it('whoami: unknown — сообщение честное, проверка AP-09 не выполнима: учётку не завели в графе стенда', () => {
    expect(ap09Verdict('unknown', true)).toEqual({ kind: 'not-enrolled' });
  });
  it('whoami не ответил — не знаем, проверяем как раньше (по экрану)', () => {
    expect(ap09Verdict(undefined, true)).toEqual({ kind: 'defect' });
  });
});
