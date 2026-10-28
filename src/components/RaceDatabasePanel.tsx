import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useArmed } from '@/lib/useArmed'
import { Search, Pencil, Check, X, Loader2, ChevronRight, ChevronDown as ChevronDownIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import SourceLinks from '@/components/SourceLinks'
import { btnPrimary, inputBase } from '@/lib/ui'

/**
 * Settings > Race Database: every race year the tool knows, its date with
 * where it came from, location and weather, plus the filename shorthand and
 * merging a misspelled race into its real one. Moved out of Dashboard.tsx in
 * October 2026; it owns its own data and state.
 */

/**
 * Where a race date came from, at a glance.
 *
 * Most dates in the database were produced by a recurrence rule in a config
 * file - "first Sunday of December" and the like. Those rules were wrong often
 * enough to matter and never looked it: CIM came out a week early in two
 * separate years, Berlin 2025 a week late. The rules are gone, and the backlog
 * is being replaced with dates checked against a real source, but the two kinds
 * sit side by side in this list and are indistinguishable without this.
 *
 * Verified covers all three trustworthy origins: a person typed it after
 * looking it up, it is a config pin with a source behind it, or a scraper read
 * it off the results page. Unverified means the row predates the cleanup and
 * still holds whatever a rule produced. Amber rather than red because nothing
 * is broken - it is unconfirmed, which is a different thing.
 */
function DateSourceBadge({ source }: { source: string | null }) {
  const verified = source === 'manual' || source === 'config' || source === 'scraped' || source === 'researched'
  const why = verified
    ? { manual: 'Entered by hand after checking the results site',
        config: 'Pinned in the race config against a verified source',
        scraped: 'Read off the results page',
        researched: 'Found and linked by the nightly research' }[source as 'manual' | 'config' | 'scraped' | 'researched']
    : 'Left over from the old computed date rules. Nobody has confirmed it.'
  return (
    <span
      title={why}
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium cursor-help shrink-0 ${
        verified
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-amber-50 text-amber-700 border border-amber-200'
      }`}
    >
      {verified ? 'Verified' : 'Unverified'}
    </span>
  )
}

type Props = {
  raceShorthands: Record<string, string>
  raceShorthandOverrides: Record<string, string>
  refreshShorthands: () => Promise<void>
  setToast: (t: { message: string; type: 'success' | 'error' | 'info' } | null) => void
  fetchOrders: () => Promise<void>
}

export default function RaceDatabasePanel({ raceShorthands, raceShorthandOverrides, refreshShorthands, setToast, fetchOrders }: Props) {
  const fetchRaceShorthands = refreshShorthands
  const [races, setRaces] = useState<{ id: number; raceName: string; year: number; raceDate: string | null; raceDateSource: string | null; raceDateSourceUrl?: string | null; raceDateEvidence?: string | null; firstPrintedAt?: string | null; location: string | null; weatherCondition: string | null; weatherTemp: string | null; weatherFetchedAt: string | null; _count?: { runnerResearch: number } }[]>([])
  const [isLoadingRaces, setIsLoadingRaces] = useState(false)
  const { arm, isArmed } = useArmed()
  const [editingRaceId, setEditingRaceId] = useState<number | null>(null)
  const [raceEditValues, setRaceEditValues] = useState({ raceDate: '', location: '', weatherCondition: '', weatherTemp: '', sourceUrl: '', reason: '' })
  const [isSavingRace, setIsSavingRace] = useState(false)
  const [showAddRace, setShowAddRace] = useState(false)
  const [newRaceValues, setNewRaceValues] = useState({ raceName: '', year: new Date().getFullYear().toString(), raceDate: '', location: '' })
  const [editingShorthandFor, setEditingShorthandFor] = useState<string | null>(null)
  const [editingShorthandValue, setEditingShorthandValue] = useState('')
  const [savingShorthand, setSavingShorthand] = useState(false)
  const [mergingRace, setMergingRace] = useState<string | null>(null)  // race the user is choosing a merge target for
  const [mergeTarget, setMergeTarget] = useState('')
  const [isMergingRace, setIsMergingRace] = useState(false)
  // Race Database UX: search + collapse
  const [raceDbSearch, setRaceDbSearch] = useState('')
  const [expandedRaceGroups, setExpandedRaceGroups] = useState<Set<string>>(new Set())

  const fetchRaces = async () => {
    setIsLoadingRaces(true)
    try {
      const response = await apiFetch('/api/orders?list=races')
      if (!response.ok) throw new Error('Failed to fetch races')
      const data = await response.json()
      setRaces(data.races || [])
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching races:', error)
    } finally {
      setIsLoadingRaces(false)
    }
  }

  const startEditingRace = (race: typeof races[0]) => {
    const dateStr = race.raceDate ? new Date(race.raceDate).toISOString().split('T')[0] : ''
    setRaceEditValues({
      raceDate: dateStr,
      location: race.location || '',
      weatherCondition: race.weatherCondition ? race.weatherCondition.charAt(0).toUpperCase() + race.weatherCondition.slice(1) : '',
      weatherTemp: race.weatherTemp || '',
      sourceUrl: race.raceDateSourceUrl || '',
      reason: ''
    })
    setEditingRaceId(race.id)
  }

  const saveRaceEdit = async (raceId: number) => {
    setIsSavingRace(true)
    try {
      const response = await apiFetch('/api/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceAction: 'update',
          raceId,
          raceData: {
            raceDate: raceEditValues.raceDate || undefined,
            location: raceEditValues.location || undefined,
            weatherCondition: raceEditValues.weatherCondition || undefined,
            weatherTemp: raceEditValues.weatherTemp || undefined,
            sourceUrl: raceEditValues.sourceUrl || undefined,
            reason: raceEditValues.reason || undefined,
          }
        })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        setToast({ message: err.error || 'Failed to update race', type: 'error' })
        return
      }
      const result = await response.json()

      // Auto-fetch weather if date + location set but no manual weather
      const hasDate = raceEditValues.raceDate
      const hasLocation = raceEditValues.location
      const weatherManuallySet = raceEditValues.weatherCondition || raceEditValues.weatherTemp
      if (hasDate && hasLocation && !weatherManuallySet && result.race?.id) {
        try {
          await apiFetch('/api/orders/refresh-weather', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raceId: result.race.id })
          })
        } catch { /* best effort */ }
      }

      setToast({ message: 'Race updated!', type: 'success' })
      setEditingRaceId(null)
      await fetchRaces()
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error saving race:', error)
      setToast({ message: 'Failed to update race', type: 'error' })
    } finally {
      setIsSavingRace(false)
    }
  }

  const createRace = async () => {
    if (!newRaceValues.raceName || !newRaceValues.year || !newRaceValues.raceDate) {
      setToast({ message: 'Race name, year, and date are required', type: 'error' })
      return
    }
    setIsSavingRace(true)
    try {
      const response = await apiFetch('/api/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceAction: 'create',
          raceData: {
            raceName: newRaceValues.raceName,
            year: newRaceValues.year,
            raceDate: newRaceValues.raceDate,
            location: newRaceValues.location || null,
            eventTypes: [],
          }
        })
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to create race')
      }

      // Auto-fetch weather if date + location provided
      const result = await response.json().catch(() => null)
      if (newRaceValues.location && result?.race?.id) {
        try {
          await apiFetch('/api/orders/refresh-weather', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raceId: result.race.id })
          })
        } catch { /* best effort */ }
      }

      setToast({ message: 'Race created!', type: 'success' })
      setShowAddRace(false)
      setNewRaceValues({ raceName: '', year: new Date().getFullYear().toString(), raceDate: '', location: '' })
      await fetchRaces()
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error creating race:', error)
      setToast({ message: error instanceof Error ? error.message : 'Failed to create race', type: 'error' })
    } finally {
      setIsSavingRace(false)
    }
  }

  const mergeRace = async (aliasName: string, canonicalName: string) => {
    if (!canonicalName || aliasName === canonicalName) return
    if (!arm(`merge:${aliasName}>${canonicalName}`)) return
    setIsMergingRace(true)
    try {
      const res = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge-race', aliasName, canonicalName }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Merge failed: ${res.status}`)
      }
      const data = await res.json()
      setToast({
        message: `Merged: ${data.ordersUpdated} orders · ${data.racesRenamed} renamed · ${data.racesMerged} merged`,
        type: 'success',
      })
      setMergingRace(null)
      setMergeTarget('')
      await fetchRaces()
      await fetchOrders()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to merge')
    } finally {
      setIsMergingRace(false)
    }
  }

  const saveRaceShorthand = async (raceName: string, shorthand: string) => {
    setSavingShorthand(true)
    try {
      const res = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-race-shorthand', raceName, shorthand }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Save failed: ${res.status}`)
      }
      await fetchRaceShorthands()
      setEditingShorthandFor(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save shorthand')
    } finally {
      setSavingShorthand(false)
    }
  }

  useEffect(() => { fetchRaces() }, [])

  return (
    <>
                    <div className="flex flex-col min-h-0">
                  <div className="flex-shrink-0 space-y-3 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setShowAddRace(!showAddRace)}
                          className={btnPrimary}
                        >
                          {showAddRace ? 'Cancel' : '+ Add Race'}
                        </button>
                      </div>
                      {/* Progress through the backlog. The nightly sweep is
                          replacing computed dates with checked ones, and this
                          is the only place the size of that job is visible. */}
                      {races.length > 0 && (() => {
                        const unverified = races.filter(
                          r => !['manual', 'config', 'scraped', 'researched'].includes(r.raceDateSource || '')
                        ).length
                        return (
                          <span className="text-xs text-off-black/50">
                            {unverified === 0
                              ? `All ${races.length} dates verified`
                              : `${races.length - unverified} of ${races.length} dates verified`}
                          </span>
                        )
                      })()}
                    </div>
                    {/* Search bar — filters race groups by name (and location/year) */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search races by name, year, or location…"
                        value={raceDbSearch}
                        onChange={(e) => setRaceDbSearch(e.target.value)}
                        className={`${inputBase} w-full pl-8 pr-8`}
                      />
                      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-off-black/40" />
                      {raceDbSearch && (
                        <button
                          onClick={() => setRaceDbSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-off-black/40 hover:text-off-black/70"
                          title="Clear search"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      {raceDbSearch && (
                        <div className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <button
                            onClick={() => {
                              // Expand all matching groups when searching
                              const matches = Array.from(new Set(races.map(r => r.raceName)))
                                .filter(name => name.toLowerCase().includes(raceDbSearch.toLowerCase()))
                              setExpandedRaceGroups(new Set(matches))
                            }}
                            className="text-[10px] text-off-black/50 hover:text-off-black underline"
                          >
                            Expand all
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6">
                    {/* Add Race Form */}
                    {showAddRace && (
                      <div className="mb-4 p-4 bg-subtle-gray border border-border-gray rounded-lg space-y-3">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Race Name"
                            value={newRaceValues.raceName}
                            onChange={(e) => setNewRaceValues(prev => ({ ...prev, raceName: e.target.value }))}
                            className={`${inputBase} flex-1`}
                          />
                          <input
                            type="number"
                            placeholder="Year"
                            value={newRaceValues.year}
                            onChange={(e) => setNewRaceValues(prev => ({ ...prev, year: e.target.value }))}
                            className="w-24 px-3 py-2 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            value={newRaceValues.raceDate}
                            onChange={(e) => setNewRaceValues(prev => ({ ...prev, raceDate: e.target.value }))}
                            className={`${inputBase} flex-1`}
                          />
                          <input
                            type="text"
                            placeholder="Location (e.g. Boston, MA)"
                            value={newRaceValues.location}
                            onChange={(e) => setNewRaceValues(prev => ({ ...prev, location: e.target.value }))}
                            className={`${inputBase} flex-1`}
                          />
                        </div>
                        <button
                          onClick={createRace}
                          disabled={isSavingRace}
                          className={`${btnPrimary} w-full py-2`}
                        >
                          {isSavingRace ? 'Creating...' : 'Create Race'}
                        </button>
                      </div>
                    )}

                    {/* Race List — grouped by raceName, with year entries nested.
                        Each group exposes the filename shorthand for editing. */}
                    {isLoadingRaces ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-off-black/40" />
                      </div>
                    ) : races.length === 0 ? (
                      <p className="text-sm text-off-black/40 text-center py-8">No races in database</p>
                    ) : (() => {
                      // Group all races by raceName
                      const grouped = races.reduce<Record<string, typeof races>>((acc, r) => {
                        (acc[r.raceName] ||= []).push(r)
                        return acc
                      }, {})

                      // Apply search filter — matches against race name, year, or location
                      const q = raceDbSearch.trim().toLowerCase()
                      const filteredEntries = Object.entries(grouped)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .filter(([raceName, group]) => {
                          if (!q) return true
                          if (raceName.toLowerCase().includes(q)) return true
                          return group.some(r =>
                            String(r.year).includes(q) ||
                            (r.location || '').toLowerCase().includes(q)
                          )
                        })

                      if (filteredEntries.length === 0) {
                        return <p className="text-sm text-off-black/40 text-center py-8">No races match "{raceDbSearch}"</p>
                      }

                      return (
                      <div className="space-y-3">
                        {filteredEntries
                          .map(([raceName, group]) => {
                            const sortedYears = [...group].sort((a, b) => b.year - a.year)
                            const currentShorthand = raceShorthands[raceName] || ''
                            const isOverridden = !!raceShorthandOverrides[raceName]
                            const isEditingThis = editingShorthandFor === raceName
                            const isExpanded = expandedRaceGroups.has(raceName)
                            const toggleExpanded = () => {
                              setExpandedRaceGroups(prev => {
                                const next = new Set(prev)
                                if (next.has(raceName)) next.delete(raceName)
                                else next.add(raceName)
                                return next
                              })
                            }
                            // Show year range in collapsed header for quick scanning
                            const yearRange = sortedYears.length === 1
                              ? String(sortedYears[0].year)
                              : `${sortedYears[sortedYears.length - 1].year}–${sortedYears[0].year}`
                            return (
                              <div key={raceName} className="rounded-lg border border-border-gray overflow-hidden">
                                {/* Group header — clicking the left side toggles expand;
                                    inner buttons (filename edit) stop propagation. */}
                                <div className="bg-off-black/[0.03] flex items-center gap-3 border-b border-border-gray">
                                  <button
                                    type="button"
                                    onClick={toggleExpanded}
                                    className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 hover:bg-off-black/[0.04] transition-colors text-left"
                                    aria-expanded={isExpanded}
                                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${raceName}`}
                                  >
                                    {isExpanded
                                      ? <ChevronDownIcon className="w-4 h-4 text-off-black/50 shrink-0" />
                                      : <ChevronRight className="w-4 h-4 text-off-black/50 shrink-0" />
                                    }
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-semibold text-off-black truncate">{raceName}</div>
                                      <div className="text-[11px] text-off-black/40 mt-0.5">
                                        {sortedYears.length} {sortedYears.length === 1 ? 'year' : 'years'} · {yearRange}
                                      </div>
                                    </div>
                                  </button>
                                  <div className="flex items-center gap-2 px-4">
                                    <span className="text-[10px] text-off-black/40 uppercase tracking-wider">Filename</span>
                                    {isEditingThis ? (
                                      <>
                                        <input
                                          type="text"
                                          value={editingShorthandValue}
                                          onChange={(e) => setEditingShorthandValue(e.target.value)}
                                          placeholder="e.g. Boston"
                                          autoFocus
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-28 px-2 py-1 text-xs border border-border-gray rounded bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveRaceShorthand(raceName, editingShorthandValue)
                                            if (e.key === 'Escape') setEditingShorthandFor(null)
                                          }}
                                        />
                                        <button
                                          onClick={(e) => { e.stopPropagation(); saveRaceShorthand(raceName, editingShorthandValue) }}
                                          disabled={savingShorthand}
                                          className="text-xs text-green-600 hover:text-green-700 disabled:opacity-50"
                                        >
                                          {savingShorthand ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setEditingShorthandFor(null) }}
                                          className="text-xs text-off-black/50 hover:text-off-black/70"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingShorthandFor(raceName); setEditingShorthandValue(currentShorthand) }}
                                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-mono rounded border ${
                                          isOverridden
                                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                                            : 'bg-white border-border-gray text-off-black/70 hover:bg-off-black/5'
                                        }`}
                                        title={isOverridden ? 'User-set override (click to edit)' : 'Default from scraper config (click to override)'}
                                      >
                                        {currentShorthand || '-'}
                                        <Pencil className="w-2.5 h-2.5 opacity-50" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {/* Body — merge controls + year entries. Only rendered when expanded. */}
                                {isExpanded && (<>
                                {/* Merge controls — inline picker when this group is the active merge source */}
                                {mergingRace === raceName ? (
                                  <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                                    <span className="text-[11px] text-amber-900 shrink-0">Merge <strong>{raceName}</strong> into:</span>
                                    <select
                                      value={mergeTarget}
                                      onChange={(e) => setMergeTarget(e.target.value)}
                                      className="flex-1 min-w-0 px-2 py-1 text-xs border border-amber-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-300"
                                      autoFocus
                                    >
                                      <option value="">Choose canonical race…</option>
                                      {Array.from(new Set(races.map(r => r.raceName)))
                                        .filter(n => n !== raceName)
                                        .sort()
                                        .map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                    <button
                                      onClick={() => mergeRace(raceName, mergeTarget)}
                                      disabled={!mergeTarget || isMergingRace}
                                      className="px-2.5 py-1 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                                    >
                                      {isMergingRace ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                      {isArmed(`merge:${raceName}>${mergeTarget}`) ? 'Click again to merge: every order re-points, no undo' : 'Merge'}
                                    </button>
                                    <button
                                      onClick={() => { setMergingRace(null); setMergeTarget('') }}
                                      className="text-xs text-off-black/50 hover:text-off-black/70 p-1"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="px-4 py-1.5 bg-off-black/[0.01] border-b border-border-gray flex justify-end">
                                    <button
                                      onClick={() => { setMergingRace(raceName); setMergeTarget('') }}
                                      className="text-[11px] text-off-black/50 hover:text-off-black transition-colors inline-flex items-center gap-1"
                                      title="Consolidate this race into another (renames orders + race entries)"
                                    >
                                      Merge into…
                                    </button>
                                  </div>
                                )}
                                {/* Year entries */}
                                <div className="divide-y divide-border-gray">
                                  {sortedYears.map((race) => (
                                    <div key={race.id} className="py-2.5 px-4 bg-white">
                                      {editingRaceId === race.id ? (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium text-off-black">{race.raceName} {race.year}</span>
                                  <div className="flex items-center gap-3">
                                    <button
                                      onClick={() => saveRaceEdit(race.id)}
                                      disabled={isSavingRace}
                                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 transition-colors disabled:opacity-50"
                                    >
                                      {isSavingRace ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                      Save
                                    </button>
                                    <button
                                      onClick={() => setEditingRaceId(null)}
                                      className="flex items-center gap-1 text-xs text-off-black/50 hover:text-off-black/70 transition-colors"
                                    >
                                      <X className="w-3 h-3" />
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-[11px] text-off-black/50 block mb-1">Date</label>
                                    <input
                                      type="date"
                                      value={raceEditValues.raceDate}
                                      onChange={(e) => setRaceEditValues(prev => ({ ...prev, raceDate: e.target.value }))}
                                      className="w-full px-3 py-1.5 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] text-off-black/50 block mb-1">Location</label>
                                    <input
                                      type="text"
                                      value={raceEditValues.location}
                                      onChange={(e) => setRaceEditValues(prev => ({ ...prev, location: e.target.value }))}
                                      placeholder="e.g. Austin, TX"
                                      className="w-full px-3 py-1.5 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] text-off-black/50 block mb-1">Weather</label>
                                    <select
                                      value={raceEditValues.weatherCondition}
                                      onChange={(e) => setRaceEditValues(prev => ({ ...prev, weatherCondition: e.target.value }))}
                                      className="w-full px-3 py-1.5 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                                    >
                                      <option value="">--</option>
                                      <option value="Sunny">Sunny</option>
                                      <option value="Cloudy">Cloudy</option>
                                      <option value="Rainy">Rainy</option>
                                      <option value="Snowy">Snowy</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[11px] text-off-black/50 block mb-1">Temp</label>
                                    <input
                                      type="text"
                                      value={raceEditValues.weatherTemp}
                                      onChange={(e) => setRaceEditValues(prev => ({ ...prev, weatherTemp: e.target.value }))}
                                      placeholder="e.g. 65°F"
                                      className="w-full px-3 py-1.5 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                                    />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="text-[11px] text-off-black/50 block mb-1">Date source (link where the date is confirmed)</label>
                                    <input
                                      type="url"
                                      value={raceEditValues.sourceUrl}
                                      onChange={(e) => setRaceEditValues(prev => ({ ...prev, sourceUrl: e.target.value }))}
                                      placeholder="https://..."
                                      className="w-full px-3 py-1.5 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                                    />
                                  </div>
                                  {race.firstPrintedAt && (
                                    <div className="col-span-2">
                                      <label className="text-[11px] text-off-black/50 block mb-1">Already printed. Reason for the change</label>
                                      <input
                                        type="text"
                                        value={raceEditValues.reason}
                                        onChange={(e) => setRaceEditValues(prev => ({ ...prev, reason: e.target.value }))}
                                        className="w-full px-3 py-1.5 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-off-black w-12 shrink-0 tabular-nums">{race.year}</span>
                                <div className="flex-1 flex items-center gap-4 text-xs text-off-black/50 min-w-0">
                                  {race.raceDate && (
                                    <span className="flex items-center gap-1.5 shrink-0">
                                      {new Date(race.raceDate).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}
                                      <DateSourceBadge source={race.raceDateSource} />
                                      <SourceLinks url={race.raceDateSourceUrl} evidence={race.raceDateEvidence} />
                                      {race.firstPrintedAt && <span title="A print with this date has been approved. Changing it needs a reason." className="cursor-help">🔒</span>}
                                    </span>
                                  )}
                                  {race.location && <span className="truncate">{race.location}</span>}
                                  {race.weatherCondition && <span>{race.weatherCondition.charAt(0).toUpperCase() + race.weatherCondition.slice(1)}</span>}
                                  {race.weatherTemp && <span>{race.weatherTemp}</span>}
                                </div>
                                <button
                                  onClick={() => startEditingRace(race)}
                                  className="text-blue-600 hover:text-blue-700 transition-colors shrink-0"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                                    </div>
                                  ))}
                                </div>
                                </>)}{/* /isExpanded body */}
                              </div>
                            )
                          })}
                      </div>
                      )
                    })()}
                  </div>
                    </div>
    </>
  )
}
