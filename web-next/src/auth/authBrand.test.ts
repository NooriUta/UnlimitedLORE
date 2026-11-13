// PU-21: слова бренда страницы входа — как у темы Keycloak; слоган один на день, на обоих языках.
import { describe, expect, it } from 'vitest';
import { authBrand } from './authBrand';

describe('authBrand', () => {
  it('знак, имя и платформа как у KC; слоган стабилен в течение дня', () => {
    const a = authBrand('ru', new Date('2026-11-13T08:00:00Z'));
    const b = authBrand('ru', new Date('2026-11-13T20:00:00Z'));
    expect(a).toMatchObject({ mark: 'L', name: 'LORE', sub: 'Graph', platform: 'AIDA · PLATFORM · KNOWLEDGE' });
    expect(a.slogan).toBe(b.slogan);
    expect(authBrand('en').slogan).toMatch(/[a-z]/);
  });
});
