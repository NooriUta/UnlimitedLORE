// LoreBragiIntegrationEditor — FE-08: create/amend a BragiIntegration.
// Wraps bragi_integration_new (MCP-04) via its backend endpoint directly
// (same convention as LoreBragiPublicationEditor). Mirrors the backend's
// secret_ref guard (^(env|vault|oauth|secret):.+) client-side so the user
// gets an inline hint before submitting, not just a 400 after the fact.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loreMutate } from '../../api/lore';

const SECRET_REF_RE = /^(env|vault|oauth|secret):.+/;

const PURPOSES = ['read', 'write', 'read/write'];
const STATUSES = ['active', 'needs_admin', 'inactive'];

/** Shape of an existing row (from the bragi_integrations slice) — passed in to edit. */
export interface LoreBragiIntegrationEditData {
  integration_id: string;
  service: string | null;
  purpose: string | null;
  endpoint?: string | null;
  scope?: string | null;
  secret_ref: string | null;
  status: string | null;
}

export interface LoreBragiIntegrationEditorProps {
  onSaved: (integrationId: string) => void;
  onCancel: () => void;
  editing?: LoreBragiIntegrationEditData;
}

export default function LoreBragiIntegrationEditor({ onSaved, onCancel, editing }: LoreBragiIntegrationEditorProps) {
  const { t } = useTranslation();
  const [integrationId, setIntegrationId] = useState(editing?.integration_id ?? '');
  const [service, setService] = useState(editing?.service ?? '');
  const [purpose, setPurpose] = useState(editing?.purpose ?? 'read');
  const [endpoint, setEndpoint] = useState(editing?.endpoint ?? '');
  const [scope, setScope] = useState(editing?.scope ?? '');
  const [secretRef, setSecretRef] = useState(editing?.secret_ref ?? '');
  const [status, setStatus] = useState(editing?.status ?? 'active');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const secretValid = secretRef === '' || SECRET_REF_RE.test(secretRef);

  const handleSave = async () => {
    const id = integrationId.trim();
    if (!id) { setErrMsg(t('bragi.integrationEditor.errIntegrationId', 'Integration ID обязателен')); return; }
    if (secretRef && !secretValid) {
      setErrMsg(t('bragi.integrationEditor.errSecretRef', 'secret_ref должен быть ссылкой: "env:X" / "vault:X" / "oauth:X" / "secret:X" — не значением токена'));
      return;
    }
    setSaving(true);
    setErrMsg(null);
    try {
      await loreMutate('/bragi/integration', {
        integration_id: id, service: service || undefined, purpose: purpose || undefined,
        endpoint: endpoint || undefined, scope: scope || undefined,
        secret_ref: secretRef || undefined, status: status || undefined,
      });
      onSaved(id);
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
      setSaving(false);
    }
  };

  return (
    <div style={S.root}>
      <div style={S.head}>
        <span style={S.title}>{editing ? t('bragi.integrationEditor.titleEdit', 'Редактирование интеграции') : t('bragi.integrationEditor.titleNew', 'Новая интеграция')}</span>
        <div style={S.headBtns}>
          <button style={S.btnGhost} onClick={onCancel} disabled={saving}>{t('bragi.integrationEditor.cancel', 'Отмена')}</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? t('bragi.integrationEditor.saving', 'Сохранение…') : t('bragi.integrationEditor.save', 'Сохранить')}
          </button>
        </div>
      </div>

      {errMsg && <div style={S.errBanner}>{errMsg}</div>}

      <div style={S.row4}>
        <Field label={t('bragi.integrationEditor.integrationId', 'Integration ID')} grow={1}>
          <input
            style={{ ...S.input, opacity: editing ? 0.6 : 1 }}
            value={integrationId}
            placeholder="INT-METRIKA"
            disabled={!!editing}
            onChange={e => setIntegrationId(e.target.value)}
          />
        </Field>
        <Field label={t('bragi.integrationEditor.service', 'Сервис')} grow={2}>
          <input style={S.input} value={service} placeholder="Яндекс.Метрика 110154828" onChange={e => setService(e.target.value)} />
        </Field>
        <Field label={t('bragi.integrationEditor.purposeLabel', 'Назначение')} grow={1}>
          <select style={S.input} value={purpose} onChange={e => setPurpose(e.target.value)}>
            {PURPOSES.map(p => <option key={p} value={p}>{t('bragi.integrationEditor.purpose.' + p.replace('/', '_'), p)}</option>)}
          </select>
        </Field>
        <Field label={t('bragi.integrationEditor.statusLabel', 'Статус')} grow={1}>
          <select style={S.input} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{t('bragi.integrationEditor.status.' + s, s)}</option>)}
          </select>
        </Field>
      </div>

      <div style={S.row4}>
        <Field label={t('bragi.integrationEditor.endpoint', 'Endpoint')} grow={1}>
          <input style={S.input} value={endpoint} onChange={e => setEndpoint(e.target.value)} />
        </Field>
        <Field label={t('bragi.integrationEditor.scope', 'Scope')} grow={1}>
          <input style={S.input} value={scope} onChange={e => setScope(e.target.value)} />
        </Field>
      </div>

      <Field label={t('bragi.integrationEditor.secretLabel', 'Секрет — ссылка, НЕ значение')} grow={1}>
        <input
          style={{ ...S.input, borderColor: secretValid ? 'var(--b3)' : 'var(--dng)' }}
          value={secretRef}
          placeholder="env:METRIKA_TOKEN"
          onChange={e => setSecretRef(e.target.value)}
        />
        <div style={secretValid ? S.secretHint : S.secretHintWarn}>
          {secretValid
            ? t('bragi.integrationEditor.secretHintOk', '⚠️ Никогда не вставлять сам токен — только ссылку вида env:X / vault:X / oauth:X / secret:X')
            : t('bragi.integrationEditor.secretHintWarn', '✕ Похоже на значение, а не на ссылку. Формат: env:X / vault:X / oauth:X / secret:X')}
        </div>
      </Field>
    </div>
  );
}

function Field({ label, grow, children }: { label: string; grow: number; children: React.ReactNode }) {
  return (
    <div style={{ ...S.field, flex: grow }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root:     { flex: 1, overflowY: 'auto', padding: '14px 20px 40px', fontFamily: 'var(--font)', fontSize: 'var(--fs-base)' },
  head:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
  title:    { fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)' },
  headBtns: { display: 'flex', gap: 8 },
  errBanner:{ marginBottom: 10, padding: '6px 10px', borderRadius: 5, fontSize: 'var(--fs-sm)',
              background: 'color-mix(in srgb, var(--dng) 12%, transparent)',
              color: 'var(--dng)', border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)' },
  row4:     { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  field:    { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 },
  label:    { fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:    { height: 28, padding: '0 8px', borderRadius: 4, border: '1px solid var(--b3)',
              background: 'var(--b1)', color: 'var(--t1)', fontSize: 'var(--fs-base)', fontFamily: 'inherit',
              outline: 'none', width: '100%', boxSizing: 'border-box' },
  secretHint:    { fontSize: 'var(--fs-xs)', color: 'var(--wrn)', marginTop: 5 },
  secretHintWarn:{ fontSize: 'var(--fs-xs)', color: 'var(--dng)', marginTop: 5 },
  btnPrimary:{ height: 28, padding: '0 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
               background: 'var(--acc)', color: 'var(--on-accent)', fontSize: 'var(--fs-base)', fontWeight: 600 },
  btnGhost:  { height: 28, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
               background: 'transparent', color: 'var(--t2)', border: '1px solid var(--b3)', fontSize: 'var(--fs-base)' },
};
