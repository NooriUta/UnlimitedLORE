// @vitest-environment jsdom
// Peek у строк ленты новостей (владелица 11.11.2026: «и к новостям тоже приделай peek»):
// наведение на строку — та же карточка записи, что у ссылок в тексте и в списке;
// выключатель «Карточки по наведению» (peek_hover) действует и здесь.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { NewsFeed, parseNewsResponse, type NewsResponse, type NewsSource } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });
afterEach(() => document.documentElement.removeAttribute('data-peek-hover'));

const SNAPSHOT = resolve(process.cwd(), '../backend/src/test/resources/news-v2/contract-v2-fixture.json');
const data = (): NewsResponse => parseNewsResponse(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
const src = (d: NewsResponse): NewsSource => ({ kind: 'live', load: vi.fn(async () => d), setReadMark: vi.fn(async (at: string) => ({ state: 'ok', at })) });
async function mount() {
  render(<KitLangProvider lang="ru"><NewsFeed source={src(data())} urlPrefix={null} timeZone="Europe/Moscow" /></KitLangProvider>);
  await screen.findByTestId('news-feed-days');
}
const firstLink = () => document.querySelector('.sk-news__link[data-ref]') as HTMLElement;

describe('Peek в ленте новостей', () => {
  it('ссылка строки несёт код и тип записи — по ним грузится карточка', async () => {
    await mount();
    const a = firstLink();
    expect(a).not.toBeNull();
    expect(a.getAttribute('data-ref')).toBeTruthy();
    expect(a.getAttribute('data-ref-type')).toBeTruthy();
  });

  it('наведение на строку — через задержку карточка Peek', async () => {
    await mount();
    fireEvent.mouseOver(firstLink());
    await waitFor(() => expect(document.querySelector('.sk-peek-hover')).not.toBeNull(), { timeout: 2000 });
  });

  it('выключатель «Карточки по наведению» выключен — карточки нет', async () => {
    document.documentElement.setAttribute('data-peek-hover', 'off');
    await mount();
    fireEvent.mouseOver(firstLink());
    await new Promise(r => setTimeout(r, 700));
    expect(document.querySelector('.sk-peek-hover')).toBeNull();
  });
});
