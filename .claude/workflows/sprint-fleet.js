export const meta = {
  name: 'sprint-fleet',
  description: 'Флот сабагентов по задачам спринта: worktree на задачу, PR по одному, статусы в LORE',
  whenToUse: 'Запуск: Workflow {name:"sprint-fleet", args:{sprint_id:"SPRINT_X", max_agents:3}}. Первый заход — фронт/MCP-задачи.',
  phases: [
    { title: 'Разведка', detail: 'задачи спринта из LORE, классификация, общие файлы' },
    { title: 'Реализация', detail: 'фронт — параллельно в worktree; бэкенд — строго последовательно' },
    { title: 'Поставка', detail: 'PR → зелёный CI → мерж, по одному' },
    { title: 'Отчёт' },
  ],
}

// Правила, зашитые в этот скрипт (см. CLAUDE.md репо):
// 1. `./gradlew test` мигрирует ПРОД-схему → бэкенд-задачи НИКОГДА не параллелятся.
// 2. Общие файлы (ru/en common.json, LoreSlices.java, src/api/lore.ts) агенты не трогают —
//    их правки описываются в отчёте агента и накладываются координатором последовательно.
// 3. Мерж только по зелёному CI конкретного PR (forgejo-mcp get_commit_status), не стек.
// 4. Статус задачи перечитывать непосредственно перед status_set (параллельные сессии).

const SPRINT = args?.sprint_id
if (!SPRINT) throw new Error('args.sprint_id обязателен, например {"sprint_id":"SPRINT_X"}')
const MAX = args?.max_agents ?? 3

const SHARED = 'src/i18n/locales/ru/common.json, src/i18n/locales/en/common.json, src/api/lore.ts, backend/.../LoreSlices.java'

phase('Разведка')
const plan = await agent(
  `Через aida-lore MCP (ToolSearch → query_slice) прочитай открытые задачи спринта ${SPRINT} ` +
  `(слайс tasks_of_sprint, статусы todo/active). Для каждой определи по note_md и коду: ` +
  `scope="frontend" (src/, mcp/, локали) или "backend" (backend/, gradle). ` +
  `Определи зависимости между задачами. Верни JSON.`,
  { label: 'план спринта', schema: {
      type: 'object', required: ['tasks'],
      properties: { tasks: { type: 'array', items: {
        type: 'object', required: ['code', 'title', 'scope'],
        properties: {
          code: { type: 'string' }, title: { type: 'string' },
          scope: { enum: ['frontend', 'backend'] },
          depends_on: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        } } } } } },
)
if (!plan.tasks.length) return { sprint: SPRINT, result: 'открытых задач нет' }
log(`Задач: ${plan.tasks.length} (frontend: ${plan.tasks.filter(t => t.scope === 'frontend').length})`)

const implPrompt = (t) =>
  `Задача ${SPRINT}/${t.code}: ${t.title}. ${t.note ?? ''}\n` +
  `Реализуй в ветке feature/fleet-${t.code.toLowerCase()} (ты в изолированном worktree). ` +
  `Порядок: сначала падающий тест, затем код до зелёного. ` +
  `Гоняй ТОЛЬКО тесты своего скоупа (${t.scope === 'backend'
    ? 'gradle-тесты — тебе разрешены, ты единственный бэкенд-агент в данный момент'
    : 'vitest + tsc; ./gradlew НЕ запускать — он мигрирует прод-схему'}). ` +
  `ЗАПРЕЩЕНО менять общие файлы: ${SHARED} — нужные правки в них опиши в отчёте, их внесёт координатор. ` +
  `Инварианты: шрифты var(--fs-*), i18n-ключи задекларируй в отчёте (сам локали не правь). ` +
  `Коммить с кодом задачи в сообщении, ветку запушь. Если один тест падает 2 раза подряд — остановись и верни failure. ` +
  `Верни JSON-отчёт.`
const implSchema = { type: 'object', required: ['ok', 'branch'], properties: {
  ok: { type: 'boolean' }, branch: { type: 'string' },
  files_changed: { type: 'array', items: { type: 'string' } },
  tests: { type: 'string' },
  shared_file_edits: { type: 'string', description: 'что внести в общие файлы (i18n-ключи ru+en и т.п.)' },
  failure: { type: 'string' } } }

phase('Реализация')
const frontTasks = plan.tasks.filter(t => t.scope === 'frontend' && !(t.depends_on?.length))
const restTasks = plan.tasks.filter(t => !frontTasks.includes(t))
// независимые фронт-задачи — параллельно (кап MAX через порционные barrier-волны)
const frontResults = []
for (let i = 0; i < frontTasks.length; i += MAX) {
  const wave = frontTasks.slice(i, i + MAX)
  const r = await parallel(wave.map(t => () =>
    agent(implPrompt(t), { label: `impl:${t.code}`, isolation: 'worktree', schema: implSchema })
      .then(res => ({ task: t, res }))))
  frontResults.push(...r.filter(Boolean))
}
// бэкенд и зависимые — строго по одному
for (const t of restTasks) {
  const res = await agent(implPrompt(t), { label: `impl:${t.code}`, isolation: 'worktree', schema: implSchema, phase: 'Реализация' })
  frontResults.push({ task: t, res })
}
const done = frontResults.filter(x => x.res?.ok)
const failed = frontResults.filter(x => !x.res?.ok)

phase('Поставка')
// по одному: общие файлы → PR → зелёный CI → мерж → статус в LORE
const shipped = []
for (const { task, res } of done) {
  const ship = await agent(
    `Ветка ${res.branch} (задача ${SPRINT}/${task.code}) готова. Действуй по процессу UnlimitedLORE:\n` +
    `1) Если агент просил правки общих файлов — внеси их сейчас в эту ветку: ${res.shared_file_edits || 'нет'}. ` +
    `После правки локалей прогони vitest i18n-coverage.\n` +
    `2) Открой PR в develop (aida-lore forgejo_pr_new), дождись зелёного CI ` +
    `(forgejo-mcp get_commit_status по sha, НЕ curl), смержи (forgejo_pr_merge). ` +
    `Красный CI — почини в ветке и повтори; после второй неудачи остановись и верни failure.\n` +
    `3) Перечитай статус задачи и поставь done через status_set, PR-ссылку — в note_md.\n` +
    `Верни JSON {ok, pr, merged}.`,
    { label: `ship:${task.code}`, phase: 'Поставка',
      schema: { type: 'object', required: ['ok'], properties: {
        ok: { type: 'boolean' }, pr: { type: 'number' }, merged: { type: 'boolean' }, failure: { type: 'string' } } } },
  )
  shipped.push({ task: task.code, ...ship })
  if (!ship?.ok) log(`⚠ ${task.code}: поставка не завершена — ${ship?.failure ?? 'нет ответа'}`)
}

phase('Отчёт')
return {
  sprint: SPRINT,
  merged: shipped.filter(s => s.merged).map(s => ({ task: s.task, pr: s.pr })),
  not_shipped: shipped.filter(s => !s.merged),
  impl_failed: failed.map(x => ({ task: x.task.code, failure: x.res?.failure ?? 'агент не вернул отчёт' })),
}
