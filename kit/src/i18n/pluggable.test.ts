// Подключаемые языки kit (SPRINT_UXR_S15_KIT6/K6-I18N-PLUGGABLE).
//
// Повод — GLADSHEIM: интерфейс на ru/en/pl, а kit знал только ru/en, и польский
// пользователь видел строки самого kit не по-польски. Добавить один pl в kit —
// частный случай; правило — язык подключает приложение своим словарём kit.*.
import { afterEach, describe, expect, it } from 'vitest';
import { kitLangMissing, kitLocale, kitT, pluralForm, registerKitLang, unregisterKitLang } from './index';
import ru from './ru.json';

const KEY = Object.keys(ru)[0] as keyof typeof ru;
const OTHER = Object.keys(ru)[1] as keyof typeof ru;

afterEach(() => unregisterKitLang('pl'));

describe('K6-I18N-PLUGGABLE · язык приложения', () => {
  it('строка из словаря приложения', () => {
    registerKitLang('pl', { [KEY]: 'po polsku' }, { locale: 'pl-PL' });
    expect(kitT('pl', KEY)).toBe('po polsku');
  });

  it('ключа нет в словаре — явный откат на английский, а не пустая строка', () => {
    registerKitLang('pl', { [KEY]: 'po polsku' });
    expect(kitT('pl', OTHER)).toBe(kitT('en', OTHER));
    expect(kitLangMissing('pl')).toContain(OTHER);
    expect(kitLangMissing('pl')).not.toContain(KEY);
  });

  it('неизвестный ключ в словаре — отказ: опечатка не проходит молча', () => {
    expect(() => registerKitLang('pl', { 'kit.no.such.key': 'x' } as never)).toThrow(/kit\.no\.such\.key/);
  });

  it('встроенные ru и en подменить нельзя — для слов приложения есть setKitStrings', () => {
    expect(() => registerKitLang('ru', {})).toThrow(/встроен/);
  });

  it('незарегистрированный язык — как раньше, русский', () => {
    expect(kitT('xx', KEY)).toBe(kitT('ru', KEY));
  });

  it('формы числа польского — по правилам языка (Intl), а не русские', () => {
    registerKitLang('pl', {}, { locale: 'pl-PL' });
    expect(pluralForm('pl', 1)).toBe('one');
    expect(pluralForm('pl', 2)).toBe('few');
    expect(pluralForm('pl', 5)).toBe('many');
    expect(pluralForm('pl', 22)).toBe('few');
    expect(pluralForm('pl', 12)).toBe('many');
  });

  it('локаль дат и чисел: ru-RU, en-US, у подключённого — своя', () => {
    registerKitLang('pl', {}, { locale: 'pl-PL' });
    expect(kitLocale('ru')).toBe('ru-RU');
    expect(kitLocale('en')).toBe('en-US');
    expect(kitLocale('pl')).toBe('pl-PL');
  });
});
