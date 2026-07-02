// LoreBragiIntegrationEditor — FE-08: create/amend a BragiIntegration.
// Wraps lore_create_integration (MCP-04) via its backend endpoint directly
// (same convention as LoreBragiPublicationEditor). Mirrors the backend's
// secret_ref guard (^(env|vault|oauth|secret):.+) client-side so the user
// gets an inline hint before submitting, not just a 400 after the fact.
import { useState } from 'react';

const LORE_BASE = '/lore';
const SECRET_REF_RE = /^(env|vault|oauth|secret):.+/;

async function post(path: string, body: unknown): Promise<{ ok: boolean; [k: string]: unknown }> {
  const res = await fetch(`${LORE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { detail?: string }).detail ?? `POST ${path} → ${res.status}`);
  return json as { ok: boolean };
}

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
    if (!id) { setErrMsg('Integration ID обязателен'); return; }
    if (secretRef && !secretValid) {
      setErrMsg('secret_ref должен быть ссылкой: "env:X" / "vault:X" / "oauth:X" / "secret:X" — не значением токена');
      return;
    }
    setSaving(true);
    setErrMsg(null);
    try {
      await post('/bragi/integration', {
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
        <span style={S.title}>{editing ? 'Редактирование интеграции' : 'Новая интеграция'}</span>
        <div style={S.headBtns}>
          <button style={S.btnGhost} onClick={onCancel} disabled={saving}>Отмена</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>

      {errMsg && <div style={S.errBanner}>{errMsg}</div>}

      <div style={S.row4}>
        <Field label="Integration ID" grow={1}>
          <input
            style={{ ...S.input, opacity: editing ? 0.6 : 1 }}
            value={integrationId}
            placeholder="INT-METRIKA"
            disabled={!!editing}
            onChange={e => setIntegrationId(e.target.value)}
          />
        </Field>
        <Field label="Сервис" grow={2}>
          <input style={S.input} value={service} placeholder="Яндекс.Метрика 110154828" onChange={e => setService(e.target.value)} />
        </Field>
        <Field label="Назначение" grow={1}>
          <select style={S.input} value={purpose} onChange={e => setPurpose(e.target.value)}>
            {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Статус" grow={1}>
          <select style={S.input} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <div style={S.row4}>
        <Field label="Endpoint" grow={1}>
          <input style={S.input} value={endpoint} onChange={e => setEndpoint(e.target.value)} />
        </Field>
        <Field label="Scope" grow={1}>
          <input style={S.input} value={scope} onChange={e => setScope(e.target.value)} />
        </Field>
      </div>

      <Field label="Секрет — ссылка, НЕ значение" grow={1}>
        <input
          style={{ ...S.input, borderColor: secretValid ? 'var(--b3)' : 'var(--dng)' }}
          value={secretRef}
          placeholder="env:METRIKA_TOKEN"
          onChange={e => setSecretRef(e.target.value)}
        />
        <div style={secretValid ? S.secretHint : S.secretHintWarn}>
          {secretValid
            ? '⚠️ Никогда не вставлять сам токен — только ссылку вида env:X / vault:X / oauth:X / secret:X'
            : '✕ Похоже на значение, а не на ссылку. Формат: env:X / vault:X / oauth:X / secret:X'}
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
  root:     { flex: 1, overflowY: 'auto', padding: '14px 20px 40px', fontFamily: 'var(--font)', fontSize: 12 },
  head:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
  title:    { fontSize: 14, fontWeight: 600, color: 'var(--t1)' },
  headBtns: { display: 'flex', gap: 8 },
  errBanner:{ marginBottom: 10, padding: '6px 10px', borderRadius: 5, fontSize: 11,
              background: 'color-mix(in srgb, var(--dng) 12%, transparent)',
              color: 'var(--dng)', border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)' },
  row4:     { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  field:    { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 },
  label:    { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:    { height: 28, padding: '0 8px', borderRadius: 4, border: '1px solid var(--b3)',
              background: 'var(--b1)', color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit',
              outline: 'none', width: '100%', boxSizing: 'border-box' },
  secretHint:    { fontSize: 10.5, color: 'var(--wrn)', marginTop: 5 },
  secretHintWarn:{ fontSize: 10.5, color: 'var(--dng)', marginTop: 5 },
  btnPrimary:{ height: 28, padding: '0 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
               background: 'var(--acc)', color: '#fff', fontSize: 12, fontWeight: 600 },
  btnGhost:  { height: 28, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
               background: 'transparent', color: 'var(--t2)', border: '1px solid var(--b3)', fontSize: 12 },
};
