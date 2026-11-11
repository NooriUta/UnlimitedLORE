// SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW · spec:SPEC-LORE-MD-INLINE-REF §2, §3a.
// Где в тексте открывается мини-окно ссылки и какие ссылки уже стоят в теле.
// Kit знает только ФОРМУ (K-14): словарь «#слово → тип» и формы голых ID отдаёт приложение.
import { describe, expect, it } from 'vitest';
import { detectRefTrigger, refsInMd, wrapBareRefs } from './refTrigger';

const types = { adr: 'adr', 'адр': 'adr', task: 'task', 'задача': 'task' };
const at = (before: string) => detectRefTrigger(before, { types });

describe('detectRefTrigger — таблица §2 спеки', () => {
  it('«[[» + слова — окно без сужения, запрос — набранное', () => {
    expect(at('См. [[мини')).toEqual({ trigger: 'brackets', type: null, query: 'мини', start: 4 });
  });
  it('«[[тип:» — сужение по типу', () => {
    expect(at('См. [[adr:LORE')).toMatchObject({ trigger: 'brackets', type: 'adr', query: 'LORE' });
  });
  it('«[[неизвестно:» — не сужение, а часть запроса', () => {
    expect(at('[[foo:bar')).toMatchObject({ trigger: 'brackets', type: null, query: 'foo:bar' });
  });
  it('закрытая ссылка «[[X]]» окна не открывает', () => {
    expect(at('см. [[ADR-1]] дальше')).toBeNull();
  });
  it('«@» после пробела — окно по всем типам', () => {
    expect(at('Связано с @мини')).toEqual({ trigger: 'at', type: null, query: 'мини', start: 10 });
  });
  it('«@» в начале строки — тоже окно', () => {
    expect(at('первая\n@x')).toMatchObject({ trigger: 'at', start: 7 });
  });
  it('«a@b» — почта, окна нет', () => {
    expect(at('почта a@b')).toBeNull();
  });
  it('«@#тип слова» — сужение по типу', () => {
    expect(at('см. @#task Пере')).toMatchObject({ trigger: 'hash', type: 'task', query: 'Пере', start: 4 });
  });
  it('«#тип» внутри строки — сужение, синоним по-русски', () => {
    expect(at('текст #задача вы')).toMatchObject({ trigger: 'hash', type: 'task', query: 'вы', start: 6 });
  });
  it('«# Заголовок» в начале строки — заголовок, окна нет', () => {
    expect(at('# Заголовок')).toBeNull();
    expect(at('абзац\n# ')).toBeNull();
  });
  it('«#тег» в начале строки без пробела — тоже не окно (так пишут заголовки без пробела)', () => {
    expect(at('#adr')).toBeNull();
  });
  it('«#неизвестный» — окно с честным «тип не знаем»', () => {
    expect(at('текст #foo')).toEqual({ trigger: 'hash', type: null, unknownType: 'foo', query: '', start: 6 });
  });
  it('внутри inline-кода окна нет никогда', () => {
    expect(at('в коде `@x')).toBeNull();
    expect(at('в коде `[[x')).toBeNull();
  });
  it('внутри блока кода окна нет никогда', () => {
    expect(at('```\n@x')).toBeNull();
    expect(at('```\nкод\n```\nтекст @x')).toMatchObject({ trigger: 'at' });
  });
});

describe('refsInMd — ссылки в теле (для проверки и «Дозавести»)', () => {
  it('[[тип:ID]] и [[ID]], без повторов, в порядке появления', () => {
    expect(refsInMd('a [[adr:ADR-1]] b [[SPRINT_X/C-1]] c [[adr:ADR-1]]')).toEqual([
      { id: 'ADR-1', type: 'adr' },
      { id: 'SPRINT_X/C-1', type: null },
    ]);
  });
  it('внутри кода ссылки не считаются', () => {
    expect(refsInMd('`[[a]]` и\n```\n[[b]]\n```\n[[c]]')).toEqual([{ id: 'c', type: null }]);
  });
});

describe('wrapBareRefs — голые ID по формам, которые дало приложение', () => {
  const forms = [
    { type: 'adr', re: /ADR-[A-Z0-9-]*[A-Z0-9]/ },
    { type: 'task', re: /SPRINT_[A-Z0-9_]+\/[A-Z0-9-]+/ },
  ];
  it('оборачивает узнанные ID, остальное не трогает', () => {
    expect(wrapBareRefs('См. ADR-LORE-038 и SPRINT_X/CO-11, а UTF-8 — нет.', forms))
      .toBe('См. [[adr:ADR-LORE-038]] и [[task:SPRINT_X/CO-11]], а UTF-8 — нет.');
  });
  it('уже обёрнутые и внутри кода — не трогает', () => {
    expect(wrapBareRefs('[[adr:ADR-1]] и `ADR-2`', forms)).toBe('[[adr:ADR-1]] и `ADR-2`');
  });
  it('ID внутри слова не узнаётся', () => {
    expect(wrapBareRefs('xADR-1 и ADR-1x', forms)).toBe('xADR-1 и ADR-1x');
  });
  it('форма с захватывающей группой — громкий отказ, а не молча неверный тип', () => {
    expect(() => wrapBareRefs('ADR-1', [{ type: 'adr', re: /(ADR)-\d+/ }])).toThrow(/захватывающ/);
  });
  it('незахватывающие группы в форме можно', () => {
    expect(wrapBareRefs('см. D-2026-X', [{ type: 'decision', re: /D-(?:\d{4})-[A-Z]+/ }])).toBe('см. [[decision:D-2026-X]]');
  });
  it('без форм — текст без изменений (kit сам ID не угадывает)', () => {
    expect(wrapBareRefs('См. ADR-LORE-038', [])).toBe('См. ADR-LORE-038');
  });
});
