// Фикстура «Дата-странников» для демо и тестов kit (K-01): форма X_DATA,
// которую сейчас вшивает их method_proto.py, приведённая к контракту —
// summary/verdict/review записи лежат в fields, статус согласования — в status.
// Содержимое вымышленное (не их корпус): только чтобы показать форму.
import type { KitData } from '../src/core/contract';

export const datawanderersData: KitData = {
  records: [
    {
      id: 'topic.sets', kind: 'Topic', title: 'Множества', status: 'ok',
      fields: {
        summary: 'Что такое множество и как с ним работать.', discipline: 'math',
        verdict: { score: 3, max: 3, failed: [], hints: [] },
      },
    },
    {
      id: 'topic.joins', kind: 'Topic', title: 'Соединения таблиц', status: 'none',
      fields: {
        summary: 'JOIN: внутреннее, левое, полное.', discipline: 'sql',
        verdict: { score: 1, max: 3, failed: [{ code: 'quiz', message: 'нет квиза' }, { code: 'item', message: 'нет заданий' }], hints: [{ code: 'scroll', message: 'нет свитка' }] },
      },
    },
    {
      id: 'quiz.sets.1', kind: 'Quiz', title: 'Пересечение множеств', status: 'fix',
      fields: {
        question: 'Что даёт A ∩ B?', options: ['элементы обоих', 'все элементы', 'ничего'], answer: 'A',
        hints: ['', 'это объединение', 'пустое — только если нет общих'],
        verdict: { score: 2, max: 3, failed: [{ code: 'hints', message: 'подсказка к A не нужна' }], hints: [] },
      },
      updated_at: '2026-11-06T18:20:00Z',
    },
    {
      id: 'scroll.sets', kind: 'Scroll', title: 'Свиток о множествах', status: 'none',
      fields: { text_md: '# Множества\nНабор **разных** элементов.', tell_correct: 'о множествах' },
    },
    {
      id: 'trail.math-sql', kind: 'Trail', title: 'От множеств к JOIN', status: 'none',
      fields: { dreamA: 'Сон чисел', dreamB: 'Сон таблиц' },
    },
    { id: 'author.cantor', kind: 'Author', title: 'Георг Кантор', status: 'ok', fields: { summary: 'Основатель теории множеств.' } },
  ],
  edges: [
    { from: 'topic.sets', to: 'topic.joins', type: 'PREREQ' },
    { from: 'quiz.sets.1', to: 'topic.sets', type: 'ASSESSES' },
    { from: 'scroll.sets', to: 'topic.sets', type: 'SCROLL_OF' },
    { from: 'author.cantor', to: 'topic.sets', type: 'CONTRIBUTED' },
    { from: 'topic.joins', to: 'trail.math-sql', type: 'ON_TRAIL' },
  ],
  journal: [
    { at: '2026-11-06T18:20:00Z', who: 'методолог', record_id: 'quiz.sets.1', field: 'status', from: 'none', to: 'fix' },
  ],
  meta: { generated_at: '2026-11-07T09:00:00Z', scope: 'method', total: 181, returned: 6, truncated: true },
};
