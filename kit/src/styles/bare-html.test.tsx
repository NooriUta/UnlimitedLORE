// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00e — снимок «/kit vs голый HTML».
//
// Элементы kit рендерятся в jsdom, их разметка собирается в самостоятельную
// HTML-страницу kit/demo/seidr-bare.html, подключающую ТОЛЬКО seidr.css через
// <link> — без React, без сборщика. Страница — файловый снимок
// (toMatchFileSnapshot): правка компонента, меняющая разметку, без обновления
// снимка (`npx vitest run -u`) валит CI, а сам файл открывается в браузере
// как есть и показывает, что один CSS-файл даёт тот же вид, что и React.
// Покрытие витрины /kit этим снимком сверяет web-next (kitBareParity.test.tsx).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { definedClasses, usedClasses } from '../test/cssClasses';

// mermaid в jsdom не рисует — в снимок идёт статичная схема-заглушка той же
// обёртки (sk-prose__diagram/__mermaid), вид рамки даёт seidr.css.
vi.mock('mermaid', () => ({
  default: {
    registerLayoutLoaders: vi.fn(),
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40" role="img" aria-label="Задача → PR → Релиз"><text x="8" y="24">Задача → PR → Релиз</text></svg>',
    })),
  },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import {
  EmptyState, Ear, Forbidden, GameIcon, IconButton, Kbd, KitLangProvider, LoadError, Pill, SECTION_ICONS,
  BatchUndo, ChainExplain, ContentRelease, DiffPreview, Matrix, Skeleton, SecretOnce, StatusStar, Steps, Tabs, Toolbar, Tooltip, Truncated, registerGameIcons,
} from '../index';
import { MartProse, SandboxedHtmlFrame, TipTapField } from '../content';

const SNAPSHOT = '../../demo/seidr-bare.html';
// В jsdom-окружении import.meta.url не file:// — пути от корня пакета kit
// (vitest запускается из kit/, как и в CI).
const KIT = process.cwd();
const SNAPSHOT_ABS = resolve(KIT, 'demo/seidr-bare.html');
const css = readFileSync(resolve(KIT, 'src/styles/seidr.css'), 'utf8');

const noop = () => {};
const STATUSES = ['done', 'active', 'partial', 'planned', 'backlog', 'blocked', 'cancelled'] as const;
const MD = '## Заголовок\n\nТекст с **жирным**, `кодом` и [ссылкой](https://example.org).\n\n- пункт один\n- [x] пункт два\n\n| поле | значение |\n|---|---|\n| статус | в работе |\n\n```mermaid\ngraph LR; A[Задача] --> B[PR] --> C[Релиз]\n```\n';

/** Те же семейства элементов, что и на витрине /kit (S4-00d). */
function Samples() {
  return (
    <KitLangProvider lang="ru">
      <section className="bare__sec" data-kit="elements">
        <h2 className="bare__h2">Элементы</h2>
        <div className="bare__row">
          <Pill>value</Pill>
          <Pill variant="id">SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00e</Pill>
          <Pill tone="suc">done</Pill>
          <Pill tone="wrn">wrn</Pill>
          <Pill tone="dng">dng</Pill>
          <Pill tone="inf">inf</Pill>
          <Pill variant="filter" pressed onToggle={noop} onRemove={noop} removeLabel="Снять фильтр">Фильтр</Pill>
          <Pill variant="filter" pressed={false} onToggle={noop}>Фильтр выкл.</Pill>
        </div>
        <div className="bare__row">
          <IconButton icon={SECTION_ICONS.search} label="Поиск" shortcut="Control+K" />
          <IconButton icon="round-star" label="Избранное" pressed onClick={noop} />
          {Object.entries(SECTION_ICONS).slice(0, 8).map(([name, slug]) => <GameIcon key={name} slug={slug} size={18} label={name} />)}
          <GameIcon slug="no-such-icon" size={18} label="нет иконки" />
        </div>
        <div className="bare__row">
          {STATUSES.map(s => <StatusStar key={s} status={s} label={`Статус: ${s}`} showLabel />)}
          <StatusStar status="active" label="Открыть" onOpen={noop} />
        </div>
        <div className="bare__row">
          <Kbd keys={['Ctrl', 'K']} />
          <Tooltip text="Подсказка"><button type="button" className="sk-btn">Подсказка</button></Tooltip>
        </div>
        <Toolbar label="Панель">
          <IconButton icon={SECTION_ICONS.filter} label="Фильтр" />
          <IconButton icon={SECTION_ICONS.views} label="Виды" />
          <IconButton icon={SECTION_ICONS.commands} label="Команды" />
        </Toolbar>
      </section>
      <section className="bare__sec" data-kit="states">
        <h2 className="bare__h2">Честные состояния</h2>
        <div className="bare__grid">
          <Skeleton lines={3} />
          <EmptyState compact />
          <LoadError compact error={{ status: 502, message: 'Bad Gateway' }} onRetry={noop} />
          <Forbidden compact reason="нужна роль reviewer" />
          <Truncated meta={{ truncated: true, limit: 1000 }} shown={1000} onMore={noop} />
          <EmptyState />
        </div>
      </section>
      <section className="bare__sec" data-kit="shell">
        <h2 className="bare__h2">Оболочки</h2>
        <Tabs label="Виды" value="list" onChange={noop} items={[{ id: 'list', label: 'Список', count: 42 }, { id: 'board', label: 'Доска', count: 7 }, { id: 'plan', label: 'План', count: 3 }]}>
          <p>Панель вкладки «Список»</p>
        </Tabs>
        <div className="bare__row">
          <Ear label="Ушко" expanded={false} controls="bare-ear" onToggle={noop} />
          <Ear label="Ушко слева" side="left" expanded onToggle={noop} />
        </div>
      </section>
      <section className="bare__sec" data-kit="flow">
        <h2 className="bare__h2">Мастера</h2>
        {/* Шаги с незаполненным условием: в снимке видно и причину отказа, и
            «осталось руками» последнего шага (K2-STEPS). Параметра адреса в
            снимке нет — состояние шага здесь в памяти. */}
        <Steps
          urlKey={null}
          steps={[
            { key: 'pick', title: 'Выбор', blocked: 'Не выбрано, что делаем', render: () => <p>Содержимое первого шага</p> },
            { key: 'fill', title: 'Заполнение', render: () => <p>Содержимое второго шага</p> },
            { key: 'check', title: 'Проверка', render: () => <p>Содержимое третьего шага</p> },
          ]}
          manual={{
            title: 'Осталось руками',
            items: [
              { text: 'Передать пароль лично', hint: 'в системе этого сделать нельзя' },
              { text: 'Forgejo: доступ к репозиторию', href: 'https://example.org' },
            ],
          }}
        />
        {/* Секрет в снимке — в состоянии «ещё не показан»: значение в снимок
            попадать не должно даже в демонстрационном виде (K2-SECRET-ONCE). */}
        <SecretOnce value="не-показано-в-снимке" label="Секрет" />
        {/* Дифф в снимке — со всеми тремя видами строк И со всеми тремя
            исходами проверки: именно их различимость одним CSS-слоем и надо
            видеть глазами (K2-DIFF). */}
        <DiffPreview
          label="Что изменится"
          rows={[
            { id: 'a', kind: 'add', text: 'строка добавится', detail: 'подробность', check: { state: 'checked' } },
            { id: 'b', kind: 'remove', text: 'строка снимется', check: { state: 'checked' } },
            { id: 'c', kind: 'same', text: 'строка уже есть', check: { state: 'checked' } },
            { id: 'ch', kind: 'change', text: 'значение сменится', from: 'прежнее', to: 'новое', check: { state: 'checked' } },
            { id: 'd', kind: 'add', text: 'строка не проверена', check: { state: 'unverified', reason: 'источник не ответил' } },
            { id: 'e', kind: 'add', text: 'смотреть не дали', check: { state: 'forbidden', reason: 'нужна роль администратора' } },
          ]}
          onApply={noop}
          confirm={{ word: 'ПРИМЕНИТЬ', label: 'введите ПРИМЕНИТЬ' }}
        />
        {/* Пачка в снимке — с частичным исходом: именно он не должен выглядеть
            успехом (K2-BATCH-UNDO). Часы в снимке подставлены, чтобы остаток
            не менялся от прогона к прогону. */}
        <BatchUndo
          batch={{
            id: 'op-1',
            applied: 2,
            total: 3,
            failed: [{ id: 'x', text: 'третья строка', reason: 'источник отказал: 409' }],
            undoUntil: 10_000,
          }}
          now={() => 0}
          onUndo={noop}
        />
        {/* Матрица в снимке — со всеми четырьмя исходами ячейки: значение,
            значения нет, не смогли проверить, нет прав. Именно их различимость
            одним CSS-слоем и надо видеть глазами (K2-MATRIX). Вид широкий:
            узкий зависит от ширины окна, а снимок — файл. */}
        <Matrix
          narrow={false}
          labels={{ rows: 'Строки', cols: 'Колонки' }}
          rows={[{ key: 'r1', title: 'Первая строка' }, { key: 'r2', title: 'Вторая строка' }]}
          cols={[{ key: 'c1', title: 'Колонка один' }, { key: 'c2', title: 'Колонка два' }]}
          options={[{ value: 'o1', title: 'Значение один' }, { value: 'o2', title: 'Значение два' }]}
          cell={(r, c) => (
            r === 'r1' && c === 'c1' ? { state: 'value', value: 'o1' }
              : r === 'r1' ? { state: 'none' }
                : c === 'c1' ? { state: 'unverified', reason: 'источник не ответил' }
                  : { state: 'forbidden', reason: 'нужна роль администратора' }
          )}
          onPropose={noop}
        />
        {/* Цепочка причин в снимке — со ВСЕМИ пятью исходами шага, помеченным
            решающим шагом и оборванным хвостом: именно их различимость одним
            CSS-слоем и надо видеть глазами (K2-CHAIN-EXPLAIN). */}
        <ChainExplain
          label="Почему такой вывод"
          verdict="Доступ есть"
          tone="suc"
          decidedBy="s2"
          stopped={{ notRun: 2, reason: 'дальше не считали — уже решилось' }}
          steps={[
            { id: 's1', title: 'Первый шаг', outcome: { state: 'confirmed', detail: 'подробность' } },
            { id: 's2', title: 'Второй шаг', outcome: { state: 'denied', detail: 'подробность' } },
            { id: 's3', title: 'Третий шаг', outcome: { state: 'unverified', reason: 'источник не ответил' } },
            { id: 's4', title: 'Четвёртый шаг', outcome: { state: 'forbidden', reason: 'смотреть не дали' } },
            { id: 's5', title: 'Пятый шаг', outcome: { state: 'unasked', reason: 'источник выключен' } },
          ]}
        />
        {/* Выпуск содержимого: пословный дифф поля, класс от сервера и журнал
            активаций. В снимке видно, как читаются зачёркнутое «было» и
            подчёркнутое «стало» одним CSS-слоем (K-12). */}
        <ContentRelease
          diff={{
            from: 7,
            to: 8,
            class: 'hotfix',
            added: [{ id: 'A-1', title: 'Новая запись' }],
            changed: [{ id: 'C-1', title: 'Изменённая запись', fields: { title: { from: 'правило для всех', to: 'правило для новичков' } } }],
            removed: [{ id: 'R-1', title: 'Снятая запись' }],
          }}
          log={[{ version: 7, who: 'кто-то', when: '2026-11-01T10:00:00Z', action: 'activate' }]}
          onActivate={noop}
          onRollback={noop}
        />
      </section>
      <section className="bare__sec" data-kit="content">
        <h2 className="bare__h2">MD / HTML</h2>
        <TipTapField value={MD} onChange={noop} ariaLabel="Правка MD" minHeight={140} />
        <MartProse text={MD} />
        <SandboxedHtmlFrame html="<p>HTML — только в песочнице</p>" title="Песочница" />
      </section>
    </KitLangProvider>
  );
}

/** Разметка → стабильный снимок: без случайных id, по строке на элемент верхнего уровня. */
function normalize(html: string): string {
  return html
    .replace(/\s(id|aria-controls|aria-labelledby|aria-describedby|for)="(«|:|_)[^"]*"/g, '')
    .replace(/></g, '>\n<');
}

function page(body: string): string {
  return `<!doctype html>
<!-- СНИМОК. Не править руками: генерирует kit/src/styles/bare-html.test.tsx
     (npx vitest run -u в kit/). SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00e.
     Голый HTML без React: тот же вид, что у элементов Seiðr-kit, даёт один
     файл seidr.css. Прототипы (docs/prototypes) подключают его так же —
     тегом link с href ../../kit/src/styles/seidr.css.
     Шрифты (Manrope, IBM Plex Mono, Unbounded 800) приложение грузит само;
     без них работают запасные гарнитуры из токенов --font/--mono/--display. -->
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seiðr-kit — голый HTML</title>
<link rel="stylesheet" href="../src/styles/seidr.css">
<style>
.bare { display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.bare__sec { display: flex; flex-direction: column; gap: var(--gap); padding: 12px; border: 1px solid var(--bd); border-radius: var(--r-lg); background: var(--bg1); }
.bare__h1 { font-family: var(--display); font-weight: var(--display-weight); font-size: var(--fs-xl); }
.bare__h2 { font-family: var(--display); font-weight: var(--display-weight); font-size: var(--fs-lg); text-transform: uppercase; letter-spacing: .04em; }
.bare__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap); }
.bare__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--gap); }
</style>
</head>
<body>
<main class="bare">
<h1 class="bare__h1">Seiðr-kit — голый HTML</h1>
${body}
</main>
</body>
</html>
`;
}

beforeAll(() => {
  registerGameIcons(gameIcons);
});

async function renderBare(): Promise<string> {
  const { container } = render(<Samples />);
  // MD рендерится после монтирования (TipTap, MartProse) — ждём содержимое.
  await waitFor(() => {
    expect(container.querySelector('.sk-prose h2')).toBeTruthy();
    expect(container.querySelector('.sk-prose__mermaid svg')).toBeTruthy();
    expect(container.querySelector('.sk-md .ProseMirror h2')).toBeTruthy();
  });
  return page(normalize(container.innerHTML));
}

describe('S4-00e · голый HTML на одном seidr.css', () => {
  it('снимок kit/demo/seidr-bare.html совпадает с разметкой элементов kit', async () => {
    await expect(await renderBare()).toMatchFileSnapshot(SNAPSHOT);
  });

  it('страница подключает только seidr.css, и путь ведёт к реальному файлу', async () => {
    const html = await renderBare();
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
    expect(links).toEqual(['../src/styles/seidr.css']);
    expect(existsSync(resolve(dirname(SNAPSHOT_ABS), links[0]))).toBe(true);
    // Скрипт допустим только внутри песочницы (srcdoc iframe sandbox) — у самой
    // страницы своего JS нет: вид даёт один CSS.
    expect(html).toMatch(/srcdoc="[^"]*<script/);
    expect(html.replace(/\ssrcdoc="[^"]*"/g, '')).not.toMatch(/<script/);
  });

  it('каждый класс sk-… в голом HTML определён в seidr.css', async () => {
    const used = [...usedClasses(await renderBare())].filter(c => c.startsWith('sk-'));
    // Положительный контроль: все семейства элементов попали в страницу.
    expect(used).toEqual(expect.arrayContaining([
      'sk-pill', 'sk-pill--filter', 'sk-iconbtn', 'sk-icon', 'sk-star', 'sk-kbd', 'sk-tip-wrap', 'sk-toolbar',
      'sk-skel', 'sk-state--empty', 'sk-state--error', 'sk-state--forbidden', 'sk-trunc',
      'sk-tabs', 'sk-ear', 'sk-md', 'sk-prose', 'sk-prose__mermaid', 'sk-frame',
    ]));
    const defined = definedClasses(css);
    expect(used.filter(c => !defined.has(c)).sort()).toEqual([]);
  });
});
