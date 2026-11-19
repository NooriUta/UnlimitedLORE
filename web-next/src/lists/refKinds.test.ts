// Поле-ссылка в списках v2 ведёт к своей записи (владелица 18.11.2026, скрин карточек задач: «если объект ссылка
// хорошо бы была возможность перехода»). Kit делает значение ссылкой только при известном виде записи (refKind) и
// адресе от приложения (refHref, ListScreen). Сторож: у каждого поля вида 'ref' на всех экранах списков есть
// refKind, и у этого вида есть адрес записи (newsRefHrefV2: раздел v2 или карточка человека в админке) — иначе значение останется текстом молча.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LIST_SCREENS } from './screens';
import { newsRefHrefV2 } from '../news/newsLinks';

describe('поля-ссылки списков знают свой вид записи', () => {
  for (const [id, def] of Object.entries(LIST_SCREENS)) {
    it(id, () => {
      const cfg = (def as { config: (l: 'ru') => { kinds: Record<string, { fields?: { key: string; type: string; refKind?: string }[] }> } }).config('ru');
      for (const [kind, k] of Object.entries(cfg.kinds)) {
        for (const f of (k.fields ?? []).filter(x => x.type === 'ref')) {
          expect(f.refKind, `${id}/${kind}.${f.key}: нет refKind`).toBeTruthy();
          expect(newsRefHrefV2(f.refKind!, 'x'), `${id}/${kind}.${f.key}: у вида ${f.refKind} нет адреса записи`).not.toBeNull();
        }
      }
    });
  }

  it('ListScreen передаёт списку адрес записи по ссылке (refHref)', () => {
    const src = readFileSync(new URL('../pages/ListScreen.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/refHref=\{/);
  });
});
