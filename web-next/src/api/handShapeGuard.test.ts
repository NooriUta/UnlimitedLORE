// SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES, шаг 3: сторож рукописной формы ответа сервера.
//
// Ручная фикстура совпадает с тем, что думает автор, а не с тем, что сервер
// отдаёт. 14.11.2026 это стоило настоящего дефекта: useModelStatuses искал
// словарь в `model.statuses.task_status`, ручная фикстура теста клала его туда же,
// тест был зелёным, а сервер кладёт блок по типу (`statuses.task`) — словарь
// оболочки v2 никогда не приходил из модели. Поймал тест на СНЯТОМ ответе
// (api/serverFixtures.test.ts, shared/fixtures/).
//
// Переписать 37 существующих файлов разом нельзя. Поэтому храповик: список
// файлов с литералом формы сервера заморожен. Новый тест с рукописным
// `contract: 'lore.record/1'` или `format: 'model/0'` роняет этот сторож —
// берите снимок из shared/fixtures/ (snapshot.mjs). Файл ушёл с ручной формы —
// уберите его из списка, чтобы храповик не ослаб.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const SHAPE = /contract: 'lore\.record\/1'|format: 'model\/0'/;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) testFiles(p, out);
    else if (/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Заморожено 14.11.2026. Только убывает. */
const KNOWN = new Set([
  // 25.11.2026, K5-PACKAGE-DELIVERY: LORE берёт kit пакетом из AIDA/lorekit — тестов kit в этом
  // репозитории больше нет, и шесть их строк (kit/src/model/*, kit/src/content/ModelDiagram) ушли
  // вместе с папкой. У kit свой репозиторий, свой CI и свои правила.
  'web-next/src/api/liveRecord.test.ts',
  'web-next/src/lists/feedWired.test.tsx',
  'web-next/src/milestone/milestoneBurn.test.tsx',
  'web-next/src/pages/ListScreen.statuses.test.tsx',
  'web-next/src/pages/ListScreen.test.tsx',
  'web-next/src/pages/PassportDemo.test.tsx',
  'web-next/src/pages/listScreenPeek.test.tsx',
  'web-next/src/record/ListPassport.facade.test.tsx',
  'web-next/src/record/ListPassport.graph.test.tsx',
  'web-next/src/record/ListPassport.statusByKind.test.tsx',
  'web-next/src/record/bodyEditableAfterFacade.test.ts',
  'web-next/src/record/childColumns.test.ts',
  'web-next/src/record/dataStateThrough.test.ts',
  'web-next/src/record/lorePeek.test.tsx',
  'web-next/src/record/partTabList.test.tsx',
  'web-next/src/record/partsFromFacade.test.ts',
  'web-next/src/record/passportMdRefs.test.tsx',
  'web-next/src/record/passportOrder.test.tsx',
  'web-next/src/record/passportStatuses.test.ts',
  'web-next/src/record/passportTabsOnce.test.ts',
  'web-next/src/record/passportWarnings.test.tsx',
  'web-next/src/record/propsEditWired.test.tsx',
  'web-next/src/record/propsEditable.test.ts',
  'web-next/src/record/readOnlyPassport.test.tsx',
  'web-next/src/record/recordSource.test.ts',
  'web-next/src/record/sprintTasksFromFacade.test.ts',
  'web-next/src/record/sprintTree.test.tsx',
  'web-next/src/record/statusChangeWired.test.tsx',
  'web-next/src/record/truncatedTabCount.test.tsx',
  'web-next/src/settings/palettesSource.test.ts',
  'web-next/src/shell/useModelStatuses.test.ts',
  'web-next/src/sprint/sprintCountersAuthor.test.tsx',
  'web-next/src/sprint/sprintTasksControls.test.tsx',
]);

describe('CT-KIT-FIXTURES: рукописная форма ответа сервера не расползается', () => {
  const found = [join(ROOT, 'web-next', 'src')]
    .flatMap(d => testFiles(d))
    .filter(f => SHAPE.test(readFileSync(f, 'utf8')))
    .map(f => relative(ROOT, f).split('\\').join('/'))
    .filter(f => !f.endsWith('api/handShapeGuard.test.ts'));

  it('положительный контроль: сторож видит известные файлы', () => {
    expect(found.length).toBeGreaterThan(10);
  });

  it('новых тестов с рукописной формой нет — берите снимок из shared/fixtures/', () => {
    const fresh = found.filter(f => !KNOWN.has(f));
    expect(fresh, 'новый тест собирает ответ сервера руками; снимок: node shared/fixtures/snapshot.mjs').toEqual([]);
  });

  it('храповик не ослаб: ушедший с ручной формы файл убран из списка', () => {
    const gone = [...KNOWN].filter(f => !found.includes(f));
    expect(gone, 'уберите эти файлы из KNOWN — они больше не держат ручную форму').toEqual([]);
  });
});
