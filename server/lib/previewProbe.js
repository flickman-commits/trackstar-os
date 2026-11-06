/**
 * Test a candidate scraper fix on its Vercel preview before it reaches main.
 *
 * The nightly agent writes scraper code in a sandbox that cannot reach a single
 * timing site, so it cannot run its own fix against real results. Vercel can:
 * every pushed branch gets a preview deployment running that branch's code. So
 * production, which holds the fixtures and overrides, hands them to the
 * preview, the preview runs its patched scrapers against the live sites, and
 * production reports back the verdict for every year of the race.
 *
 * Every year, not only the broken one. A fix for 2025 that breaks 2023 is a
 * regression that would otherwise ship silently, and the gate exists to catch
 * exactly that.
 *
 * Nothing here writes health rows. A preview verdict is evidence about a
 * branch, not about what production is running; production's own probe after
 * the deploy is what updates ScraperHealth.
 *
 * Env: VERCEL_API_TOKEN, VERCEL_PROJECT_ID, optional VERCEL_TEAM_ID;
 * PREVIEW_PROBE_SECRET set for BOTH Production and Preview; and, if Deployment
 * Protection is on, VERCEL_AUTOMATION_BYPASS_SECRET (Protection Bypass for
 * Automation).
 */
import { fetchWithTimeout } from './fetchWithTimeout.js'
import { loadProbeFixtures } from './scraperHealth.js'
import { ensureOverridesLoaded, listOverrides } from '../scrapers/scraperOverrides.js'
import { getCanonicalRaceName } from '../scrapers/index.js'
import { ToolError } from '../services/mcp/errors.js'

// The agent's MCP client abandons a tool call after 60s, and an abandoned call
// returns nothing, not even "still building". So each wait stays well inside
// that and hands back retry: true; the caller simply asks again.
const POLL_MS = 5_000
const PREVIEW_WAIT_MS = 15_000
const DEPLOY_WAIT_MS = 45_000
const PROBE_CALL_TIMEOUT_MS = 40_000
const PREVIEW_MAX_TARGETS = 12

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function vercelConfig() {
  const token = process.env.VERCEL_API_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !projectId) {
    return { error: 'VERCEL_API_TOKEN and VERCEL_PROJECT_ID are not set on production, so previews cannot be found. This needs Matt to add them in Vercel.' }
  }
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID || null }
}

async function listDeployments(cfg, { production = false } = {}) {
  const qs = new URLSearchParams({ projectId: cfg.projectId, limit: '30' })
  if (cfg.teamId) qs.set('teamId', cfg.teamId)
  if (production) qs.set('target', 'production')
  const resp = await fetchWithTimeout(`https://api.vercel.com/v6/deployments?${qs}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  })
  if (!resp.ok) {
    console.error(`[previewProbe] Vercel API ${resp.status}:`, (await resp.text().catch(() => '')).slice(0, 500))
    throw new Error(`Vercel API ${resp.status}`)
  }
  const data = await resp.json()
  return data.deployments || []
}

const looksLikeSha = ref => /^[0-9a-f]{7,40}$/i.test(ref)
const stateOf = d => d.readyState || d.state

/**
 * The only previews probe_preview will hand production's fixtures and
 * overrides to, and run: the nightly routine's own sweep/* branches. A full
 * sha is accepted only when Vercel reports it built from a sweep/* branch.
 */
const SWEEP_BRANCH = /^sweep\/[A-Za-z0-9._-][A-Za-z0-9._/-]{0,99}$/
const FULL_SHA = /^[0-9a-f]{40}$/i
export const isSweepBranch = ref => SWEEP_BRANCH.test(String(ref || '')) && !String(ref).includes('..')
export function previewRefKind(ref) {
  if (isSweepBranch(ref)) return 'branch'
  if (FULL_SHA.test(String(ref || ''))) return 'sha'
  return null
}

function matchesRef(d, ref) {
  const meta = d.meta || {}
  if (looksLikeSha(ref)) return String(meta.githubCommitSha || '').toLowerCase().startsWith(ref.toLowerCase())
  return meta.githubCommitRef === ref
}

/** A preview for a sweep/* branch: by name, or by full sha whose deployment came from one. */
function matchesPreviewRef(d, ref) {
  const meta = d.meta || {}
  if (previewRefKind(ref) === 'sha') return String(meta.githubCommitSha || '').toLowerCase() === ref.toLowerCase() && isSweepBranch(meta.githubCommitRef)
  return meta.githubCommitRef === ref
}

/** Newest deployment for a branch or sha, waiting until it finishes building. */
async function awaitDeployment(cfg, ref, { production = false, waitMs, match = matchesRef }) {
  const deadline = Date.now() + waitMs
  let last = null
  while (Date.now() < deadline) {
    const found = (await listDeployments(cfg, { production })).find(d => match(d, ref))
    if (found) {
      last = found
      const state = stateOf(found)
      if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') return found
    }
    await sleep(POLL_MS)
  }
  return last
}

function describe(d) {
  return {
    url: d?.url ? `https://${d.url}` : null,
    state: d ? stateOf(d) : 'NOT_FOUND',
    sha: d?.meta?.githubCommitSha || null,
    branch: d?.meta?.githubCommitRef || null,
  }
}

/**
 * Probe a branch's preview for every fixture-backed year of the given races.
 * Returns allPassing only when every probed year came back live.
 */
export async function probePreview({ ref, races, years = null }) {
  // Checked first: a preview of any other branch is code nobody vetted, and
  // this would hand it production's probe secret and fixtures.
  if (!previewRefKind(ref)) {
    throw new ToolError('probe_preview only tests the nightly routine\'s sweep/* branches: pass a branch like "sweep/berlin-2025", or the full 40-character sha of a commit on one.')
  }
  const cfg = vercelConfig()
  if (cfg.error) return { ok: false, error: cfg.error }
  if (!process.env.PREVIEW_PROBE_SECRET) {
    return { ok: false, error: 'PREVIEW_PROBE_SECRET is not set, so the preview would refuse the probe. This needs Matt to add it in Vercel for Production and Preview.' }
  }
  if (!ref || !Array.isArray(races) || !races.length) return { ok: false, error: 'Pass ref (branch or sha) and at least one race.' }

  const deployment = await awaitDeployment(cfg, ref, { waitMs: PREVIEW_WAIT_MS, match: matchesPreviewRef })
  const info = describe(deployment)
  if (!deployment) {
    return { ok: false, deployment: info, error: `No Vercel preview of a sweep/* branch found for "${ref}" yet. Check the branch was pushed, then call again.` }
  }
  if (!isSweepBranch(info.branch)) {
    throw new ToolError('That deployment was not built from a sweep/* branch, so it will not be probed.')
  }
  if (info.state === 'ERROR' || info.state === 'CANCELED') {
    return { ok: false, deployment: info, error: `The preview build ${info.state === 'ERROR' ? 'failed' : 'was cancelled'}. Run npm run build locally; it runs the same steps.` }
  }
  if (info.state !== 'READY') {
    return { ok: false, retry: true, deployment: info, error: `Preview is still ${info.state}. Call probe_preview again in a minute.` }
  }

  const fixtures = await loadProbeFixtures()
  await ensureOverridesLoaded()
  const wantYears = Array.isArray(years) && years.length ? new Set(years.map(Number)) : null

  const targets = []
  const untestable = []
  for (const race of races) {
    const canonical = getCanonicalRaceName(race) || race
    const keys = Object.keys(fixtures).filter(k => k.startsWith(`${canonical}::`))
    const picked = keys
      .map(k => ({ race: canonical, year: Number(k.split('::')[1]), fixture: fixtures[k] }))
      .filter(t => !wantYears || wantYears.has(t.year))
    if (!picked.length) untestable.push(canonical)
    targets.push(...picked)
  }
  if (!targets.length) {
    return { ok: false, deployment: info, error: `No fixtures exist for ${untestable.join(', ')}, so there is no known finisher to test the fix against. Capture one first.` }
  }

  // Matches MAX_TARGETS in api/_routes/admin/preview-probe.js. Refused rather than
  // truncated: a verdict on part of the list would read as a pass on all of it.
  if (targets.length > PREVIEW_MAX_TARGETS) {
    return { ok: false, deployment: info, error: `That is ${targets.length} race-years; one call probes at most ${PREVIEW_MAX_TARGETS}. Probe one race at a time, or pass years.` }
  }

  const headers = { 'Content-Type': 'application/json', 'x-preview-probe-secret': process.env.PREVIEW_PROBE_SECRET }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

  let resp
  try {
    resp = await fetchWithTimeout(`${info.url}/api/admin/preview-probe`, {
      method: 'POST', headers, body: JSON.stringify({ targets, overrides: listOverrides() }),
    }, PROBE_CALL_TIMEOUT_MS)
  } catch (err) {
    console.error(`[previewProbe] reaching ${info.url} failed:`, err)
    return { ok: false, deployment: info, error: err?.name === 'TimeoutError' ? 'The preview did not answer in time. Call probe_preview again.' : 'Could not reach the preview. Call probe_preview again in a minute.' }
  }
  const text = await resp.text()
  if (!resp.ok) {
    const hint = resp.status === 401 || resp.status === 403
      // Vercel's protection wall answers with an HTML login page or, to a
      // non-browser client, JSON carrying a "protection" block.
      ? (/<html/i.test(text) || /"protection"\s*:/.test(text)
        ? ' Vercel Deployment Protection blocked it; production needs VERCEL_AUTOMATION_BYPASS_SECRET.'
        : ' The preview refused the secret; PREVIEW_PROBE_SECRET must be set for Preview as well as Production.')
      : ''
    console.error(`[previewProbe] preview probe ${resp.status}:`, text.slice(0, 500))
    return { ok: false, deployment: info, error: `Preview probe returned ${resp.status}.${hint}` }
  }

  let parsed
  try { parsed = JSON.parse(text) } catch {
    console.error('[previewProbe] preview probe answered with something other than JSON:', text.slice(0, 500))
    return { ok: false, deployment: info, error: 'The preview answered with something other than a probe result. Check the branch builds api/_routes/admin/preview-probe.js.' }
  }
  const { rows = [], sha = null } = parsed
  const failing = rows.filter(r => r.status !== 'live')
  return {
    ok: true,
    deployment: { ...info, servedSha: sha },
    allPassing: rows.length > 0 && failing.length === 0,
    passing: rows.length - failing.length,
    probed: rows.length,
    rows: rows.map(r => ({ race: r.race, year: r.year, status: r.status, ms: r.ms, detail: r.detail })),
    untestable,
    note: failing.length
      ? 'Not every year passed. Do not merge: fix the failing years or leave the change out.'
      : 'Every fixture-backed year passed on the preview. Merge to main, then wait_for_deploy and probe_scrapers on production.',
  }
}

/** Wait until production is serving a given commit. */
export async function waitForDeploy({ sha }) {
  const cfg = vercelConfig()
  if (cfg.error) return { ok: false, error: cfg.error }
  if (!sha || !looksLikeSha(sha)) return { ok: false, error: 'Pass the commit sha you pushed to main.' }

  const deployment = await awaitDeployment(cfg, sha, { production: true, waitMs: DEPLOY_WAIT_MS })
  const info = describe(deployment)
  if (info.state === 'READY') {
    return { ok: true, ready: true, deployment: info, next: 'Production is serving this commit. Run probe_scrapers on the races you fixed; that verdict is what the morning report counts.' }
  }
  if (info.state === 'ERROR' || info.state === 'CANCELED') {
    return { ok: false, ready: false, deployment: info, error: 'The production build failed, so production is still on the previous commit. Revert your commit on main and push.' }
  }
  return { ok: false, ready: false, retry: true, deployment: info, error: `Production deployment is ${info.state}. Call wait_for_deploy again.` }
}
