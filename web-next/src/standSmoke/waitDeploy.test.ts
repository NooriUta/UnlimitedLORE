// E2E-STAND: смоук после выкатки в preprod ждёт, пока стенд отдаст ТОТ ЖЕ коммит,
// иначе проверил бы прошлую сборку и выдал бы её зелёный за новую.
import { describe, expect, it } from 'vitest';
import { deployState, shouldRelogin, MAX_RELOGINS } from './waitDeploy';

const SHA = '949044fd8a1b2c3d4e5f60718293a4b5c6d7e8f9';

describe('deployState — стенд уже на нужном коммите?', () => {
  it('коммит совпал — reached', () => {
    expect(deployState(200, { commit: SHA }, SHA)).toEqual({ reached: true, seen: SHA });
  });
  it('короткий хэш в ответе тоже совпадение (в обе стороны), регистр не важен', () => {
    expect(deployState(200, { commit: SHA.slice(0, 8) }, SHA).reached).toBe(true);
    expect(deployState(200, { commit: SHA.toUpperCase() }, SHA.slice(0, 8)).reached).toBe(true);
  });
  it('другой коммит — ещё старая сборка', () => {
    expect(deployState(200, { commit: '76a825359767d4445c3e56ceac7ef49a00d00d75' }, SHA))
      .toEqual({ reached: false, seen: '76a825359767d4445c3e56ceac7ef49a00d00d75' });
  });
  it('нет коммита, не 200 или пустое ожидание — не reached (молчание ≠ выкатка)', () => {
    expect(deployState(200, {}, SHA).reached).toBe(false);
    expect(deployState(200, null, SHA).reached).toBe(false);
    expect(deployState(502, { commit: SHA }, SHA).reached).toBe(false);
    expect(deployState(200, { commit: '' }, '').reached).toBe(false);
    expect(deployState(200, { commit: 'abc' }, SHA).reached).toBe(false);
  });
});

// Прогон 9017 (18.11.2026): вход в 13:06, выкатка в очереди 15 мин — и с 13:21 до конца 40 минут сплошные 401:
// токен входа истёк, ожидание его не обновляло, смоук упал «стенд не дошёл», хотя стенд дошёл. 401 — повод войти
// заново, а не ждать дальше с мёртвым токеном; число повторных входов ограничено.
describe('ожидание выкатки: 401 — войти заново', () => {
  it('401 при запасе повторных входов — войти заново', () => {
    expect(shouldRelogin(401, 0)).toBe(true);
    expect(shouldRelogin(401, MAX_RELOGINS - 1)).toBe(true);
  });
  it('запас исчерпан — не входить (честный отказ по сроку)', () => {
    expect(shouldRelogin(401, MAX_RELOGINS)).toBe(false);
  });
  it('200 и прочие ответы — не повод входить', () => {
    expect(shouldRelogin(200, 0)).toBe(false);
    expect(shouldRelogin(502, 0)).toBe(false);
  });
});
