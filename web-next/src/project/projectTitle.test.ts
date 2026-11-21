// 1.18, владелица 21.11.2026: «не вижу на препроде полей … код, краткое название, полное название, описание» (ru/en/pl).
// Проект везде подписан кратким названием на языке интерфейса (откат — русское, затем полное, затем ключ), а не кодом
// со слешем «владелец/репозиторий».
import { describe, expect, it } from 'vitest';
import { projectShortTitle, projectFullTitle } from './projectTitle';
import { loadProjectScope } from '../scope/loadProjectScope';
import { projectRecord } from '../lists/records';

const MIDGARD = { slug: 'AIDA/MIDGARD', name: 'MIDGARD — хаб', short_title: 'Мидгард', short_title_en: 'Midgard', title_en: 'MIDGARD hub' };

describe('подпись проекта', () => {
  it('краткое название на языке интерфейса; нет перевода — русское; нет краткого — полное; нет ничего — ключ', () => {
    expect(projectShortTitle(MIDGARD, 'en')).toBe('Midgard');
    expect(projectShortTitle(MIDGARD, 'ru')).toBe('Мидгард');
    expect(projectShortTitle({ ...MIDGARD, short_title_en: null }, 'en')).toBe('Мидгард');
    expect(projectShortTitle({ slug: 'NooriUta/ODIN', name: 'ODIN' }, 'ru')).toBe('ODIN');
    expect(projectShortTitle({ slug: 'NooriUta/x' }, 'ru')).toBe('NooriUta/x');
  });

  it('полное название — тоже по языку с откатом на русское', () => {
    expect(projectFullTitle(MIDGARD, 'en')).toBe('MIDGARD hub');
    expect(projectFullTitle(MIDGARD, 'ru')).toBe('MIDGARD — хаб');
  });

  it('фильтр проектов в шапке подписан кратким названием по языку', async () => {
    const fetch = (async (slice: string) => (slice === 'git_projects' ? { rows: [MIDGARD] } : { rows: [] })) as never;
    const ru = await loadProjectScope({ fetch, me: async () => [] });
    expect(ru.rows[0].title).toBe('Мидгард');
    const en = await loadProjectScope({ fetch, me: async () => [], lang: 'en' });
    expect(en.rows[0].title).toBe('Midgard');
  });

  it('строка раздела «Проекты» — краткое название, полное — полем', () => {
    const r = projectRecord(MIDGARD, { lang: 'en' });
    expect(r.title).toBe('Midgard');
    expect(r.fields.full_title).toBe('MIDGARD hub');
    expect(projectRecord(MIDGARD).title).toBe('Мидгард');
  });
});
