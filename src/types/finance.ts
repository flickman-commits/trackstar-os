/** Shapes the Finance pages read from /api/finance/*. Money is integer cents. */

export type Totals = {
  revenue: number; shopifyRevenue: number; etsyRevenue: number; cm: number; cmPct: number | null; grossProfit: number; grossMarginPct: number | null
  adSpend: number; meta: number; google: number; roas: number | null; orders: number; aov: number | null; cpa: number | null; breakevenCpa: number | null
  cogs: number; designerFee: number; organicOrders: number; organicPct: number | null; units: number; dayCount: number; lastLanded: string | null; first: string | null; last: string | null
}

export type TrendDay = { day: string; landed: boolean; revenue: number; cogs: number; adSpend: number; cm: number; designerFee: number; orders: number; roas: number | null; races: string[] }
export type WaterfallLine = { key: string; label: string; cents: number; kind?: 'total' | 'subtotal'; pctOfRevenue: number | null }
export type Need = { kind: string; text: string; to?: string; cents?: number }
export type SyncInfo = { at: string; read: number; created: number; updated: number; latest: Record<string, string>; missingTabs: string[] } | null

export type OverviewPayload = {
  period: { key: string; first: string; last: string; label: string; compareLabel: string; compareFirst: string; compareLast: string }
  periods: { key: string; label: string }[]
  today: string; through: string | null; partial: boolean
  totals: Totals; compare: Totals
  waterfall: WaterfallLine[]; feeBase: 'gp' | 'cm'; breakevenRoas: number
  trend: TrendDay[]
  levers: Record<string, number | null>
  pacing: { month: string; mtd: Totals; lastMonth: Totals; lastMonthSameDays: Totals; lastYear: Totals; daysInMonth: number; dayNo: number }
  needs: Need[]; sync: SyncInfo
}

export type Landed = { shopify: boolean; etsy: boolean; printShop: boolean; meta: boolean; google: boolean }
export type DayRow = Totals & Record<string, number | string | null | boolean | Landed | string[]> & { day: string; landed: boolean; has: Landed; readAt: string | null; overridden: string[] }
export type WeekRow = Totals & { weekStart: string; weekEnd: string }
export type DailyPayload = { month: string; days: DayRow[]; total: Totals | null; weeks: WeekRow[]; readAt: string | null; sync: SyncInfo; sheetUrl: string }
export type DayInput = { field: string; sheet: number | null; override: number | null; value: number | null }

export type TimeEntry = { id: string; day: string; minutes: number; startedAt: string | null; endedAt: string | null; note: string | null }
export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected'
export type Timesheet = {
  id: string; userId: string; user?: { id: string; firstName: string; lastName: string; role: string }
  weekStart: string; weekEnd: string; status: TimesheetStatus; submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null
  hourlyRateCents: number | null; paid: boolean; entries: TimeEntry[]; totalMinutes: number; byDay: Record<string, number>; flags: string[]; rateNow?: number | null
}
export type WeekSummary = { weekStart: string; weekEnd: string; status: TimesheetStatus | 'empty'; totalMinutes: number; reviewNote: string | null }
export type HoursPayload = { week: Timesheet; weeks: WeekSummary[]; running: TimeEntry | null; today: string }
export type Person = { id: string; firstName: string; lastName: string; role: string; hourlyRateCents: number | null }

export type Rate = { userId: string; name: string; role: string; hourlyRateCents: number | null; customs: { newCents: number; repeatCents: number; custom: boolean } | null }
export type OwedWeek = { timesheetId: string; userId: string; name: string; weekStart: string; weekEnd: string; minutes: number; rateCents: number; amountCents: number }
export type OwedItem = { userId: string; name: string; kind: string; quantity: number | null; rateCents: number | null; amountCents: number; sourceRef: string; note: string }
export type Owed = { hours: { userId: string; name: string; weeks: OwedWeek[]; minutes: number; amountCents: number }[]; months: { month: string; label: string; items: OwedItem[]; totalCents: number }[]; totalCents: number }
export type PayoutLine = { id: string; userId: string; name: string; kind: string; quantity: number | null; rateCents: number | null; amountCents: number; note: string | null; paidAt: string | null; paidRef: string | null; sourceRef: string | null }
export type PayRun = { id: string; kind: 'hours' | 'monthly'; periodStart: string; periodEnd: string; label: string; status: 'draft' | 'approved' | 'paid'; note: string | null; approvedAt: string | null; paidAt: string | null; createdAt: string; totalCents: number; lines: PayoutLine[] }
export type PayoutsPayload = { owed: Owed; runs: PayRun[]; rates: Rate[] }
