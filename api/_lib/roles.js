/**
 * Roles, and what each one can see and do.
 *
 *   admin        Matt. Everything, always, including Settings > Data and Admin.
 *   sales        Sales & Marketing.
 *   fulfillment  Fulfillment.
 *   support      Customer Support: the shared inbox, and the tools a reply
 *                needs (discount codes, pace, weather).
 *   creators     The creator program: the Creators page and discount codes.
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

export const ROLES = ['admin', 'sales', 'fulfillment', 'support', 'creators', 'head_designer', 'designer']

export const ROLE_LABEL = {
  admin: 'Admin',
  sales: 'Sales & Marketing',
  fulfillment: 'Fulfillment',
  support: 'Customer Support',
  creators: 'Creators',
  head_designer: 'Head of Design',
  designer: 'Junior Designer',
}

/**
 * What an admin can hand out, grouped by the job it belongs to, in the order
 * the People page shows them. Ids are stable; only the words change.
 */
export const CAPABILITIES = [
  { id: 'support', group: 'Work areas', label: 'Support inbox', blurb: 'Read and answer customer conversations' },
  { id: 'sales', group: 'Work areas', label: 'Sales', blurb: 'The race and charity pipeline (needs an Attio seat)' },
  { id: 'creators', group: 'Work areas', label: 'Creators', blurb: 'The creator program and briefs' },
  { id: 'hours', group: 'Work areas', label: 'Hours', blurb: 'Log and submit their own time' },
  { id: 'orders.assign_custom', group: 'Can also do', label: 'Assign custom orders', blurb: 'Hand custom designs to a designer' },
  { id: 'orders.render', group: 'Can also do', label: 'Approve automated designs', blurb: 'Create and approve standard prints' },
  { id: 'orders.message_customer', group: 'Can also do', label: 'Email customers on custom orders', blurb: 'Send proofs and questions from an order' },
  { id: 'tools.samples', group: 'Can also do', label: 'Send samples', blurb: 'Places real orders with the print partner' },
  { id: 'tools.discounts', group: 'Tools', label: 'Discount codes' },
  { id: 'tools.pace', group: 'Tools', label: 'Pace calculator' },
  { id: 'tools.weather', group: 'Tools', label: 'Race weather' },
  { id: 'tools.surveys', group: 'Tools', label: 'Design Survey' },
  { id: 'settings.reviews', group: 'Reports', label: 'Request Reviews' },
  { id: 'settings.stats', group: 'Reports', label: 'Stats' },
  { id: 'settings.design_needs', group: 'Reports', label: 'Design Needs' },
]
const GRANTABLE = new Set(CAPABILITIES.map(c => c.id))
/** Only these may be granted or denied to a person; anything else is dropped. */
export const grantable = list => [...new Set((Array.isArray(list) ? list : []).filter(c => GRANTABLE.has(c)))]
const EDITABLE_ROLES = ROLES.filter(r => r !== 'admin')

export const DEFAULT_CAPS = {
  sales: ['sales', 'creators', 'tools.discounts', 'tools.pace', 'tools.weather', 'tools.surveys', 'settings.reviews', 'settings.stats'],
  fulfillment: ['support', 'creators', 'orders.render', 'tools.discounts', 'tools.pace', 'tools.weather', 'settings.stats', 'settings.design_needs'],
  support: ['support', 'hours', 'tools.discounts', 'tools.pace', 'tools.weather'],
  creators: ['creators', 'hours', 'tools.discounts'],
  head_designer: ['orders.assign_custom', 'orders.message_customer', 'tools.pace', 'tools.weather', 'tools.surveys', 'settings.stats', 'settings.design_needs'],
  designer: ['orders.message_customer', 'tools.pace', 'tools.weather', 'tools.surveys', 'settings.stats', 'settings.design_needs'],
}

const KEY = 'role_capabilities'
let cache = { at: 0, value: DEFAULT_CAPS }

export function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'designer'
}

// Capabilities added after the first saved table (a saved table without
// `_known` predates all of these). A role gets a new capability's default
// until an admin saves the table again, so "on by default" holds for a
// workspace whose roles were set up before the capability existed.
const ADDED_LATER = ['hours']

function clean(map) {
  const known = new Set(Array.isArray(map?._known) ? map._known : [...GRANTABLE].filter(c => !ADDED_LATER.includes(c)))
  const out = {}
  for (const r of EDITABLE_ROLES) {
    const list = Array.isArray(map?.[r]) ? map[r] : DEFAULT_CAPS[r]
    const fresh = DEFAULT_CAPS[r].filter(c => !known.has(c))
    out[r] = [...new Set([...list, ...fresh].filter(c => GRANTABLE.has(c)))]
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
  // Saved with every capability that exists now, so a later addition reads as new.
  const v = JSON.stringify({ ...value, _known: [...GRANTABLE] })
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value: v }, create: { key: KEY, value: v } })
  cache = { at: Date.now(), value }
  return value
}

/** Every role a person has: their main role plus any extras. Accepts a role string or a user. */
export function rolesOf(who) {
  if (!who) return []
  if (typeof who === 'string') return [normalizeRole(who)]
  return [...new Set([who.role, ...(Array.isArray(who.extraRoles) ? who.extraRoles : [])].filter(Boolean).map(normalizeRole))]
}

/** Whether this person has this role, as main or extra. */
export function hasRole(who, role) {
  return rolesOf(who).includes(role)
}

/**
 * Checked roles to what is stored: the main role (admin when it is among
 * them, else the first in ROLES order) and the rest as extras.
 */
export function splitRoles(list) {
  const picked = ROLES.filter(r => (list || []).includes(r))
  if (!picked.length) return null
  return { role: picked[0], extraRoles: picked.slice(1) }
}

/**
 * Everything this person includes: '*' for admin, else the capability ids of
 * all their roles together, plus their own extras, less what was taken away.
 * Takes a role string or a user with extraRoles / extraCaps / deniedCaps.
 */
export async function capsFor(who) {
  const roles = rolesOf(who)
  if (roles.includes('admin')) return '*'
  const table = await loadRoleCaps()
  const fromRoles = roles.flatMap(r => table[r] || [])
  // Per-person exceptions on top of the roles (User.extraCaps / deniedCaps).
  const extra = typeof who === 'object' ? grantable(who.extraCaps) : []
  const denied = new Set(typeof who === 'object' ? grantable(who.deniedCaps) : [])
  return [...new Set([...fromRoles, ...extra])].filter(c => !denied.has(c))
}

/** Whether this person (or role) may use this part of the app. */
export async function can(who, capability) {
  const caps = await capsFor(who)
  return caps === '*' || caps.includes(capability)
}
