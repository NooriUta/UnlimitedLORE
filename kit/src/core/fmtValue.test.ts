// Числа и даты в интерфейсе — по ОДНОМУ правилу (ревью владелицы 10.11.2026,
// раздел UX-долга).
//
// Что нашло ревью: «Числа: три `Intl.NumberFormat` (TaskCounters.tsx:42,
// TaskTable.tsx:194, sum.tsx:77) + сырой `String(v)` (taskGroups.ts:126) —
// «6,44» vs «0.375»; поле правки принимает точку, показывает запятую» и
// «Даты: нет единого форматтера; три ручные обрезки (ListView.tsx:781,
// RecordHead.tsx:38, NewsFeed.tsx:772) + полный ISO в тултипе
// (RecordFacts.tsx:68); тип `date` в движке списка не обрабатывается (ISO с
// миллисекундами в «Технологиях»)».
//
// Почему это правило, а не три правки: разнобой возник не от трёх опечаток, а
// от того, что форматирование НЕ ЖИВЁТ В ОДНОМ МЕСТЕ. Пока его нет, каждый
// следующий экран снова выберет своё. Поэтому здесь и сторож: `Intl` для чисел
// заводится только в этом модуле, обрезка даты руками — тоже.
//
// Намеренное исключение, названное прямо: ПОЛЕ ПРАВКИ показывает число так,
// как его можно ввести (точка), а не так, как его читают (запятая по языку).
// Иначе человек видит «12,5», вводит «12,5» и получает отказ разбора.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { kitDay, kitMinute, kitNumber, kitNumberOf } from './fmtValue';

const SRC = join(process.cwd(), 'src');

/** Все .ts/.tsx под src, кроме тестов. */
function sources(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

/** Код без комментариев: сторож ловит ОБРАЩЕНИЕ, а не упоминание в пояснении. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('одно правило на числа', () => {
  it('положительный контроль: корпус прочитан', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(50);
  });

  it('число пишется по языку: разделитель дробной части — языка, не кода', () => {
    expect(kitNumber('ru', 12.5)).toBe('12,5');
    expect(kitNumber('en', 12.5)).toBe('12.5');
    expect(kitNumber('ru', 12), 'целое — без лишних нулей').toBe('12');
  });

  it('больше двух знаков после запятой не показываем: 0,375 → «0,38»', () => {
    expect(kitNumber('ru', 0.375)).toBe('0,38');
    expect(kitNumber('en', 6.44)).toBe('6.44');
  });

  it('не число — это НЕ ноль: null вместо выдуманной цифры', () => {
    expect(kitNumberOf('ru', null)).toBeNull();
    expect(kitNumberOf('ru', 'двенадцать')).toBeNull();
    expect(kitNumberOf('ru', Number.NaN)).toBeNull();
    expect(kitNumberOf('ru', 12.5)).toBe('12,5');
  });

  it('сторож: Intl.NumberFormat заводится только в этом модуле', () => {
    const bad = sources()
      .filter(p => !p.endsWith(join('core', 'fmtValue.ts')))
      .filter(p => code(readFileSync(p, 'utf8')).includes('Intl.NumberFormat'));
    expect(bad, 'форматирование числа мимо kitNumber — отсюда и начинается разнобой').toEqual([]);
  });
});

describe('одно правило на даты', () => {
  it('день из отметки времени: «2026-11-10», подсказка — полная отметка', () => {
    const d = kitDay('2026-11-10T09:31:14.123Z')!;
    expect(d.text).toBe('2026-11-10');
    expect(d.title).toContain('2026-11-10T09:31:14');
    expect(d.ok).toBe(true);
  });

  it('минуты — тоже одно правило: «2026-11-10 09:31», без T и без миллисекунд', () => {
    expect(kitMinute('2026-11-10T09:31:14.123Z')!.text).toBe('2026-11-10 09:31');
  });

  it('даты нет — null, чтобы вызывающий сказал «не заполнено», а не «1970»', () => {
    expect(kitDay(null)).toBeNull();
    expect(kitDay('')).toBeNull();
    expect(kitDay('   ')).toBeNull();
  });

  it('дату не разобрали — показываем КАК ПРИСЛАЛИ и помечаем, а не прячем', () => {
    const d = kitDay('через неделю')!;
    expect(d.ok).toBe(false);
    expect(d.text).toBe('через неделю');
    expect(d.title).toBe('через неделю');
  });

  it('сторож: обрезка даты руками — только в этом модуле', () => {
    const bad = sources()
      .filter(p => !p.endsWith(join('core', 'fmtValue.ts')))
      .filter(p => /(updated_at|created_at|\bat\b)[^;\n]*\.slice\(\s*0\s*,\s*(10|16|19)\s*\)/.test(code(readFileSync(p, 'utf8'))));
    expect(bad, 'дата режется на месте — следующий экран отрежет иначе').toEqual([]);
  });
});
