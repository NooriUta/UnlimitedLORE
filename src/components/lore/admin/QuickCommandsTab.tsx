import { useState } from 'react';
import { S } from './adminStyles';

// ── Быстрые команды — личная шпаргалка владельца (не продуктовая фича,
//    не читает LORE-данные) ──────────────────────────────────────────────────
// Формат нарочно плоский массив, а не таблица/справочник в БД: список личный,
// правится редко и вручную, заводить под него ещё один dict_type — лишний слой
// для того, что проще редактировать прямо в коде при следующем расширении.
const QUICK_GROUPS: { title: string; items: { label: string; cmd: string }[] }[] = [
  {
    title: 'Перейти в проект',
    items: [
      { label: 'UnlimitedLORE', cmd: 'cd C:\\AIDA\\UnlimitedLORE' },
      { label: 'aida-root', cmd: 'cd C:\\AIDA\\aida-root' },
      { label: 'Mobilepoc', cmd: 'cd D:\\Mobilepoc' },
    ],
  },
  {
    title: 'Канал miniLORE',
    items: [
      {
        label: 'Подключить консоль к диалогу по sessionId (виден в приложении) — НЕ -c, он берёт не тот диалог. PowerShell.',
        cmd: '& "$env:USERPROFILE\\.local\\bin\\claude.exe" --dangerously-load-development-channels server:mobilepoc-channel --resume <sessionId>',
      },
    ],
  },
];

function CopyBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Скопировать"
      style={{
        display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
        fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', lineHeight: 1.5,
        padding: '7px 10px', borderRadius: 5, cursor: 'pointer', whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        border: `1px solid ${copied ? 'var(--suc)' : 'var(--bd)'}`,
        background: copied ? 'color-mix(in srgb, var(--suc) 10%, transparent)' : 'var(--bg1)',
        color: copied ? 'var(--suc)' : 'var(--t1)',
      }}
    >
      {copied ? '✓ скопировано' : cmd}
    </button>
  );
}

export function QuickCommandsTab() {
  return (
    <div>
      <div style={S.card}>
        Личная шпаргалка — команды на каждый день, чтобы не вспоминать порядок заново. Клик по строке копирует её в буфер.
        Полный рецепт с оговорками — вкладка «Подключения» в разделе «Основа».
      </div>
      {QUICK_GROUPS.map(g => (
        <div key={g.title} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            {g.title}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.items.map(it => (
              <div key={it.cmd}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 2 }}>{it.label}</div>
                <CopyBlock cmd={it.cmd} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
