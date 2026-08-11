// LoreConnectionsScreen — рецепты подключения внешних клиентов к живому диалогу
// Claude Code. Лежит в разделе «Основа» рядом с MCP API (тот же паттерн
// страницы — Section/Pre/Th/Td, локальные стили, без общих компонентов).
// Первый рецепт — MobilePoc: мобильное приложение и десктопная консоль,
// работающие с ОДНИМ и тем же диалогом одновременно через dev-канал.
import { useTranslation } from 'react-i18next';

const MOBILEPOC_MCP_JSON = `{
  "mcpServers": {
    "mobilepoc-channel": {
      "command": "node",
      "args": ["D:/Mobilepoc/channel/server.js"],
      "env": {
        "MOBILEPOC_GATEWAY_URL": "http://localhost:8787",
        "MOBILEPOC_CHANNEL_SECRET": "<секрет из gateway/.env>"
      }
    }
  }
}`;

const ATTACH_CMD = `cd <папка проекта>
claude --dangerously-load-development-channels server:mobilepoc-channel -c`;

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

        {/* ── MobilePoc: один диалог в консоли и в приложении ───────────────── */}
        <Section title={t('lore.connections.mobilepocTitle', 'MobilePoc — один диалог, доступный и в консоли, и в мобильном приложении')}>
          <p style={S.note}>
            {t('lore.connections.mobilepocLead', 'Работает через dev-канал: MCP-сервер, который знает адрес гейтвея MobilePoc, слушает на стороне Claude Code, а гейтвей — на стороне мобильного приложения. Канал один на все проекты, конкретный проект он определяет по рабочей папке, из которой запущен Claude Code.')}
          </p>

          <ol style={S.ol}>
            <li>
              {t('lore.connections.step1', 'Дать проекту канал — добавить сервер в')} <code style={S.code}>.mcp.json</code> {t('lore.connections.step1Rest', 'этого проекта. Если у проекта уже есть свой')} <code style={S.code}>.mcp.json</code>{t('lore.connections.step1Rest2', ' — блок добавляется ВНУТРЬ существующего')} <code style={S.code}>mcpServers</code>{t('lore.connections.step1Rest3', ', файл не заменяется целиком:')}
              <Pre>{MOBILEPOC_MCP_JSON}</Pre>
              <p style={S.noteTight}>
                {t('lore.connections.secretNote', 'Секрет —')} <code style={S.codeAcc}>MOBILEPOC_CHANNEL_SECRET</code> {t('lore.connections.secretNoteRest', 'из')} <code style={S.code}>gateway/.env</code>{t('lore.connections.secretNoteRest2', '. Сюда, на страницу, значение не копировать — только ссылка на то, где оно лежит.')}
              </p>
            </li>
            <li>
              {t('lore.connections.step2', 'Открыть диалог на десктопе в этом же проекте и немного поработать в нём — пока транскрипт пуст, подключаться не к чему.')}
            </li>
            <li>
              {t('lore.connections.step3', 'Подцепить консоль к тому же диалогу:')}
              <Pre>{ATTACH_CMD}</Pre>
              <p style={S.noteTight}>
                {t('lore.connections.step3Note', 'Ключевое —')} <code style={S.codeAcc}>-c</code>{t('lore.connections.step3NoteRest', ': продолжает последнюю сессию в этой папке, то есть ту самую десктопную. С этого момента оба окна пишут в один транскрипт, а сам канал принадлежит консольному процессу — поэтому из приложения в этот диалог можно писать.')}
              </p>
            </li>
          </ol>

          <p style={S.note}><b>{t('lore.connections.gotchasLabel', 'Две тонкости, о которые легко споткнуться:')}</b></p>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <Th>{t('lore.connections.colGotcha', 'Что')}</Th>
                <Th>{t('lore.connections.colWhy', 'Почему')}</Th>
              </tr></thead>
              <tbody>
                <tr style={S.tr}>
                  <Td><code style={S.codeAcc}>-c</code> {t('lore.connections.gotcha1Label', 'берёт не тот диалог')}</Td>
                  <Td style={{ color: 'var(--t2)' }}>
                    {t('lore.connections.gotcha1', 'Он подцепляет самую свежую сессию в папке — если там недавно работало что-то ещё, подключится не тот диалог. Надёжнее')} <code style={S.code}>--resume &lt;sessionId&gt;</code>{t('lore.connections.gotcha1Rest', '; нужный sessionId виден в приложении.')}
                  </Td>
                </tr>
                <tr style={S.tr}>
                  <Td>{t('lore.connections.gotcha2Label', 'События не идут в приложение')}</Td>
                  <Td style={{ color: 'var(--t2)' }}>
                    {t('lore.connections.gotcha2', 'При первом запуске Claude Code спросит подтверждение на загрузку dev-канала и согласие на новый MCP-сервер. Нужно принять оба — иначе события внутрь не пойдут.')}
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
};
