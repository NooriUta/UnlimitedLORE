// «Что LORE помнит обо мне» (S4-02, контракт S2 /lore/me/memory, S2-05).
// Категории привычек с «забыть» по пункту, по разделу и «стереть всё»;
// флаг «запоминать». Честные состояния: загрузка, сбой (с «повторить»),
// чужая память (403 — «нет прав»), пустой раздел — проверенный ноль, а при
// выключенной памяти пустота подписана как «не запоминаю».
import { ICON_CANON } from '@seidr/kit';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, Forbidden, IconButton, LoadError, Segmented, SettingRow, Skeleton, classifyError } from '@seidr/kit';
import type { MemoryKind, MemoryResponse } from '../api/contracts/s2';
import type { S2Client } from '../api/contracts/s2.stubs';
import { t, type Lang, type MessageKey } from '../i18n/messages';

type MemState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ok'; data: MemoryResponse; busy: boolean; actionError?: unknown };

const KIND_KEY: Record<MemoryKind, MessageKey> = {
  frequent_views: 'settings.memory.kind.frequent_views',
  frequent_slices: 'settings.memory.kind.frequent_slices',
  recent_records: 'settings.memory.kind.recent_records',
};

export interface MemoryPanelProps {
  client: S2Client;
  lang: Lang;
  onBack?: () => void;
}

export function MemoryPanel({ client, lang, onBack }: MemoryPanelProps) {
  const [st, setSt] = useState<MemState>({ status: 'loading' });

  const load = useCallback(() => {
    let live = true;
    client.memory().then(
      data => { if (live) setSt({ status: 'ok', data, busy: false }); },
      error => { if (live) setSt({ status: 'error', error }); },
    );
    return () => { live = false; };
  }, [client]);

  useEffect(() => load(), [load]);

  /** Действие над памятью и перечитывание: что показано — то и есть на сервере. */
  const act = async (fn: () => Promise<unknown>) => {
    if (st.status !== 'ok') return;
    setSt({ ...st, busy: true, actionError: undefined });
    try {
      await fn();
      const data = await client.memory();
      setSt({ status: 'ok', data, busy: false });
    } catch (actionError) {
      setSt({ ...st, busy: false, actionError });
    }
  };

  let body;
  if (st.status === 'loading') body = <Skeleton lines={3} label={t(lang, 'settings.loading')} />;
  else if (st.status === 'error') {
    body = classifyError(st.error) === 'forbidden'
      ? <Forbidden compact />
      : <LoadError compact error={st.error} onRetry={() => { setSt({ status: 'loading' }); load(); }} />;
  } else {
    const { data, busy } = st;
    body = (
      <>
        <SettingRow label={t(lang, 'settings.memory.remembering')}>
          <Segmented
            label={t(lang, 'settings.memory.remembering')}
            value={data.remembering ? 'on' : 'off'}
            options={[{ value: 'on', label: t(lang, 'settings.memory.on') }, { value: 'off', label: t(lang, 'settings.memory.off') }]}
            onChange={v => act(() => client.setRemembering({ remembering: v === 'on' }))}
            disabled={busy}
          />
        </SettingRow>
        <p className="settings-note">{t(lang, 'settings.memory.note')} {data.retention_days}</p>
        {!data.remembering && <p className="settings-note settings-note--warn">{t(lang, 'settings.memory.notRemembering')}</p>}
        {st.actionError !== undefined && <LoadError compact error={st.actionError} />}
        {data.categories.map(cat => {
          const kindTitle = t(lang, KIND_KEY[cat.kind]);
          return (
            <div key={cat.kind} className="memory-cat" data-memory-kind={cat.kind}>
              <div className="memory-cat__head">
                <h4 className="memory-cat__title">{kindTitle}</h4>
                {cat.items.length > 0 && (
                  <IconButton
                    icon={ICON_CANON.ctlDelete}
                    label={`${t(lang, 'settings.memory.forgetKind')}: ${kindTitle}`}
                    disabled={busy}
                    onClick={() => act(() => client.forgetAll(cat.kind))}
                  />
                )}
              </div>
              {cat.items.length === 0
                ? <EmptyState compact title={t(lang, 'settings.memory.empty')} hint="" />
                : (
                  <ul className="memory-list">
                    {cat.items.map(m => {
                      const label = m.label ?? m.key;
                      return (
                        <li key={m.memory_id} className="memory-item">
                          <span className="memory-item__label">{label}</span>
                          <span className="memory-item__hits">{m.hits} {t(lang, 'settings.memory.hits')}</span>
                          <IconButton
                            icon="cross-mark"
                            iconSize={12}
                            label={`${t(lang, 'settings.memory.forget')}: ${label}`}
                            disabled={busy}
                            onClick={() => act(() => client.forget(m.memory_id))}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
            </div>
          );
        })}
        <div className="memory-actions">
          <button type="button" className="sk-btn" disabled={busy} onClick={() => act(() => client.forgetAll())}>
            {t(lang, 'settings.memory.forgetAll')}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="settings memory" aria-label={t(lang, 'settings.memory.title')}>
      <div className="memory-head">
        {onBack && <IconButton icon="return-arrow" label={t(lang, 'settings.memory.back')} onClick={onBack} />}
        <h3 className="settings-title">{t(lang, 'settings.memory.title')}</h3>
      </div>
      {body}
    </section>
  );
}
