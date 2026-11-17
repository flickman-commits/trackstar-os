/**
 * This card's view of your timer, told to the rest of the page (the Hours
 * button in the queue header) so nothing else has to ask the server too.
 * The last one is kept for a button that mounts later.
 */
export const HOURS_STATE = 'hours:state'
export type HoursState = { running: boolean; startedAt: string | null; carriedMinutes: number; paused: boolean }
let lastState: HoursState | null = null
export const hoursState = () => lastState
export const tell = (s: HoursState) => { lastState = s; window.dispatchEvent(new CustomEvent(HOURS_STATE, { detail: s })) }
