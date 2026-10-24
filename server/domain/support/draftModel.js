/**
 * Which Claude model drafts support replies: picked by an admin in Support
 * settings, stored in SystemConfig. SUPPORT_LLM_MODEL in the environment
 * still wins, for a deploy that pins one. Costs are what a draft ran at our
 * volume (about 9,000 tokens in and 1,200 out, some 1,600 drafts a month,
 * measured 2026-10-24) with the playbook cached.
 */
import prisma from '../../db.js'
import { UserError } from './errors.js'

const KEY = 'support_draft_model'
export const DEFAULT_DRAFT_MODEL = 'claude-sonnet-5-5'

export const DRAFT_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest, weakest replies. About $3 a month.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Good judgment and tone. About $30 to $50 a month.' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best on hard cases, slower. About $55 to $100 a month.' },
]

export async function getDraftModel() {
  if (process.env.SUPPORT_LLM_MODEL) return process.env.SUPPORT_LLM_MODEL
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } }).catch(() => null)
  return DRAFT_MODELS.some(m => m.id === row?.value) ? row.value : DEFAULT_DRAFT_MODEL
}

export async function setDraftModel(id) {
  if (!DRAFT_MODELS.some(m => m.id === id)) throw new UserError('Pick one of the listed models')
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value: id }, create: { key: KEY, value: id } })
  return id
}
