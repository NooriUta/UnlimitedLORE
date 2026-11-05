// LoreConnectionsScreen — рецепты подключения внешних клиентов к живому диалогу
// Claude Code. Лежит в разделе «Основа» рядом с MCP API (тот же паттерн
// страницы — Section/Pre/Th/Td, локальные стили, без общих компонентов).
// Первый рецепт — miniLORE: мобильное приложение и десктопная консоль,
// работающие с ОДНИМ и тем же диалогом одновременно через канал.
//
// AH-10 (SPRINT_LORE_ADMIN_HOUSEKEEPING): прежний канал выключен 23.08.2026,
// единственный канал — minilore-link. Он подключён в user-скоупе Claude Code
// (C:/Mobilepoc/v2/link, роутер 127.0.0.1:8789), поэтому шаг «добавить сервер
// в .mcp.json проекта» и шаг с секретом в переменной окружения сняты. Секретов
// на странице нет: где он нужен — «задаётся в настройках канала». Что не
// перепроверено на новом канале, помечено в тексте как «уточнить».
import { useTranslation } from 'react-i18next';

// Блок сервера в ~/.claude.json (user-скоуп) — как он заведён на этой машине.
const LINK_MCP_JSON = `"mcpServers": {
  "minilore-link": {
    "command": "node",
    "args": ["C:/Mobilepoc/v2/link/dist/mcp-server.js"],
    "env": { "MINILORE_ROUTER_URL": "http://127.0.0.1:8789" }
  }
}`;

const ATTACH_CMD = `cd <папка проекта>
& "$env:USERPROFILE\\.local\\bin\\claude.exe" --dangerously-load-development-channels server:minilore-link --resume <sessionId>`;

/** Инструменты канала: имя — как в MCP, описание — ключ локали. */
const TOOLS: { name: string; key: string; fallback: string }[] = [
  { name: 'reply',        key: 'lore.connections.toolReply', fallback: 'ответ владельцу на телефон. В диалоге не виден — тот же текст продублировать обычным сообщением, длинное — целиком' },
  { name: 'ask',          key: 'lore.connections.toolAsk',   fallback: 'вопрос с ожиданием ответа — дорога для решений владельца' },
  { name: 'peers',        key: 'lore.connections.toolPeers', fallback: 'соседние сессии на этой машине' },
  { name: 'tell',         key: 'lore.connections.toolTell',  fallback: 'написать соседней сессии напрямую — по имени диалога, проекта или префиксу sessionId' },
  { name: 'send',         key: 'lore.connections.toolSend',  fallback: 'передать файл на телефон' },
  { name: 'fetch',        key: 'lore.connections.toolFetch', fallback: 'забрать файл из архива сервера, если вложение не скачалось само' },
  { name: 'note_to_self', key: 'lore.connections.toolNote',  fallback: 'заметка себе, можно с задержкой' },
];

export default function LoreConnectionsScreen() {
  const { t } = useTranslation();

  return (
    <div style={S.scroll}>
      <div style={S.wrap}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={S.head}>
          <h1 style={S.h1}>{t('lore.connections.headerTitle', 'Подключения')}</h1>
        </div>
        <p style={S.lead}>
          {t('lore.connections.lead', 'Рецепты, как подключить внешний клиент (мобильное приложение, отдельный процесс) к диалогу Claude Code так, чтобы обе стороны писали в один и тот же транскрипт — вместо того, чтобы каждый раз заново вспоминать порядок действий.')}
        </p>

        {/* ── miniLORE: один диалог в консоли и в приложении ────────────────── */}
        <Section title={t('lore.connections.channelTitle', 'miniLORE — один диалог в консоли и в мобильном приложении (канал minilore-link)')}>
          <p style={S.note}>
            {t('lore.connections.channelLead', 'Канал — MCP-сервер minilore-link. Сессия Claude Code запускает его своим дочерним процессом; процессы всех сессий ходят в общий локальный роутер. Прежний канал выключен 23.08.2026 — его рецепт с этой страницы снят.')}
          </p>

          <p style={S.note}><b>{t('lore.connections.factsLabel', 'Что значит «в диалог можно писать» — факты прямо:')}</b></p>
          <ul style={S.ul}>
            <li>
              <b>{t('lore.connections.fact1Label', 'Подключён один раз — на всю машину.')}</b>{' '}
              {t('lore.connections.fact1', 'Сервер заведён в user-скоупе Claude Code (')}<code style={S.code}>~/.claude.json</code>{t('lore.connections.fact1Rest', '), поэтому доступен во всех проектах сразу. В')} <code style={S.code}>.mcp.json</code> {t('lore.connections.fact1Rest2', 'проекта ничего добавлять не нужно.')}
            </li>
            <li>
              <b>{t('lore.connections.fact2Label', 'Десктопная сессия канал не получает.')}</b>{' '}
              {t('lore.connections.fact2', 'Десктоп и headless (')}<code style={S.code}>-p</code>{t('lore.connections.fact2Rest', ') принимают событие и молча его роняют. Пишет только интерактивная консольная сессия, запущенная с флагом ниже.')}{' '}
              <span style={S.todo}>{t('lore.connections.fact2Check', 'Проверено экспериментом на прежнем канале; для minilore-link — уточнить.')}</span>
            </li>
            <li>
              <b>{t('lore.connections.fact3Label', 'Адресация — по сессии, не по проекту.')}</b>{' '}
              {t('lore.connections.fact3', 'Раньше шлюз искал канал по имени проекта: при двух диалогах в одном проекте выигрывал первый попавшийся, и сообщение уходило в соседнюю переписку молча. Сейчас — по sessionId; если у сессии своего канала нет, шлюз так и отвечает, вместо того чтобы подставить чужой диалог.')}
            </li>
            <li>
              <b>{t('lore.connections.fact4Label', 'Живой — значит ответил.')}</b>{' '}
              {t('lore.connections.fact4', 'Имя minilore-link в списке инструментов ещё не значит, что канал жив: живым считается только инструмент, который действительно ответил.')}
            </li>
          </ul>

          <ol style={S.ol}>
            <li>
              {t('lore.connections.step1', 'Проверить, что сервер заведён в user-скоупе —')} <code style={S.code}>~/.claude.json</code>{t('lore.connections.step1Rest', ', раздел')} <code style={S.code}>mcpServers</code>{t('lore.connections.step1Rest2', '. Обычно блок уже есть; если нет — добавить его ВНУТРЬ существующего раздела, файл целиком не заменять:')}
              <Pre>{LINK_MCP_JSON}</Pre>
              <p style={S.noteTight}>
                {t('lore.connections.secretNote', 'Секрет в конфиг не пишем.')}{' '}{t('lore.connections.secretNoteRest', 'Если каналу нужен секрет — он задаётся в настройках канала, а не на этой странице и не в .mcp.json.')}
              </p>
              <p style={S.noteTight}>
                {t('lore.connections.routerNote', 'Роутер слушает')} <code style={S.code}>http://127.0.0.1:8789</code>{t('lore.connections.routerNoteRest', ' (переменная')} <code style={S.code}>MINILORE_ROUTER_URL</code>{t('lore.connections.routerNoteRest2', ').')}{' '}
                <span style={S.todo}>{t('lore.connections.routerCheck', 'Кто и как поднимает роутер — уточнить.')}</span>
              </p>
            </li>
            <li>
              {t('lore.connections.step2', 'Открыть диалог на десктопе в нужном проекте и немного поработать в нём — пока транскрипт пуст, подключаться не к чему. Сама десктопная сессия канал не получает (факт 2 выше) — этот шаг только создаёт диалог, к которому потом подключится консоль.')}
            </li>
            <li>
              {t('lore.connections.step3', 'Подцепить к нему консоль — по')} <code style={S.codeAcc}>sessionId</code>{t('lore.connections.step3Rest', ', видимому в приложении:')}
              <Pre>{ATTACH_CMD}</Pre>
              <p style={S.noteTight}>
                {t('lore.connections.step3Note', 'Не')} <code style={S.code}>-c</code>{t('lore.connections.step3NoteRest', ': он берёт самую свежую сессию в папке и легко подцепляет не тот диалог, если там недавно работало что-то ещё.')} <code style={S.codeAcc}>--resume &lt;sessionId&gt;</code>{t('lore.connections.step3NoteRest2', ' — адресный, ошибиться диалогом нельзя.')}
              </p>
              <p style={S.noteTight}>
                {t('lore.connections.step3Shell', 'Команда — PowerShell')}{t('lore.connections.step3ShellRest', ' (оператор')} <code style={S.code}>&amp;</code>{t('lore.connections.step3ShellRest2', ' и')} <code style={S.code}>$env:</code>{t('lore.connections.step3ShellRest3', '); в Git Bash не сработает как есть.')}
              </p>
            </li>
          </ol>

          <p style={S.note}><b>{t('lore.connections.toolsLabel', 'Инструменты канала')}</b></p>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <Th>{t('lore.connections.colTool', 'Инструмент')}</Th>
                <Th>{t('lore.connections.colWhat', 'Что делает')}</Th>
              </tr></thead>
              <tbody>
                {TOOLS.map(tool => (
                  <tr key={tool.name} style={S.tr}>
                    <Td><code style={S.code}>{tool.name}</code></Td>
                    <Td style={{ color: 'var(--t2)' }}>{t(tool.key, tool.fallback)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={S.note}><b>{t('lore.connections.verifyLabel', 'Как проверить, что получилось')}</b></p>
          <p style={S.note}>
            {t('lore.connections.verifyLead', 'В приложении у каждого диалога своя иконка — пометка честная при любом количестве каналов на проект:')}
          </p>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <Th>{t('lore.connections.colIcon', 'Иконка')}</Th>
                <Th>{t('lore.connections.colMeans', 'Значит')}</Th>
              </tr></thead>
              <tbody>
                <tr style={S.tr}>
                  <Td>🗨️</Td>
                  <Td style={{ color: 'var(--t2)' }}>{t('lore.connections.iconWritable', 'зелёная «речь» — у диалога живой канал, можно писать')}</Td>
                </tr>
                <tr style={S.tr}>
                  <Td>🖥️ / 💻</Td>
                  <Td style={{ color: 'var(--t2)' }}>{t('lore.connections.iconReadonly', 'серые консоль или ноутбук — диалог виден, только чтение (канала нет или не подцеплен)')}</Td>
                </tr>
                <tr style={S.tr}>
                  <Td>🪦</Td>
                  <Td style={{ color: 'var(--t2)' }}>{t('lore.connections.iconEnded', 'надгробие — сессия завершена')}</Td>
                </tr>
              </tbody>
            </table>
          </div>

          <p style={S.note}><b>{t('lore.connections.gotchasLabel', 'Подводные камни:')}</b></p>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <Th>{t('lore.connections.colGotcha', 'Что')}</Th>
                <Th>{t('lore.connections.colWhy', 'Почему')}</Th>
              </tr></thead>
              <tbody>
                <tr style={S.tr}>
                  <Td>{t('lore.connections.gotcha2Label', 'События не идут в приложение')}</Td>
                  <Td style={{ color: 'var(--t2)' }}>
                    {t('lore.connections.gotcha2', 'При первом запуске Claude Code спросит подтверждение на загрузку dev-канала и согласие на новый MCP-сервер. Нужно принять оба — иначе события внутрь не пойдут, а диалог будет выглядеть доступным на запись, хотя это не так.')}
                  </Td>
                </tr>
                <tr style={S.tr}>
                  <Td>{t('lore.connections.gotcha3Label', 'Диалог виден, но без явной ошибки только читается')}</Td>
                  <Td style={{ color: 'var(--t2)' }}>
                    {t('lore.connections.gotcha3', 'Сначала проверить, что консоль запущена с флагом из шага 3 и что роутер отвечает на 127.0.0.1:8789. Если каналу нужен секрет — он задаётся в настройках канала. Результат: у диалога должна стать зелёная 🗨️.')}
                  </Td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

      </div>
    </div>
  );
}

// ── Small building blocks (локальные, как в LoreMcpApiScreen — общего набора нет) ──
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={S.h2}>{title}</h2>
      {children}
    </section>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={S.th}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ ...S.td, ...style }}>{children}</td>;
}
function Pre({ children }: { children: React.ReactNode }) {
  return <pre style={S.pre}>{children}</pre>;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  scroll:  { flex: 1, overflowY: 'auto', fontFamily: 'var(--font)' },
  wrap:    { maxWidth: 920, margin: '0 auto', padding: '22px 26px 60px' },
  head:    { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  h1:      { fontSize: 'var(--fs-2xl)', fontWeight: 700, fontFamily: 'var(--display)', color: 'var(--t1)' },
  h2:      { fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)', marginBottom: 10,
             paddingBottom: 5, borderBottom: '1px solid var(--bd)' },
  lead:    { marginTop: 12, fontSize: 'var(--fs-md)', lineHeight: 1.65, color: 'var(--t2)' },
  tableWrap: { marginTop: 10, overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 6 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-base)' },
  th:      { textAlign: 'left', padding: '7px 10px', color: 'var(--t3)', fontWeight: 600,
             fontSize: 'var(--fs-sm)', borderBottom: '1px solid var(--bd)', background: 'var(--b1)',
             whiteSpace: 'nowrap' },
  tr:      { borderBottom: '1px solid var(--bd)' },
  td:      { padding: '7px 10px', verticalAlign: 'top', color: 'var(--t1)' },
  note:    { marginTop: 10, fontSize: 'var(--fs-base)', lineHeight: 1.6, color: 'var(--t3)' },
  noteTight: { marginTop: 6, fontSize: 'var(--fs-sm)', lineHeight: 1.55, color: 'var(--t3)' },
  // AH-10: честная пометка «уточнить» — не перепроверенное на minilore-link.
  todo:    { color: 'var(--wrn)', fontSize: 'var(--fs-sm)' },
  code:    { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', padding: '1px 5px', borderRadius: 3,
             background: 'var(--b2)', color: 'var(--t2)' },
  codeAcc: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', padding: '1px 5px', borderRadius: 3,
             background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)' },
  pre:     { marginTop: 8, padding: '10px 12px', borderRadius: 6, overflowX: 'auto',
             background: 'var(--b1)', border: '1px solid var(--bd)',
             fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, color: 'var(--t2)',
             whiteSpace: 'pre' },
  ol:      { marginTop: 4, paddingLeft: 20, fontSize: 'var(--fs-base)', lineHeight: 1.7, color: 'var(--t2)',
             display: 'flex', flexDirection: 'column', gap: 10 },
  ul:      { marginTop: 6, paddingLeft: 20, fontSize: 'var(--fs-sm)', lineHeight: 1.65, color: 'var(--t2)',
             display: 'flex', flexDirection: 'column', gap: 6 },
};
