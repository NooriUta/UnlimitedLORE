// Форма сегмента клиента (актора) — PL-01/PL-18, ADR-LORE-022 D12/D18.
//
// Акторы заводились только через MCP `actor_new`. При этом именно они —
// вход в профиль Остервальдера: работы, боли и выгоды вешаются НА сегмент, и
// без возможности завести сегмент из UI весь профиль оставался read-only.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import { saveLoreActor } from '../../../api/lore';
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
  project?: string | null;
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
  const [project, setProject] = useState(initial?.project ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setId(initial?.actor_id ?? '');
    setName(initial?.name ?? '');
    setKind(initial?.kind ?? 'human-role');
    setBody(initial?.body_md ?? '');
    setProject(initial?.project ?? '');
  }, [initial]);

  const finalId = editing ? (initial?.actor_id ?? '') : normalizeActorId(id);

  const submit = async () => {
    if (!finalId || saving) return;
    setSaving(true);
    try {
      await saveLoreActor({
        actor_id: finalId,
        name: name || undefined,
        kind: (kind || undefined) as 'human-role' | 'system' | 'agent' | undefined,
        body_md: body || undefined,
        project: project || undefined,
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
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
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
        <option value="agent">{t('lore.product.vocab.actorKind.agent', 'агент')}</option>
        <option value="system">{t('lore.product.vocab.actorKind.system', 'система')}</option>
      </select>

      <label style={label}>{t('lore.product.actor.project', 'Проект')}</label>
      <input style={{ ...field, fontFamily: 'var(--mono)' }} value={project} onChange={e => setProject(e.target.value)} placeholder="AIDA/UnlimitedLORE" />
      {/* D18: актор ПРОЕКТНЫЙ. Схема проект не требует, но одноимённые роли
          разных продуктов без него склеиваются в одну строку RBAC-матрицы —
          поэтому подсказка стоит здесь, а не в документации, куда не смотрят. */}
      <div style={hint}>{t('lore.product.actor.projectHint', 'без проекта одноимённые роли разных продуктов сольются в одну')}</div>

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
