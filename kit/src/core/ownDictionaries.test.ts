// kit не держит прикладные словари (SPRINT_UXR_S10_SEIDR_KIT/K-14).
//
// **Вопрос владелицы 09.11, с которого всё началось:** «зачем тебе словарь
// статусов на своей стороне, если это задача уже конкретного приложения… так
// же как и палитра». И следом: «завтра кто-нибудь будет на kit собирать своё
// приложение и?»
//
// Это не рассуждение, а уже случившийся отказ. LORE добавила свой статус
// «К выкатке» — валидатор ядра отверг его цвет, хотя токен `--st-ready_for_deploy`
// в теме kit объявлен давно; после правки валидатора упала JSON-схема. Список
// статусов лежал в kit ТРИЖДЫ.
//
// Для LORE это починено списком. Но для ЧУЖОГО приложения починки нет: у
// «Дата-странников» (K-08, пилот) статусы свои, и kit отвергнет их цвета,
// потому что в его списке лежат статусы LORE. Выход у пилота останется один —
// форк kit, то есть ровно то, от чего предостерегает K-10: «без точек
// расширения каждое приложение будет форкать kit — это главная угроза
// конструктору».
//
// **Правило, которое закрепляется здесь:** валидатор проверяет ФОРМУ цвета, а
// не принадлежность к перечню статусов LORE. Токен — да, сырой цвет — нет
// (правило владелицы «цвета только токенами, никаких сырых hex» остаётся). Чей
// это токен, kit не решает: приложение объявляет свои в своей теме.
//
// Незнакомый токен при этом не молчит: он даёт ПРЕДУПРЕЖДЕНИЕ, а не ошибку —
// опечатку `var(--acc1)` надо заметить, но запрещать приложению свои токены
// нельзя.
import { describe, expect, it } from 'vitest';
import { validateKitConfig } from './validate';
import type { KitConfig } from './contract';

/** Конфиг чужого приложения: статусы не из LORE и свой цветовой токен. */
const foreign = (color: string): KitConfig => ({
  modules: [{ id: 'quiz', title: 'Квизы', icon: 'compass' }],
  menu: { groups: [{ id: 'g', title: 'Свитки', items: [{ id: 'scroll', title: 'Свитки' }] }] },
  kinds: { scroll: { title: 'Свиток', icon: 'scroll-quill' } },
  statuses: {
    items: [
      // «Отгружено» — статус методотдела, в LORE такого нет и быть не должно.
      { code: 'shipped', title: 'Отгружено', category: 'done', icon: 'compass', color },
    ],
  },
});

const errorsOf = (c: KitConfig) => validateKitConfig(c).errors.map(e => e.code);
const warningsOf = (c: KitConfig) => validateKitConfig(c).warnings.map(e => e.code);

describe('K-14 · чужое приложение приносит свои статусы', () => {
  it('положительный контроль: конфиг с токеном темы kit проходит без замечаний', () => {
    const v = validateKitConfig(foreign('var(--suc)'));
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it('свой токен приложения принимается: kit не решает, чей это токен', () => {
    expect(errorsOf(foreign('var(--st-shipped)'))).toEqual([]);
  });

  it('но незнакомый токен не молчит — предупреждение, чтобы заметить опечатку', () => {
    expect(warningsOf(foreign('var(--st-shipped)'))).toContain('color-token-unknown');
  });

  it('опечатка в токене kit тоже видна предупреждением', () => {
    expect(warningsOf(foreign('var(--acc1)'))).toContain('color-token-unknown');
  });

  it('сырой цвет по-прежнему ошибка: правило «только токенами» остаётся', () => {
    expect(errorsOf(foreign('#3fb6c4'))).toContain('color-token');
    expect(errorsOf(foreign('rgb(63, 182, 196)'))).toContain('color-token');
  });

  it('не строка и мусор в форме токена — тоже ошибка', () => {
    expect(errorsOf(foreign('var(--)'))).toContain('color-token');
    expect(errorsOf(foreign('var(acc)'))).toContain('color-token');
  });

  it('статус с кодом вне LORE не вызывает ни одной ошибки сам по себе', () => {
    const v = validateKitConfig(foreign('var(--suc)'));
    expect(v.errors.filter(e => e.path.includes('statuses'))).toEqual([]);
  });
});
