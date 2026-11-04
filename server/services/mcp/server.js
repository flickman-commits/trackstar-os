/**
 * Trackstar MCP: the server, built per request on the official MCP SDK.
 *
 * Every POST to /api/mcp carries an API key (api/_lib/apiKeys.js). The key
 * decides which tools exist for that request: a tool is registered only when
 * the key's scopes include the tool's scope, the person behind the key may
 * use that part of the app (api/_lib/roles.js), and admin tools only for an
 * admin. A caller with no key sees the read tools as a menu and nothing
 * answers.
 *
 * Every call is rate limited per key and logged; anything that changes
 * something lands in the Activity Log as the person the key acts as. A
 * handler that fails returns a short message and a reference, never the
 * error itself: an internal message is a map of the server.
 */
import crypto from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { can } from '../../../api/_lib/roles.js'
import { checkRateLimitDurable } from '../../lib/publicRateLimit.js'
import { ALL_TOOLS } from './tools/index.js'

export const SERVER_INFO = { name: 'trackstar', version: '1.0.0' }
const CALLS_PER_WINDOW = 240
const WINDOW_MS = 10 * 60_000
const NO_KEY = 'No API key was sent. Add a header "Authorization: Bearer <key>"; keys are minted in Settings > Admin > API Keys.'

/** A problem the caller should read as written: wrong input, nothing found. */
export { ToolError } from './errors.js'

/** The tools this caller gets. Null principal: the plain read tools, as a menu. */
export async function toolsFor(principal) {
  if (!principal) return ALL_TOOLS.filter(t => t.scope === 'read' && !t.cap)
  const out = []
  for (const t of ALL_TOOLS) {
    if (!principal.scopes.has(t.scope)) continue
    if ((t.scope === 'write' || t.scope === 'admin') && !principal.user) continue
    if (t.scope === 'admin' && principal.role !== 'admin') continue
    // Repair is minted only for admins and service keys; a person who has
    // since lost admin loses it too (their role is read fresh on every request).
    if (t.scope === 'repair' && principal.user && principal.role !== 'admin') continue
    // A write that only an admin may make, whatever the key's scopes.
    if (t.adminOnly && principal.role !== 'admin') continue
    // A capability belongs to a person's role; a service key has no person, so no capability tools.
    if (t.cap && (!principal.user || !(await can(principal, t.cap)))) continue
    out.push(t)
  }
  return out
}

function asResult(out) {
  if (out && Array.isArray(out.content)) return out
  const data = out && typeof out === 'object' ? out : { result: out }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data }
}

function refuse(message) {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function actorFor(principal) {
  return principal.user
    ? { id: principal.user.id, email: principal.user.email }
    : { isSystem: true, email: `key:${principal.name}` }
}

const DRAFT_AUDIT_CHARS = 200

/**
 * What a tool's arguments look like in the Activity Log. The log is read by
 * every admin and kept for good, so a recipient's street address and email
 * stay out of it (name and city say who it was) and a drafted reply is cut
 * to its opening.
 */
const AUDIT_REDACT = {
  send_sample: a => ({
    name: a.name,
    city: a.address?.city,
    mode: a.mode,
    items: a.items,
    shipping: a.shipping,
    confirm: a.confirm,
    previewId: a.previewId,
  }),
  draft_reply: a => ({
    ...a,
    body: typeof a.body === 'string' && a.body.length > DRAFT_AUDIT_CHARS ? `${a.body.slice(0, DRAFT_AUDIT_CHARS)}...` : a.body,
  }),
}

export function argsForAudit(toolName, args) {
  try {
    const redact = AUDIT_REDACT[toolName]
    const safe = redact ? redact(args || {}) : args
    const s = JSON.stringify(safe)
    return s.length > 2000 ? { truncated: s.slice(0, 2000) } : safe
  } catch { return null }
}

/**
 * Build the server for one request. Tools are closed over the principal.
 * The second argument swaps the rate limit and the audit log, for tests.
 */
export async function buildServer(principal, { rateLimit = checkRateLimitDurable, audit = recordAudit } = {}) {
  const server = new McpServer(SERVER_INFO)
  const tools = await toolsFor(principal)
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input || {},
        annotations: { readOnlyHint: Boolean(tool.readOnly), destructiveHint: Boolean(tool.destructive), openWorldHint: Boolean(tool.openWorld) },
      },
      async (args) => {
        if (!principal) return refuse(NO_KEY)
        const started = Date.now()
        const limit = await rateLimit(principal.keyId, { bucket: 'mcp-call', max: CALLS_PER_WINDOW, windowMs: WINDOW_MS })
        if (!limit.allowed) {
          return refuse(`This key has made too many calls; try again in ${Math.ceil(limit.retryAfterMs / 60000)} minute(s).`)
        }
        try {
          const out = await tool.handler(args || {}, { principal })
          if (!tool.readOnly) {
            await audit({
              action: `mcp.${tool.name}`,
              summary: `${out?.summary || tool.title} (via API key "${principal.name}")`,
              detail: { tool: tool.name, keyId: principal.keyId, args: argsForAudit(tool.name, args) },
              actor: actorFor(principal),
            })
          }
          console.log(`[mcp] ${principal.name} -> ${tool.name} ok ${Date.now() - started}ms`)
          return asResult(out)
        } catch (err) {
          if (err?.expose) {
            console.log(`[mcp] ${principal.name} -> ${tool.name} refused: ${err.message}`)
            return refuse(err.message)
          }
          const ref = crypto.randomBytes(3).toString('hex')
          console.error(`[mcp] ${principal.name} -> ${tool.name} failed (ref ${ref}):`, err)
          return refuse(`That did not work on the server (ref ${ref}). Try again, or ask Matt to check the logs.`)
        }
      },
    )
  }
  return server
}
