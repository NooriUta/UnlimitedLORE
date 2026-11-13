// Слова бренда на странице входа (SPRINT_UXR_POLISH_UAT_1113/PU-21): те же, что у темы Keycloak
// lore/login (template.ftl) — знак «L», LORE · Graph, слоган, строка платформы. Kit даёт композицию,
// слова — приложение (K-14). Слоган — один на день (без случайности: экран не мигает при перерисовке).
import type { KitLang } from '@seidr/kit';
import type { AuthBrand } from '@seidr/kit/auth';

const SLOGANS: Record<'ru' | 'en', readonly string[]> = {
  ru: [
    'У каждого решения остаётся его причина.',
    'Не документация — память.',
    'Знание переживает тех, кто его записал.',
    'ADR, спринты, релизы — одной нитью.',
    'Граф помнит то, что забывает переписка.',
  ],
  en: [
    'Every decision keeps its reason.',
    'Not documentation — memory.',
    'Lore is what survives the people who wrote it.',
    'ADRs, sprints, releases — one thread.',
    'The graph remembers what the chat forgets.',
  ],
};

export function authBrand(lang: KitLang, now: Date = new Date()): AuthBrand {
  const pool = SLOGANS[lang === 'en' ? 'en' : 'ru'];
  const day = Math.floor(now.getTime() / 86_400_000);
  return { mark: 'L', name: 'LORE', sub: 'Graph', slogan: pool[day % pool.length], platform: 'AIDA · PLATFORM · KNOWLEDGE' };
}
