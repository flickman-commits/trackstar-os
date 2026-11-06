/**
 * Trackstar MCP, over Streamable HTTP, on the official MCP SDK.
 *
 *   POST https://fast.trackstar.art/api/mcp
 *   Authorization: Bearer <API key>
 *
 * Keys are minted in Settings > Admin > API Keys and decide what the caller
 * can see and do (api/_lib/apiKeys.js, server/services/mcp/server.js). On
 * claude.ai, add it as a custom connector with Authentication: None and the
 * Authorization header under "Additional request headers". x-mcp-token still
 * works for anything calling this directly.
 *
 * Stateless: every request builds its own server and answers with plain JSON,
 * which is what a serverless function can promise. A wrong key gets a 401
 * and counts toward a per-address limit; no key at all gets the read tools
 * as a menu, and every call then says a key is needed.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { resolveApiKey } from '../../_lib/apiKeys.js'
import { buildServer, SERVER_INFO } from '../../../server/services/mcp/server.js'
import { checkRateLimitDurable } from '../../../server/lib/publicRateLimit.js'

/** "Bearer abc" -> "abc"; a bare value is accepted too. */
function bearer(value) {
  if (!value) return null
  const match = String(value).match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : String(value).trim()
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      transport: 'streamable-http',
      note: 'This is an MCP endpoint. Add it as a custom connector with an Authorization: Bearer header; it does not render in a browser.',
    })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {
      return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
  }

  const presented = bearer(req.headers['authorization']) || req.headers['x-mcp-token'] || null
  let principal = null
  if (presented) {
    principal = await resolveApiKey(presented)
    if (!principal) {
      const limit = await checkRateLimitDurable(clientIp(req), { bucket: 'mcp-auth', max: 20, windowMs: 10 * 60_000 })
      res.setHeader('WWW-Authenticate', 'Bearer realm="trackstar", error="invalid_token"')
      if (!limit.allowed) return res.status(429).json({ error: 'Too many bad keys from this address. Try again later.' })
      return res.status(401).json({ error: 'That API key is not valid. It may be revoked, expired, or mistyped.' })
    }
  }

  const server = await buildServer(principal)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}) })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (err) {
    console.error('[mcp] transport error:', err)
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } })
  }
}
