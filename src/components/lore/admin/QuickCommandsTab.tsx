import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GameIcon } from '../GameIcon';
import { S } from './adminStyles';
import { QUICK_GROUPS, tryCopy, type CopyResult } from './quickCommands';

function CopyBlock({ cmd }: { cmd: string }) {
  const { t } = useTranslation();
  const [res, setRes] = useState<CopyResult | null>(null);
  const tone = res === 'ok' ? 'var(--suc)' : res ? 'var(--dng)' : null;
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const r = await tryCopy(cmd, typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
          setRes(r);
          setTimeout(() => setRes(null), r === 'ok' ? 1500 : 4000);
        }}
        title={t('lore.admin.copyTitle', 'Скопировать')}
        style={{
          display: 'block', width: '100%', textAlign: 'left', font: 'inherit', minHeight: 40,
          fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', lineHeight: 1.5,
          padding: '7px 10px', borderRadius: 5, cursor: 'pointer', whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          border: `1px solid ${tone ?? 'var(--bd)'}`,
          background: tone ? `color-mix(in srgb, ${tone} 10%, transparent)` : 'var(--bg1)',
          color: tone ?? 'var(--t1)',
        }}
      >
        {res === 'ok'
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><GameIcon slug="tick" size={12} style={{ color: 'inherit' }} />{t('lore.admin.copied', 'скопировано')}</span>
          : cmd}
      </button>
      {/* Q-03: «не скопировано» — с причиной; команда остаётся видна, её можно выделить вручную. */}
      {res && res !== 'ok' && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--dng)', marginTop: 2 }}>
          {res === 'unavailable'
            ? t('lore.admin.copyUnavailable', 'Не скопировано: буфер обмена недоступен (страница открыта не по https/localhost). Выделите команду вручную.')
            : t('lore.admin.copyFailed', 'Не скопировано: браузер отказал в доступе к буферу. Выделите команду вручную.')}
        </div>
      )}
    </div>
  );
}

export function QuickCommandsTab() {
  const { t } = useTranslation();
  return (
    <div>
      <div style={S.note}>
        {t('lore.admin.quickNote', 'Личная шпаргалка — команды на каждый день, чтобы не вспоминать порядок заново. Нажатие на строку копирует её в буфер. Полный рецепт с оговорками — вкладка «Подключения» в разделе «Основа».')}
      </div>
      {QUICK_GROUPS.map(g => (
        <div key={g.titleKey} style={{ marginBottom: 16 }}>
          <div style={{ ...S.sec, marginTop: 0 }}>{t(g.titleKey, g.title)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.items.map(it => (
              <div key={it.cmd}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 2 }}>{t(it.labelKey, it.label)}</div>
                <CopyBlock cmd={it.cmd} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
