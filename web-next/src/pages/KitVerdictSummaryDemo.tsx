// Витрина kit: сводка по вердикту (K4-SUMMARY-QUEUE) — «прошло N из M» по видам записей и
// причины со счётом; причина ведёт в список с условием по проверке (K4-VERDICT-FILTER).
// Данные выдуманы; в приложении вердикт считает config.verdict, адрес — приложение.
import { VerdictSummary, useKitLang, type KitConfig, type KitCtx, type KitRecord, type KitVerdict } from '@seidr/kit';

const rec = (id: string, kind: string): KitRecord => ({ id, kind, title: id, status: '', fields: {} });
const RECORDS: KitRecord[] = [
  ...['t1', 't2', 't3', 't4', 't5'].map(id => rec(id, 'topic')),
  ...['q1', 'q2', 'q3'].map(id => rec(id, 'quiz')),
  ...['r1', 'r2'].map(id => rec(id, 'rule')),
];
const NO_QUIZ = { code: 'quiz', message: 'нет квиза по руне темы' };
const NO_ART = { code: 'art', message: 'нет рисунка' };
const NO_PACK = { code: 'pack', message: 'пак игры не прочитан' };
const VERDICTS: Record<string, KitVerdict | undefined> = {
  t1: { score: 1, max: 2, failed: [NO_QUIZ], hints: [] },
  t2: { score: 1, max: 2, failed: [NO_QUIZ], hints: [NO_ART] },
  t3: { score: 1, max: 2, failed: [NO_QUIZ], hints: [] },
  t4: { score: 2, max: 2, failed: [], hints: [NO_ART] },
  t5: { score: 2, max: 2, failed: [], hints: [] },
  q1: { score: 2, max: 2, failed: [], hints: [] },
  q2: { score: 2, max: 2, failed: [], hints: [] },
  q3: { score: 1, max: 1, failed: [], hints: [], unknown: [NO_PACK] },
};
const CONFIG = {
  modules: [], menu: { groups: [] }, statuses: { items: [] },
  kinds: {
    topic: { title: 'Темы', icon: 'scroll-unfurled' },
    quiz: { title: 'Квизы', icon: 'checkbox-tree' },
    rule: { title: 'Правила', icon: 'gears' },
  },
  verdict: (r: KitRecord) => VERDICTS[r.id],
} as unknown as KitConfig;
const CTX = { config: CONFIG } as unknown as KitCtx;

export default function KitVerdictSummaryDemo() {
  const lang = useKitLang();
  return (
    <VerdictSummary
      records={RECORDS}
      ctx={CTX}
      lang={lang}
      hrefOf={(kind, check) => `#kit-states?sec=${kind}${check ? `&lck=${encodeURIComponent(check)}` : ''}`}
    />
  );
}
