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
import { saveLorePain, saveLoreGain, saveLoreJob } from '../../../api/lore';
import TipTapField from '../TipTapField';

export type VpKind = 'job' | 'pain' | 'gain';

const PREFIX: Record<VpKind, string> = { job: 'JOB-', pain: 'PAIN-', gain: 'GAIN-' };

/** Тип записи по её id — тем же префиксом, которым ветвится весь реестр. */
export function vpKindOf(id: string): VpKind | null {
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
export function normalizeVpId(kind: VpKind, raw: string): string {
  const prefix = PREFIX[kind];
  const v = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (!v) return '';
  return v.startsWith(prefix) ? v : prefix + v;
}

/** Значения, которыми форма открывается на правку существующей записи. */
export interface VpDraft {
  id: string;
  title?: string | null;
  body_md?: string | null;
  /** severity (боль) · metric_md (выгода) · importance (работа) */
  extra?: string | null;
  /** только у работы — тип по Остервальдеру */
  jobKind?: string | null;
}

export default function VpCreateModal({
  kind, opened, onClose, onCreated, onError, initial,
}: {
  kind: VpKind;
  opened: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  onError: (e: unknown) => void;
  /** задан — форма открыта на правку: id заблокирован, поля предзаполнены */
  initial?: VpDraft;
}) {
  const { t } = useTranslation();
  const editing = !!initial;

  const [id, setId] = useState(initial?.id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body_md ?? '');
  const [extra, setExtra] = useState(initial?.extra ?? '');
  const [jobKind, setJobKind] = useState(initial?.jobKind ?? '');
  const [saving, setSaving] = useState(false);

  // Предзаполнение приходит асинхронно (слайс мог ещё грузиться), поэтому
  // синхронизируем состояние с ним, а не только начальным значением: иначе
  // форма правки открывалась бы пустой и «сохранение» стирало бы поля.
  useEffect(() => {
    setId(initial?.id ?? '');
    setTitle(initial?.title ?? '');
    setBody(initial?.body_md ?? '');
    setExtra(initial?.extra ?? '');
    setJobKind(initial?.jobKind ?? '');
  }, [initial]);

  const finalId = editing ? (initial?.id ?? '') : normalizeVpId(kind, id);

  const reset = () => { setId(''); setTitle(''); setBody(''); setExtra(''); setJobKind(''); };
  const close = () => { if (!editing) reset(); onClose(); };

  const submit = async () => {
    if (!finalId || saving) return;
    setSaving(true);
    try {
      const common = { title: title || undefined, body_md: body || undefined };
      if (kind === 'pain') {
        await saveLorePain({ pain_id: finalId, ...common, severity: extra || undefined });
      } else if (kind === 'gain') {
        await saveLoreGain({ gain_id: finalId, ...common, metric_md: extra || undefined });
      } else {
        await saveLoreJob({ job_id: finalId, ...common, kind: jobKind || undefined, importance: extra || undefined });
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

  const titles: Record<VpKind, string> = {
    job: t('lore.product.vp.newJob', '+ Работа'),
    pain: t('lore.product.vp.newPain', '+ Боль'),
    gain: t('lore.product.vp.newGain', '+ Выгода'),
  };
  const idRules: Record<VpKind, string> = {
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
        </>
      ) : levelSelect}

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
