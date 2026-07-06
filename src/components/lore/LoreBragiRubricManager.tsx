// LoreBragiRubricManager — compact admin block for the rubric classifier
// (SPRINT_BRAGI_ARCHIVE_FOLLOWUP). Fixed list, manually assigned per-item
// (see LoreBragiKeywordEditor/LoreBragiPublicationEditor's rubric select) —
// this is just the CRUD for the list itself, not an assignment UI. Lives at
// the top of the "Ключи" tab since rubrics classify both keywords and
// publications and there's no dedicated top-level menu slot for it (the
// 8-item BRAGI menu mirrors the prototype 1:1 — adding a 9th tab for a
// rarely-touched admin list isn't worth breaking that).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loreMutate } from '../../api/lore';

export interface RubricRow { rubric_id: string; name: string; description: string | null; order_index: number | null }

export interface LoreBragiRubricManagerProps {
  rubrics: RubricRow[];
  onChanged: () => void;
}

export default function LoreBragiRubricManager({ rubrics, onChanged }: LoreBragiRubricManagerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => { if (!open) { setId(''); setName(''); setDescription(''); setErrMsg(null); } }, [open]);

  const handleAdd = async () => {
    const rid = id.trim();
    if (!rid) { setErrMsg(t('bragi.rubricManager.errId', 'ID рубрики обязателен')); return; }
    if (!name.trim()) { setErrMsg(t('bragi.rubricManager.errName', 'Название обязательно')); return; }
    setSaving(true);
    setErrMsg(null);
    try {
      await loreMutate('/bragi/rubric', {
        rubric_id: rid, name: name.trim(), description: description || undefined,
        order_index: rubrics.length,
      });
      setOpen(false);
      onChanged();
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.card}>
      <div style={S.head}>
        <span style={S.title}>{t('bragi.rubricManager.header', 'рубрикатор')}</span>
        <button style={S.addBtn} onClick={() => setOpen(o => !o)}>{open ? t('bragi.rubricManager.cancel', 'отмена') : t('bragi.rubricManager.addToggle', '+ рубрика')}</button>
      </div>
      <div style={S.chips}>
        {rubrics.map(r => (
          <span key={r.rubric_id} style={S.chip} title={r.description ?? undefined}>{r.name}</span>
        ))}
        {rubrics.length === 0 && !open && <span style={S.hint}>{t('bragi.rubricManager.emptyHint', 'рубрик пока нет — можно добавить в форме публикации/ключа')}</span>}
      </div>
      {open && (
        <div style={S.form}>
          {errMsg && <div style={S.err}>{errMsg}</div>}
          <input style={S.input} value={id} placeholder={t('bragi.rubricManager.idPlaceholder', 'RUB-XXX')} onChange={e => setId(e.target.value)} />
          <input style={S.input} value={name} placeholder={t('bragi.rubricManager.namePlaceholder', 'Название рубрики')} onChange={e => setName(e.target.value)} />
          <input style={S.input} value={description} placeholder={t('bragi.rubricManager.descPlaceholder', 'Описание (опц.)')} onChange={e => setDescription(e.target.value)} />
          <button style={S.saveBtn} onClick={handleAdd} disabled={saving}>{saving ? '…' : t('bragi.rubricManager.addBtn', 'добавить')}</button>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  card:  { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 },
  head:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  addBtn:{ fontSize: 11, color: 'var(--t2)', background: 'transparent', border: '1px solid var(--b3)',
           borderRadius: 5, padding: '3px 9px', cursor: 'pointer' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  chip:  { fontSize: 11, color: 'var(--acc)', background: 'color-mix(in srgb, var(--acc) 14%, transparent)',
           border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)', borderRadius: 6, padding: '2px 8px' },
  hint:  { fontSize: 11, color: 'var(--t3)' },
  form:  { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' },
  input: { height: 26, padding: '0 8px', borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--bg0)',
           color: 'var(--t1)', fontSize: 11.5, fontFamily: 'inherit', outline: 'none', minWidth: 130 },
  saveBtn:{ height: 26, padding: '0 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
            background: 'var(--acc)', color: '#fff', fontSize: 11, fontWeight: 600 },
  err:   { fontSize: 10.5, color: 'var(--dng)', width: '100%' },
};
