import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import AppSidebar, { MobileToolBar } from '@/components/AppSidebar'
import CustomTools from '@/components/CustomTools'
import StandardTools from '@/components/StandardTools'
import CommandSearch from '@/components/CommandSearch'

/**
 * Everything that has to outlive a page change.
 *
 * The rail started life inside Dashboard, which meant it vanished the moment
 * you clicked Creators - the whole point of a rail is that it is still there
 * when you arrive. It lives here now, wrapping every signed-in route, so the
 * tools and the current-page marker survive navigation.
 *
 * The two tool panels come along for the ride. They are self-contained popups,
 * so Discounts and Pace now work on the Creators page too.
 *
 * Settings is the exception and it is worth being honest about why. That modal
 * is several hundred lines of Dashboard - pricing, stats, people, the race
 * database - and lifting it out is a much bigger change than making the rail
 * persist. So from anywhere else, Settings routes home and asks Dashboard to
 * open it. The user lands on the dashboard with the panel already up, which is
 * where all of those settings act anyway.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { can } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [railPanel, setRailPanel] = useState<null | 'discounts' | 'pace'>(null)
  // Cmd+D (Ctrl+D elsewhere) opens the Discounts tool from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setRailPanel(p => (p === 'discounts' ? null : 'discounts'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const path = location.pathname
  const settingsOpen = path === '/settings' || path.startsWith('/settings/')
  const activeId =
    settingsOpen ? 'settings'
    : railPanel === 'discounts' ? 'discounts'
    : railPanel === 'pace' ? 'pace'
    : path.startsWith('/creators') || path.startsWith('/briefs') ? 'creators'
    : path.startsWith('/sales') || path.startsWith('/send') ? 'sales'
    : path.startsWith('/support') ? 'support'
    : path.startsWith('/surveys') ? 'surveys'
    : path.startsWith('/samples') ? 'samples'
    : 'fulfillment'

  const openSettings = () => {
    // Close whatever panel is open first. Without this the old tile keeps
    // its white card while the settings modal is up, and its popup sits
    // behind the modal where it cannot be closed.
    setRailPanel(null)
    // `replace` so Settings does not stack history entries you have to
    // click back through.
    navigate('/settings')
  }

  return (
    // Room for the rail on the left on desktop, and for the bar along the
    // bottom on a phone, so neither covers the page's own content.
    <div className="md:pl-[92px] pb-[calc(92px+env(safe-area-inset-bottom))] md:pb-0">
      <MobileToolBar
        can={can}
        activeId={activeId}
        onOpenSettings={openSettings}
      />
      <AppSidebar
        can={can}
        activeId={activeId}
        onOpenDiscounts={() => setRailPanel(p => (p === 'discounts' ? null : 'discounts'))}
        onOpenPaceConverter={() => setRailPanel(p => (p === 'pace' ? null : 'pace'))}
        onOpenSettings={openSettings}
      />
      <CustomTools open={railPanel === 'pace'} onClose={() => setRailPanel(null)} />
      <StandardTools open={railPanel === 'discounts'} onClose={() => setRailPanel(null)} />
      <CommandSearch can={can} onOpenSettings={openSettings} />
      {children}
    </div>
  )
}
