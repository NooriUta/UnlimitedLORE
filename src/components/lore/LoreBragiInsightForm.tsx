// V2-05 (ТЗ: SPRINT_BRAGI_ARCHIVE_IMPL/ANA-03): мини-форма «зафиксировать вывод»
// под строкой ретро. id и обоснование подставлены (bragiInsight.ts), человек
// пишет только сам вывод и, если есть, куда он ведёт (задача/ADR → LED_TO).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TipTapField from './TipTapField';
import { loreMutate, describeLoreError } from '../../api/lore';

type LinkKind = 'none' | 'task' | 'adr';

export interface InsightFormProps {
  insightId: string;
  subjectId: string;
  evidence: string;
  onSaved: (insightId: string) => void;
  onCancel: () => void;
}

export default function LoreBragiInsightForm({ insightId, subjectId, evidence, onSaved, onCancel }: InsightFormProps) {
  const { t } = useTranslation();
  const [statement, setStatement] = useState('');
  const [linkKind, setLinkKind] = useState<LinkKind>('none');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Вывод записан, а связь — нет: показываем это отдельно, а не общей «ошибкой»,
  // иначе повтор создал бы вывод с тем же id поверх (upsert) и спрятал причину.
  const [savedWithoutLink, setSavedWithoutLink] = useState(false);

  const canSave = statement.trim().length > 0 && (linkKind === 'none' || target.trim().length > 0) && !busy;

  async function save() {
    setBusy(true); setError(null);
    try {
      if (!savedWithoutLink) {
        await loreMutate('/bragi/insight', {
          insight_id: insightId, statement_md: statement.trim(),
          insight_date: new Date().toISOString().slice(0, 10),
          evidence_ref: evidence, subject_id: subjectId,
        });
      }
      if (linkKind !== 'none') {
        try {
          await loreMutate('/bragi/insight/link', { insight_id: insightId, target_type: linkKind, target_id: target.trim() });
        } catch (e) {
          setSavedWithoutLink(true);
          setError(t('bragi.extras.insightForm.linkFailed', 'вывод {{id}} записан, связь не поставлена: {{err}}', { id: insightId, err: describeLoreError(e).text }));
          return;
        }
      }
      onSaved(insightId);
    } catch (e) {
      setError(describeLoreError(e).text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={S.id}>{insightId}</span>
        <span style={S.evidence} title={t('bragi.extras.insightForm.evidenceTitle', 'обоснование подставлено из строки')}>{evidence}</span>
      </div>
      <TipTapField
        value={statement}
        onChange={setStatement}
        placeholder={t('bragi.extras.insightForm.placeholder', 'что показали цифры и что из этого следует')}
        ariaLabel={t('bragi.extras.insightForm.statementLabel', 'вывод')}
        minHeight={60}
        enableImages={false}
        enableHtmlMode={false}
        editable={!savedWithoutLink}
      />
      <div style={S.row}>
        <label style={S.label}>
          {t('bragi.extras.insightForm.ledTo', 'ведёт к')}
          <select value={linkKind} onChange={e => setLinkKind(e.target.value as LinkKind)} style={S.input}>
            <option value="none">{t('bragi.extras.insightForm.ledNone', 'пока ни к чему')}</option>
            <option value="task">{t('bragi.extras.insightForm.ledTask', 'задаче')}</option>
            <option value="adr">{t('bragi.extras.insightForm.ledAdr', 'ADR')}</option>
          </select>
        </label>
        {linkKind !== 'none' && (
          <input value={target} onChange={e => setTarget(e.target.value)} style={{ ...S.input, flex: 1 }}
            placeholder={linkKind === 'task'
              ? t('bragi.extras.insightForm.taskPlaceholder', 'SPRINT_X/CODE')
              : t('bragi.extras.insightForm.adrPlaceholder', 'ADR-LORE-0NN')}
            aria-label={t('bragi.extras.insightForm.targetLabel', 'куда ведёт')} />
        )}
        <button type="button" onClick={save} disabled={!canSave} style={canSave ? S.primary : S.disabled}>
          {busy ? t('bragi.extras.insightForm.saving', 'записываю…') : t('bragi.extras.insightForm.save', 'зафиксировать')}
        </button>
        <button type="button" onClick={onCancel} style={S.ghost}>{t('bragi.extras.insightForm.cancel', 'отмена')}</button>
      </div>
      {error && <div role="alert" style={S.error}>{error}</div>}
    </div>
  );
}

const S = {
  wrap:     { padding: '10px 12px', background: 'var(--bg2)', borderLeft: '2px solid var(--acc)', display: 'flex', flexDirection: 'column' as const, gap: 8 },
  head:     { display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' as const },
  id:       { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--acc)' },
  evidence: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' },
  row:      { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const },
  label:    { display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)', color: 'var(--t2)' },
  input:    { background: 'var(--bg1)', color: 'var(--t1)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 6px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--mono)' },
  primary:  { background: 'var(--acc)', color: 'var(--bg0)', border: 'none', borderRadius: 999, padding: '4px 12px', fontSize: 'var(--fs-sm)', cursor: 'pointer' },
  disabled: { background: 'var(--bg3)', color: 'var(--t3)', border: 'none', borderRadius: 999, padding: '4px 12px', fontSize: 'var(--fs-sm)', cursor: 'not-allowed' },
  ghost:    { background: 'transparent', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 999, padding: '4px 12px', fontSize: 'var(--fs-sm)', cursor: 'pointer' },
  error:    { color: 'var(--dng)', fontSize: 'var(--fs-sm)' },
};
