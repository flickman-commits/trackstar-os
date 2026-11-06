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
export type LedgerStatus = 'owed' | 'draft' | 'approved' | 'paid'
export type LedgerItem = { key: string; userId: string; name: string; kind: string; note: string | null; amountCents: number; status: LedgerStatus; paidAt: string | null; paidRef: string | null; run: { id: string; label: string } | null }
export type LedgerMonth = { month: string; label: string; inProgress: boolean; items: LedgerItem[]; status: 'owed' | 'on_run' | 'paid' | 'empty'; totalCents: number; owedCents: number; onRunCents: number; paidCents: number; canCreateRun: boolean }
export type PayoutsPayload = { owed: Owed; runs: PayRun[]; rates: Rate[]; ledger: LedgerMonth[] }

export type RaceTerms = { structure: 'percent' | 'per_order'; pct: number | null; perOrderCents: number | null; assumed: boolean }
export type RaceSales = { grossCents: number; discountCents: number; refundCents: number; netSalesCents: number; unitsSold: number; orders: number; computedAt: string; products: string[]; canonical: string | null }
export type RaceReport = { report: string; subject: string; to: string | null; email: string; window: string }
export type RacePayout = {
  dealId: string; name: string; stage: string; raceDate: string | null; window: { start: string; end: string } | null; dueDate: string | null; daysToDue: number | null; windowClosed: boolean
  terms: RaceTerms; termsUsed: RaceTerms | null; poc: { name: string | null; email: string | null } | null; contractUrl: string | null; webUrl: string | null; runners: number | string | null
  status: 'pending' | 'sent' | 'paid'; sales: RaceSales | null; payoutCents: number | null; sentAt: string | null; paidAt: string | null; paidRef: string | null; note: string | null
  report: RaceReport | null; attio?: string | null
}
export type RacePayoutsPayload = { races: RacePayout[]; rules: { daysBefore: number; daysAfter: number; dueDays: number; defaultPct: number } }

/** One month of payouts (Finance > Payouts): every line in three states, and the totals. */
export type PayoutState = 'in_progress' | 'submitted' | 'approved'
export type MonthLine = {
  key: string; kind: 'customs' | 'designer_fee' | 'hours' | 'race'; name: string; detail: string; amountCents: number | null; status: PayoutState
  paid?: boolean; sentBack?: boolean; userId?: string; timesheetId?: string; dealId?: string
}
export type MonthPayouts = {
  month: string; label: string; closed: boolean; current: boolean; previous: string; next: string | null; lines: MonthLine[]
  totals: { totalCents: number; inProgressCents: number; submittedCents: number; approvedCents: number; customsCents: number; designerFeeCents: number; hoursCents: number; racesCents: number; unpriced: number }
  racesError: string | null
}

/** The forecast (Finance > Forecast). Money is cents. */
export type ForecastScenario = 'base' | 'upside' | 'downside'
export type ForecastDriver = { key: string; label: string; unit: 'x' | 'orders' | 'cents' | '%'; help: string; value: number; computed: number; overridden: boolean }
export type ForecastAmounts = { revenue: number; orders: number; cogs: number; adSpend: number; cm: number; designerFee: number; raceOrders?: number }
export type ForecastWeek = { weekStart: string; weekEnd: string; actual: ForecastAmounts; forecast: ForecastAmounts; revenue: number; orders: number; cm: number; adSpend: number; cogs: number; designerFee: number; partial: boolean; past: boolean; races: string[] }
export type ForecastRace = { key: string; name: string; year: number; date: string; lastYear: number; received: number; expected: number; override: number | null; remaining: number; inHorizon?: number; noHistory: boolean }
export type ForecastMonth = { month: string; label: string; target: { revenueCents: number | null; cmCents: number | null; adSpendCents: number | null } | null; toDate: { revenue: number; cm: number; adSpend: number; designerFee: number }; projected: { revenue: number; cm: number; adSpend: number; designerFee: number } }
export type CashWeek = { weekStart: string; start: number; in: number; out: { costs: number; ads: number; hours: number; customsAndFee: number; partners: number; fixed: number; draws: number }; totalOut: number; net: number; end: number }
export type Bank = { name: string; cents: number; asOf: string }
export type FixedCost = { name: string; cents: number; cadence: 'monthly' | 'weekly' }
export type ForecastPayload = {
  asOf: string; scenario: ForecastScenario; scenarios: ForecastScenario[]; horizon: { start: string; end: string; weeks: number }
  drivers: ForecastDriver[]; growthHint: { growth: number; races: number }; curve: { fromData: boolean; orders: number }
  weeks: ForecastWeek[]; races: ForecastRace[]; months: ForecastMonth[]
  totals: { revenue: number; forecastRevenue: number; cm: number; orders: number }
  cash: { opening: number; banks: Bank[]; bufferCents: number; fixedCosts: FixedCost[]; ownerDrawMonthlyCents: number; weeks: CashWeek[]; lowest: { cents: number; weekStart: string }; weeksBelowBuffer: number; partners: { name: string; dueDate: string; cents: number; estimated: boolean }[]; hasBalance: boolean }
}
