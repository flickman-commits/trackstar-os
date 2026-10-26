/**
 * Roles, and what each one can see and do.
 *
 *   admin        Matt. Everything, always, including Settings > Data and Admin.
 *   sales        Sales & Marketing.
 *   fulfillment  Fulfillment.
 *   support      Customer Support: the shared inbox, and the tools a reply
 *                needs (discount codes, pace, weather).
 *   head_designer  Head of Design (Dan): also assigns custom orders.
 *   designer     Junior Designer. The id stays "designer" so existing people
 *                keep their role; only the label changed.
 *
 * What the three non-admin roles include is set by an admin in Settings >
 * Admin > Roles, as checkboxes over CAPABILITIES, and kept in SystemConfig
 * (role_capabilities). DEFAULT_CAPS is what they start with. The screens get
 * the signed-in person's list from /api/auth/login; the endpoints that matter
 * check it here, against the role read fresh from the database.
 *
 * Data and Admin are not on the list: they stay admin only.
 *
 * "staff" is the role everyone had before these existed. It reads as
 * designer, the narrowest, until someone gives it a real one.
 */
import prisma from './prisma.js'

export const ROLES = ['admin', 'sales', 'fulfillment', 'support', 'head_designer', 'designer']

export const ROLE_LABEL = {
  admin: 'Admin',
  sales: 'Sales & Marketing',
  fulfillment: 'Fulfillment',
  support: 'Customer Support',
  head_designer: 'Head of Design',
  designer: 'Junior Designer',
}

/** What an admin can hand out, in the order the Roles panel shows them. */
export const CAPABILITIES = [
  { id: 'sales', group: 'Pages', label: 'Sales' },
  { id: 'support', group: 'Pages', label: 'Support' },
  { id: 'creators', group: 'Pages', label: 'Creators' },
  { id: 'orders.assign_custom', group: 'Orders', label: 'Assign custom orders' },
  { id: 'orders.render', group: 'Orders', label: 'Create and approve automated designs' },
  { id: 'tools.discounts', group: 'Tools', label: 'Discount codes' },
  { id: 'tools.pace', group: 'Tools', label: 'Pace calculator' },
  { id: 'tools.weather', group: 'Tools', label: 'Race weather' },
  { id: 'tools.surveys', group: 'Tools', label: 'Design Survey' },
  { id: 'tools.samples', group: 'Tools', label: 'Samples (sends real orders)' },
  { id: 'settings.reviews', group: 'Settings', label: 'Request Reviews' },
  { id: 'settings.stats', group: 'Settings', label: 'Stats' },
  { id: 'settings.design_needs', group: 'Settings', label: 'Design Needs' },
]
const GRANTABLE = new Set(CAPABILITIES.map(c => c.id))
const EDITABLE_ROLES = ROLES.filter(r => r !== 'admin')

export const DEFAULT_CAPS = {
  sales: ['sales', 'creators', 'tools.discounts', 'tools.pace', 'tools.weather', 'tools.surveys', 'settings.reviews', 'settings.stats'],
  fulfillment: ['support', 'creators', 'orders.render', 'tools.discounts', 'tools.pace', 'tools.weather', 'settings.stats', 'settings.design_needs'],
  support: ['support', 'tools.discounts', 'tools.pace', 'tools.weather'],
  head_designer: ['orders.assign_custom', 'tools.pace', 'tools.weather', 'tools.surveys', 'settings.stats', 'settings.design_needs'],
  designer: ['tools.pace', 'tools.weather', 'tools.surveys', 'settings.stats', 'settings.design_needs'],
}

const KEY = 'role_capabilities'
let cache = { at: 0, value: DEFAULT_CAPS }

export function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'designer'
}

function clean(map) {
  const out = {}
  for (const r of EDITABLE_ROLES) {
    const list = Array.isArray(map?.[r]) ? map[r] : DEFAULT_CAPS[r]
    out[r] = [...new Set(list.filter(c => GRANTABLE.has(c)))]
  }
  return out
}

/** The saved table, cached briefly per instance. */
export async function loadRoleCaps({ force = false } = {}) {
  if (!force && Date.now() - cache.at < 30_000) return cache.value
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: KEY } })
    cache = { at: Date.now(), value: clean(row?.value ? JSON.parse(row.value) : null) }
  } catch {
    cache = { at: Date.now(), value: cache.value || DEFAULT_CAPS }
  }
  return cache.value
}

export async function saveRoleCaps(map) {
  const value = clean(map)
  const v = JSON.stringify(value)
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value: v }, create: { key: KEY, value: v } })
  cache = { at: Date.now(), value }
  return value
}

/** Everything this role includes: '*' for admin, else a list of capability ids. */
export async function capsFor(role) {
  const r = normalizeRole(role)
  if (r === 'admin') return '*'
  return (await loadRoleCaps())[r] || []
}

/** Whether this role may use this part of the app. */
export async function can(role, capability) {
  const caps = await capsFor(role)
  return caps === '*' || caps.includes(capability)
}
