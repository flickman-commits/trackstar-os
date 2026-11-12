/**
 * The event (distance) a print is for, before research has confirmed which
 * one the runner actually ran. Read off what the customer told the widget,
 * else off the race's name: a product called "Philadelphia Marathon" sells
 * the marathon. Research overrides this when it finds the runner in a
 * different event, which is the case worth flagging.
 */
export function eventFromName(raceName) {
  const n = String(raceName || '')
  if (/half/i.test(n)) return 'Half Marathon'
  if (/ten[- ]?miler|10[- ]?mile/i.test(n)) return '10 Miler'
  if (/\b10k\b/i.test(n)) return '10K'
  if (/\b8k\b/i.test(n)) return '8K'
  if (/\b5k\b/i.test(n)) return '5K'
  if (/marathon/i.test(n)) return 'Marathon'
  return null
}

/** { eventType, eventTypeSource: 'research' | 'customer' | 'product' | null } */
export function resolveEvent(research, order, raceName) {
  if (research?.eventType) return { eventType: research.eventType, eventTypeSource: 'research' }
  if (order?.customerEventType) return { eventType: order.customerEventType, eventTypeSource: 'customer' }
  const fromName = eventFromName(raceName)
  return fromName ? { eventType: fromName, eventTypeSource: 'product' } : { eventType: null, eventTypeSource: null }
}
