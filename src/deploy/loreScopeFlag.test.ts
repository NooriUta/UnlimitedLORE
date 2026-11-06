import { describe, it, expect } from 'vitest';

// SPRINT_LORE_PROJECT_SCOPE/AL-91: проектный скоуп чтения (lore.scope.enforce) в
// коде готов, но ни compose, ни CD его не передавали — включить его было нечем,
// кроме правки контейнера руками (правка на хосте не переживает деплой).
// Флаг проводится так же, как LORE_MART_AUTH (DBR-01): переменная репозитория →
// шаг деплоя → compose → свойство Quarkus. По умолчанию ВЫКЛЮЧЕН: включение —
// решение владелицы и только после того, как служебный читатель miniLORE заведён
// в граф ролей (иначе он увидит пустоту, неотличимую от «нет прав»).

// Чтение как в соседних тестах-сторожах (adminSplit, adminMcpGroup): ?raw через
// import.meta.glob — без node:fs, типов Node во фронтовом tsconfig нет.
const RAW = {
  ...import.meta.glob('../../docker-compose.yml', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../.github/workflows/lore-cd.yml', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const root = (p: string) => {
  const src = RAW['../../' + p];
  if (src === undefined) throw new Error('файл не подхвачен: ' + p + ' (есть: ' + Object.keys(RAW).join(', ') + ')');
  return src;
};

describe('флаг проектного скоупа доходит до бэкенда', () => {
  it('compose передаёт lore.scope.enforce с дефолтом false', () => {
    expect(root('docker-compose.yml')).toContain('- lore.scope.enforce=${LORE_SCOPE_ENFORCE:-false}');
  });

  it('CD берёт его из переменной репозитория, по умолчанию false', () => {
    const cd = root('.github/workflows/lore-cd.yml');
    expect(cd).toContain("LORE_SCOPE_ENFORCE: ${{ vars.LORE_SCOPE_ENFORCE || 'false' }}");
  });
});
