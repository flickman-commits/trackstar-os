/**
 * Every tool the MCP server can offer. Which ones a caller gets is decided
 * per request in ../server.js from the key's scopes and the person's role.
 *
 * A tool is { name, title, description, scope, readOnly, input, handler }:
 *   scope     read | write | admin | repair (never worker: that scope is the
 *             render worker's, api/_routes/render/worker.js, and has no MCP tools)
 *   cap       optional: a role capability from api/_lib/roles.js
 *   adminOnly optional: only for a key whose person is an admin, whatever its scopes
 *   input     a zod raw shape; the SDK validates before the handler runs
 *   handler   (args, { principal }) -> a plain object; `summary` is what the
 *             Activity Log says for a write
 */
import { opsTools } from './ops.js'
import { orderTools } from './orders.js'
import { designTools } from './design.js'
import { bulkTools } from './bulk.js'
import { teamTools } from './team.js'
import { repairTools } from './repair.js'
import { renderTools } from './render.js'
import { raceTools } from './races.js'
import { researchTools } from './research.js'
import { statsTools } from './stats.js'
import { supportTools } from './support.js'
import { sampleTools } from './samples.js'
import { financeTools } from './finance.js'

export const ALL_TOOLS = [...opsTools, ...orderTools, ...designTools, ...bulkTools, ...teamTools, ...renderTools, ...raceTools, ...researchTools, ...statsTools, ...supportTools, ...sampleTools, ...financeTools, ...repairTools]

const names = ALL_TOOLS.map(t => t.name)
if (new Set(names).size !== names.length) throw new Error('MCP tool names must be unique')
