// LoreConnectionsScreen — рецепты подключения внешних клиентов к живому диалогу
// Claude Code. Лежит в разделе «Основа» рядом с MCP API (тот же паттерн
// страницы — Section/Pre/Th/Td, локальные стили, без общих компонентов).
// Первый рецепт — miniLORE (мобильное приложение, было MobilePoc):
// мобильное приложение и десктопная консоль, работающие с ОДНИМ и тем же
// диалогом одновременно через dev-канал.
//
// Версия 2 (исправлена авторами miniLORE после первого прохода): канал
// принадлежит СЕССИИ, а не проекту — предыдущая формулировка «канал один на
// все проекты, определяет проект по рабочей папке» была неточной. Три факта
// ниже — прямая цитата их правки, не обкатанное самостоятельно.
//
// Версия 3: секрет в config-файле не нужен вовсе — server.js читает его из
// process.env, а MCP-сервер наследует окружение родительского процесса.
// Блок env с ${VAR} в первой правке был лишним усложнением, снят по указанию
// авторов miniLORE.
import { useTranslation } from 'react-i18next';

const SETX_CMD = `setx MOBILEPOC_CHANNEL_SECRET "<значение из gateway/.env>"`;

const MINILORE_MCP_JSON = `{
  "mcpServers": {
    "mobilepoc-channel": {
      "command": "node",
      "args": ["D:/Mobilepoc/channel/server.js"]
    }
  }
}`;

const ATTACH_CMD = `cd <папка проекта>
claude --dangerously-load-development-channels server:mobilepoc-channel --resume <sessionId>`;

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
        <Section title={t('lore.connections.mobilepocTitle', 'miniLORE — один диалог, доступный и в консоли, и в мобильном приложении')}>
          <p style={S.note}>
            {t('lore.connections.mobilepocLead', 'Канал — это MCP-сервер, который поднимает сама сессия Claude Code: он дочерний процесс своей сессии и принадлежит только ей, а не проекту.')}
          </p>

          <p style={S.note}><b>{t('lore.connections.factsLabel', 'Что значит «в диалог можно писать» — три факта прямо:')}</b></p>
          <ul style={S.ul}>
            <li>
              <b>{t('lore.connections.fact1Label', 'Каналов может быть сколько угодно.')}</b>{' '}
              {t('lore.connections.fact1', 'Файл')} <code style={S.code}>channel/server.js</code> {t('lore.connections.fact1Rest', 'один, но каждая сессия поднимает свой процесс на своём порту и регистрируется отдельно. Прописывать канал в')} <code style={S.code}>.mcp.json</code> {t('lore.connections.fact1Rest2', 'каждого проекта — нормально, они не конфликтуют.')}
            </li>
            <li>
              <b>{t('lore.connections.fact2Label', 'Десктопная сессия канал не получает.')}</b>{' '}
              {t('lore.connections.fact2', 'Проверено экспериментом: десктоп и headless (')}<code style={S.code}>-p</code>{t('lore.connections.fact2Rest', ') принимают событие и молча его роняют. Пишет только интерактивная консольная сессия, запущенная с флагом ниже.')}
            </li>
            <li>
              <b>{t('lore.connections.fact3Label', 'Адресация — по сессии, не по проекту.')}</b>{' '}
              {t('lore.connections.fact3', 'Раньше шлюз искал канал по имени проекта: при двух диалогах в одном проекте выигрывал первый попавшийся, и сообщение уходило в соседнюю переписку молча. Сейчас — по sessionId; если у сессии своего канала нет, шлюз так и отвечает, вместо того чтобы подставить чужой диалог.')}
            </li>
          </ul>

          <ol style={S.ol}>
            <li>
              {t('lore.connections.setxLabel', 'Завести секрет переменной окружения — один раз на машину.')}{' '}
              {t('lore.connections.setx1', 'Значение лежит в')} <code style={S.code}>gateway/.env</code>{t('lore.connections.setx1Rest', ', ключ')} <code style={S.codeAcc}>MOBILEPOC_CHANNEL_SECRET</code>{t('lore.connections.setx1Rest2', '. Сюда, на страницу, значение не копировать — только команда:')}
              <Pre>{SETX_CMD}</Pre>
              <p style={S.noteTight}>
                {t('lore.connections.setxNote', 'setx действует только на НОВЫЕ процессы')}{t('lore.connections.setxNoteRest', ' — терминал, из которого ставили переменную, для канала не годится, нужен свежий.')}
              </p>
            </li>
            <li>
              {t('lore.connections.step1', 'Дать проекту канал — добавить сервер в')} <code style={S.code}>.mcp.json</code> {t('lore.connections.step1Rest', 'этого проекта. Если у проекта уже есть свой')} <code style={S.code}>.mcp.json</code>{t('lore.connections.step1Rest2', ' — блок добавляется ВНУТРЬ существующего')} <code style={S.code}>mcpServers</code>{t('lore.connections.step1Rest3', ', файл не заменяется целиком:')}
              <Pre>{MINILORE_MCP_JSON}</Pre>
              <p style={S.noteTight}>
                {t('lore.connections.secretNote', 'Секрет в конфиг не пишем')}{t('lore.connections.secretNoteRest', ' — сервер сам читает его из окружения процесса, унаследованного от родителя (шаг 1 выше), поэтому блок')} <code style={S.code}>env</code>{t('lore.connections.secretNoteRest2', ' тут не нужен.')}
              </p>
            </li>
            <li>
              {t('lore.connections.step2', 'Открыть диалог на десктопе в этом же проекте и немного поработать в нём — пока транскрипт пуст, подключаться не к чему. Сама десктопная сессия канал не получает (факт 2 выше) — этот шаг только создаёт диалог, к которому потом подключится консоль.')}
            </li>
            <li>
              {t('lore.connections.step3', 'Подцепить к нему консоль — по')} <code style={S.codeAcc}>sessionId</code>{t('lore.connections.step3Rest', ', видимому в приложении:')}
              <Pre>{ATTACH_CMD}</Pre>
              <p style={S.noteTight}>
                {t('lore.connections.step3Note', 'Не')} <code style={S.code}>-c</code>{t('lore.connections.step3NoteRest', ': он берёт самую свежую сессию в папке и легко подцепляет не тот диалог, если там недавно работало что-то ещё.')} <code style={S.codeAcc}>--resume &lt;sessionId&gt;</code>{t('lore.connections.step3NoteRest2', ' — адресный, ошибиться диалогом нельзя.')}
              </p>
            </li>
          </ol>

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

          <p style={S.note}><b>{t('lore.connections.gotchasLabel', 'Подводный камень:')}</b></p>
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
                    {t('lore.connections.gotcha3', 'Если секрет не доехал, сервер не падает — поднимается с пустой строкой и получает от шлюза 403 на регистрацию, внешне неотличимо от read-only. Проверка: у диалога должна стать зелёная 🗨️. Серая — почти всегда несвежая консоль (см. шаг 1: setx не действует на уже открытый терминал).')}
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
