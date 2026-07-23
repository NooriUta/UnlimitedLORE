// Форма пользовательской истории (PL-17, ADR-LORE-027) — шаблон Кокберна
// + ЖИВОЙ линтер качества.
//
// До этой задачи US заводились только через MCP: продуктовый слой был read-only,
// а готовый бэкенд линтера (`/lore/uc/quality`) не звался из фронта НИ РАЗУ.
//
// Линтер зовём серверный, а не повторяем его правила здесь: одна и та же чистая
// функция судит и форму, и MCP, поэтому оценки не могут разойтись. Дублируй мы
// логику — расхождение появилось бы при первой правке одной из копий, и «в форме
// зелено, в ревью красно» стало бы нормой.
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import {
  saveLoreUc, checkLoreUcQuality,
  type LoreUcQualityResult,
} from '../../../api/lore';
import TipTapField from '../TipTapField';

/**
 * Скелеты сценария по весу (ADR-027 §5).
 *
 * Заголовки — КОНВЕНЦИЯ, которую матчит серверный линтер (`UcQuality`), а не
 * оформление: переименуй здесь «Триггер» — проверка перестанет находить секцию,
 * и форма начнёт подсовывать шаблон, который сама же считает неполным.
 */
export const COCKBURN_CASUAL = [
  '### Триггер',
  '_Что запускает сценарий._',
  '',
  '### Основной сценарий',
  '1. …',
  '2. …',
  '',
  '### Минимальные гарантии',
  '_Что истинно даже при неудаче._',
  '',
].join('\n');

export const COCKBURN_FULL = [
  '### Триггер',
  '_Что запускает сценарий._',
  '',
  '### Предусловия',
  '_Что должно быть истинно до старта._',
  '',
  '### Основной сценарий',
  '1. …',
  '2. …',
  '',
  '### Расширения',
  '_Ветвления вида «2a. …» — номер ссылается на шаг основного сценария._',
  '',
  '### Вариации',
  '_Технологические/данные-вариации (опционально)._',
  '',
  '### Минимальные гарантии',
  '_Что истинно даже при неудаче._',
  '',
  '### Гарантии успеха',
  '_Измеримый результат при успехе._',
  '',
].join('\n');

export const templateFor = (rigor: string) => (rigor === 'casual' ? COCKBURN_CASUAL : COCKBURN_FULL);

/**
 * Нормализация id: префикс определяет цвет строки и разбор паспорта.
 *
 * Корень получает `FEAT-`, сценарий — `US-`. Тип у них ОДИН (PL-28), но id
 * читают люди, и по префиксу высота узла видна без открытия записи. Уже
 * набранный префикс не трогаем: часть корпуса старше соглашения и заведена
 * как `UC-`, а приписка второго префикса создала бы ДУБЛЬ под новым id.
 */
export function normalizeUsId(raw: string, root = false): string {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (!v) return '';
  if (/^(US|UC|FEAT)-/.test(v)) return v;
  return (root ? 'FEAT-' : 'US-') + v;
}

export interface UsDraft {
  uc_id: string;
  title?: string | null;
  scenario_md?: string | null;
  acceptance_md?: string | null;
  goal_level?: string | null;
  rigor?: string | null;
  parent_uc_id?: string | null;
}

export default function UsFormModal({
  opened, onClose, onSaved, onError, initial, parentUcId, root = false,
}: {
  opened: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  onError: (e: unknown) => void;
  /** задан — правка: id заблокирован, поля предзаполнены */
  initial?: UsDraft;
  /** корень, под которым заводится новый сценарий (DECOMPOSES_INTO) */
  parentUcId?: string | null;
  /**
   * true — заводим КОРЕНЬ («фичу»): те же поля, только высота из верхней
   * половины шкалы. Отдельной формы у корня нет намеренно — после PL-28 это
   * один тип с само-иерархией, и вторая форма означала бы, что слияние типов
   * существует только в схеме.
   */
  root?: boolean;
}) {
  const { t } = useTranslation();
  const editing = !!initial;

  const [id, setId] = useState(initial?.uc_id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [goalLevel, setGoalLevel] = useState(initial?.goal_level ?? (root ? 'cloud' : 'sea-level'));
  const [rigor, setRigor] = useState(initial?.rigor ?? 'casual');
  const [scenario, setScenario] = useState(initial?.scenario_md ?? '');
  const [acceptance, setAcceptance] = useState(initial?.acceptance_md ?? '');
  const [saving, setSaving] = useState(false);
  const [quality, setQuality] = useState<LoreUcQualityResult | null>(null);

  useEffect(() => {
    setId(initial?.uc_id ?? '');
    setTitle(initial?.title ?? '');
    setGoalLevel(initial?.goal_level ?? 'sea-level');
    setRigor(initial?.rigor ?? 'casual');
    setScenario(initial?.scenario_md ?? '');
    setAcceptance(initial?.acceptance_md ?? '');
  }, [initial]);

  // ── живой линтер ──
  //
  // Debounce 400мс и отмена предыдущего запроса: без отмены ответы гонятся, и
  // панель показывает оценку УСТАРЕВШЕГО текста — худший вид вранья, потому что
  // выглядит свежим. Пустое тело не шлём: чек-лист «всё красное» на ещё не
  // начатой форме читается как поломка, а не как приглашение писать.
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!opened) return;
    if (!scenario.trim() && !acceptance.trim()) { setQuality(null); return; }
    const timer = setTimeout(() => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      checkLoreUcQuality(
        {
          rigor, goal_level: goalLevel,
          scenario_md: scenario, acceptance_md: acceptance,
          // Рёбер у несозданного UC нет; у сохранённого их считает сервер по
          // uc_id — здесь честно false, и обе проверки идут подсказками.
          has_primary_actor: false, has_traced_to: false,
        },
        ctrl.signal,
      )
        .then(setQuality)
        .catch(() => { /* линтер advisory: молчим, форма остаётся рабочей */ });
    }, 400);
    return () => clearTimeout(timer);
  }, [opened, scenario, acceptance, rigor, goalLevel]);

  const finalId = editing ? (initial?.uc_id ?? '') : normalizeUsId(id, root);

  const submit = async () => {
    if (!finalId || saving) return;
    setSaving(true);
    try {
      await saveLoreUc({
        uc_id: finalId,
        title: title || undefined,
        scenario_md: scenario || undefined,
        acceptance_md: acceptance || undefined,
        goal_level: (goalLevel || undefined) as 'sea-level' | 'subfunction' | undefined,
        rigor: (rigor || undefined) as 'casual' | 'fully-dressed' | undefined,
        // Родитель только при СОЗДАНИИ: смена родителя у существующего — это
        // перенос в другой корень, отдельное действие, а не побочный эффект
        // сохранения тела.
        ...(editing || !parentUcId ? {} : { parent_uc_id: parentUcId }),
      });
      onSaved(finalId);
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

  const insertTemplate = () => {
    const tpl = templateFor(rigor);
    // Не затираем набранное: шаблон дописывается, иначе одна кнопка стирала бы
    // текст, который писали десять минут.
    setScenario(prev => (prev.trim() ? prev.replace(/\s*$/, '\n\n') + tpl : tpl));
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? `${t('lore.product.us.edit', 'Правка')} · ${finalId}` : (root ? t('lore.product.us.newRoot', '+ Фича') : t('lore.product.us.new', '+ История'))}
      size={720}
    >
      {!editing && (
        <>
          <label style={{ ...label, marginTop: 0 }}>ID</label>
          <input
            style={{ ...field, fontFamily: 'var(--mono)' }}
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder={root ? 'FEAT-GITCYCLE' : 'US-GIT-MERGE'}
          />
          <div style={hint}>
            {root
              ? t('lore.product.us.idRuleRoot', 'FEAT-‹ОБЛАСТЬ›-‹ЦЕЛЬ›, латиницей через дефис: FEAT-GITCYCLE')
              : t('lore.product.us.idRule', 'US-‹ОБЛАСТЬ›-‹ДЕЙСТВИЕ›, латиницей через дефис: US-GIT-MERGE')}
          </div>
          {id.trim() && finalId !== id.trim().toUpperCase() && (
            <div style={{ ...hint, fontFamily: 'var(--mono)' }}>→ {finalId}</div>
          )}
          {parentUcId && (
            <div style={hint}>
              {t('lore.product.us.underRoot', 'Заводится под корнем')}: <span style={{ fontFamily: 'var(--mono)' }}>{parentUcId}</span>
            </div>
          )}
        </>
      )}

      <label style={editing ? { ...label, marginTop: 0 } : label}>{t('lore.product.us.title', 'Заголовок')}</label>
      <input style={field} value={title} onChange={e => setTitle(e.target.value)} />

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>{t('lore.product.us.goalLevel', 'Уровень цели (Кокберн)')}</label>
          <select style={field} value={goalLevel} onChange={e => setGoalLevel(e.target.value)}>
            {root ? (
              <>
                <option value="cloud">☁ {t('lore.product.vocab.goalLevel.cloud', 'облако')}</option>
                <option value="kite">🪁 {t('lore.product.vocab.goalLevel.kite', 'воздушный змей')}</option>
              </>
            ) : (
              <>
                <option value="sea-level">🌊 {t('lore.product.vocab.goalLevel.sea-level', 'уровень моря')}</option>
                <option value="subfunction">🐟 {t('lore.product.vocab.goalLevel.subfunction', 'подфункция')}</option>
              </>
            )}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>{t('lore.product.us.rigor', 'Вес изложения')}</label>
          <select style={field} value={rigor} onChange={e => setRigor(e.target.value)}>
            <option value="casual">⚡ {t('lore.product.vocab.rigor.casual', 'облегчённый')}</option>
            <option value="fully-dressed">📋 {t('lore.product.vocab.rigor.fully-dressed', 'полный')}</option>
          </select>
        </div>
      </div>
      {/* Вес меняет ЗНАМЕНАТЕЛЬ линтера, а не только шаблон: у casual часть
          проверок становится подсказкой. Сказать это явно дешевле, чем оставить
          пользователя гадать, почему счёт скакнул при переключении. */}
      <div style={hint}>{t('lore.product.us.rigorHint', 'Вес задаёт, какие проверки обязательны: у облегчённого их меньше')}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
        <span style={{ ...label, marginTop: 0, marginBottom: 0 }}>{t('lore.product.us.scenario', 'Сценарий')}</span>
        <button
          type="button"
          onClick={insertTemplate}
          style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px dashed var(--bd)', color: 'var(--t2)' }}
        >
          {t('lore.product.us.insertTemplate', 'вставить шаблон Кокберна')}
        </button>
      </div>
      <TipTapField
        value={scenario}
        onChange={setScenario}
        minHeight={180}
        enableImages={false}
        enableHtmlMode={false}
        ariaLabel={t('lore.product.us.scenario', 'Сценарий')}
      />

      <label style={label}>{t('lore.product.us.acceptance', 'Приёмка')}</label>
      <TipTapField
        value={acceptance}
        onChange={setAcceptance}
        minHeight={110}
        enableImages={false}
        enableHtmlMode={false}
        ariaLabel={t('lore.product.us.acceptance', 'Приёмка')}
      />

      {/* ── панель линтера ── */}
      {quality && (
        <div style={{ marginTop: 12, border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', background: 'var(--bg1)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--t2)' }}>
              {t('lore.product.us.quality', 'Оформление по Кокберну')}
            </span>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)',
              color: quality.score === quality.max ? 'var(--suc)' : 'var(--wrn)',
            }}>
              {quality.score}/{quality.max}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--t3)', marginLeft: 'auto' }}>
              {/* Линтер advisory (D14): сохранить можно всегда. Без этой строки
                  красный чек-лист читается как запрет сохранения. */}
              {t('lore.product.us.advisory', 'подсказка — сохранить можно и так')}
            </span>
          </div>
          {quality.findings.map(f => (
            <div key={f.code} style={{
              display: 'flex', gap: 6, fontSize: 'var(--fs-sm)', padding: '1px 0',
              color: f.ok ? 'var(--t3)' : f.required ? 'var(--wrn)' : 'var(--t3)',
              opacity: f.ok ? 0.65 : 1,
            }}>
              <span style={{ width: 12 }}>{f.ok ? '✓' : f.required ? '⚠' : '·'}</span>
              <span>{f.message}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>
          {t('lore.product.us.cancel', 'Отмена')}
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
          {saving ? '…' : editing ? t('lore.product.us.save', 'Сохранить') : t('lore.product.us.create', 'Создать')}
        </button>
      </div>
    </Modal>
  );
}
