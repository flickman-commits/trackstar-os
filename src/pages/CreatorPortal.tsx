import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useParams } from 'react-router-dom'
import PrintPicker from '@/components/PrintPicker'
import { Loader2, AlertTriangle, ChevronRight, ChevronLeft, ChevronDown, ClipboardList, CheckCircle2, Truck, Home, ExternalLink, Printer } from 'lucide-react'
import { TRYBE_URL } from '@/lib/creatorLinks'

const API_BASE = import.meta.env.VITE_API_URL || ''

type PortalState = 'loading' | 'error' | 'expired' | 'onboarding' | 'dashboard'

interface PortalBrief {
  id: string
  title: string
  description: string | null
  styleOfVideo: string | null
  angle: string | null
  targetLength: string | null
  hooks: string | null
  emotion: string | null
  fomo: string | null
  persona: string | null
  examplesNotes: string | null
}

interface PortalCreator {
  id: string
  name: string | null
  email: string | null
  instagramHandle: string | null
  tiktokHandle: string | null
  bestContentLinks: string | null
  whyWorkWithUs: string | null
  raceName: string | null
  productTitle?: string | null
  raceYear: number | null
  bibNumber: string | null
  finishTime: string | null
  productSize: string | null
  frameType: string | null
  shippingName: string | null
  shippingAddress1: string | null
  shippingAddress2: string | null
  shippingCity: string | null
  shippingState: string | null
  shippingZip: string | null
  shippingCountry: string | null
  status: string
  onboardedAt: string | null
}

/** Where their sample is, read live from Artelo and Shopify (server/domain/creators/portal.js). */
interface PortalSampleStatus {
  stage: 'approved' | 'in_production' | 'shipped' | 'delivered'
  tracking: { url: string | null; carrier: string | null; number: string | null; shippedAt: string | null; deliveredAt: string | null; estimatedAt: string | null } | null
}

interface PortalCreatorSampleOrder {
  id: string
  orderNumber: string
  status: string
  createdAt: string
  trackingNumber: string | null
  trackingCarrier: string | null
  shippedAt: string | null
}

interface RaceOption {
  id: number
  raceName: string
  year: number
}

/** A print from the store (names and pictures only). */
interface CatalogPrint { title: string; label: string; race: string; edition: string | null; image: string | null; sizes: string[]; frames: string[] }

interface PortalData {
  creator: PortalCreator
  briefs: PortalBrief[]
  sampleOrder: PortalCreatorSampleOrder | null
  sampleStatus?: PortalSampleStatus | null
  races: RaceOption[]
  /** The store's prints, the same list every picker uses. */
  catalog?: CatalogPrint[]
  winningAds?: { id: string; title: string; url: string; imageUrl: string | null; notes: string | null }[]
}

export default function CreatorPortal() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PortalState>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [data, setData] = useState<PortalData | null>(null)

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/public/creator?token=${encodeURIComponent(token)}`)
      if (res.status === 404) {
        setState('expired')
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErrorMessage(j.error || 'Something went wrong')
        setState('error')
        return
      }
      const payload: PortalData = await res.json()
      setData(payload)
      setState(payload.creator.onboardedAt ? 'dashboard' : 'onboarding')
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Something went wrong')
      setState('error')
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  if (state === 'loading') {
    return <FullscreenCenter><Loader2 className="w-8 h-8 animate-spin text-off-black/40" /></FullscreenCenter>
  }
  if (state === 'expired') {
    return (
      <FullscreenCenter>
        <div className="max-w-sm text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">Link not found</h1>
          <p className="text-sm text-off-black/60">
            This invite link is no longer valid. Reach out to Matt for a new one.
          </p>
        </div>
      </FullscreenCenter>
    )
  }
  if (state === 'error') {
    return (
      <FullscreenCenter>
        <div className="max-w-sm text-center">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-off-black/60">{errorMessage}</p>
        </div>
      </FullscreenCenter>
    )
  }
  if (!data) return null

  return state === 'dashboard'
    ? <CreatorDashboard data={data} />
    : <OnboardingWizard data={data} token={token!} onDone={fetchData} />
}

// ---------------------------------------------------------------------------
// Onboarding Wizard
// ---------------------------------------------------------------------------

type Step = 0 | 1 | 2 | 3 | 4 | 5

interface OnboardingDraft {
  // Step 1: profile + application questions
  name: string
  email: string
  instagramHandle: string
  tiktokHandle: string
  bestContentLinks: string  // freeform — URLs / handles
  whyWorkWithUs: string     // optional pitch
  // Step 2: which print (from the store catalog) and the year they ran it
  productTitle: string
  raceName: string
  raceYear: string  // string for <select> binding
  // Step 3: product
  productSize: string
  frameType: string
  // Step 4: shipping
  shippingName: string
  shippingAddress1: string
  shippingAddress2: string
  shippingCity: string
  shippingState: string
  shippingZip: string
  shippingCountry: string
}

const PRODUCT_SIZES = ['8x10', '12x18']
const FRAME_TYPES = ['Unframed', 'Black Oak', 'Natural Oak']

function OnboardingWizard({ data, token, onDone }: {
  data: PortalData
  token: string
  onDone: () => void | Promise<void>
}) {
  const [step, setStep] = useState<Step>(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agreedToContent, setAgreedToContent] = useState(false)
  const [draft, setDraft] = useState<OnboardingDraft>({
    name: data.creator.name || '',
    email: data.creator.email || '',
    instagramHandle: data.creator.instagramHandle || '',
    tiktokHandle: data.creator.tiktokHandle || '',
    bestContentLinks: data.creator.bestContentLinks || '',
    whyWorkWithUs: data.creator.whyWorkWithUs || '',
    productTitle: data.creator.productTitle || '',
    raceName: data.creator.raceName || '',
    raceYear: data.creator.raceYear ? String(data.creator.raceYear) : '',
    productSize: data.creator.productSize || '',
    frameType: data.creator.frameType || '',
    shippingName: data.creator.shippingName || data.creator.name || '',
    shippingAddress1: data.creator.shippingAddress1 || '',
    shippingAddress2: data.creator.shippingAddress2 || '',
    shippingCity: data.creator.shippingCity || '',
    shippingState: data.creator.shippingState || '',
    shippingZip: data.creator.shippingZip || '',
    shippingCountry: data.creator.shippingCountry || 'US',
  })

  const totalSteps = 6

  // Per-step validation — only blocks Next when a hard-required field is empty
  const canProceed = () => {
    if (step === 0) return true // welcome
    if (step === 1) return draft.name.trim().length > 0 && draft.email.trim().length > 0 && draft.whyWorkWithUs.trim().length > 0
    if (step === 2) return draft.productTitle.length > 0 && draft.raceYear.length > 0
    if (step === 3) return draft.productSize.length > 0 && draft.frameType.length > 0
    if (step === 4) return (
      draft.shippingName.trim().length > 0 &&
      draft.shippingAddress1.trim().length > 0 &&
      draft.shippingCity.trim().length > 0 &&
      draft.shippingState.trim().length > 0 &&
      draft.shippingZip.trim().length > 0
    )
    if (step === 5) return agreedToContent
    return true
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/public/creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'onboard',
          token,
          data: {
            name: draft.name.trim(),
            email: draft.email.trim(),
            instagramHandle: draft.instagramHandle.trim() || null,
            tiktokHandle: draft.tiktokHandle.trim() || null,
            bestContentLinks: draft.bestContentLinks.trim() || null,
            whyWorkWithUs: draft.whyWorkWithUs.trim() || null,
            productTitle: draft.productTitle || null,
            raceName: draft.raceName || null,
            raceYear: draft.raceYear || null,
            productSize: draft.productSize,
            frameType: draft.frameType,
            shippingName: draft.shippingName.trim(),
            shippingAddress1: draft.shippingAddress1.trim(),
            shippingAddress2: draft.shippingAddress2.trim() || null,
            shippingCity: draft.shippingCity.trim(),
            shippingState: draft.shippingState.trim(),
            shippingZip: draft.shippingZip.trim(),
            shippingCountry: draft.shippingCountry.trim() || 'US',
          }
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Onboarding failed (${res.status})`)
      }
      await onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="h-screen bg-[#F0F0F0] flex flex-col">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 md:px-6 pt-8 pb-6">
          <div className="bg-white border border-border-gray rounded-md shadow-sm p-5 md:p-6">
            {step === 0 && <StepWelcome briefs={data.briefs} />}
            {step === 1 && <StepProfile draft={draft} setDraft={setDraft} />}
            {step === 2 && <StepRace draft={draft} setDraft={setDraft} catalog={data.catalog || null} />}
            {step === 3 && <StepProduct draft={draft} setDraft={setDraft} print={(data.catalog || []).find(c => c.title === draft.productTitle) || null} />}
            {step === 4 && <StepShipping draft={draft} setDraft={setDraft} />}
            {step === 5 && (
              <StepContentAgreement
                briefs={data.briefs}
                agreed={agreedToContent}
                setAgreed={setAgreedToContent}
              />
            )}
          </div>
        </div>
      </div>

      {/* Sticky footer: progress + nav */}
      <div className="border-t border-border-gray bg-[#F0F0F0]">
        <div className="max-w-xl mx-auto px-4 md:px-6 py-4">
          <div className="flex items-center gap-1 mb-3 px-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-1 rounded-full ${i <= step ? 'bg-[#4F2DD4]' : 'bg-[#4F2DD4]/15'}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
              disabled={step === 0}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm text-off-black/60 hover:text-off-black hover:bg-off-black/5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            {step < totalSteps - 1 ? (
              <button
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canProceed()}
                className="inline-flex items-center gap-1 px-5 py-2 bg-dark-fill text-white text-sm font-medium rounded hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canProceed() || isSubmitting}
                className="inline-flex items-center gap-2 px-5 py-2 bg-dark-fill text-white text-sm font-medium rounded hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isSubmitting ? 'Submitting…' : 'Agree + Submit'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Steps ----

function StepWelcome(_: { briefs: PortalBrief[] }) {
  return (
    <div>
      <h1 className="text-3xl font-bold text-off-black mb-3 leading-tight text-center">
        Trackstar Creator Program Application
      </h1>

      {/* Subhead badge — sets the "this is quick" expectation right at the top */}
      <div className="flex justify-center mb-4">
        <span className="inline-flex items-center px-3 py-1 text-[11px] font-semibold tracking-wider uppercase bg-[#4F2DD4]/10 text-[#4F2DD4] rounded-full">
          Takes less than 2 min
        </span>
      </div>

      <img
        src="/Tim_UGC_1.jpg"
        alt="Trackstar creator with their print"
        className="w-full h-auto rounded-md mb-4"
      />

      <p className="text-sm text-off-black/80 leading-relaxed">
        ^^ This could be you. Apply below and we'll review your application - if it's a fit we'll ship you a personalized Trackstar print in exchange for some short-form content.
      </p>
    </div>
  )
}

// Simplified content briefs for the application step. Full briefs (with
// guardrails, hook options, persona, etc.) are shown to the creator in
// their portal AFTER acceptance — applicants just need the high-level
// list so they can decide whether to commit. Edit the reference URLs
// when better examples land.
const APPLICATION_CONTENT_BRIEFS = [
  {
    title: 'Surprise Unboxing Video',
    referenceUrl: 'https://www.instagram.com/reel/DV8r0jIDVkS/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
  },
  {
    title: "'Why Trackstar?' Video",
    // Temporarily points to the Trackstar IG profile so applicants get
    // a sense of the brand. Swap in a real reference reel once Matt
    // picks one.
    referenceUrl: 'https://www.instagram.com/trackstar_art/',
  },
  {
    title: 'Race Recap Video',
    referenceUrl: 'https://www.instagram.com/reel/DXseR6sDXzT/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
  },
]

function StepContentAgreement({ briefs: _briefs, agreed, setAgreed }: {
  briefs: PortalBrief[]
  agreed: boolean
  setAgreed: (v: boolean) => void
}) {
  return (
    <div>
      <h2 className="text-3xl font-bold text-off-black mb-4 leading-tight">Content Needed</h2>

      <div className="space-y-2 mb-2">
        {APPLICATION_CONTENT_BRIEFS.map((brief, idx) => (
          <div
            key={brief.title}
            className="flex items-center justify-between gap-3 px-4 py-3 bg-subtle-gray border border-border-gray rounded-md"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="shrink-0 w-6 h-6 rounded-full bg-dark-fill text-white text-xs font-semibold inline-flex items-center justify-center">
                {idx + 1}
              </span>
              <span className="text-sm font-medium text-off-black truncate">{brief.title}</span>
            </div>
            <a
              href={brief.referenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-medium text-[#4F2DD4] hover:underline whitespace-nowrap"
            >
              Reference ↗
            </a>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-off-black/50 italic mb-5">
        *More details on these briefs will be given once you're accepted into the program.
      </p>

      {/* Paid-ads disclosure — sits right above the checkbox so it's part of
          what they're agreeing to. Not hidden, not buried in fine print. */}
      <div className="mb-3 p-4 bg-[#4F2DD4]/5 border border-[#4F2DD4]/20 rounded-md">
        <div className="text-sm font-semibold text-off-black mb-1.5">Agree to be in social media ads</div>
        <p className="text-sm text-off-black/80 leading-relaxed">
          The content you submit may be used as <strong>paid advertising</strong> on Meta (Instagram + Facebook) and other platforms. By checking the box below you're giving Trackstar permission to use your content in ads.
        </p>
      </div>

      <label className="flex items-start gap-3 p-4 bg-subtle-gray border border-border-gray rounded-md cursor-pointer hover:bg-off-black/5 transition-colors">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-[#4F2DD4] cursor-pointer"
        />
        <span className="text-sm text-off-black/90 leading-relaxed">
          By checking this box I'm agreeing to create the above content by 7 days after receiving my print, and I'm giving Trackstar permission to use my content in ads.
        </span>
      </label>
    </div>
  )
}

function StepProfile({ draft, setDraft }: { draft: OnboardingDraft; setDraft: (d: OnboardingDraft) => void }) {
  return (
    <div>
      <h2 className="text-3xl font-bold text-off-black mb-1 leading-tight">Your Info</h2>
      <p className="text-xs text-off-black/60 mb-4">So we know who you are and how to reach you.</p>
      <div className="space-y-3">
        <Field label="Name *" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} autoFocus />
        <Field label="Email *" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} type="email" />
        <SocialField
          label="Instagram"
          prefix="https://www.instagram.com/"
          value={draft.instagramHandle}
          onChange={(v) => setDraft({ ...draft, instagramHandle: v })}
        />
        <SocialField
          label="TikTok"
          prefix="https://www.tiktok.com/@"
          value={draft.tiktokHandle}
          onChange={(v) => setDraft({ ...draft, tiktokHandle: v })}
        />

        {/* Why work with us — required pitch */}
        <div>
          <div className="text-xs text-off-black/60 mb-1">Why do you want to work with us? *</div>
          <textarea
            value={draft.whyWorkWithUs}
            onChange={(e) => setDraft({ ...draft, whyWorkWithUs: e.target.value })}
            placeholder="What caught your eye about our brand? What about it resonates with you?"
            rows={4}
            className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20 bg-white resize-none"
          />
        </div>
      </div>
    </div>
  )
}

function StepRace({ draft, setDraft, catalog }: {
  draft: OnboardingDraft
  setDraft: (d: OnboardingDraft) => void
  catalog: CatalogPrint[] | null
}) {
  // Year options: 2000 to this year, newest first.
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: currentYear - 2000 + 1 }, (_, i) => currentYear - i)

  return (
    <div>
      <h2 className="text-3xl font-bold text-off-black mb-1 leading-tight">Which product do you want?</h2>
      <p className="text-xs text-off-black/60 mb-4">
        Pick the print for the race you ran. We'll find your bib # and finish time for you, based off your name.
      </p>

      <div className="mb-4 p-3 bg-[#4F2DD4]/5 border border-[#4F2DD4]/20 rounded-md">
        <p className="text-sm text-off-black/80 leading-relaxed">
          <strong>To be eligible</strong>, you must've run a race we have a print for. If you don't see your race in the list, we don't have a design for it yet.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-xs text-off-black/60 mb-1">Print *</div>
          <PrintPicker value={draft.productTitle || null} options={catalog} placeholder="Choose your race's print"
            onChange={(p: CatalogPrint) => setDraft({ ...draft, productTitle: p.title, raceName: p.race })} />
        </div>
        <div>
          <div className="text-xs text-off-black/60 mb-1">Year you ran it *</div>
          <select
            value={draft.raceYear}
            onChange={(e) => setDraft({ ...draft, raceYear: e.target.value })}
            className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20 bg-white"
          >
            <option value="">Select a year…</option>
            {yearOptions.map(y => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
        {catalog && catalog.length === 0 && (
          <p className="text-xs text-amber-600 mt-2">The store's prints did not load. Refresh, or reach out to Matt.</p>
        )}
      </div>
    </div>
  )
}

function StepProduct({ draft, setDraft, print }: { draft: OnboardingDraft; setDraft: (d: OnboardingDraft) => void; print: CatalogPrint | null }) {
  // Sizes we send as samples, and the frames this print comes in.
  const sizes = PRODUCT_SIZES.filter(sz => !print || print.sizes.includes(sz))
  const frames = print?.frames.length ? print.frames : FRAME_TYPES
  return (
    <div>
      <h2 className="text-3xl font-bold text-off-black mb-1 leading-tight">If you're approved, which size and frame would you like?</h2>
      <p className="text-xs text-off-black/60 mb-4">We'll send this exact configuration if your application's accepted.</p>

      <div className="mb-4">
        <div className="text-xs text-off-black/60 mb-2">Size *</div>
        <div className="grid grid-cols-3 gap-2">
          {sizes.map(s => (
            <button
              key={s}
              onClick={() => setDraft({ ...draft, productSize: s })}
              className={`py-3 text-sm font-medium rounded border transition-colors ${
                draft.productSize === s
                  ? 'bg-dark-fill text-white border-dark-fill'
                  : 'bg-white text-off-black border-border-gray hover:bg-subtle-gray'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs text-off-black/60 mb-2">Frame *</div>
        <div className="space-y-2">
          {frames.map(f => (
            <button
              key={f}
              onClick={() => setDraft({ ...draft, frameType: f })}
              className={`w-full py-3 px-4 text-sm text-left rounded border transition-colors ${
                draft.frameType === f
                  ? 'bg-dark-fill text-white border-dark-fill'
                  : 'bg-white text-off-black border-border-gray hover:bg-subtle-gray'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function StepShipping({ draft, setDraft }: { draft: OnboardingDraft; setDraft: (d: OnboardingDraft) => void }) {
  return (
    <div>
      <h2 className="text-3xl font-bold text-off-black mb-4 leading-tight">Where should we send it?</h2>
      <div className="space-y-3">
        <Field label="Full name *" value={draft.shippingName} onChange={(v) => setDraft({ ...draft, shippingName: v })} autoFocus />
        <Field label="Address line 1 *" value={draft.shippingAddress1} onChange={(v) => setDraft({ ...draft, shippingAddress1: v })} />
        <Field label="Address line 2" value={draft.shippingAddress2} onChange={(v) => setDraft({ ...draft, shippingAddress2: v })} placeholder="Apt, suite, etc." />
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-3">
            <Field label="City *" value={draft.shippingCity} onChange={(v) => setDraft({ ...draft, shippingCity: v })} />
          </div>
          <div className="col-span-1">
            <Field label="State *" value={draft.shippingState} onChange={(v) => setDraft({ ...draft, shippingState: v })} placeholder="NY" />
          </div>
          <div className="col-span-2">
            <Field label="Zip *" value={draft.shippingZip} onChange={(v) => setDraft({ ...draft, shippingZip: v })} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Post-onboarding Dashboard
// ---------------------------------------------------------------------------
function CreatorDashboard({ data }: { data: PortalData }) {
  const { creator, briefs, sampleOrder, sampleStatus } = data
  const winningAds = data.winningAds || []
  const firstName = creator.name?.split(' ')[0] || 'there'

  // Build the personality bubbles
  const bubbles: string[] = []
  if (creator.raceName) bubbles.push(creator.raceName)
  const sizeYear = [creator.raceYear, creator.productSize].filter(Boolean).join(' • ')
  if (sizeYear) bubbles.push(sizeYear)
  if (creator.shippingCity) bubbles.push(creator.shippingCity)

  return (
    <div className="min-h-screen bg-[#F0F0F0]">
      <div className="max-w-xl mx-auto px-4 md:px-6 py-8">
        <h1 className="text-3xl font-bold text-off-black mb-3 leading-tight">
          Hey {firstName} 👋
        </h1>

        {bubbles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {bubbles.map((b, i) => (
              <span
                key={i}
                className="px-3 py-1 text-xs font-medium text-[#4F2DD4] bg-[#4F2DD4]/10 border border-[#4F2DD4]/20 rounded-full"
              >
                {b}
              </span>
            ))}
          </div>
        )}

        <p className="text-sm text-off-black/60 mb-6">
          Your Trackstar Creator Portal. Please reach out to{' '}
          <a href="mailto:matt@trackstar.art" className="text-[#4F2DD4] hover:underline">
            Matt
          </a>{' '}
          if you have any problems.
        </p>

        {/* Sample tracker — Domino's-style */}
        <div className="bg-white border border-border-gray rounded-md p-5 mb-5">
          <h2 className="text-sm font-semibold text-off-black mb-4">Your Application</h2>
          <SampleTracker order={sampleOrder} status={sampleStatus || null} onboardedAt={creator.onboardedAt} />
          {(() => {
            // Live tracking once it ships; else the number we stored by hand, if any.
            const t = sampleStatus?.tracking
            const carrier = t?.carrier || sampleOrder?.trackingCarrier || null
            const number = t?.number || sampleOrder?.trackingNumber || null
            if (!number && !t?.url) return null
            const when = t?.deliveredAt ? `Delivered ${fmtDay(t.deliveredAt)}` : t?.estimatedAt ? `Expected ${fmtDay(t.estimatedAt)}` : t?.shippedAt ? `Shipped ${fmtDay(t.shippedAt)}` : null
            return (
              <div className="mt-4 pt-4 border-t border-border-gray flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-off-black/50 uppercase tracking-wider font-semibold">Tracking</span>
                {carrier && <span className="text-off-black/70">{carrier}</span>}
                {t?.url
                  ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[#4F2DD4] hover:underline break-all">{number || 'Track your package'}</a>
                  : <span className="font-mono text-off-black break-all">{number}</span>}
                {when && <span className="text-off-black/50">{when}</span>}
              </div>
            )
          })()}
        </div>

        {/* Briefs */}
        {briefs.length > 0 && (
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-off-black mb-3">Your Briefs</h2>
            <div className="space-y-3">
              {briefs.map(b => <CollapsibleBriefCard key={b.id} brief={b} />)}
            </div>
          </div>
        )}

        {/* What's working: ads the team has picked, so creators can see what to make. */}
        {winningAds.length > 0 && (
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-off-black mb-3">What's working</h2>
            <div className="space-y-3">
              {winningAds.map(ad => (
                <a key={ad.id} href={ad.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 bg-white border border-border-gray rounded-md p-3 hover:border-[#4F2DD4]/40 transition-colors">
                  {ad.imageUrl && <img src={ad.imageUrl} alt="" className="w-20 h-24 object-cover rounded shrink-0 bg-subtle-gray" loading="lazy" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-off-black inline-flex items-center gap-1">{ad.title} <ExternalLink className="w-3 h-3 text-off-black/40" /></div>
                    {ad.notes && <p className="text-xs text-off-black/65 mt-1 leading-relaxed whitespace-pre-wrap">{ad.notes}</p>}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Trybe, and the community once it exists. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <a href={TRYBE_URL} target="_blank" rel="noopener noreferrer" className="bg-white border border-border-gray rounded-md p-4 hover:border-[#4F2DD4]/40 transition-colors">
            <div className="text-sm font-semibold text-off-black inline-flex items-center gap-1">Join us on Trybe <ExternalLink className="w-3 h-3 text-off-black/40" /></div>
            <p className="text-xs text-off-black/60 mt-1 leading-relaxed">Where you upload your content, handle revisions, and get it running as an ad. Sign up at jointrybe.com.</p>
          </a>
          <div className="bg-white border border-dashed border-border-gray rounded-md p-4">
            <div className="text-sm font-semibold text-off-black/50">Creator community <span className="ml-1 px-1.5 py-0.5 bg-off-black/5 text-off-black/45 text-[10px] font-medium rounded uppercase tracking-wider align-middle">Coming soon</span></div>
            <p className="text-xs text-off-black/45 mt-1 leading-relaxed">Learn more about which ads are working.</p>
          </div>
        </div>

        {/* Upload reminder card */}
        <div className="bg-white border border-border-gray rounded-md p-5">
          <p className="text-sm text-off-black/80 mb-4 leading-relaxed">
            <strong>Reminder</strong>, please submit content no later than 7 days after receiving your print.
          </p>
          <div className="flex flex-wrap gap-2">
          <a
            href={TRYBE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-dark-fill text-white text-sm font-medium rounded hover:opacity-90 transition-opacity"
          >
            Upload on Trybe <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href="https://drive.google.com/drive/folders/16SZxJ-1wa6cbmVndkCGIaOmxZX-_pGsf?usp=sharing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-border-gray text-off-black text-sm font-medium rounded hover:bg-subtle-gray transition-colors"
          >
            Upload to Google Drive
          </a>
          </div>
          <p className="text-xs text-off-black/50 mt-3">
            *Please email{' '}
            <a href="mailto:matt@trackstar.art" className="text-[#4F2DD4] hover:underline">
              Matt
            </a>{' '}
            or DM{' '}
            <a
              href="https://www.instagram.com/flickman"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#4F2DD4] hover:underline"
            >
              @flickman
            </a>{' '}
            when you've uploaded the content.
          </p>
        </div>
      </div>
    </div>
  )
}

// Domino's-style 4-stage tracker. Each stage reads from independent signals,
// not Order.status — that field is for internal fulfillment, not the creator
// view. Mapping:
//   Applied    → creator submitted their application (`onboardedAt` set)
//   Approved   → admin clicked Approve → fulfillment order exists
//   Shipped    → admin entered a tracking number
//   Delivered  → not wired yet (carrier API or manual, future)
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function SampleTracker({
  order,
  status,
  onboardedAt,
}: {
  order: PortalCreatorSampleOrder | null
  status: PortalSampleStatus | null
  onboardedAt: string | null
}) {
  const stages = [
    { key: 'applied',       label: 'Applied',       Icon: ClipboardList },
    { key: 'approved',      label: 'Approved',      Icon: CheckCircle2 },
    { key: 'in_production', label: 'In production', Icon: Printer },
    { key: 'shipped',       label: 'Shipped',       Icon: Truck },
    { key: 'delivered',     label: 'Delivered',     Icon: Home },
  ] as const

  const stageIndex = (() => {
    // Live from Artelo and Shopify when we have it; else what the order row says.
    if (status) return stages.findIndex(s => s.key === status.stage)
    if (order?.trackingNumber) return 3 // shipped
    if (order) return 1                 // approved
    if (onboardedAt) return 0           // requested
    return -1                           // pre-onboarding
  })()

  return (
    <div className="flex items-start justify-between">
      {stages.map((s, i) => {
        const isReached = i <= stageIndex
        const isCurrent = i === stageIndex
        const Icon = s.Icon
        return (
          <div key={s.key} className="flex-1 flex flex-col items-center relative">
            {/* Connector to previous */}
            {i > 0 && (
              <div
                className={`absolute top-4 right-1/2 w-full h-0.5 ${
                  i <= stageIndex ? 'bg-[#4F2DD4]' : 'bg-off-black/10'
                }`}
              />
            )}
            <div
              className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                isReached
                  ? 'bg-[#4F2DD4] border-[#4F2DD4] text-white'
                  : 'bg-white border-off-black/20 text-off-black/30'
              } ${isCurrent ? 'ring-4 ring-[#4F2DD4]/20' : ''}`}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div
              className={`mt-2 text-[11px] font-medium ${
                isReached ? 'text-off-black' : 'text-off-black/40'
              }`}
            >
              {s.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CollapsibleBriefCard({ brief }: { brief: PortalBrief }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white border border-border-gray rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-off-black/[0.02] transition-colors"
      >
        <h3 className="text-base font-semibold text-off-black">{brief.title}</h3>
        <ChevronDown
          className={`w-5 h-5 text-off-black/50 transition-transform duration-300 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {/* grid-rows trick animates to natural content height */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0 border-t border-border-gray">
            <div className="pt-4">
              <BriefCard brief={brief} hideTitle />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
function BriefCard({ brief, hideTitle = false }: { brief: PortalBrief; hideTitle?: boolean }) {
  return (
    <div className={hideTitle ? '' : 'bg-subtle-gray border border-border-gray rounded-md p-4'}>
      {!hideTitle && <h3 className="text-base font-semibold text-off-black mb-2">{brief.title}</h3>}
      {brief.description && (
        <p className="text-sm text-off-black/70 mb-3">{brief.description}</p>
      )}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {brief.styleOfVideo && <Chip label={`Style: ${brief.styleOfVideo}`} />}
        {brief.targetLength && <Chip label={`Length: ${brief.targetLength}`} />}
        {brief.angle && <Chip label={`Angle: ${brief.angle}`} />}
        {brief.persona && <Chip label={`Persona: ${brief.persona}`} />}
      </div>
      {/* Information framework — the guardrails, not a script. These are
          direction, not lines to read. Creators find their own voice inside. */}
      {(brief.hooks || brief.emotion || brief.fomo) && (
        <div className="mt-2 space-y-2">
          <div className="text-[10px] font-semibold text-off-black/50 uppercase tracking-wider">Framework (guardrails, not a script)</div>
          {brief.hooks && (
            <Box label="Hook - opening line options">
              <pre className="whitespace-pre-wrap text-sm text-off-black/80 font-sans leading-relaxed">{brief.hooks}</pre>
            </Box>
          )}
          {brief.emotion && (
            <Box label="Emotion - the feeling to land">
              <pre className="whitespace-pre-wrap text-sm text-off-black/80 font-sans leading-relaxed">{brief.emotion}</pre>
            </Box>
          )}
          {brief.fomo && (
            <Box label="FOMO - why act now">
              <pre className="whitespace-pre-wrap text-sm text-off-black/80 font-sans leading-relaxed">{brief.fomo}</pre>
            </Box>
          )}
        </div>
      )}
      {brief.examplesNotes && (
        <Box label="Top-performing references">
          <ReferenceList raw={brief.examplesNotes} />
        </Box>
      )}
    </div>
  )
}

function Chip({ label }: { label: string }) {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-medium text-off-black/70 bg-white border border-border-gray rounded">
      {label}
    </span>
  )
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] font-semibold text-off-black/50 uppercase tracking-wider mb-1">{label}</div>
      <div className="bg-white border border-border-gray rounded p-2.5">{children}</div>
    </div>
  )
}

// Renders the brief's `examplesNotes` field as a list of clickable reference links.
// Each line is parsed as `URL` or `URL — note`. Lines without URLs render as plain text
// (legacy briefs that pre-date the structured form).
function ReferenceList({ raw }: { raw: string }) {
  const rows = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const urlMatch = line.match(/https?:\/\/\S+/)
      if (urlMatch) {
        const url = urlMatch[0]
        const note = line.replace(url, '').replace(/^[\s-–-]+/, '').trim()
        return { url, note }
      }
      return { url: '', note: line }
    })

  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="text-off-black/80 leading-relaxed">
          {r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#4F2DD4] hover:underline break-all font-medium"
            >
              {r.url}
            </a>
          ) : null}
          {r.url && r.note ? <span className="text-off-black/40"> - </span> : null}
          {r.note ? <span>{r.note}</span> : null}
        </li>
      ))}
    </ul>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, autoFocus }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-off-black/60 mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
      />
    </div>
  )
}

function SocialField({ label, prefix, value, onChange }: {
  label: string
  prefix: string
  value: string
  onChange: (v: string) => void
}) {
  // Strip the prefix (and any leading @) from whatever the user pastes — we
  // store the full URL so it's clickable later, but the input only shows the
  // handle to keep things tidy.
  const stripPrefix = (raw: string) => {
    let v = raw.trim()
    if (!v) return ''
    // Strip common URL prefixes (with or without protocol/www) for both platforms
    v = v.replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\//i, '')
    v = v.replace(/^@/, '')
    return v.replace(/\/+$/, '')
  }

  // Display just the handle portion in the input
  const handleOnly = (() => {
    if (!value) return ''
    return stripPrefix(value)
  })()

  return (
    <div>
      <div className="text-xs text-off-black/60 mb-1">{label}</div>
      <div className="flex items-center w-full border border-border-gray rounded text-sm focus-within:ring-2 focus-within:ring-off-black/20 overflow-hidden bg-white">
        <span className="px-2 py-2 text-off-black/40 bg-subtle-gray border-r border-border-gray whitespace-nowrap text-xs">
          {prefix}
        </span>
        <input
          type="text"
          value={handleOnly}
          onChange={(e) => {
            const handle = stripPrefix(e.target.value)
            onChange(handle ? `${prefix}${handle}` : '')
          }}
          placeholder="handle"
          className="flex-1 px-2 py-2 focus:outline-none min-w-0"
        />
      </div>
    </div>
  )
}

function FullscreenCenter({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-off-white flex items-center justify-center px-4">
      {children}
    </div>
  )
}
