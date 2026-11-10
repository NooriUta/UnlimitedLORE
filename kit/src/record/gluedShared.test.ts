// Вклеенный блок — ОДИН код на паспорт и на ленту
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-BODY-MORE, п. 4 состава: «механизм
// свёртки/вклейки ОБЩИЙ с паспортом — второй заводить нельзя: разойдутся
// поведением на первой же правке»).
//
// Это сторож ИСХОДНИКА, а не разметки, и так задумано. Разметку легко сделать
// похожей: два блока с одинаковыми классами пройдут любую проверку вида, а
// разъедутся, когда в один добавят правило (счётчик «не проверено», пустой
// блок, уровень заголовка), а во второй забудут. Проверять надо именно то, что
// код ОДИН.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Код без комментариев: в комментариях класс упоминается по делу. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const USERS = ['src/record/RecordView.tsx', 'src/list/ListView.tsx'];

describe('K2-FEED-BODY-MORE · вклеенный блок один на оба места', () => {
  it('положительный контроль: сам блок существует и несёт счётчик', () => {
    const glue = code('src/record/GluedBlock.tsx');
    expect(glue).toContain('sk-rec-glue__head');
    expect(glue, 'счётчик у вклеенного блока обязателен: вкладки у него нет').toContain('TabCount');
  });

  it('и паспорт, и лента рисуют его ОДНИМ компонентом', () => {
    for (const p of USERS) {
      expect(code(p), `${p} не использует общий GluedBlock`).toContain('<GluedBlock');
    }
  });

  it('своей вёрстки заголовка вклеенного блока ни один из них не держит', () => {
    for (const p of USERS) {
      expect(code(p), `${p} рисует заголовок вклеенного блока сам — это второй механизм`)
        .not.toContain('sk-rec-glue__head');
    }
  });

  it('лента не заводит своего класса вклейки: иначе у неё свои правила', () => {
    expect(code('src/list/ListView.tsx')).not.toMatch(/sk-feed__glue/);
  });
});
