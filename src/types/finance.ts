/** Shapes the Finance pages read from /api/finance/*. Money is integer cents. */

export type Totals = {
  revenue: number; shopifyRevenue: number; etsyRevenue: number; cm: number; cmPct: number | null; grossProfit: number; grossMarginPct: number | null
  adSpend: number; meta: number; trybe: number; google: number; roas: number | null; orders: number; aov: number | null; cpa: number | null; breakevenCpa: number | null
  cogs: number; designerFee: number; organicOrders: number; organicPct: number | null; units: number; dayCount: number; lastLanded: string | null; first: string | null; last: string | null
}

export type TrendDay = { day: string; landed: boolean; revenue: number; cogs: number; adSpend: number; cm: number; designerFee: number; orders: number; roas: number | null; races: string[] }
export type WaterfallLine = { key: string; label: string; cents: number; kind?: 'total' | 'subtotal'; pctOfRevenue: number | null }
export type Need = { key: string; kind: string; tone: 'due' | 'soon' | 'alert'; title: string; detail?: string; text: string; cents?: number | null; due?: string; action?: { label: string; to: string } }
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
export type HoursPayload = { week: Timesheet; weeks: WeekSummary[]; running: TimeEntry | null; paused?: { note: string | null; carriedMinutes: number; since: string } | null; carriedMinutes?: number; today: string }
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
  dealId: string; name: string; stage: string; raceDate: string | null; window: { start: string; end: string } | null; dueDate: string | null; daysToDue: number | null; windowClosed: boolean; windowOpen: boolean; final: boolean
  terms: RaceTerms; termsUsed: RaceTerms | null; poc: { name: string | null; email: string | null } | null; contractUrl: string | null; webUrl: string | null; runners: number | string | null
  status: 'pending' | 'sent' | 'paid'; sales: RaceSales | null; payoutCents: number | null; sentAt: string | null; emailedTo: string | null; paidAt: string | null; paidRef: string | null; note: string | null
  report: RaceReport | null; attio?: string | null
}
export type RacePayoutsPayload = { races: RacePayout[]; owed: { totalCents: number; accruingCents: number; closedCents: number; races: number }; rules: { daysBefore: number; daysAfter: number; dueDays: number; defaultPct: number } }

/** One month of payouts (Finance > Payouts): every line in three states, and the totals. */
export type PayoutState = 'in_progress' | 'submitted' | 'approved'
export type MonthLine = {
  key: string; kind: 'customs' | 'designer_fee' | 'hours' | 'race'; name: string; detail: string; amountCents: number | null; status: PayoutState
  paid?: boolean; sentBack?: boolean; userId?: string; timesheetId?: string; dealId?: string
  // Hours only: the two-week pay period the week is paid in, and how it was paid.
  period?: { start: string; end: string; payday: string }; weekStart?: string; minutes?: number; rateCents?: number | null
  paidAt?: string | null; paidRef?: string | null; payoutMethod?: PayoutMethod | null
  /** The Wise payment this line is on, if it went through Wise. */
  wise?: { id: string; status: WiseStatus; failureReason: string | null; wiseTransferId: string | null } | null
}
export type PayoutMethod = 'wise' | 'payoneer' | 'other'

// ── Paying through Wise (server/domain/finance/wisePay.js) ──
export type WiseStatus = 'prepared' | 'created' | 'funded' | 'sent' | 'failed' | 'returned' | 'cancelled'
export type WisePreviewPerson = {
  userId: string; name: string; cents: number; currency: string | null; country: string | null
  recipientId: string | null; recipientName: string | null; taxFormType: string | null; taxFormOnFile: boolean
  items: { kind: string; label: string; amountCents: number }[]
  blockers: string[]
  quote: { rate: string | null; targetMinor: number | null; feeCents: number | null; expiresAt: string | null } | null
}
export type WisePreview = {
  kind: 'period' | 'month'; key: string; label: string; env: 'sandbox' | 'production'
  balanceCents: number | null; balanceError: string | null; totalCents: number; shortfallCents: number | null
  people: WisePreviewPerson[]
}
export type WiseTransfer = {
  id: string; userId: string; name: string | null; status: WiseStatus; wiseState: string | null; cents: number; currency: string
  targetMinor: number | null; rate: string | null; feeCents: number | null; wiseTransferId: string | null; failureReason: string | null
  traceId: string | null; fundedAt: string | null; sentAt: string | null; createdAt: string
}
export type WiseRun = { runId: string; label: string; status: string; totalCents: number; transfers: WiseTransfer[]; createdAt?: string; paidAt?: string | null }
export type WisePayee = {
  userId: string; name: string; role: string; recipientId: string | null; recipientName: string | null
  currency: string | null; country: string | null; taxFormType: string | null; taxFormOnFile: boolean
}
export type WiseRecipient = { id: string; name: string; currency: string | null; country: string | null; type: string | null; summary: string; problem: string | null }
export type MonthPayouts = {
  month: string; label: string; closed: boolean; current: boolean; today: string; designPayday: string; previous: string; next: string | null; lines: MonthLine[]
  totals: { totalCents: number; inProgressCents: number; submittedCents: number; approvedCents: number; customsCents: number; designerFeeCents: number; hoursCents: number; racesCents: number; unpriced: number }
  racesError: string | null
}

/** The forecast (Finance > Forecast). Money is cents. */
export type ForecastScenario = 'base' | 'upside' | 'downside'
export type ForecastDriver = { key: string; label: string; unit: 'x' | 'orders' | 'cents' | '%'; help: string; value: number; computed: number; overridden: boolean }
export type ForecastAmounts = { revenue: number; orders: number; cogs: number; adSpend: number; cm: number; designerFee: number; raceOrders?: number }
export type ForecastWeek = { weekStart: string; weekEnd: string; actual: ForecastAmounts; forecast: ForecastAmounts; revenue: number; orders: number; cm: number; adSpend: number; cogs: number; designerFee: number; partial: boolean; past: boolean; races: string[]; holiday?: number }
export type ForecastRace = { key: string; name: string; year: number; date: string; lastYear: number; received: number; expected: number; override: number | null; remaining: number; inHorizon?: number; noHistory: boolean; basis?: 'typed' | 'pace' | 'rate' | 'last_year' | 'none' }
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

/** Is Trybe paying for itself (Finance > Overview): one Monday-to-Sunday week. Money is cents. */
export type TrybeWeek = {
  start: string; end: string; last: string; partial: boolean
  trybe: { adSpendCents: number; adPurchaseValueCents: number; adPurchases: number; earningsCents: number; gmvCents: number; conversions: number; ads: number; newSubmissions: number; activeCreators: number }
  meta: { spendCents: number; purchaseValueCents: number }
  costCents: number; gmPct: number | null; metaShare: number | null
  otherSpendCents: number; otherValueCents: number; trybeRoas: number | null; otherRoas: number | null; afterRoas: number | null; breakEvenRoas: number | null; costShare: number | null
  vsOtherCents: number | null; verdict: 'paying' | 'not_paying' | 'quiet' | 'unknown'
}
export type TrybeCheck = {
  configured: boolean; at?: string; weeks: TrybeWeek[]
  totals: { costCents: number; vsOtherCents: number; newSubmissions: number; adSpendCents: number; weeksPaying: number; fullWeeks: number } | null
}

