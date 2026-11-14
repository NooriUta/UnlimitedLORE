// @vitest-environment jsdom
// MD-WINDOW §3a (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW; D-2026-LORE-MD-REF-PASTE-CHECK,
// spec:SPEC-LORE-MD-INLINE-REF §3a): при вставке копипастом голые ID оборачиваются в [[тип:ID]] и
// сразу проверяются — найденная зелёная, ненайденная красная; «не смогли проверить» не красится.
// «Не сейчас» оставляет красной; сохранение с красными предупреждает, но не запрещает.
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { pasteRefNodes, refCheckStates } from './refPasteCheck';
import { TipTapField, type TipTapRefSource } from './TipTapField';

// jsdom не меряет раскладку — тот же приём, что в tiptapMath.test.tsx.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
for (const proto of [Range.prototype, Element.prototype, Text.prototype as unknown as Element]) {
  const p = proto as unknown as { getClientRects?: unknown; getBoundingClientRect?: unknown };
  if (typeof p.getClientRects !== 'function') p.getClientRects = noRects;
  if (typeof p.getBoundingClientRect !== 'function') p.getBoundingClientRect = zeroRect;
}

const forms = [{ type: 'adr', re: /ADR-[A-Z0-9]+(?:-[A-Z0-9]+)*/ }, { type: 'spec', re: /SPEC-[A-Z0-9]+(?:-[A-Z0-9]+)*/ }];

describe('pasteRefNodes — голые ID из вставки становятся ссылками', () => {
  it('ID в тексте — атомы [[тип:ID]] между кусками текста', () => {
    expect(pasteRefNodes('см. ADR-1 и SPEC-X.', forms)).toEqual([
      { type: 'text', text: 'см. ' },
      { type: 'mdRaw', attrs: { raw: '[[adr:ADR-1]]', kind: 'wikilink' } },
      { type: 'text', text: ' и ' },
      { type: 'mdRaw', attrs: { raw: '[[spec:SPEC-X]]', kind: 'wikilink' } },
      { type: 'text', text: '.' },
    ]);
  });
  it('нечего оборачивать — null (вставка идёт обычным путём)', () => {
    expect(pasteRefNodes('просто текст', forms)).toBeNull();
    expect(pasteRefNodes('ADR-1', [])).toBeNull();
  });
  it('переносы строк сохраняются абзацами', () => {
    const nodes = pasteRefNodes('ADR-1\nвторая', forms)!;
    expect(nodes.some(n => n.type === 'hardBreak')).toBe(true);
  });
});

describe('refCheckStates — найдено / нет / не смогли проверить', () => {
  it('true — ok, false — missing, null или нет ответа — unknown (не красим)', () => {
    expect(refCheckStates(['A', 'B', 'C', 'D'], { A: true, B: false, C: null })).toEqual({ A: 'ok', B: 'missing', C: 'unknown', D: 'unknown' });
  });
});

describe('TipTapField · отметки ссылок и полоса ненайденных', () => {
  const src = (exists: TipTapRefSource['exists']): TipTapRefSource => ({
    types: { adr: 'adr', spec: 'spec' }, typeLabels: { adr: 'ADR', spec: 'Спека' }, search: async () => [], forms, exists,
  });
  it('найденная — зелёная, ненайденная — красная; «не смогли» не красная; полоса называет ненайденные', async () => {
    const exists = vi.fn(async () => ({ 'ADR-1': true, 'SPEC-X': false, 'ADR-9': null }));
    const onMissing = vi.fn();
    const { container } = render(<TipTapField value="[[adr:ADR-1]] [[spec:SPEC-X]] [[adr:ADR-9]]" onChange={() => {}} refs={src(exists)} onRefsMissing={onMissing} />);
    await waitFor(() => expect(container.querySelector('[data-ref-state="missing"]')).toBeTruthy());
    const state = (raw: string) => container.querySelector(`[data-raw="${raw}"]`)?.getAttribute('data-ref-state');
    expect(state('[[adr:ADR-1]]')).toBe('ok');
    expect(state('[[spec:SPEC-X]]')).toBe('missing');
    expect(state('[[adr:ADR-9]]')).toBe('unknown');
    expect(screen.getByTestId('kit-ref-missing').textContent).toContain('SPEC-X');
    expect(onMissing).toHaveBeenLastCalledWith(['SPEC-X']);
  });
  it('«Не сейчас» прячет полосу, ссылка остаётся красной', async () => {
    const { container } = render(<TipTapField value="[[spec:SPEC-X]]" onChange={() => {}} refs={src(async () => ({ 'SPEC-X': false }))} />);
    await screen.findByTestId('kit-ref-missing');
    act(() => { screen.getByRole('button', { name: 'Не сейчас' }).click(); });
    expect(screen.queryByTestId('kit-ref-missing')).toBeNull();
    expect(container.querySelector('[data-raw="[[spec:SPEC-X]]"]')?.getAttribute('data-ref-state')).toBe('missing');
  });
  it('проверка упала — ничего не красим, полосы нет', async () => {
    const { container } = render(<TipTapField value="[[spec:SPEC-X]]" onChange={() => {}} refs={src(async () => { throw new Error('503'); })} />);
    await waitFor(() => expect(container.querySelector('[data-raw="[[spec:SPEC-X]]"]')?.getAttribute('data-ref-state')).toBe('unknown'));
    expect(screen.queryByTestId('kit-ref-missing')).toBeNull();
  });
});
