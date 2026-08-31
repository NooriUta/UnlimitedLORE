// Форма сегмента клиента (актора) — PL-01/PL-18, ADR-LORE-022 D12/D18.
//
// Акторы заводились только через MCP `actor_new`. При этом именно они —
// вход в профиль Остервальдера: работы, боли и выгоды вешаются НА сегмент, и
// без возможности завести сегмент из UI весь профиль оставался read-only.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import { fetchLoreSlice, saveLoreActor } from '../../../api/lore';
import { LoreLinkChips } from '../LoreLinkChips';
import TipTapField from '../TipTapField';

/** Нормализация id к виду `ACT-…` — префикс задаёт цвет и разбор паспорта. */
export function normalizeActorId(raw: string): string {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (!v) return '';
  return v.startsWith('ACT-') ? v : 'ACT-' + v;
}

export interface ActorDraft {
  actor_id: string;
  name?: string | null;
  kind?: string | null;
  body_md?: string | null;
  /** AL-107: набор проектов, а не один. */
  projects?: string[];
}

export default function ActorFormModal({
  opened, onClose, onSaved, onError, initial,
}: {
  opened: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  onError: (e: unknown) => void;
  initial?: ActorDraft;
}) {
  const { t } = useTranslation();
  const editing = !!initial;

  const [id, setId] = useState(initial?.actor_id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState(initial?.kind ?? 'human-role');
  const [body, setBody] = useState(initial?.body_md ?? '');
  /** Выбранные проекты актора. Именно НАБОР — см. AL-107. */
  const [picked, setPicked] = useState<string[]>(initial?.projects ?? []);
  const [projects, setProjects] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setId(initial?.actor_id ?? '');
    setName(initial?.name ?? '');
    setKind(initial?.kind ?? 'human-role');
    setBody(initial?.body_md ?? '');
    setPicked(initial?.projects ?? []);
  }, [initial]);

  // Слаги, которых нет в реестре: показать, а не подменить молча. Такой слаг
  // не даёт ошибки при записи — привязка просто не создаётся при ok:true.
  const unknown = picked.filter(p => projects.length > 0 && !projects.includes(p));

  // Список проектов для пикера. Грузится при открытии, а не при монтировании:
  // форма живёт в дереве постоянно, и запрос на каждый рендер списка акторов
  // был бы платой ни за что.
  useEffect(() => {
    if (!opened) return;
    const ctrl = new AbortController();
    fetchLoreSlice<{ slug: string }>('git_projects', {}, ctrl.signal)
      .then(ps => setProjects(ps.map(p => p.slug).filter(Boolean).sort()))
      .catch(() => { /* без списка остаётся текущее значение — форма рабочая */ });
    return () => ctrl.abort();
  }, [opened]);

  const finalId = editing ? (initial?.actor_id ?? '') : normalizeActorId(id);

  const submit = async () => {
    if (!finalId || saving) return;
    setSaving(true);
    try {
      await saveLoreActor({
        actor_id: finalId,
        name: name || undefined,
        kind: (kind || undefined) as 'human-role' | 'system' | 'automation' | undefined,
        body_md: body || undefined,
        // Шлём НАБОР всегда, даже пустой: пустой список — осознанное «убрать
        // все», а отсутствие ключа бэкенд трактует как «рёбра не трогать».
        // Разница существенная, поэтому ставим явно, а не через `|| undefined`.
        projects: picked,
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

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? `${t('lore.product.actor.edit', 'Правка')} · ${finalId}` : t('lore.product.actor.new', '+ Клиент')}
      size={560}
    >
      {!editing && (
        <>
          <label style={{ ...label, marginTop: 0 }}>ID</label>
          <input
            style={{ ...field, fontFamily: 'var(--mono)' }}
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="ACT-ARCHITECT"
          />
          <div style={hint}>
            {t('lore.product.actor.idRule', 'ACT-‹РОЛЬ›, латиницей через дефис: ACT-ARCHITECT')}
          </div>
          {id.trim() && finalId !== id.trim().toUpperCase() && (
            <div style={{ ...hint, fontFamily: 'var(--mono)' }}>→ {finalId}</div>
          )}
        </>
      )}

      <label style={editing ? { ...label, marginTop: 0 } : label}>{t('lore.product.actor.name', 'Название')}</label>
      <input style={field} value={name} onChange={e => setName(e.target.value)} />

      <label style={label}>{t('lore.product.actor.kind', 'Вид')}</label>
      <select style={field} value={kind} onChange={e => setKind(e.target.value)}>
        <option value="human-role">{t('lore.product.vocab.actorKind.human-role', 'человек')}</option>
        <option value="automation">{t('lore.product.vocab.actorKind.automation', 'автоматизация')}</option>
        <option value="system">{t('lore.product.vocab.actorKind.system', 'система')}</option>
      </select>

      <label style={label}>{t('lore.product.actor.projects', 'Проекты')}</label>
      {/* AL-107: МНОЖЕСТВО, а не один. Актор принадлежит нескольким продуктам,
          и слайс всегда отдавал их массивом — это форма схлопывала набор в
          один и молча теряла остальные. Контрол тот же, что у ADR и вопросов:
          чипы + выпадающий список, свободного ввода нет (несуществующий слаг
          не даёт ошибки, привязка просто не создаётся при ok:true). */}
      <LoreLinkChips
        label=""
        color="var(--suc)"
        values={picked}
        options={projects}
        onAdd={v => setPicked(prev => [...prev, v])}
        onRemove={v => setPicked(prev => prev.filter(x => x !== v))}
      />
      {/* D18: актор ПРОЕКТНЫЙ. Схема проект не требует, но одноимённые роли
          разных продуктов без него склеиваются в одну строку RBAC-матрицы —
          поэтому подсказка стоит здесь, а не в документации, куда не смотрят. */}
      <div style={hint}>{t('lore.product.actor.projectsHint', 'актор может принадлежать нескольким продуктам; без проекта одноимённые роли разных продуктов сольются в одну')}</div>
      {unknown.length > 0 && (
        <div style={{ ...hint, color: 'var(--wrn)' }}>
          {t('lore.product.actor.projectUnknownHint', 'нет в реестре: {{list}} — привязка не создастся, ответ при этом будет успешным', { list: unknown.join(', ') })}
        </div>
      )}

      <label style={label}>{t('lore.product.actor.about', 'О роли')}</label>
      <TipTapField
        value={body}
        onChange={setBody}
        minHeight={100}
        enableImages={false}
        enableHtmlMode={false}
        ariaLabel={t('lore.product.actor.about', 'О роли')}
      />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>
          {t('lore.product.actor.cancel', 'Отмена')}
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
          {saving ? '…' : editing ? t('lore.product.actor.save', 'Сохранить') : t('lore.product.actor.create', 'Создать')}
        </button>
      </div>
    </Modal>
  );
}
