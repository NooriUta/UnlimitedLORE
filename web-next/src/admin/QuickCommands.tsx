// Блок «Быстрые команды» в разделе MCP админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-31
// п.5, решение 5а). Перенесено из старой вкладки v1 QuickCommandsTab.
// Команда всегда видна текстом (её можно выделить вручную); «Скопировать» —
// отдельной кнопкой; отказ буфера назван словами, не ложным «скопировано».
import { useState } from 'react';
import { useAppT } from '../i18n';
import { QUICK_GROUPS, tryCopy, type Clip, type CopyResult } from './quickCmds';
import './Admin.css';

export interface QuickCommandsProps {
  /** Буфер обмена; null — его нет (тесты). По умолчанию navigator.clipboard. */
  clipboard?: Clip | null;
}

export function QuickCommands({ clipboard }: QuickCommandsProps) {
  const t = useAppT();
  const clip = clipboard === undefined ? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined) : clipboard;
  return (
    <section aria-labelledby="adm-quick-h" data-testid="adm-quick">
      <h3 id="adm-quick-h" className="adm-access__h">{t('admin.quick.title')}</h3>
      <p className="adm-hint">{t('admin.quick.note')}</p>
      {QUICK_GROUPS.map(g => (
        <div key={g.title} className="adm-card">
          <span className="adm-field__l">{t(g.title)}</span>
          {g.items.map(it => <CopyLine key={it.cmd} label={t(it.label)} cmd={it.cmd} clip={clip} />)}
        </div>
      ))}
    </section>
  );
}

function CopyLine({ label, cmd, clip }: { label: string; cmd: string; clip: Clip | null | undefined }) {
  const t = useAppT();
  const [res, setRes] = useState<CopyResult | null>(null);
  const copy = () => { tryCopy(cmd, clip).then(setRes); };
  return (
    <div className="adm-field">
      <span className="adm-hint">{label}</span>
      <span className="adm-field--btns">
        <code className="adm-mono adm-wiz-code">{cmd}</code>
        <button type="button" className="adm-btn" aria-label={`${t('admin.quick.copy')}: ${label}`} onClick={copy}>
          {res === 'ok' ? t('admin.quick.copied') : t('admin.quick.copy')}
        </button>
      </span>
      {res && res !== 'ok' && (
        <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-quick-fail" data-why={res}>
          {res === 'unavailable' ? t('admin.quick.unavailable') : t('admin.quick.failed')}
        </p>
      )}
    </div>
  );
}
