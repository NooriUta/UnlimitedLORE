import { describe, expect, it } from 'vitest';
import { findDefining, sourceOf } from './sourceOf';

// SPRINT_UXR_S0_SAFETY/S0-07: гварды по исходникам искали файл по ПУТИ
// (`endsWith('/components/lore/LoreBragiPlan.tsx')`) — перенос компонента в
// другую папку ронял тест при работающем коде. Теперь файл ищется по тому,
// какой компонент в нём объявлен.
describe('sourceOf: исходник по имени компонента, а не по пути', () => {
  const corpus = {
    '../a/One.tsx': 'export default function One() { return null; }',
    '../b/deep/Two.tsx': 'export function Two({ x }: P) {}\nexport function TwoHelper() {}',
    '../c/Three.tsx': 'export const Three = () => null;',
    '../c/Three.test.tsx': 'function One() {}',
  };

  it('находит файл по default-, именованному и const-объявлению, где бы он ни лежал', () => {
    expect(findDefining(corpus, 'One')).toBe('../a/One.tsx');
    expect(findDefining(corpus, 'Two')).toBe('../b/deep/Two.tsx');
    expect(findDefining(corpus, 'Three')).toBe('../c/Three.tsx');
  });

  it('имя — целым словом: TwoHelper не путается с Two', () => {
    expect(findDefining({ '../x.tsx': 'export function TwoHelper() {}' }, 'Two')).toBeNull();
  });

  it('тестовые файлы не считаются определением', () => {
    expect(findDefining({ '../c/Three.test.tsx': 'function One() {}' }, 'One')).toBeNull();
  });

  it('два определения — ошибка, а не случайный выбор', () => {
    expect(() => findDefining({ '../a.tsx': 'function Dup() {}', '../b.tsx': 'export function Dup() {}' }, 'Dup'))
      .toThrow(/Dup/);
  });

  it('на настоящем корпусе находит экраны приложения', () => {
    expect(sourceOf('LoreBragiPlan')).toMatch(/function LoreBragiPlan\b/);
    expect(sourceOf('AppShell')).toMatch(/function AppShell\b/);
  });

  it('пропавший компонент — громкая ошибка с именем', () => {
    expect(() => sourceOf('NoSuchComponentEver')).toThrow(/NoSuchComponentEver/);
  });
});
