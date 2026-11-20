// kit как пакет для чужого репозитория (SPRINT_UXR_S14_KIT5/K5-PACKAGE-DELIVERY).
//
// Повод — пилот «Дата-странники» (сессия 696ed81e, с их слов): kit берётся исходниками —
// папка копируется скриптом, npm у локальной папки-пакета ставит и тестовые зависимости
// (сотни мегабайт), их вырезают своим скриптом. Нужен обычный пакет с версией из своего
// хранилища пакетов: собранный код и типы, без тестовых зависимостей у потребителя.
//
// Здесь — форма манифеста. Установку «как у потребителя» (npm pack → чистая папка → импорт)
// проверяет scripts/consumer-check.mjs, он же шаг CI перед публикацией.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Target = string | { types?: string; import?: string; default?: string };
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  name: string; version: string; private?: boolean; files?: string[];
  exports: Record<string, Target>; types?: string; scripts: Record<string, string>;
  dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>; publishConfig?: { registry?: string };
};

describe('K5-PACKAGE-DELIVERY · манифест пакета', () => {
  it('положительный контроль: манифест прочитан, имя и версия есть', () => {
    expect(pkg.name).toBe('@seidr/kit');
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('пакет публикуемый: не private, в архив идёт только собранное', () => {
    expect(pkg.private).not.toBe(true);
    expect(pkg.files).toEqual(['dist']);
  });

  it('каждый вход — собранный JS и типы из dist, а не исходник .ts', () => {
    for (const [entry, t] of Object.entries(pkg.exports)) {
      expect(typeof t, entry).toBe('object');
      const o = t as Exclude<Target, string>;
      if (entry.endsWith('.css')) { expect(o.default, entry).toMatch(/^\.\/dist\/.+\.css$/); continue; }
      expect(o.types, entry).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      expect(o.import, entry).toMatch(/^\.\/dist\/.+\.js$/);
    }
  });

  it('исходник — только под своим условием seidr-source и ПЕРВЫМ ключом (приложения этого репозитория)', () => {
    // Потребитель без условия seidr-source его пропускает и берёт dist; приложения репозитория
    // (web-next) включают условие и работают с исходниками без сборки kit. Ключ первый: условия
    // перебираются в порядке ключей объекта, и «types» перед ним перехватил бы TypeScript.
    for (const [entry, t] of Object.entries(pkg.exports)) {
      const keys = Object.keys(t as object);
      expect(keys[0], entry).toBe('seidr-source');
    }
  });

  it('прежние входы сохранены — у потребителей LORE и пилота ничего не отваливается', () => {
    for (const e of ['.', './content', './auth', './core', './record', './graph', './styles/seidr.css', './style-guard', './demo/lore', './demo/datawanderers']) {
      expect(Object.keys(pkg.exports), e).toContain(e);
    }
  });

  it('тестовых зависимостей у потребителя нет: dependencies пуст, всё рабочее — peer', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    for (const dev of ['vitest', 'jsdom', 'typescript', '@testing-library/react', 'axe-core']) {
      expect(Object.keys(pkg.peerDependencies ?? {}), dev).not.toContain(dev);
    }
  });

  it('сборка и публикация названы: build, prepack, своё хранилище пакетов', () => {
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.scripts.prepack).toMatch(/build/);
    expect(pkg.publishConfig?.registry).toMatch(/^https:\/\/.+\/api\/packages\/[^/]+\/npm\/$/);
  });
});
