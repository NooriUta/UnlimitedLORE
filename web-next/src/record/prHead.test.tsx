// @vitest-environment jsdom
// SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 — шапка паспорта PR по прототипу docs/prototypes/md05-pr-passport.html,
// одобренному владельцем 23.11.2026 («все рекомендации ок»): 1а — вид PR словом из ветки-цели, 2а — спринты
// выводом через задачи (поле модели pr.sprints, рисует общий паспорт), 3б — плашка «заголовок не дотянут»
// общей фразой, без поля причины (поле причины заполнила бы только отдельная дотяжка — пункт «3а после 1.19»).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { prKind, PrHeadLine } from './PrHeadLine';
import ListPassport from './ListPassport';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

beforeAll(() => { registerGameIcons(gameIcons); });

const UID = 'NooriUta/UnlimitedLORE#1641';

describe('вид PR из ветки-цели (1а)', () => {
  it('develop — работа, preprod — промо, main из preprod или promote/* — релиз, иное в main — срочная правка', () => {
    expect(prKind('feat/x', 'develop')).toBe('work');
    expect(prKind('promote/2026-11-22-b8c2198b', 'preprod')).toBe('promo');
    expect(prKind('develop', 'preprod')).toBe('promo');
    expect(prKind('preprod', 'main')).toBe('release');
    expect(prKind('hotfix/crash', 'main')).toBe('hotfix');
  });
  it('ветки-цели нет или она чужая — вида нет, не угадываем', () => {
    expect(prKind('feat/x', null)).toBeNull();
    expect(prKind(null, undefined)).toBeNull();
    expect(prKind('feat/x', 'release/2.0')).toBeNull();
  });
});

describe('шапка PR', () => {
  it('ветки «откуда → куда» и вид словом', () => {
    render(<PrHeadLine values={{ title: 'feat: x', code: UID, head_ref: 'feat/md05', base_ref: 'develop', state: 'merged', merged_at: '2026-11-18T21:14:00Z' }} />);
    const line = screen.getByTestId('pr-head');
    expect(line.textContent).toContain('feat/md05');
    expect(line.textContent).toContain('develop');
    expect(line.textContent).toContain('→');
    expect(screen.getByTestId('pr-kind').textContent).toBe(ru['prHead.kind.work']);
    expect(screen.queryByTestId('pr-notitle'), 'заголовок есть — плашки нет').toBeNull();
    expect(screen.queryByTestId('pr-notmerged'), 'влит — пометки «не влит» нет').toBeNull();
  });

  it('PR без заголовка (подпись — ключ): жёлтая плашка общей фразой (3б)', () => {
    render(<PrHeadLine values={{ title: UID, code: UID }} />);
    const b = screen.getByTestId('pr-notitle');
    expect(b.className).toContain('sk-banner--warn');
    expect(b.textContent).toBe(ru['prHead.noTitle']);
    expect(screen.queryByTestId('pr-head'), 'веток нет — строки веток нет, а не «undefined → undefined»').toBeNull();
  });

  it('открытый PR: «не влит — ещё не в релизе» словами', () => {
    render(<PrHeadLine values={{ title: 'feat: y', code: UID, head_ref: 'feat/y', base_ref: 'develop', state: 'open' }} />);
    expect(screen.getByTestId('pr-notmerged').textContent).toBe(ru['prHead.notMerged']);
  });

  it('по-английски — английские строки', () => {
    render(<PrHeadLine lang="en" values={{ title: UID, code: UID, head_ref: 'preprod', base_ref: 'main', state: 'open' }} />);
    expect(screen.getByTestId('pr-kind').textContent).toBe(en['prHead.kind.release']);
    expect(screen.getByTestId('pr-notitle').textContent).toBe(en['prHead.noTitle']);
    expect(screen.getByTestId('pr-notmerged').textContent).toBe(en['prHead.notMerged']);
  });

  it('все строки шапки есть в обеих локалях', () => {
    for (const k of ['prHead.kind.work', 'prHead.kind.promo', 'prHead.kind.release', 'prHead.kind.hotfix', 'prHead.noTitle', 'prHead.notMerged', 'prHead.branches']) {
      expect((ru as Record<string, string>)[k], 'ru: ' + k).toBeTruthy();
      expect((en as Record<string, string>)[k], 'en: ' + k).toBeTruthy();
    }
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Фасад PR — на СНЯТОМ ответе сервера (shared/fixtures/record-task.json, сторож CT-KIT-FIXTURES): форма ответа
 * своя у сервера, подменены только тип, ключ и значения PR (LoreRecordFrom.VALUES pr).
 */
function prFacade(): Record<string, unknown> {
  const body = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'record-task.json'), 'utf8')) as Record<string, unknown> & { record: object; schema: object };
  body.record = { ...body.record, type: 'pr', id: UID, title: 'feat(forgejo): данные PR при мерже' };
  body.values = { title: 'feat(forgejo): данные PR при мерже', code: UID, url: 'https://h/AIDA/UnlimitedLORE/pulls/1641', state: 'merged',
    merged_at: '2026-11-18T21:14:00Z', head_ref: 'feat/md05-merge', base_ref: 'develop', sprints: ['SPRINT_LORE_MODEL_DOCS_TIDY'] };
  body.schema = { ...body.schema, type: 'pr' };
  return body;
}

describe('паспорт PR собирается с шапкой веток', () => {
  it('ListPassport type=pr: строка веток над записью, спринт PR — в поле «Спринты»', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname.startsWith('/lore/record/')) return json(prFacade());
      if (url.pathname === '/lore/history') return json({ type: 'pr', id: UID, rows: [], attribution: { ok: true } });
      if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    render(<ListPassport type="pr" id={UID} placement="bottom" fetchImpl={fetchImpl} />);
    const line = await screen.findByTestId('pr-head', {}, { timeout: 8000 });
    expect(line.textContent).toContain('feat/md05-merge');
    expect(screen.getByTestId('pr-kind').textContent).toBe(ru['prHead.kind.work']);
  });
});
