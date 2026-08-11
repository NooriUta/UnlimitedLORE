import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withStrictTools } from './strictTool.js';

// Fake double, same pattern as registration.test.ts's fakeServer() — records
// registerTool() calls (the wrapper's actual dispatch target) instead of
// tool() calls, since that's what withStrictTools re-routes through.
function fakeServer() {
  const calls: { name: string; config: { description?: string; inputSchema?: z.ZodTypeAny; annotations?: unknown } }[] = [];
  const server = {
    registerTool: (name: string, config: unknown) => {
      calls.push({ name, config: config as never });
      return undefined;
    },
  } as unknown as McpServer;
  return { server: withStrictTools(server), calls };
}

describe('withStrictTools', () => {
  it('rejects an unrecognized parameter that a permissive schema would have silently dropped', () => {
    const { server, calls } = fakeServer();
    (server.tool as (...a: unknown[]) => unknown)(
      'uc_link', 'desc', { uc_id: z.string(), actor_role: z.string().optional() }, () => {},
    );
    const schema = calls[0].config.inputSchema!;
    // The bug this guards against: MT-09 found nine live calls that sent `role`
    // instead of `actor_role` and got ok:true with a wrong default — a plain
    // z.object() strips the unrecognized key instead of erroring.
    const result = schema.safeParse({ uc_id: 'UC-1', role: 'primary' });
    expect(result.success).toBe(false);
  });

  it('still accepts a call using only the declared parameters', () => {
    const { server, calls } = fakeServer();
    (server.tool as (...a: unknown[]) => unknown)(
      'uc_link', 'desc', { uc_id: z.string(), actor_role: z.string().optional() }, () => {},
    );
    const schema = calls[0].config.inputSchema!;
    expect(schema.safeParse({ uc_id: 'UC-1', actor_role: 'primary' }).success).toBe(true);
    expect(schema.safeParse({ uc_id: 'UC-1' }).success).toBe(true);
  });

  it('passes the tool name and description through unchanged', () => {
    const { server, calls } = fakeServer();
    (server.tool as (...a: unknown[]) => unknown)('status_set', 'set status', { id: z.string() }, () => {});
    expect(calls[0].name).toBe('status_set');
    expect(calls[0].config.description).toBe('set status');
  });

  it('handles the schema-less overload (name, description, handler) without a schema', () => {
    const { server, calls } = fakeServer();
    (server.tool as (...a: unknown[]) => unknown)('no_params_tool', 'desc', () => {});
    expect(calls[0].name).toBe('no_params_tool');
    expect(calls[0].config.inputSchema).toBeUndefined();
  });

  it('passes annotations through when given (name, schema, annotations, handler)', () => {
    const { server, calls } = fakeServer();
    const annotations = { readOnlyHint: true };
    (server.tool as (...a: unknown[]) => unknown)('reader', { q: z.string() }, annotations, () => {});
    expect(calls[0].config.annotations).toEqual(annotations);
    expect(calls[0].config.inputSchema!.safeParse({ q: 'x', extra: 1 }).success).toBe(false);
  });
});
