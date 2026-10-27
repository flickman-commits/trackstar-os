/** The ⌘K search's open signal, for buttons (the phone header's) where there is no ⌘K. */
export const OPEN_SEARCH_EVENT = 'trackstar:open-search'
export function openCommandSearch() { window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)) }
