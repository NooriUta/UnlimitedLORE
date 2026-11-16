// K4-MENTION-LOOK, препрод 16.11: ссылка [[task:…]] в тексте шла без значка. Корень: приложение
// регистрирует СВОЙ набор lucide (LORE — LORE_LUCIDE_ICONS), и registerGameIcons ЗАМЕНЯЛ набор kit по
// приставке — значки kit, которых нет в наборе приложения (lucide:list-checks у задачи), пропадали из
// разметки вне React. Набор приложения ДОПОЛНЯЕТ набор kit, а не вытесняет его.
import { describe, expect, it } from 'vitest';
import { gameIconSvg, registerGameIcons } from './GameIcon';

describe('gameIconSvg после регистрации набора приложения с той же приставкой', () => {
  it('значок kit остаётся, значок приложения добавляется', () => {
    expect(gameIconSvg('lucide:list-checks')).not.toBeNull();
    registerGameIcons({ prefix: 'lucide', icons: { 'app-only': { body: '<path d="M0 0h1"/>' } }, width: 24, height: 24 });
    expect(gameIconSvg('lucide:list-checks')).not.toBeNull();
    expect(gameIconSvg('lucide:app-only')).not.toBeNull();
  });
});
