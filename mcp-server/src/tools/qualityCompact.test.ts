import { describe, expect, it } from 'vitest';
import { compactVerdicts } from './loreWrite.js';

// ADR-LORE-039 §2. Проверяется не «формат красивый», а два обещания, которые
// формовка обязана держать: OK схлопывается, а провал НИКОГДА не прячется.

const finding = (code: string, ok: boolean, required = true) =>
  ({ code, ok, required, message: `${code} — сообщение проверки` });

describe('compactVerdicts', () => {
  it('схлопывает пройденный вердикт в одну строку', () => {
    const out = compactVerdicts({
      ok: true,
      task_uid: 'SPRINT_X/A-1',
      quality: { kind: 'task', score: 2, max: 2, findings: [finding('status', true), finding('project', true)] },
    }) as { quality: string };
    expect(out.quality).toBe('task: все проверки ok (2/2)');
  });

  it('называет невыполненные подсказки хвостом, не роняя счёт', () => {
    const out = compactVerdicts({
      quality: {
        kind: 'sprint', score: 1, max: 1,
        findings: [finding('status', true), finding('milestone', false, false)],
      },
    }) as { quality: string };
    expect(out.quality).toBe('sprint: все проверки ok (1/1) · подсказки: milestone');
  });

  it('при провале отдаёт ТОЛЬКО проваленные — и обязательно с текстом', () => {
    const out = compactVerdicts({
      quality: {
        kind: 'task', score: 1, max: 3,
        findings: [finding('status', true), finding('effort_days', false), finding('component', false)],
      },
    }) as { quality: { ok: boolean; findings: { code: string; message: string }[] } };
    expect(out.quality.ok).toBe(false);
    expect(out.quality.findings.map(f => f.code)).toEqual(['effort_days', 'component']);
    // Код без сообщения заставляет лезть в документацию — решение владельца:
    // текст остаётся всегда.
    expect(out.quality.findings[0].message).toBe('effort_days — сообщение проверки');
    // Пройденное в разбор не попадает.
    expect(JSON.stringify(out)).not.toContain('status');
  });

  it('обрабатывает КАЖДЫЙ элемент batch-ответа, а не только корень', () => {
    const out = compactVerdicts({
      ok: true, updated: 2,
      items: [
        { task_uid: 'A', quality: { kind: 'task', score: 1, max: 1, findings: [finding('status', true)] } },
        { task_uid: 'B', quality: { kind: 'task', score: 0, max: 1, findings: [finding('status', false)] } },
      ],
    }) as { items: { quality: unknown }[] };
    expect(out.items[0].quality).toBe('task: все проверки ok (1/1)');
    expect((out.items[1].quality as { ok: boolean }).ok).toBe(false);
  });

  it('не трогает UC-вердикт: у него rigor, а не kind', () => {
    const uc = { rigor: 'fully-dressed', score: 3, max: 7, findings: [finding('goal', false)] };
    const out = compactVerdicts({ quality: uc }) as { quality: typeof uc };
    expect(out.quality).toEqual(uc);
  });

  it('оставляет обычный ответ без вердикта нетронутым', () => {
    const plain = { ok: true, adr_id: 'ADR-LORE-039', hist_created: false, body_written: true };
    expect(compactVerdicts(plain)).toEqual(plain);
  });
});
