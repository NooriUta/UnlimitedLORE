import { describe, expect, it } from 'vitest';
import {
  corePermission, fullPermission, gateFor, permissionForProfile,
  profileNameFromJwt,
} from './profile.js';

// SPRINT_LORE_MCP_V2/MCPV2-1+2: сужение поверхности инструментов по профилю
// конфига (LORE_MCP_PROFILE) и по роли клиента (agent_scope токена).

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf-8').toString('base64url');
const jwtWith = (claims: Record<string, unknown>) => `h.${b64url(claims)}.s`;

describe('profileNameFromJwt', () => {
  it('массив с agent- префиксом → имя профиля', () => {
    expect(profileNameFromJwt(jwtWith({ agent_scope: ['agent-full'] }))).toBe('full');
  });
  it('строка без префикса → как есть', () => {
    expect(profileNameFromJwt(jwtWith({ agent_scope: 'developer' }))).toBe('developer');
  });
  it('повтор маппера схлопывается — не неоднозначность', () => {
    expect(profileNameFromJwt(jwtWith({ agent_scope: ['agent-full', 'agent-full'] }))).toBe('full');
  });
  it('два РАЗНЫХ профиля — ambiguous (ошибка провижининга, отказ)', () => {
    expect(profileNameFromJwt(jwtWith({ agent_scope: ['agent-full', 'agent-tester'] }))).toBe('ambiguous');
  });
  it('нет клейма / битый JWT → null', () => {
    expect(profileNameFromJwt(jwtWith({}))).toBeNull();
    expect(profileNameFromJwt('not-a-jwt')).toBeNull();
  });
});

describe('gateFor', () => {
  it('full пропускает всё', () => {
    const gate = gateFor([fullPermission()]);
    expect(gate('task_new')).toBe(true);
    expect(gate('anything_at_all')).toBe(true);
  });
  it('core: чтение — можно, запись — нельзя', () => {
    const gate = gateFor([corePermission()]);
    for (const t of ['list_slices', 'query_slice', 'search', 'graph', 'quality_check', 'lore_version']) {
      expect(gate(t), t).toBe(true);
    }
    for (const t of ['task_new', 'status_set', 'adr_new', 'forgejo_pr_merge']) {
      expect(gate(t), t).toBe(false);
    }
  });
  it('последнее совпавшее правило побеждает (doc_del поверх doc_*)', () => {
    const gate = gateFor([{ '*': 'deny', 'doc_*': 'allow', 'doc_del': 'deny' }]);
    expect(gate('doc_new')).toBe(true);
    expect(gate('doc_del')).toBe(false);
  });
  it('пересечение осей: виден только разрешённый обеими', () => {
    const gate = gateFor([fullPermission(), corePermission()]);
    expect(gate('query_slice')).toBe(true);
    expect(gate('task_new')).toBe(false);
    const gate2 = gateFor([permissionForProfile('developer'), fullPermission()]);
    expect(gate2('task_new')).toBe(true);   // developer владеет task_*
    expect(gate2('doc_del')).toBe(false);   // developer: doc_del deny
    expect(gate2('adr_set')).toBe(false);   // developer владеет только adr_new
    expect(gate2('adr_new')).toBe(true);
  });
});

describe('permissionForProfile', () => {
  it('загружает agent-profiles/*.json (developer)', () => {
    const perm = permissionForProfile('developer');
    expect(perm['*']).toBe('deny');
    expect(perm['task_*']).toBe('allow');
  });
  it('неизвестный профиль — громкая ошибка, не молчаливый full', () => {
    expect(() => permissionForProfile('no-such-profile')).toThrow(/agent-profiles/);
  });
});
