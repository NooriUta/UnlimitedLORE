// @vitest-environment jsdom
// K-14 (SPRINT_UXR_S7B_ADMIN/S7B-23_2): схема ссылок редактора («lore:» у LORE) —
// настройка приложения. У kit нейтральная «ref:»; приложение называет свою один раз
// при старте, и тела записей, где уже лежат её ссылки, разбираются без потерь.
import { afterEach, describe, expect, it } from 'vitest';
import { linkScheme, resetLinkScheme, setLinkScheme } from './linkScheme';
import { markdownRoundTrip as mdRoundTrip } from './markdownRoundTrip';

afterEach(() => resetLinkScheme());

describe('схема ссылок редактора', () => {
  it('у kit своей предметной схемы нет: умолчание — ref:', () => {
    expect(linkScheme().protocols).toEqual(['ref']);
    expect(linkScheme().mentionHref('anna')).toBe('ref:actor/anna');
  });

  it('приложение называет свою схему — ссылки на неё переживают круг', () => {
    setLinkScheme({ protocols: ['app'], mentionHref: id => `app:actor/${id}` });
    expect(linkScheme().mentionHref('anna')).toBe('app:actor/anna');
    const md = 'Ответственный [@Анна](app:actor/anna), спринт [переезд](app:sprint/S1).\n';
    expect(mdRoundTrip(md).trim()).toBe(md.trim());
  });
});
