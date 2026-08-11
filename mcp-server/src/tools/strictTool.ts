import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// MT-09: every tool below registers a raw Zod shape ({ foo: z.string() }), which
// the SDK wraps internally with a PLAIN z.object() — plain object schemas strip
// unknown keys silently instead of rejecting them (Zod default). Nine calls to
// uc_link with `role` where the tool expects `actor_role` returned ok:true with
// a wrong default (first-linked actor became primary) — no error, no clue in
// the response that the parameter was never read.
//
// Fix goes here, ONCE, not per call site: every server.tool(...) call routed
// through a server wrapped by withStrictTools ends up validated against
// z.object(shape).strict(), so an unrecognized key is a hard 400 naming the
// key, for every tool, including ones added later — nobody has to remember to
// opt in per tool.
//
// Implementation note: passing an ALREADY-BUILT z.object(shape).strict()
// instance back through server.tool() does not work — the SDK's isZodRawShapeCompat
// check explicitly excludes schema instances (they're meant to go through
// server.registerTool()'s config object instead, which accepts either a raw
// shape or a schema instance via getZodSchemaObject()). So this wrapper
// intercepts .tool() calls, reproduces the SDK's own positional-argument
// parsing (mirrored below from server/mcp.js so classification stays
// identical to what the unwrapped server would have done), and re-dispatches
// through .registerTool() with the shape promoted to a strict schema.

type RawShape = Record<string, z.ZodTypeAny>;

// Mirrors isZodTypeLike/isZodSchemaInstance/isZodRawShapeCompat in
// @modelcontextprotocol/sdk's server/mcp.js — kept in lockstep so this
// wrapper classifies arguments exactly like the SDK it's standing in front of.
function isZodTypeLike(value: unknown): value is { parse: unknown; safeParse: unknown } {
  return value !== null && typeof value === 'object' &&
    'parse' in value && typeof (value as Record<string, unknown>).parse === 'function' &&
    'safeParse' in value && typeof (value as Record<string, unknown>).safeParse === 'function';
}
function isZodSchemaInstance(obj: object): boolean {
  return '_def' in obj || '_zod' in obj || isZodTypeLike(obj);
}
function isRawShapeCompat(obj: unknown): obj is RawShape {
  if (typeof obj !== 'object' || obj === null) return false;
  if (isZodSchemaInstance(obj)) return false;
  if (Object.keys(obj).length === 0) return true;
  return Object.values(obj).some(isZodTypeLike);
}

export function withStrictTools(server: McpServer): McpServer {
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: { description?: string; inputSchema?: unknown; annotations?: unknown },
    cb: unknown,
  ) => unknown;

  const strictTool = (name: string, ...rest: unknown[]): unknown => {
    let description: string | undefined;
    if (typeof rest[0] === 'string') description = rest.shift() as string;

    let shape: RawShape | undefined;
    let annotations: Record<string, unknown> | undefined;
    if (rest.length > 1) {
      if (isRawShapeCompat(rest[0])) {
        shape = rest.shift() as RawShape;
        if (rest.length > 1 && typeof rest[0] === 'object' && rest[0] !== null && !isRawShapeCompat(rest[0])) {
          annotations = rest.shift() as Record<string, unknown>;
        }
      } else if (typeof rest[0] === 'object' && rest[0] !== null) {
        annotations = rest.shift() as Record<string, unknown>;
      }
    }
    const handler = rest[0];

    return registerTool(
      name,
      {
        description,
        ...(shape ? { inputSchema: z.object(shape).strict() } : {}),
        ...(annotations ? { annotations } : {}),
      },
      handler,
    );
  };

  (server as unknown as { tool: typeof strictTool }).tool = strictTool;
  return server;
}
