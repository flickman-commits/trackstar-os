/** Fired by any page to open the Hours Tracker (AppShell listens). */
export const OPEN_HOURS_EVENT = 'trackstar:open-hours'
export const openHours = () => window.dispatchEvent(new Event(OPEN_HOURS_EVENT))
