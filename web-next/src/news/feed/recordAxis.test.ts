// SPRINT_UXR_S9_SCALE_OPT/S9-11 — ось «по записи» в ленте новостей.
//
// Сервер (NewsV2Engine.AXES) получил ось `record`: ключ группы — «тип:код»
// элемента события. Клиент обязан раскладывать строки дня по тому же ключу и
// подписывать группу записью, а не сырым ключом.
import { describe, expect, it } from 'vitest';
import { NEWS_AXES, NEWS_FIXTURE, axisLabel, eventAxisValues, newsGroupLabel } from './index';

describe('S9-11 · ось «по записи»', () => {
  const e = NEWS_FIXTURE.events[1];

  it('ось есть среди разрезов ленты', () => {
    expect(NEWS_AXES).toContain('record');
  });

  it('строка стоит в группе своей записи — тот же ключ, что у сервера («тип:код»)', () => {
    expect(eventAxisValues(e, 'record')).toEqual([e.el_key]);
  });

  it('группа подписана записью: вид и код, а не сырой ключ', () => {
    expect(newsGroupLabel('record', 'task:SPRINT_X/T-1', 'ru')).toBe('задача · SPRINT_X/T-1');
  });

  it('у оси есть подпись в выборе разреза', () => {
    expect(axisLabel('record', 'ru')).toBe('По записи');
  });
});
