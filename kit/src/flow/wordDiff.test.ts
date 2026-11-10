// Пословный дифф (SPRINT_UXR_S10_SEIDR_KIT/K-12).
//
// Нужен экрану «Выпуск контента»: у изменённой записи надо видеть, ЧТО именно
// изменилось в поле, а не «поле изменилось». Переносится из прототипа v4
// (confirmRisk), но здесь — чистой функцией с тестами, потому что по этому
// диффу владелица решает, активировать версию или нет.
//
// Функция обязана быть детерминированной: один и тот же вход — тот же выход,
// порядок слов на входе не влияет ни на что, кроме самого результата.
import { describe, expect, it } from 'vitest';
import { wordDiff } from './wordDiff';

const txt = (from: string, to: string) => wordDiff(from, to).chunks.map(c => `${c.kind}:${c.text}`);

describe('K-12 · пословный дифф', () => {
  it('положительный контроль: одинаковый текст — один кусок «без изменений»', () => {
    const r = wordDiff('одно и то же', 'одно и то же');
    expect(r.exact).toBe(true);
    expect(r.chunks).toEqual([{ kind: 'same', text: 'одно и то же' }]);
  });

  it('слово заменили — видно и убранное, и добавленное', () => {
    expect(txt('правило для всех', 'правило для новичков'))
      .toEqual(['same:правило для ', 'del:всех', 'add:новичков']);
  });

  it('слово добавили в конец', () => {
    expect(txt('краткое правило', 'краткое правило проверки')).toEqual(['same:краткое правило', 'add: проверки']);
  });

  it('слово убрали из начала', () => {
    expect(txt('очень краткое правило', 'краткое правило')).toEqual(['del:очень ', 'same:краткое правило']);
  });

  it('пустое «было» — всё добавлено; пустое «стало» — всё убрано', () => {
    expect(txt('', 'новый текст')).toEqual(['add:новый текст']);
    expect(txt('старый текст', '')).toEqual(['del:старый текст']);
  });

  it('оба пустые — кусков нет вовсе', () => {
    expect(wordDiff('', '').chunks).toEqual([]);
  });

  it('пробелы и переводы строк сохраняются: текст читают, а не считают', () => {
    const r = wordDiff('первая строка\nвторая строка', 'первая строка\nтретья строка');
    expect(r.chunks.map(c => c.text).join('')).toContain('\n');
  });

  it('детерминирована: тот же вход — тот же выход', () => {
    const a = wordDiff('раз два три четыре', 'раз три четыре пять');
    const b = wordDiff('раз два три четыре', 'раз три четыре пять');
    expect(a).toEqual(b);
  });

  it('куски одного вида склеены: «add» рядом с «add» не дробится', () => {
    const r = wordDiff('а', 'а б в г');
    expect(r.chunks.filter(c => c.kind === 'add')).toHaveLength(1);
  });

  it('склейка кусков не теряет ни одного символа «стало»', () => {
    const from = 'правило проверки порядка слов';
    const to = 'правило проверки порядка и состава слов';
    const r = wordDiff(from, to);
    const rebuilt = r.chunks.filter(c => c.kind !== 'del').map(c => c.text).join('');
    expect(rebuilt).toBe(to);
  });

  it('и ни одного символа «было»', () => {
    const from = 'правило проверки порядка слов';
    const to = 'правило порядка слов';
    const r = wordDiff(from, to);
    const rebuilt = r.chunks.filter(c => c.kind !== 'add').map(c => c.text).join('');
    expect(rebuilt).toBe(from);
  });

  it('очень длинный текст: дифф ГРУБЫЙ, и об этом сказано флагом, а не молча', () => {
    const long = Array.from({ length: 900 }, (_, i) => `слово${i}`).join(' ');
    const r = wordDiff(long, long + ' хвост');
    expect(r.exact, 'на длинном тексте точный дифф не считаем — иначе экран встанет').toBe(false);
    expect(r.chunks.map(c => c.kind)).toEqual(['del', 'add']);
  });

  it('порог можно задать: правило одно, число — настройка', () => {
    const r = wordDiff('раз два три', 'раз два четыре', { limit: 2 });
    expect(r.exact).toBe(false);
  });
});
