import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { loreMutate, fetchVolvaEmbed, LoreHttpError } from '../../../api/lore';
import { loadKcObj } from '../kc-state';
import { AUTH_ENABLED } from '../../../auth/session';
import { useRole } from '../../../auth/useRole';
import { GameIcon } from '../GameIcon';
import type { DictRow, Preflight, Denial } from './types';
import { S } from './adminStyles';
import { readiness } from './adminShellModel';
import { RespTable, rowBtn } from './adminWidgets';
import { useIsNarrow } from './useIsNarrow';
import type { Col } from './adminCards';

// AL-38: реестр известных app_setting-ключей. Ключ попадает сюда только вместе с
// чтением в коде (одним PR) — всё прочее в dict_type=app_setting остаётся «неопознанным».
// Тексты — функцией от t: ключи локалей литералами, их видит i18n-coverage.
interface KnownSetting {
  key: string;
  text: (t: TFunction) => { type: string; def: string; descr: string; hint: string };
  placeholder: string;
}
const KNOWN_SETTINGS: KnownSetting[] = [
  // Слой графиков (решение владелицы 06.11.2026): свои графики на ECharts или
  // встройка Völva — либо то, либо другое. Читает charts/chartLayer.ts на каждом
  // показе графика; по умолчанию echarts.
  {
    key: 'charts.layer',
    placeholder: 'echarts',
    text: t => ({
      type: t('lore.admin.settingTypeChartLayer', 'echarts | volva'),
      def: 'echarts',
      descr: t('lore.admin.settingChartLayerDescr', 'Чем рисуются графики LORE: echarts — сам LORE из своих данных; volva — встроенные графики Völva (нужна карточка в Völva и белый список lore.volva.embed.charts на бэкенде).'),
      hint: t('lore.admin.settingChartLayerHint', 'Одна настройка на весь LORE, действует сразу после сохранения (после обновления страницы). Если в слое Völva графика нет, вместо пустой рамки показывается «не настроено».'),
    }),
  },
  // SPRINT_QG_REBUILD/QG-09: читает LoreQgActionsPoller на каждом заходе
  // (настройка → иначе LORE_QG_ACTIONS_PROJECTS → иначе пусто).
  {
    key: 'qg.actions_projects',
    placeholder: 'NooriUta/UnlimitedLORE,NooriUta/AIDA',
    text: t => ({
      type: t('lore.admin.settingTypeProjects', 'список git-проектов через запятую'),
      def: t('lore.admin.settingQgProjectsDef', '— (берётся из LORE_QG_ACTIONS_PROJECTS, если задан)'),
      descr: t('lore.admin.settingQgProjectsDescr', 'Какие репозитории опрашивает канал прогонов Forgejo Actions для гейтов качества. Пусто — прогоны Actions в гейты не пишутся.'),
      hint: t('lore.admin.settingQgProjectsHint', 'Список проектов — во вкладке «Проекты» (slug вида owner/repo). Правка подхватывается со следующего захода опроса, без рестарта.'),
    }),
  },
  // Картинки в MD-полях (LoreAssetResource.settingBool/settingLong) — ключи заводит
  // миграция, читает бэкенд при каждой загрузке. Раньше их не было в реестре, и
  // админка показывала их «неопознанными» с обещанием «удаление ни на что не повлияет».
  {
    key: 'md_images_enabled',
    placeholder: 'true',
    text: t => ({
      type: t('lore.admin.settingTypeBool', 'да/нет (true | false)'),
      def: 'true',
      descr: t('lore.admin.settingMdImagesDescr', 'Разрешена ли вставка картинок в MD-поля (описания, заметки, тела доков). false — загрузка отвечает отказом MD_IMAGES_DISABLED.'),
      hint: t('lore.admin.settingMdImagesHint', 'Действует сразу, без рестарта: значение читается при каждой загрузке.'),
    }),
  },
  {
    key: 'md_image_max_mb',
    placeholder: '5',
    text: t => ({
      type: t('lore.admin.settingTypeMb', 'число, мегабайты'),
      def: '5',
      descr: t('lore.admin.settingMdImageMaxDescr', 'Предельный размер одной картинки в MD-поле. Больше — загрузка отклоняется с размером файла в ответе.'),
      hint: t('lore.admin.settingMdImagesHint', 'Действует сразу, без рестарта: значение читается при каждой загрузке.'),
    }),
  },
];

/** Строка таблицы известных ключей: запись из базы или null — ключ ещё не задан. */
interface KnownRow { k: KnownSetting; row: DictRow | null }

// ── Настройки (AL-38 + чеклист AL-35 + отказы AL-45) ────────────────────────
// AH-05 п.2: таблицы — RespTable (на телефоне карточки, панель вбок не листается).
export function SettingsTab({ dicts, preflight, onError, reload }: {
  dicts: DictRow[]; preflight: Preflight | null; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const role = useRole();
  const narrow = useIsNarrow();
  const [busy, setBusy] = useState(false);
  const [denials, setDenials] = useState<Denial[] | null>(null);
  // S-07: удаление неопознанного ключа — в два шага, как деактивация словаря.
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    loadKcObj<{ denials: Denial[] }>('/lore/kc/denials').then(r => setDenials(r?.denials ?? null));
  }, []);

  // QG-09: правка значения известного ключа. editing — код ключа в режиме правки.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const settings = dicts.filter(r => r.dict_type === 'app_setting' && r.is_active);
  // Известный ключ виден ВСЕГДА: нет записи в базе — строка «не задано», её можно создать.
  const known: KnownRow[] = KNOWN_SETTINGS.map(k => ({ k, row: settings.find(s => s.code === k.key) ?? null }));
  const unknown = settings.filter(s => !KNOWN_SETTINGS.some(k => k.key === s.code));

  // Поля, кроме label_ru/is_active, — null: /dict/entry partial-safe, null-поле не
  // трогается (на новой записи is_extensible получит дефолт false).
  async function saveKnown(code: string, value: string) {
    setBusy(true);
    try {
      await loreMutate('/dict/entry', { dict_type: 'app_setting', code, label_ru: value.trim(), is_active: true, label_en: null, color: null, icon: null, sort_order: null, is_extensible: null });
      setEditing(null);
      reload();
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  async function removeUnknown(code: string) {
    setBusy(true);
    try {
      await loreMutate('/dict/entry', { dict_type: 'app_setting', code, is_active: false, label_ru: null, label_en: null, color: null, icon: null, sort_order: null, is_extensible: null });
      setConfirmDel(null);
      reload();
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  const pf = preflight;
  // AH-05: те же проверки считает красный счётчик «Настроек» в навигации (readiness).
  const rd = pf ? readiness(pf) : null;
  const checks: { ok: boolean; title: string; sub: string }[] = pf && rd ? [
    {
      ok: rd.admins,
      title: t('lore.admin.chkAdmins', 'Есть хотя бы один человек с ролью admin'),
      sub: pf.admin_count === -1
        ? t('lore.admin.chkAdminsUnknown', 'Число админов неизвестно: KC-мост не настроен или не ответил.')
        : t('lore.admin.chkAdminsN', 'Сейчас: {{n}}. Заведите себя на вкладке «Люди» и назначьте admin.', { n: pf.admin_count }),
    },
    {
      ok: rd.kc,
      title: t('lore.admin.chkKc', 'Keycloak доступен'),
      sub: pf.kc_configured
        ? (pf.kc_reachable ? t('lore.admin.chkKcOk', 'Мост отвечает.') : t('lore.admin.chkKcDown', 'KC не ответил: {{err}}', { err: pf.kc_error }))
        : t('lore.admin.chkKcOff', 'KC_ADMIN_CLIENT_SECRET не задан.'),
    },
    {
      ok: rd.scope,
      title: t('lore.admin.chkScope', 'Права агентов проверяются на бэкенде'),
      // S-02: подпись от состояния — прежняя константа «ещё не включён (AL-17)» стояла и при зелёном чеке.
      sub: rd.scope
        ? t('lore.admin.chkScopeOn', 'AgentScopeFilter включён: клейм agent_scope проверяется на каждом запросе.')
        : t('lore.admin.chkScopeSub', 'AgentScopeFilter ещё не включён (AL-17): после включения auth агенты пройдут в любое семейство.'),
    },
  ] : [];

  const keyCols: Col[] = [
    { key: 'code', label: t('lore.admin.thKey', 'ключ'), kind: 'title' },
    { key: 'value', label: t('lore.admin.thValue', 'значение') },
    { key: 'descr', label: t('lore.admin.thDescr', 'описание'), kind: 'full' },
    { key: 'act', label: '', kind: 'act' },
  ];
  const knownCell = ({ k, row }: KnownRow, col: string) => {
    const tx = k.text(t);
    const isEdit = editing === k.key;
    switch (col) {
      case 'code': return <span style={{ fontFamily: 'var(--mono)' }}>{k.key}</span>;
      case 'value':
        if (isEdit) return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <input style={{ ...S.input, fontFamily: 'var(--mono)', width: '100%', boxSizing: 'border-box' }}
              value={draft} placeholder={k.placeholder} disabled={busy} autoFocus
              aria-label={k.key}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveKnown(k.key, draft); if (e.key === 'Escape') setEditing(null); }} />
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', overflowWrap: 'anywhere' }}>{tx.hint}</span>
          </div>
        );
        return row && row.label_ru
          ? <span style={{ fontFamily: 'var(--mono)', overflowWrap: 'anywhere' }}>{row.label_ru}</span>
          : <span style={{ color: 'var(--t3)' }}>{t('lore.admin.settingNotSet', 'не задано')}</span>;
      case 'descr': return (
        <span style={{ overflowWrap: 'anywhere' }}>
          {tx.descr}
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 2 }}>
            {t('lore.admin.settingTypeDef', 'тип: {{type}} · по умолчанию: {{def}}', { type: tx.type, def: tx.def })}
          </div>
        </span>
      );
      case 'act': return isEdit
        ? <>
            <button style={rowBtn(narrow, S.primary)} disabled={busy} onClick={() => saveKnown(k.key, draft)}>{t('lore.admin.settingSave', 'Сохранить')}</button>
            <button style={rowBtn(narrow)} disabled={busy} onClick={() => setEditing(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
          </>
        : <button style={rowBtn(narrow)} disabled={busy} onClick={() => { setDraft(row?.label_ru ?? ''); setEditing(k.key); }}>{t('lore.admin.settingEdit', 'Изменить')}</button>;
    }
    return null;
  };
  const unkCols: Col[] = [
    { key: 'code', label: t('lore.admin.thKey', 'ключ'), kind: 'title' },
    { key: 'value', label: t('lore.admin.thValue', 'значение') },
    { key: 'act', label: '', kind: 'act' },
  ];
  const settingCell = (s: DictRow, k: string) => {
    switch (k) {
      case 'code': return s.code;
      case 'value': return <span style={{ fontFamily: 'var(--mono)', overflowWrap: 'anywhere' }}>{s.label_ru}</span>;
      case 'act': return confirmDel === s.code
        ? <>
            <button style={rowBtn(narrow, S.danger)} disabled={busy} onClick={() => removeUnknown(s.code)}>{t('lore.admin.removeConfirm', 'Точно удалить?')}</button>
            <button style={rowBtn(narrow)} onClick={() => setConfirmDel(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
          </>
        : <button style={rowBtn(narrow, S.danger)} disabled={busy} onClick={() => setConfirmDel(s.code)}>{t('lore.admin.remove', 'Удалить')}</button>;
    }
    return null;
  };
  const denCols: Col[] = [
    { key: 'path', label: t('lore.admin.thPath', 'путь'), kind: 'title' },
    { key: 'ts', label: t('lore.admin.thWhen', 'когда') },
    { key: 'method', label: t('lore.admin.thMethod', 'метод') },
    { key: 'status', label: t('lore.admin.thStatus', 'статус') },
    { key: 'error', label: t('lore.admin.thError', 'ошибка') },
    { key: 'role', label: t('lore.admin.thRole', 'роль') },
  ];
  const mono = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' };
  const denCell = (d: Denial, k: string) => {
    switch (k) {
      case 'ts': return <span style={{ ...mono, fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap' }}>{d.ts.replace('T', ' ').slice(0, 19)}</span>;
      case 'method': return <span style={{ fontFamily: 'var(--mono)' }}>{d.method}</span>;
      case 'path': return <span style={{ ...mono, overflowWrap: 'anywhere' }}>{d.path}</span>;
      case 'status': return <span style={{ color: 'var(--dng)', fontFamily: 'var(--mono)' }}>{d.status}</span>;
      case 'error': return <span style={{ ...mono, overflowWrap: 'anywhere' }}>{d.error || '—'}</span>;
      case 'role': return <span style={mono}>{d.role}</span>;
    }
    return null;
  };
  const h3 = { fontSize: 'var(--fs-md)', margin: '0 0 6px', color: 'var(--t1)' };

  return (
    <div>
      <h3 style={h3}>{t('lore.admin.authBlockH', 'Включение аутентификации')}</h3>
      {pf ? (
        <>
          {!pf.can_enable_auth && (
            <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>
              <b>{t('lore.admin.cantEnableH', 'Включать auth сейчас нельзя.')}</b> {pf.hint}
            </div>
          )}
          <div style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 12px', marginBottom: 8 }}>
            {checks.map(c => (
              <div key={c.title} style={S.check}>
                <span style={S.mark(c.ok)}><GameIcon slug={c.ok ? 'tick' : 'cross-mark'} size={10} style={{ color: 'inherit' }} /></span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ color: 'var(--t1)' }}>{c.title}</b>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', overflowWrap: 'anywhere' }}>{c.sub}</div>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
            <button style={{ ...rowBtn(narrow, S.primary), opacity: pf.can_enable_auth ? 1 : 0.45, cursor: pf.can_enable_auth ? 'pointer' : 'not-allowed' }} disabled>
              {t('lore.admin.enableAuth', 'Включить аутентификацию')}
            </button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', minWidth: 0 }}>
              {t('lore.admin.enableAuthNote', 'Сам флип — env (LORE_AUTH_ENABLED=true) + рестарт по RUNBOOK-AUTH-OMILORE, все флаги вместе (AL-12 — владелец лично). Кнопка станет активной формой, когда появится рантайм-ручка.')}
            </span>
          </div>
        </>
      ) : (
        <div style={S.card}>{t('lore.admin.pfLoading', 'Проверки грузятся (или KC-мост недоступен — тогда чеклист покажет это явно после ответа).')}</div>
      )}

      <h3 style={h3}>{t('lore.admin.paramsH', 'Параметры приложения')}</h3>
      {KNOWN_SETTINGS.length === 0 && (
        <div style={S.card}>
          {t('lore.admin.noKnownSettings', 'Приложение пока не читает ни одного ключа app_setting — реестр известных параметров пуст (AL-38). Появится реальный параметр → он получит здесь строку с типом, дефолтом и описанием; свободного ввода ключей больше нет: выдуманный ключ не прочитает никто.')}
        </div>
      )}
      {known.length > 0 && <RespTable cols={keyCols} rows={known} rowKey={r => r.k.key} cell={knownCell} narrow={narrow} />}
      {unknown.length > 0 && (
        <div style={{ ...S.warn, marginTop: 10 }}>
          <b>{t('lore.admin.unknownH', 'Неопознанные значения · {{n}}', { n: unknown.length })}</b>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', margin: '4px 0 8px' }}>
            {t('lore.admin.unknownB', 'Эти ключи лежат в базе (dict_type=app_setting), но приложение их не читает — скорее всего, остались от ручной правки. Удаление ни на что не повлияет (soft-delete: is_active=false).')}
          </div>
          <RespTable cols={unkCols} rows={unknown} rowKey={s => s.code} cell={settingCell} narrow={narrow} />
        </div>
      )}

      <VolvaIntegrationCheck />

      <h3 style={{ ...h3, marginTop: 18 }}>{t('lore.admin.denialsH', 'Последние отказы доступа')}</h3>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 6 }}>
        {t('lore.admin.denialsSrc', 'Источник: память процесса с последнего рестарта (кольцевой буфер, AL-45). Долговременный аудит по осям — AL-20.')}
      </div>
      {denials === null && <div style={S.card}>{t('lore.admin.denialsNA', 'Недоступно (нужна роль admin или бэкенд старой версии).')}</div>}
      {denials !== null && denials.length === 0 && <div style={S.card}>{t('lore.admin.denialsEmpty', 'С последнего рестарта отказов не было.')}</div>}
      {denials !== null && denials.length > 0 && (
        <RespTable cols={denCols} rows={denials.slice(0, 30).map((d, i) => ({ ...d, i }))} rowKey={d => String(d.i)} cell={denCell} narrow={narrow} />
      )}

      <div style={{ height: 12 }} />
      <div style={{ ...S.card, opacity: 0.75 }}>
        <b>Auth:</b> {AUTH_ENABLED
          ? t('lore.admin.authOnLine', 'включён (JWT, роль из seer_roles)')
          : t('lore.admin.authOffLine', 'выключен — dev-режим, роль из конфига (VITE_LORE_ROLE)')} · {t('lore.admin.roleNow', 'текущая роль')}: <b>{role}</b>
      </div>
      <div style={{ ...S.card, opacity: 0.75, overflowWrap: 'anywhere' }}><b>LORE_ACTIVE_PROJECT:</b> {t('lore.admin.setProj', 'сессионный дефолт проекта MCP-процесса (env, ADR-LORE-017) — задаётся в .mcp.json/OpenCode-конфиге, из UI не читается')}</div>
    </div>
  );
}

/**
 * Проверка интеграции Völva (решение владелицы 06.11.2026, «и там же проверка
 * интеграции»): запрос подписанного адреса пилотного графика у бэкенда LORE.
 * Исход — по коду ответа, а не «нажали и тишина»: не настроено ≠ нет графика ≠
 * нет доступа ≠ ошибка. Адрес целиком не показывается — в нём JWT.
 */
export function volvaCheckVerdict(e: unknown): { ok: false; kind: 'not_configured' | 'unknown_chart' | 'forbidden' | 'error'; detail: string } {
  if (e instanceof LoreHttpError) {
    if (e.status === 503) return { ok: false, kind: 'not_configured', detail: e.detail || e.code };
    if (e.status === 404) return { ok: false, kind: 'unknown_chart', detail: e.detail || e.code };
    if (e.status === 401 || e.status === 403) return { ok: false, kind: 'forbidden', detail: e.detail || e.code };
  }
  return { ok: false, kind: 'error', detail: e instanceof Error ? e.message : String(e) };
}

function VolvaIntegrationCheck() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<null | { ok: true; origin: string; expires: string } | ReturnType<typeof volvaCheckVerdict>>(null);
  async function run() {
    setBusy(true); setRes(null);
    try {
      const r = await fetchVolvaEmbed('velocity');
      setRes({ ok: true, origin: new URL(r.url).origin, expires: r.expires_at });
    } catch (e) { setRes(volvaCheckVerdict(e)); }
    finally { setBusy(false); }
  }
  const msg = !res ? null
    : res.ok ? t('lore.admin.volvaCheckOk', 'Готово: адрес выдан, ведёт на {{origin}}, действует до {{expires}}.', { origin: res.origin, expires: res.expires })
    : res.kind === 'not_configured' ? t('lore.admin.volvaCheckNotConfigured', 'Не настроено: на бэкенде нет секрета LORE_VOLVA_EMBED_SECRET или адреса lore.volva.embed.site-url. ({{d}})', { d: res.detail })
    : res.kind === 'unknown_chart' ? t('lore.admin.volvaCheckUnknown', 'Графика velocity нет в белом списке lore.volva.embed.charts. ({{d}})', { d: res.detail })
    : res.kind === 'forbidden' ? t('lore.admin.volvaCheckForbidden', 'Нет доступа к подписи встройки. ({{d}})', { d: res.detail })
    : t('lore.admin.volvaCheckError', 'Ошибка проверки: {{d}}', { d: res.detail });
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={S.primary} disabled={busy} onClick={run}>{busy ? '…' : t('lore.admin.volvaCheckBtn', 'Проверить интеграцию Völva')}</button>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{t('lore.admin.volvaCheckNote', 'Запрашивает подписанный адрес пилотного графика velocity — тот же путь, что у слоя Völva.')}</span>
      </div>
      {msg && <div role="status" style={{ ...S.card, marginTop: 6, color: res && res.ok ? 'var(--suc)' : 'var(--dng)', overflowWrap: 'anywhere' }}>{msg}</div>}
    </div>
  );
}
