// AH-05, пачка 2 (прототип admin-v2, класс .rt): одна разметка колонок на обе
// раскладки. Десктоп — плотная таблица, телефон — карточка на строку:
//   title — заголовок карточки (без подписи), крупно;
//   act   — действия, внизу карточки во всю ширину;
//   full  — поле во всю ширину без подписи-слева (длинные списки, пилюли);
//   прочие — строка «ПОДПИСЬ … значение», подпись = заголовок колонки.
// Тексты сюда не попадают: label приходит уже переведённым через t().

export type ColKind = 'title' | 'act' | 'full';
export interface Col { key: string; label: string; kind?: ColKind; num?: boolean }
export interface CardParts { title: Col | null; body: Col[]; act: Col[] }

export function cardParts(cols: Col[]): CardParts {
  const title = cols.find(c => c.kind === 'title') ?? null;
  return {
    title,
    body: cols.filter(c => c !== title && c.kind !== 'act'),
    act: cols.filter(c => c.kind === 'act'),
  };
}
