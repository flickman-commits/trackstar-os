/**
 * Roles, and what each one can see. What the non-admin roles include is set
 * by an admin in Settings > Admin > Roles and enforced on the server
 * (api/_lib/roles.js); the signed-in person's list arrives as `user.caps`.
 * DEFAULT_CAPS here is only the fallback for a session that has not loaded
 * it yet.
 */
export type Role = 'admin' | 'sales' | 'fulfillment' | 'support' | 'head_designer' | 'designer'

export type Capability =
  | 'sales' | 'support' | 'creators' | 'orders.assign_custom' | 'orders.render'
  | 'tools.discounts' | 'tools.pace' | 'tools.weather' | 'tools.surveys' | 'tools.samples'
  | 'settings.pricing' | 'settings.reviews' | 'settings.stats' | 'settings.design_needs' | 'settings.data' | 'settings.admin'

export type Caps = '*' | Capability[]

export const ROLES: Role[] = ['admin', 'sales', 'fulfillment', 'support', 'head_designer', 'designer']

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  sales: 'Sales & Marketing',
  fulfillment: 'Fulfillment',
  support: 'Customer Support',
  head_designer: 'Head of Design',
  designer: 'Junior Designer',
}

export const CAPABILITY_LABEL: Partial<Record<Capability, string>> = {
  sales: 'Sales',
  support: 'Support',
  creators: 'Creators',
  'orders.assign_custom': 'Assign customs',
  'orders.render': 'Automated designs',
  'tools.discounts': 'Discounts',
  'tools.pace': 'Pace',
  'tools.weather': 'Weather',
  'tools.surveys': 'Design Survey',
  'tools.samples': 'Samples',
  'settings.reviews': 'Reviews',
  'settings.stats': 'Stats',
  'settings.design_needs': 'Design Needs',
}

const DEFAULT_CAPS: Record<Role, Caps> = {
  admin: '*',
  sales: ['sales', 'creators', 'tools.discounts', 'tools.pace', 'tools.weather', 'tools.surveys', 'settings.reviews', 'settings.stats'],
  fulfillment: ['support', 'creators', 'orders.render', 'tools.discounts', 'tools.pace', 'tools.weather', 'settings.stats', 'settings.design_needs'],
  support: ['support', 'tools.discounts', 'tools.pace', 'tools.weather'],
  head_designer: ['orders.assign_custom', 'tools.pace', 'tools.weather', 'tools.surveys', 'settings.stats', 'settings.design_needs'],
  designer: ['tools.pace', 'tools.weather', 'tools.surveys', 'settings.stats', 'settings.design_needs'],
}

/** "staff" (from before roles) and anything unknown read as designer, the narrowest. */
export function normalizeRole(role?: string | null): Role {
  return (ROLES as string[]).includes(role || '') ? (role as Role) : 'designer'
}

export function capsCan(caps: Caps | undefined, capability: Capability) {
  return caps === '*' || Boolean(caps?.includes(capability))
}

export function roleCan(role: string | null | undefined, capability: Capability, caps?: Caps) {
  return capsCan(caps ?? DEFAULT_CAPS[normalizeRole(role)], capability)
}

/** "Fulfillment, plus Sales, Creators, Pace and Stats": what a role includes, in a line. */
export function describeCaps(caps: Caps | undefined): string {
  if (caps === '*') return 'Everything, including people, data and maintenance'
  const names = (caps || []).map(c => CAPABILITY_LABEL[c]).filter(Boolean) as string[]
  if (!names.length) return 'Fulfillment only'
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return `Fulfillment, plus ${list}`
}
