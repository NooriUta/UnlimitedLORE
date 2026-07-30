// Форма работы/боли/выгоды (PL-18B, прототип PL-01 v3 «Экран 5б»).
//
// Реестр — единственная поверхность создания VP кроме MCP: до неё записи
// заводились только вызовами `job_new`/`pain_new`/`gain_new`, а у фичи был лишь
// пикер для привязки УЖЕ существующей. Привязка к фиче/UC остаётся в карточке
// фичи: реестр решает «завести и увидеть везде», карточка — «привязать к этой
// ценности».
//
// Форма одна на создание и правку: поля совпадают дословно, а два экземпляра
// разъехались бы при первой же правке одного из них.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import { saveLorePain, saveLoreGain, saveLoreJob, linkLoreVp, fetchLoreSlice } from '../../../api/lore';
import type { LoreActorRow, LoreJobRow } from '../../../api/lore';
import TipTapField from '../TipTapField';
import { gainRankLabel } from './vocab';

export type PainGainJobKind = 'job' | 'pain' | 'gain';

const PREFIX: Record<PainGainJobKind, string> = { job: 'JOB-', pain: 'PAIN-', gain: 'GAIN-' };

/** Тип записи по её id — тем же префиксом, которым ветвится весь реестр. */
export function painGainJobKindOf(id: string): PainGainJobKind | null {
  if (id.startsWith('JOB-')) return 'job';
  if (id.startsWith('PAIN-')) return 'pain';
  if (id.startsWith('GAIN-')) return 'gain';
  return null;
}

/**
 * Нормализация введённого id к виду `JOB-…` / `PAIN-…` / `GAIN-…`.
 *
 * Префикс несёт смысл: и цвет строки, и выбор паспорта ветвятся ровно по нему.
 * Запись без префикса завелась бы успешно и стала бы невидимой в собственном
 * реестре — отказ, замаскированный под успех, поэтому чиним ввод, а не браним
 * пользователя.
 */
export function normalizePainGainJobId(kind: PainGainJobKind, raw: string): string {
  const prefix = PREFIX[kind];
  const v = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (!v) return '';
  return v.startsWith(prefix) ? v : prefix + v;
}

/** Значения, которыми форма открывается на правку существующей записи. */
export interface PainGainJobDraft {
  id: string;
  title?: string | null;
  body_md?: string | null;
  /** severity (боль) · metric_md (выгода) · importance (работа) */
  extra?: string | null;
  /** только у работы — тип по Остервальдеру */
  jobKind?: string | null;
  /** FELT_BY / DESIRED_BY / PERFORMED_BY — чья это боль, выгода, работа */
  actorIds?: string[] | null;
  /** только у выгоды — essential | expected | desired | unexpected (Kano) */
  rank?: string | null;
  /** только у боли — BLOCKS: каким работам мешает */
  blocksJobIds?: string[] | null;
  /** только у выгоды — SUCCESS_OF: успех в какой работе */
  successOfJobIds?: string[] | null;
}

export default function PainGainJobModal({
  kind, opened, onClose, onCreated, onError, initial,
}: {
  kind: PainGainJobKind;
  opened: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  onError: (e: unknown) => void;
  /** задан — форма открыта на правку: id заблокирован, поля предзаполнены */
  initial?: PainGainJobDraft;
}) {
  const { t } = useTranslation();
  const editing = !!initial;

  const [id, setId] = useState(initial?.id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body_md ?? '');
  const [extra, setExtra] = useState(initial?.extra ?? '');
  const [jobKind, setJobKind] = useState(initial?.jobKind ?? '');
  const [saving, setSaving] = useState(false);

  /**
   * Чей это профиль (PL-36).
   *
   * Поля не было вовсе, и рёбра FELT_BY/DESIRED_BY/PERFORMED_BY оставались
   * пустыми у всего корпуса: VP-канва не могла ответить, чьи боли показывает,
   * а фильтр по сегменту не с чем было строить. Пути записи на бэкенде и в MCP
   * существовали — не хватало ровно этого поля.
   */
  const [actorIds, setActorIds] = useState<string[]>(initial?.actorIds ?? []);
  const [actors, setActors] = useState<LoreActorRow[]>([]);
  useEffect(() => {
    if (!opened) return;
    const ctrl = new AbortController();
    fetchLoreSlice<LoreActorRow>('actors', undefined, ctrl.signal)
      .then(setActors)
      .catch(() => { /* список акторов не критичен: форма сохранится и без него */ });
    return () => ctrl.abort();
  }, [opened]);

  /**
   * Ранг выгоды (Kano) и связь с работой (PL-49 / FIT-01).
   *
   * До этой правки оба пути существовали только в MCP: владелец не мог задать
   * ранг выгоды или отметить, какой работе мешает боль / в какой работе
   * выгода — форма их просто не показывала, хотя `saveLoreGain`/`linkLoreVp`
   * уже умели то и другое.
   */
  const [rank, setRank] = useState(initial?.rank ?? '');
  const [jobLinks, setJobLinks] = useState<string[]>(
    (kind === 'pain' ? initial?.blocksJobIds : initial?.successOfJobIds) ?? [],
  );
  const [jobs, setJobs] = useState<LoreJobRow[]>([]);
  useEffect(() => {
    if (!opened || (kind !== 'pain' && kind !== 'gain')) return;
    const ctrl = new AbortController();
    fetchLoreSlice<LoreJobRow>('jobs', undefined, ctrl.signal)
      .then(setJobs)
      .catch(() => { /* список работ не критичен: форма сохранится и без него */ });
    return () => ctrl.abort();
  }, [opened, kind]);

  // Предзаполнение приходит асинхронно (слайс мог ещё грузиться), поэтому
  // синхронизируем состояние с ним, а не только начальным значением: иначе
  // форма правки открывалась бы пустой и «сохранение» стирало бы поля.
  useEffect(() => {
    setId(initial?.id ?? '');
    setTitle(initial?.title ?? '');
    setBody(initial?.body_md ?? '');
    setExtra(initial?.extra ?? '');
    setJobKind(initial?.jobKind ?? '');
    setActorIds(initial?.actorIds ?? []);
    setRank(initial?.rank ?? '');
    setJobLinks((kind === 'pain' ? initial?.blocksJobIds : initial?.successOfJobIds) ?? []);
  }, [initial, kind]);

  const finalId = editing ? (initial?.id ?? '') : normalizePainGainJobId(kind, id);

  const reset = () => {
    setId(''); setTitle(''); setBody(''); setExtra(''); setJobKind(''); setActorIds([]);
    setRank(''); setJobLinks([]);
  };
  const close = () => { if (!editing) reset(); onClose(); };

  const submit = async () => {
    if (!finalId || saving) return;
    setSaving(true);
    try {
      const common = { title: title || undefined, body_md: body || undefined };
      if (kind === 'pain') {
        await saveLorePain({ pain_id: finalId, ...common, severity: extra || undefined });
      } else if (kind === 'gain') {
        await saveLoreGain({ gain_id: finalId, ...common, metric_md: extra || undefined, rank: rank || undefined });
      } else {
        await saveLoreJob({ job_id: finalId, ...common, kind: jobKind || undefined, importance: extra || undefined });
      }
      // Рёбра к акторам — отдельными вызовами после самой записи: вершина
      // должна существовать, иначе связывать не с чем.
      const rel = kind === 'pain' ? 'felt_by' : kind === 'gain' ? 'desired_by' : 'performed_by';
      const was = initial?.actorIds ?? [];
      for (const a of actorIds.filter(x => !was.includes(x))) {
        await linkLoreVp({ source_id: finalId, rel, target_id: a });
      }
      for (const a of was.filter(x => !actorIds.includes(x))) {
        await linkLoreVp({ source_id: finalId, rel, target_id: a, action: 'remove' });
      }
      // Связь с работой — BLOCKS у боли, SUCCESS_OF у выгоды (FIT-01).
      if (kind === 'pain' || kind === 'gain') {
        const jobRel = kind === 'pain' ? 'blocks' : 'success_of';
        const wasJobs = (kind === 'pain' ? initial?.blocksJobIds : initial?.successOfJobIds) ?? [];
        for (const j of jobLinks.filter(x => !wasJobs.includes(x))) {
          await linkLoreVp({ source_id: finalId, rel: jobRel, target_id: j });
        }
        for (const j of wasJobs.filter(x => !jobLinks.includes(x))) {
          await linkLoreVp({ source_id: finalId, rel: jobRel, target_id: j, action: 'remove' });
        }
      }
      onCreated(finalId);
      if (!editing) reset();
      onClose();
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%', background: 'var(--bg2)', border: '1px solid var(--bd)',
    borderRadius: 4, color: 'var(--t1)', padding: '4px 8px', fontSize: 'var(--fs-sm)',
  };
  const label: React.CSSProperties = {
    fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.04em', color: 'var(--t3)', display: 'block', marginBottom: 3, marginTop: 9,
  };
  const hint: React.CSSProperties = { fontSize: 10.5, color: 'var(--t3)', marginTop: 3 };

  const titles: Record<PainGainJobKind, string> = {
    job: t('lore.product.vp.newJob', '+ Работа'),
    pain: t('lore.product.vp.newPain', '+ Боль'),
    gain: t('lore.product.vp.newGain', '+ Выгода'),
  };
  const idRules: Record<PainGainJobKind, string> = {
    job: t('lore.product.vp.idRuleJob', 'JOB-‹ОБЛАСТЬ›-‹СУТЬ›, латиницей через дефис. Область — компонент или продукт: JOB-LORE-SHIP-RELEASE'),
    pain: t('lore.product.vp.idRulePain', 'PAIN-‹ОБЛАСТЬ›-‹СУТЬ›, латиницей через дефис. Область — компонент или продукт: PAIN-LORE-MANUAL-HANDOFF'),
    gain: t('lore.product.vp.idRuleGain', 'GAIN-‹ОБЛАСТЬ›-‹СУТЬ›, латиницей через дефис. Область — компонент или продукт: GAIN-LORE-LINKED-RELEASES'),
  };

  // Шкала «остроты/важности» общая у боли и работы — словарь на бэкенде один
  // (high|normal|low). Подписи русские, ЗНАЧЕНИЯ словарные: экран русский, а в
  // корпус обязано уйти то, что понимают слайсы и MCP.
  const levelSelect = (
    <select style={field} value={extra} onChange={e => setExtra(e.target.value)}>
      <option value="">{t('lore.product.vp.sevNone', '— не указана —')}</option>
      <option value="high">{t('lore.product.vp.sevHigh', 'высокая')}</option>
      <option value="normal">{t('lore.product.vp.sevNormal', 'обычная')}</option>
      <option value="low">{t('lore.product.vp.sevLow', 'низкая')}</option>
    </select>
  );

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={editing ? `${t('lore.product.vp.edit', 'Правка')} · ${finalId}` : titles[kind]}
      size={520}
    >
      {!editing && (
        <>
          <label style={{ ...label, marginTop: 0 }}>ID</label>
          <input
            style={{ ...field, fontFamily: 'var(--mono)' }}
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder={PREFIX[kind] + 'LORE-…'}
          />
          {/* Правило кодификации — прямо под полем, а не «где-то в спеке»: схема
              id в корпусе есть, но нигде не записана, и каждый заводящий
              изобретал её заново. Разнобой не чинится переименованием: id — ключ,
              на него уже ссылаются рёбра. */}
          <div style={hint}>{idRules[kind]}</div>
          {id.trim() && finalId !== id.trim().toUpperCase() && (
            // Показываем ИТОГОВЫЙ id: подставленный молча префикс — это запись
            // не с тем именем, которое человек видел перед «Создать».
            <div style={{ ...hint, fontFamily: 'var(--mono)' }}>→ {finalId}</div>
          )}
          {/[А-ЯЁ]/.test(finalId) && (
            // Предупреждение, а не запрет: кириллический id заведётся, но
            // встанет особняком среди латинских.
            <div style={{ ...hint, color: 'var(--wrn)' }}>
              ⚠ {t('lore.product.vp.idCyrillic', 'в корпусе id латиницей — кириллический встанет особняком')}
            </div>
          )}
        </>
      )}

      <label style={editing ? { ...label, marginTop: 0 } : label}>{t('lore.product.vp.fieldTitle', 'Заголовок')}</label>
      <input style={field} value={title} onChange={e => setTitle(e.target.value)} />

      {kind === 'job' && (
        <>
          <label style={label}>{t('lore.product.vp.fieldJobKind', 'Тип работы (Остервальдер)')}</label>
          <select style={field} value={jobKind} onChange={e => setJobKind(e.target.value)}>
            <option value="">{t('lore.product.vp.jobKindNone', '— не указан —')}</option>
            <option value="functional">{t('lore.product.vp.jobFunctional', 'функциональная — что нужно сделать')}</option>
            <option value="social">{t('lore.product.vp.jobSocial', 'социальная — как хочет выглядеть')}</option>
            <option value="emotional">{t('lore.product.vp.jobEmotional', 'эмоциональная — что хочет чувствовать')}</option>
            <option value="supporting">{t('lore.product.vp.jobSupporting', 'вспомогательная — вокруг основной')}</option>
          </select>
        </>
      )}

      <label style={label}>
        {kind === 'pain' && t('lore.product.vp.fieldSeverity', 'Острота')}
        {kind === 'job' && t('lore.product.vp.fieldImportance', 'Важность')}
        {kind === 'gain' && t('lore.product.vp.fieldMetric', 'Метрика — чем измерим, что выгода получена')}
      </label>
      {kind === 'gain' ? (
        <>
          <input
            style={field}
            value={extra}
            onChange={e => setExtra(e.target.value)}
            placeholder={t('lore.product.vp.metricPlaceholder', 'prs_linked > 0 у каждого нового релиза без ручных вызовов release_link')}
          />
          {/* Метрика — не название показателя, а проверяемое утверждение: что
              считаем, порог и при каких условиях. Иначе поле заполняют словом
              «скорость», и проверить по нему нечего. */}
          <div style={hint}>
            {t('lore.product.vp.metricHint', 'Проверяемое утверждение: что считаем, порог и условие. Не «скорость», а «0 merge-ов из статусов RED/PENDING».')}
          </div>
          {!extra.trim() && (
            // Предупреждение, а не запрет: выгоду без метрики завести можно, но
            // в fit VP-канвы она не попадёт (ADR-032 §2). Молчаливое создание
            // оставило бы запись, которая нигде не считается.
            <div style={{ ...hint, color: 'var(--wrn)' }}>
              ⚠ {t('lore.product.vp.noMetricWarn', 'без метрики выгода не попадёт в fit VP-канвы')}
            </div>
          )}
          <label style={label}>{t('lore.product.vp.fieldRank', 'Ранг (Kano)')}</label>
          <select style={field} value={rank} onChange={e => setRank(e.target.value)}>
            <option value="">{t('lore.product.vp.rankNone', '— не указан —')}</option>
            <option value="essential">{gainRankLabel(t, 'essential')}</option>
            <option value="expected">{gainRankLabel(t, 'expected')}</option>
            <option value="desired">{gainRankLabel(t, 'desired')}</option>
            <option value="unexpected">{gainRankLabel(t, 'unexpected')}</option>
          </select>
        </>
      ) : levelSelect}

      {/* Связь с работой — BLOCKS у боли, SUCCESS_OF у выгоды (FIT-01). Оба
          пути уже писались через MCP (vp_link), но форма их не показывала:
          заполнить мог только тот, у кого есть доступ к MCP, а не владелец,
          который знает клиента. */}
      {(kind === 'pain' || kind === 'gain') && (
        <>
          <label style={label}>
            {kind === 'pain' && t('lore.product.vp.fieldBlocks', 'Мешает работам (BLOCKS)')}
            {kind === 'gain' && t('lore.product.vp.fieldSuccessOf', 'Успех в работе (SUCCESS_OF)')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {jobs.map(j => {
              const on = jobLinks.includes(j.job_id);
              return (
                <button
                  key={j.job_id}
                  type="button"
                  onClick={() => setJobLinks(v => on ? v.filter(x => x !== j.job_id) : [...v, j.job_id])}
                  aria-pressed={on}
                  style={{
                    padding: '2px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 'var(--fs-xs)',
                    border: `1px solid ${on ? 'var(--job)' : 'var(--bd)'}`,
                    background: on ? 'var(--bg2)' : 'transparent',
                    color: on ? 'var(--t1)' : 'var(--t2)',
                  }}
                >
                  {j.title ?? j.job_id}
                </button>
              );
            })}
            {jobs.length === 0 && (
              <span style={hint}>{t('lore.product.vp.noJobs', 'работ пока нет — заведите через «+ Работа»')}</span>
            )}
          </div>
        </>
      )}

      {/* Чей это профиль. Без ответа VP-канва показывает боли всех сегментов в
          одном круге — а канон Остервальдера строится на ОДНОМ сегменте: боли
          водителя и боли механика рядом складываются в несуществующего
          клиента, и подгонка карты ценности к нему ничего не доказывает. */}
      <label style={label}>
        {kind === 'pain' && t('lore.product.vp.fieldFeltBy', 'Чья боль (акторы)')}
        {kind === 'gain' && t('lore.product.vp.fieldDesiredBy', 'Кто ждёт выгоду (акторы)')}
        {kind === 'job' && t('lore.product.vp.fieldPerformedBy', 'Кто выполняет работу (акторы)')}
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {actors.map(a => {
          const on = actorIds.includes(a.actor_id);
          return (
            <button
              key={a.actor_id}
              type="button"
              onClick={() => setActorIds(v => on ? v.filter(x => x !== a.actor_id) : [...v, a.actor_id])}
              aria-pressed={on}
              style={{
                padding: '2px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 'var(--fs-xs)',
                border: `1px solid ${on ? 'var(--wrn)' : 'var(--bd)'}`,
                background: on ? 'var(--bg2)' : 'transparent',
                color: on ? 'var(--t1)' : 'var(--t2)',
              }}
            >
              {a.name ?? a.actor_id}
            </button>
          );
        })}
        {actors.length === 0 && (
          <span style={hint}>{t('lore.product.vp.noActors', 'акторов пока нет — заведите на экране «Клиент»')}</span>
        )}
      </div>
      {actorIds.length === 0 && actors.length > 0 && (
        // Предупреждение, а не запрет: запись заведётся, но в фильтр канвы по
        // сегменту не попадёт и будет видна только в режиме «все акторы».
        <div style={{ ...hint, color: 'var(--wrn)' }}>
          ⚠ {t('lore.product.vp.noActorWarn', 'без актора запись не попадёт в профиль конкретного клиента')}
        </div>
      )}

      {/* body_md — НАШ редактор, а не голая textarea: поле markdown-ное, и во
          всех прочих редакторах корпуса стоит TipTapField (MD + Mermaid).
          Картинки выключены, как у прозаических полей. */}
      <label style={label}>{t('lore.product.vp.fieldBody', 'Описание')}</label>
      <TipTapField
        value={body}
        onChange={setBody}
        minHeight={84}
        enableImages={false}
        enableHtmlMode={false}
        ariaLabel={t('lore.product.vp.fieldBody', 'Описание')}
      />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={close} style={{ ...field, width: 'auto', cursor: 'pointer' }}>
          {t('lore.product.vp.cancel', 'Отмена')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!finalId || saving}
          style={{
            ...field, width: 'auto', cursor: finalId && !saving ? 'pointer' : 'not-allowed',
            background: finalId && !saving ? 'var(--acc)' : 'var(--bg3)',
            color: finalId && !saving ? 'var(--bg0)' : 'var(--t3)',
            borderColor: 'transparent', fontWeight: 600,
          }}
        >
          {saving ? '…' : editing ? t('lore.product.vp.save', 'Сохранить') : t('lore.product.vp.create', 'Создать')}
        </button>
      </div>
    </Modal>
  );
}
