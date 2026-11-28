// ADR-LORE-066 фаза А (владелица 28.11.2026: «списки, карточки PR и релизов должны иметь связь и видимость
// репозитория»): у релиза и PR — поле «Репозиторий» ссылкой на паспорт репозитория (рёбра RELEASE_OF / PR_OF).
// Нет ребра — честное «не определён» текстом, а не проект вместо репозитория и не пустота.
import { describe, expect, it } from 'vitest';
import { LIST_SCREENS } from './screens';
import { prRecord, releaseRecord } from './records';

const REPO = 'https://git.example.org/AIDA/UnlimitedLORE';

describe('репозиторий у релиза и PR', () => {
  it('релиз с ребром — ссылка на репозиторий, подпись — путь', () => {
    const r = releaseRecord({ release_uid: 'NooriUta/UnlimitedLORE#v1.19.3', git_tag: 'v1.19.3', repository: REPO, repository_path: 'AIDA/UnlimitedLORE' });
    expect(r.fields.repository).toEqual([{ id: REPO, label: 'AIDA/UnlimitedLORE' }]);
  });

  it('PR с ребром — ссылка; без пути — адрес без схемы', () => {
    const r = prRecord({ pr_uid: 'NooriUta/UnlimitedLORE#1', repository: REPO });
    expect(r.fields.repository).toEqual([{ id: REPO, label: 'git.example.org/AIDA/UnlimitedLORE' }]);
  });

  it('нет ребра — «не определён» текстом (без ссылки), на обоих языках', () => {
    expect(releaseRecord({ release_uid: 'X#v1' }).fields.repository).toEqual([{ id: '', label: 'не определён' }]);
    expect(prRecord({ pr_uid: 'X#1' }, { lang: 'en' }).fields.repository).toEqual([{ id: '', label: 'not determined' }]);
  });

  it('колонка и поле «Репозиторий» в списках релизов и PR — ссылкой на паспорт репозитория', () => {
    for (const key of ['releases', 'prs'] as const) {
      const cfg = LIST_SCREENS[key].config('ru');
      expect(cfg.list?.columns).toContain('repository');
      const kind = Object.values(cfg.kinds ?? {})[0] as { fields: { key: string; type: string; refKind?: string; title: string }[] };
      const fld = kind.fields.find(x => x.key === 'repository');
      expect(fld).toMatchObject({ type: 'ref', refKind: 'repository', title: 'Репозиторий' });
    }
  });
});
