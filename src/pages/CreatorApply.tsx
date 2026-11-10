import { useEffect, useState } from 'react'
import { Loader2, Check, ArrowRight } from 'lucide-react'
import SiteFooter from '@/components/SiteFooter'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Public creator-program landing page. Single CTA -> mints a fresh invite
// token and drops the applicant straight into the onboarding wizard.
//
// Styled to match charity.trackstar.art (the Charity Bib Finder), which uses
// the storefront's design system (trackstar-art assets/trackstar-system.css):
// Helvetica at -0.04em, purple #4600D6, a slim white header with the wordmark
// and a divider, a big centered hero, warm gray rounded panels, 8px controls.
const TS = {
  purple: '#4600D6',
  purpleHover: '#3A00B0',
  ink: '#1E1E1E',
  gray: '#F6F5F2',
  muted: '#666666',
  border: '#E0E0E0',
  font: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
}
const WORDMARK = 'https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png'
const STORE = 'https://www.trackstar.art/collections/marathons?utm_source=creator-program&utm_medium=referral'

export default function CreatorApply() {
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { document.title = 'Trackstar Creator Program' }, [])

  const handleApply = async () => {
    setIsStarting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/public/creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Failed to start application (${res.status})`)
      }
      const { inviteToken } = await res.json()
      if (!inviteToken) throw new Error('No invite token returned')
      // A full page load, not an in-app move: session recording runs on this
      // page and must not carry on onto the invite page, whose address is the token.
      window.location.assign(`/creator/${inviteToken}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start application')
      setIsStarting(false)
    }
  }

  const applyButton = (block = false) => (
    <button
      onClick={handleApply}
      disabled={isStarting}
      className={`inline-flex items-center justify-center gap-2 font-bold text-white transition-colors disabled:opacity-60 ${block ? 'w-full sm:w-auto' : ''}`}
      style={{ minHeight: 56, padding: '16px 28px', fontSize: 16, borderRadius: 8, letterSpacing: '-0.04em', backgroundColor: TS.purple }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = TS.purpleHover }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = TS.purple }}
    >
      {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      Apply Now
      {!isStarting && <ArrowRight className="w-4 h-4" />}
    </button>
  )

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: TS.font, letterSpacing: '-0.02em' }}>
      {/* Slim header: wordmark, a divider, the page's name. Same as the finder. */}
      <header className="sticky top-0 z-20 bg-white" style={{ borderBottom: `1px solid ${TS.border}` }}>
        <div className="mx-auto flex items-center gap-4 px-4 md:px-6" style={{ maxWidth: 1120, minHeight: 60 }}>
          <div className="flex items-center gap-2.5 shrink-0">
            <a href={STORE}><img src={WORDMARK} alt="Trackstar" className="w-[100px] md:w-[124px] h-auto" /></a>
            <span className="font-bold text-sm md:text-[19px] whitespace-nowrap pl-2.5" style={{ borderLeft: `1px solid ${TS.border}` }}>Creator Program</span>
          </div>
          <nav className="ml-auto">
            <button onClick={handleApply} disabled={isStarting} className="font-medium text-[15px] hover:underline underline-offset-4" style={{ color: TS.purple }}>
              Apply
            </button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: text and the action on the left, the prints in creators'
            hands on the right. Stacked and centered on a phone. */}
        <section className="px-4 md:px-6 pt-14 md:pt-24 lg:pt-28 pb-16 md:pb-24">
          <div className="mx-auto grid grid-cols-1 lg:grid-cols-2 items-center gap-12 lg:gap-10" style={{ maxWidth: 1120 }}>
            <div className="text-center lg:text-left">
              <h1 className="font-bold mx-auto lg:mx-0" style={{ fontSize: 'clamp(44px, 5.6vw, 72px)', lineHeight: 0.98, letterSpacing: '-0.05em', maxWidth: '16ch', textWrap: 'balance' }}>
                Get a Trackstar print in exchange for creating 3 videos.
              </h1>
              <p className="mx-auto lg:mx-0 mt-4" style={{ color: TS.muted, fontSize: 'clamp(18px, 2vw, 22px)', lineHeight: 1.35, maxWidth: '40ch' }}>
                Your name, bib, finish time and course, on a print made for your wall. In exchange for 3 short videos.
              </p>
              <div className="mt-8 flex justify-center lg:justify-start">{applyButton(true)}</div>
              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            </div>

            <div className="relative mx-auto w-full h-72 md:h-96" style={{ maxWidth: 520 }}>
              {[
                { src: '/Nat_UGC.png', alt: 'Nat with her Trackstar print', t: 'translateX(-110%) rotate(-10deg)', z: 10, top: 'top-4' },
                { src: '/Sophie_UGC.png', alt: 'Sophie with her Trackstar print', t: 'translateX(10%) rotate(10deg)', z: 10, top: 'top-4' },
                { src: '/Tim_UGC_1.jpg', alt: 'Tim with his Trackstar print', t: 'translateX(-50%)', z: 20, top: 'top-0' },
              ].map(p => (
                <img
                  key={p.src}
                  src={p.src}
                  alt={p.alt}
                  className={`absolute ${p.top} left-1/2 w-40 h-56 md:w-52 md:h-72 object-cover`}
                  style={{ borderRadius: 8, transform: p.t, zIndex: p.z, boxShadow: '0 12px 32px rgba(0,0,0,0.18)' }}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Prints for content: a gray panel, like the finder's alternating sections. */}
        <section className="mx-2 md:mx-4 rounded-[18px] md:rounded-[24px] px-4 md:px-6 py-12 md:py-20" style={{ backgroundColor: TS.gray }}>
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            <h2 className="text-center font-bold" style={{ fontSize: 'clamp(36px, 5vw, 52px)', lineHeight: 1.05, letterSpacing: '-0.04em' }}>Trackstar Prints 🤝 Content</h2>
            <div className="mt-8 md:mt-10 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <Card eyebrow="What you get">
                <Bullet><strong>A personalized Trackstar race print</strong> customized with your name, bib, finish time, and the course you ran.</Bullet>
              </Card>
              <Card eyebrow="What we ask">
                <Bullet><strong>3 short-form videos</strong> (TikTok or Reels) within 7 days of receiving your print.</Bullet>
              </Card>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-4 md:px-6 py-12 md:py-20">
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            <h2 className="text-center font-bold" style={{ fontSize: 'clamp(36px, 5vw, 52px)', lineHeight: 1.05, letterSpacing: '-0.04em' }}>How it works</h2>
            <div className="mt-8 md:mt-10 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <Step n={1} title="Apply">Tell us why you're a good fit, which race you ran, and your address.</Step>
              <Step n={2} title="Approve">If it's a good fit, we'll approve!</Step>
              <Step n={3} title="Film Content">We'll give a full brief on how to do it.</Step>
            </div>
            <div className="mt-10 md:mt-14 flex justify-center">{applyButton(true)}</div>
            {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
          </div>
        </section>
      </main>

      {/* The real trackstar.art footer. */}
      <SiteFooter />
    </div>
  )
}

function Card({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg p-6 md:p-8" style={{ border: `1px solid ${TS.border}` }}>
      <div className="text-xs font-bold uppercase mb-4" style={{ color: TS.purple, letterSpacing: '0.04em' }}>{eyebrow}</div>
      {children}
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-base md:text-lg leading-snug">
      <Check className="w-5 h-5 mt-0.5 shrink-0" style={{ color: TS.purple }} />
      <span>{children}</span>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-6 md:p-8" style={{ backgroundColor: TS.gray }}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white mb-4" style={{ backgroundColor: TS.purple }}>{n}</div>
      <div className="text-xl font-bold mb-1.5" style={{ letterSpacing: '-0.04em' }}>{title}</div>
      <div className="text-base leading-snug" style={{ color: TS.muted }}>{children}</div>
    </div>
  )
}
