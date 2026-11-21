// Пакет 1.18 — имена людей из KC в разделе «Люди»: при открытии раздела — сверка раз в сутки (сервер помнит
// последнюю), кнопкой — сразу. Итог словами («обновлено N, без имени в KC M»); KC недоступен — строка-отказ
// с причиной, а не тихие логины.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKitLang } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { useAppT } from '../i18n';
import { kcNamesLine, syncKcNames, type KcNamesResult } from './kcNames';

export function KcNamesBar({ fetchImpl, onChanged }: { fetchImpl?: typeof fetch; onChanged: () => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const [result, setResult] = useState<KcNamesResult | null>(null);
  const [running, setRunning] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const run = useCallback(async (daily: boolean) => {
    setRunning(true);
    const r = await syncKcNames(fetchImpl ?? loreFetch, daily ? { ifOlderThanHours: 24 } : {});
    setResult(r);
    setRunning(false);
    if (r.state === 'done' && r.summary.updated > 0) changed.current();
  }, [fetchImpl]);
  useEffect(() => { void run(true); }, [run]);
  return (
    <div className="adm-people__names" data-testid="adm-kc-names">
      <button type="button" className="sk-btn" data-testid="adm-kc-names-btn" disabled={running} onClick={() => void run(false)}
        title={t('admin.kcNames.hint')}>
        {t('admin.kcNames.button')}
      </button>
      {running && <span className="adm-note" role="status">{t('admin.kcNames.running')}</span>}
      {!running && result && (
        <span className="adm-note" data-testid="adm-kc-names-line" role={result.state === 'error' ? 'alert' : 'status'}>
          {kcNamesLine(result, lang)}
        </span>
      )}
    </div>
  );
}
