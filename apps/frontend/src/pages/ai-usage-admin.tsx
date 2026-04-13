import { useState, useCallback, useMemo, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, DollarSign, Bot, Cog, Shield, Bell, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts"
import { useAIUsage, useAIBudget, useUpdateAIBudget } from "@/hooks"
import { usePreferences } from "@/contexts"
import { useWorkspaceUsers } from "@/stores/workspace-store"
import type { UpdateAIBudgetInput, AIUsageByUser } from "@threa/types"
import { cn } from "@/lib/utils"

function formatCurrency(value: number, maxFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.min(2, maxFractionDigits),
    maximumFractionDigits: maxFractionDigits,
  }).format(value)
}

const MS_PER_DAY = 86_400_000

function formatShortDate(d: Date, timezone?: string) {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  })
}

type Status = "on_track" | "at_risk" | "over"

interface BudgetMetrics {
  status: Status
  statusCopy: string
  totalCost: number
  budgetAmount: number
  percentUsed: number
  projectedTotal: number
  projectedOverage: number
  dailyAvg: number
  daysElapsed: number
  daysTotal: number
  daysRemaining: number
  periodStart: Date
  periodEnd: Date
  budgetBustDate: Date | null
  hardLimitAmount: number | null
}

function computeMetrics(opts: {
  totalCost: number
  budgetAmount: number
  percentUsed: number
  periodStart: string
  periodEnd: string
  hardLimitEnabled: boolean
  hardLimitPercent: number
}): BudgetMetrics {
  const periodStart = new Date(opts.periodStart)
  const periodEnd = new Date(opts.periodEnd)
  const now = new Date()

  const daysTotal = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY))
  const daysElapsedRaw = (now.getTime() - periodStart.getTime()) / MS_PER_DAY
  const daysElapsed = Math.max(0.5, Math.min(daysTotal, daysElapsedRaw))
  const daysRemaining = Math.max(0, daysTotal - Math.floor(daysElapsed))

  const dailyAvg = opts.totalCost / daysElapsed
  const projectedTotal = dailyAvg * daysTotal
  const projectedOverage = Math.max(0, projectedTotal - opts.budgetAmount)
  const projectedPercent = opts.budgetAmount > 0 ? (projectedTotal / opts.budgetAmount) * 100 : 0

  let status: Status = "on_track"
  if (opts.percentUsed >= 100 || projectedPercent > 110) status = "over"
  else if (projectedPercent > 100) status = "at_risk"

  let budgetBustDate: Date | null = null
  if (dailyAvg > 0 && projectedTotal > opts.budgetAmount && opts.totalCost < opts.budgetAmount) {
    const daysUntilBust = opts.budgetAmount / dailyAvg
    if (daysUntilBust > daysElapsed && daysUntilBust <= daysTotal) {
      budgetBustDate = new Date(periodStart.getTime() + daysUntilBust * MS_PER_DAY)
    }
  }

  const hardLimitAmount = opts.hardLimitEnabled ? opts.budgetAmount * (opts.hardLimitPercent / 100) : null

  let statusCopy: string
  if (status === "on_track") {
    statusCopy =
      projectedTotal > 0
        ? `Expected to finish within budget at ${formatCurrency(projectedTotal)}.`
        : "No AI spend recorded yet this cycle."
  } else if (status === "at_risk") {
    statusCopy = `Expected to finish ${formatCurrency(projectedOverage)} over budget.`
  } else if (opts.percentUsed >= 100) {
    statusCopy = `Currently ${formatCurrency(opts.totalCost - opts.budgetAmount)} over budget.`
  } else {
    statusCopy = `Expected to finish ${formatCurrency(projectedOverage)} over budget.`
  }

  return {
    status,
    statusCopy,
    totalCost: opts.totalCost,
    budgetAmount: opts.budgetAmount,
    percentUsed: opts.percentUsed,
    projectedTotal,
    projectedOverage,
    dailyAvg,
    daysElapsed,
    daysTotal,
    daysRemaining,
    periodStart,
    periodEnd,
    budgetBustDate,
    hardLimitAmount,
  }
}

const statusStyles: Record<Status, { dot: string; stroke: string }> = {
  on_track: { dot: "bg-emerald-500", stroke: "#059669" },
  at_risk: { dot: "bg-amber-500", stroke: "#d97706" },
  over: { dot: "bg-destructive", stroke: "#dc2626" },
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", className)}>
      {children}
    </span>
  )
}

function Stat({
  label,
  value,
  hint,
  info,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  info?: React.ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1">
      <SectionLabel>
        {label}
        {info && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="ml-1 inline-flex rounded-sm align-middle text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="How this is calculated"
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="start"
              className="max-w-xs text-xs font-normal normal-case leading-relaxed tracking-normal"
            >
              {info}
            </TooltipContent>
          </Tooltip>
        )}
      </SectionLabel>
      <div className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function ChartLegendItem({
  id,
  label,
  color,
  kind,
  focused,
  onFocus,
}: {
  id: string
  label: string
  color: string
  kind: "line" | "line-dashed" | "line-muted" | "area"
  focused: string | null
  onFocus: (id: string | null) => void
}) {
  const active = focused === null || focused === id
  return (
    <button
      type="button"
      className={cn(
        "group inline-flex items-center gap-1.5 rounded text-[11px] text-muted-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !active && "opacity-40"
      )}
      onMouseEnter={() => onFocus(id)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(id)}
      onBlur={() => onFocus(null)}
    >
      {kind === "area" && <span className="h-2.5 w-4 rounded-sm" style={{ background: color }} />}
      {kind === "line-dashed" && (
        <span
          className="h-[2px] w-4"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 8px)`,
          }}
        />
      )}
      {kind === "line-muted" && <span className="h-[2px] w-4 bg-foreground/50" />}
      {kind === "line" && <span className="h-[2px] w-4" style={{ background: color }} />}
      <span className="group-hover:text-foreground">{label}</span>
    </button>
  )
}

function TrajectoryChart({ metrics }: { metrics: BudgetMetrics }) {
  const styles = statusStyles[metrics.status]
  const [focused, setFocused] = useState<string | null>(null)
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone

  // Build the data series. Actual line runs [0, daysElapsed]; projected runs
  // [daysElapsed, daysTotal]. They share a transition point at today so the
  // two segments meet cleanly.
  const data = useMemo(() => {
    const rows: Array<{ day: number; actual: number | null; projected: number | null }> = []
    for (let d = 0; d <= metrics.daysTotal; d++) {
      rows.push({
        day: d,
        actual: d <= metrics.daysElapsed ? metrics.dailyAvg * d : null,
        projected: d >= metrics.daysElapsed ? metrics.dailyAvg * d : null,
      })
    }
    const fractional =
      metrics.daysElapsed !== Math.floor(metrics.daysElapsed) &&
      metrics.daysElapsed > 0 &&
      metrics.daysElapsed < metrics.daysTotal
    if (fractional) {
      rows.push({
        day: metrics.daysElapsed,
        actual: metrics.totalCost,
        projected: metrics.totalCost,
      })
      rows.sort((a, b) => a.day - b.day)
    }
    return rows
  }, [metrics.daysTotal, metrics.daysElapsed, metrics.dailyAvg, metrics.totalCost])

  const maxY = Math.max(metrics.budgetAmount * 1.25, metrics.projectedTotal * 1.12, metrics.hardLimitAmount ?? 0, 0.01)

  const config = useMemo<ChartConfig>(
    () => ({
      actual: { label: "Actual", color: styles.stroke },
      projected: { label: "Projected", color: styles.stroke },
    }),
    [styles.stroke]
  )

  const dayToDate = (day: number) => new Date(metrics.periodStart.getTime() + day * MS_PER_DAY)

  const dim = (key: string) => (focused !== null && focused !== key ? 0.2 : 1)

  const xTicks = [0, metrics.daysElapsed, metrics.daysTotal]

  return (
    <div className="space-y-3">
      {/* Interactive legend */}
      <div className="flex flex-wrap items-center justify-end gap-4">
        <ChartLegendItem
          id="actual"
          label="Actual"
          color={styles.stroke}
          kind="line"
          focused={focused}
          onFocus={setFocused}
        />
        <ChartLegendItem
          id="projected"
          label="Projected"
          color={styles.stroke}
          kind="line-dashed"
          focused={focused}
          onFocus={setFocused}
        />
        <ChartLegendItem
          id="budget"
          label="Budget"
          color="currentColor"
          kind="line-muted"
          focused={focused}
          onFocus={setFocused}
        />
        <ChartLegendItem
          id="overBudget"
          label="Over budget"
          color="rgba(217, 119, 6, 0.35)"
          kind="area"
          focused={focused}
          onFocus={setFocused}
        />
        {metrics.hardLimitAmount !== null && (
          <ChartLegendItem
            id="hardLimit"
            label="Hard limit"
            color="rgba(220, 38, 38, 0.45)"
            kind="area"
            focused={focused}
            onFocus={setFocused}
          />
        )}
      </div>

      <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={styles.stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={styles.stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} strokeDasharray="2 3" strokeOpacity={0.15} />

          <XAxis
            dataKey="day"
            type="number"
            domain={[0, metrics.daysTotal]}
            ticks={xTicks}
            tickFormatter={(day: number) => {
              if (Math.abs(day - metrics.daysElapsed) < 0.01) return "Today"
              return formatShortDate(dayToDate(day), timezone)
            }}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            interval={0}
            minTickGap={0}
          />

          <YAxis
            type="number"
            domain={[0, maxY]}
            tickFormatter={(v: number) => formatCurrency(v, 0)}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            width={56}
          />

          {/* Over-budget zone */}
          <ReferenceArea
            y1={metrics.budgetAmount}
            y2={metrics.hardLimitAmount !== null ? metrics.hardLimitAmount : maxY}
            fill="#d97706"
            fillOpacity={0.09 * dim("overBudget")}
            stroke="none"
            ifOverflow="visible"
          />

          {/* Above-hard-limit zone */}
          {metrics.hardLimitAmount !== null && (
            <ReferenceArea
              y1={metrics.hardLimitAmount}
              y2={maxY}
              fill="#dc2626"
              fillOpacity={0.11 * dim("hardLimit")}
              stroke="none"
              ifOverflow="visible"
            />
          )}

          {/* Budget reference line */}
          <ReferenceLine
            y={metrics.budgetAmount}
            stroke="currentColor"
            strokeOpacity={0.5 * dim("budget")}
            strokeWidth={1}
          />

          {/* Hard limit reference line */}
          {metrics.hardLimitAmount !== null && (
            <ReferenceLine
              y={metrics.hardLimitAmount}
              stroke="#dc2626"
              strokeOpacity={0.55 * dim("hardLimit")}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          )}

          {/* Today vertical marker */}
          <ReferenceLine x={metrics.daysElapsed} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="1 3" />

          {/* Actual (area with fill) */}
          <Area
            type="monotone"
            dataKey="actual"
            stroke={styles.stroke}
            strokeWidth={2.25}
            strokeOpacity={dim("actual")}
            fill="url(#actualFill)"
            fillOpacity={dim("actual")}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))", fill: styles.stroke }}
            isAnimationActive={false}
          />

          {/* Projected (dashed, no fill) */}
          <Area
            type="monotone"
            dataKey="projected"
            stroke={styles.stroke}
            strokeWidth={2}
            strokeOpacity={0.85 * dim("projected")}
            strokeDasharray="5 4"
            fill="none"
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))", fill: styles.stroke }}
            isAnimationActive={false}
          />

          {/* Today anchor dot */}
          <ReferenceDot
            x={metrics.daysElapsed}
            y={metrics.totalCost}
            r={4.5}
            fill={styles.stroke}
            stroke="hsl(var(--background))"
            strokeWidth={2}
            ifOverflow="visible"
          />

          <ChartTooltip
            cursor={{ stroke: "currentColor", strokeOpacity: 0.4, strokeDasharray: "2 2" }}
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(_label, payload) => {
                  const day = payload?.[0]?.payload?.day
                  if (typeof day !== "number") return ""
                  const date = dayToDate(day)
                  const dayNum = Math.max(1, Math.ceil(day))
                  return (
                    <span className="flex items-baseline gap-2">
                      <span>{formatShortDate(date, timezone)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        day {dayNum} of {metrics.daysTotal}
                      </span>
                    </span>
                  )
                }}
                formatter={(value, name, item) => {
                  const num = typeof value === "number" ? value : 0
                  const color = item.color
                  const displayName = name === "actual" ? "Actual" : "Projected"
                  return (
                    <>
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />
                      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                        <span className="text-muted-foreground">{displayName}</span>
                        <span className="font-medium tabular-nums text-foreground">{formatCurrency(num)}</span>
                      </div>
                    </>
                  )
                }}
              />
            }
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

function BudgetHealthHero({ metrics, isLoading }: { metrics: BudgetMetrics; isLoading: boolean }) {
  const styles = statusStyles[metrics.status]
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone

  if (isLoading) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="space-y-6 p-6">
          <Skeleton className="h-5 w-64" />
          <div className="grid gap-6 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-[220px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <div className="space-y-6 p-6 sm:p-8">
        {/* Headline — neutral, factual */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("h-1.5 w-1.5 flex-none translate-y-[-3px] rounded-full", styles.dot)} aria-hidden />
            <p className="text-lg leading-snug sm:text-xl">{metrics.statusCopy}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Cycle {formatShortDate(metrics.periodStart, timezone)} – {formatShortDate(metrics.periodEnd, timezone)} ·{" "}
            {metrics.daysRemaining} days remaining
          </p>
        </div>

        {/* Key stats */}
        <div className="grid gap-6 border-y border-border/60 py-5 sm:grid-cols-4">
          <Stat
            label="Spent"
            value={formatCurrency(metrics.totalCost)}
            hint={`${metrics.percentUsed.toFixed(0)}% of ${formatCurrency(metrics.budgetAmount, 0)} budget`}
          />
          <Stat
            label="Projected"
            value={formatCurrency(metrics.projectedTotal)}
            hint={
              metrics.projectedOverage > 0
                ? `${formatCurrency(metrics.projectedOverage)} over budget`
                : `${formatCurrency(Math.max(0, metrics.budgetAmount - metrics.projectedTotal))} headroom`
            }
            info={
              <>
                <p className="font-medium">Rough projection</p>
                <p className="mt-1 text-muted-foreground">
                  Straight-line extrapolation: total spend ÷ days elapsed × days in cycle.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Doesn't model weekends, peaks, or behaviour changes — treat it as a ballpark, not a forecast.
                </p>
              </>
            }
          />
          <Stat
            label="Daily avg"
            value={formatCurrency(metrics.dailyAvg, 4)}
            hint={`over ${metrics.daysElapsed.toFixed(1)} days`}
          />
          <Stat
            label="Days remaining"
            value={<span className="tabular-nums">{metrics.daysRemaining}</span>}
            hint={
              metrics.budgetBustDate
                ? `Budget exhausts ≈ ${formatShortDate(metrics.budgetBustDate, timezone)}`
                : `of ${metrics.daysTotal} day cycle`
            }
          />
        </div>

        {/* Trajectory chart */}
        <TrajectoryChart metrics={metrics} />
      </div>
    </Card>
  )
}

function UsageSplitCard({
  systemCost,
  assistantCost,
  totalCost,
  isLoading,
}: {
  systemCost: number
  assistantCost: number
  totalCost: number
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Where the spend is going</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[120px] w-full" />
        </CardContent>
      </Card>
    )
  }

  const systemPct = totalCost > 0 ? (systemCost / totalCost) * 100 : 0
  const assistantPct = totalCost > 0 ? (assistantCost / totalCost) * 100 : 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionLabel>Split by source</SectionLabel>
        <CardTitle className="text-base font-medium">Where the spend is going</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Stacked composition bar */}
        <div className="space-y-2">
          <div className="relative h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 bg-primary transition-all"
              style={{ width: `${assistantPct}%` }}
            />
            <div
              className="absolute inset-y-0 bg-foreground/60 transition-all"
              style={{ left: `${assistantPct}%`, width: `${systemPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-primary" />
              Assistant
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-foreground/60" />
              System
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              Assistant
            </div>
            <div className="text-xl font-semibold tabular-nums">{formatCurrency(assistantCost)}</div>
            <div className="text-[11px] text-muted-foreground">{assistantPct.toFixed(1)}% · companion responses</div>
          </div>
          <div className="space-y-1.5 rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Cog className="h-3.5 w-3.5" />
              System
            </div>
            <div className="text-xl font-semibold tabular-nums">{formatCurrency(systemCost)}</div>
            <div className="text-[11px] text-muted-foreground">{systemPct.toFixed(1)}% • background jobs</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TopSpendersCard({
  byUser,
  userNames,
  assistantTotal,
  isLoading,
}: {
  byUser: AIUsageByUser[]
  userNames: Map<string, string>
  assistantTotal: number
  isLoading: boolean
}) {
  const items = useMemo(() => {
    const userUsage = byUser.filter((u) => u.userId !== null)
    const sorted = [...userUsage].sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    const maxCost = Math.max(...sorted.map((u) => u.totalCostUsd), 0.0001)
    return sorted.map((u) => ({
      userId: u.userId!,
      name: userNames.get(u.userId!) ?? "Unknown user",
      cost: u.totalCostUsd,
      tokens: u.totalTokens,
      percentOfAssistant: assistantTotal > 0 ? (u.totalCostUsd / assistantTotal) * 100 : 0,
      barPct: (u.totalCostUsd / maxCost) * 100,
    }))
  }, [byUser, userNames, assistantTotal])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Top assistant users</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionLabel>Top spenders</SectionLabel>
        <CardTitle className="text-base font-medium">Assistant usage by member</CardTitle>
        <CardDescription className="text-xs">
          {items.length} {items.length === 1 ? "member" : "members"} active this cycle
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center">
            <Bot className="h-6 w-6 text-muted-foreground/60" />
            <div className="text-sm text-muted-foreground">No assistant usage yet this cycle</div>
          </div>
        ) : (
          <ScrollArea className="h-[280px]">
            <ul className="space-y-3 pr-3">
              {items.map((item, idx) => (
                <li key={item.userId} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="w-5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</span>
                      <span className="truncate font-medium">{item.name}</span>
                    </div>
                    <div className="flex items-baseline gap-2 tabular-nums">
                      <span>{formatCurrency(item.cost)}</span>
                      <span className="w-9 text-right text-[11px] text-muted-foreground">
                        {item.percentOfAssistant.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(item.barPct, 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

function BudgetControlsPanel({
  workspaceId,
  budget,
  nextReset,
  metrics,
  localBudget,
  onBudgetChange,
  onBudgetCommit,
  localHardLimit,
  onHardLimitChange,
  onHardLimitCommit,
  isLoading,
}: {
  workspaceId: string
  budget: {
    monthlyBudgetUsd: number
    alertThreshold50: boolean
    alertThreshold80: boolean
    alertThreshold100: boolean
    degradationEnabled: boolean
    hardLimitEnabled: boolean
    hardLimitPercent: number
  } | null
  nextReset: string
  metrics: BudgetMetrics
  localBudget: string
  onBudgetChange: (v: string) => void
  onBudgetCommit: () => void
  localHardLimit: string
  onHardLimitChange: (v: string) => void
  onHardLimitCommit: () => void
  isLoading: boolean
}) {
  const updateBudget = useUpdateAIBudget(workspaceId)
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone

  const handleUpdate = useCallback(
    (updates: UpdateAIBudgetInput) => {
      updateBudget.mutate(updates)
    },
    [updateBudget]
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Cost controls</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[420px] w-full" />
        </CardContent>
      </Card>
    )
  }

  const resetDate = new Date(nextReset)
  const resetDateStr = resetDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: timezone,
  })

  // Compute threshold states to annotate switches with current progress
  const usedPct = metrics.percentUsed
  const thresholdHit = (t: number) => usedPct >= t

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionLabel>Controls</SectionLabel>
        <CardTitle className="text-base font-medium">Budget &amp; guardrails</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Monthly budget */}
        <div className="space-y-2">
          <Label
            htmlFor="monthly-budget"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Monthly budget
          </Label>
          <div className="flex items-baseline gap-1 border-b border-border pb-1 focus-within:border-primary">
            <span className="text-lg font-semibold tabular-nums text-muted-foreground">$</span>
            <Input
              id="monthly-budget"
              type="number"
              min="0"
              step="1"
              value={localBudget}
              onChange={(e) => onBudgetChange(e.target.value)}
              onBlur={onBudgetCommit}
              className="h-auto w-full rounded-none border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0"
              aria-label="Monthly budget"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Resets {resetDateStr} · currently {formatCurrency(metrics.totalCost)} of{" "}
            {formatCurrency(metrics.budgetAmount, 0)} used
          </p>
        </div>

        {/* Alert thresholds */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Alert thresholds</h4>
          </div>
          <div className="space-y-2">
            {[
              {
                pct: 50,
                id: "alert-50",
                title: "Halfway",
                checked: budget?.alertThreshold50 ?? true,
                key: "alertThreshold50" as const,
              },
              {
                pct: 80,
                id: "alert-80",
                title: "Approaching limit",
                checked: budget?.alertThreshold80 ?? true,
                key: "alertThreshold80" as const,
              },
              {
                pct: 100,
                id: "alert-100",
                title: "Budget exhausted",
                checked: budget?.alertThreshold100 ?? true,
                key: "alertThreshold100" as const,
              },
            ].map((t) => {
              const hit = thresholdHit(t.pct)
              const thresholdAmount = metrics.budgetAmount * (t.pct / 100)
              return (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border border-border/60 p-3 transition-colors",
                    hit && t.checked && "border-amber-500/40 bg-amber-500/5"
                  )}
                >
                  <Label htmlFor={t.id} className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2 text-sm font-medium">
                      <span>{t.title}</span>
                      {hit && (
                        <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                          reached
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      Fires at{" "}
                      <span className="font-medium tabular-nums text-foreground">
                        {formatCurrency(thresholdAmount, 0)}
                      </span>{" "}
                      · {t.pct}% of budget
                    </span>
                  </Label>
                  <Switch
                    id={t.id}
                    checked={t.checked}
                    onCheckedChange={(checked) => handleUpdate({ [t.key]: checked })}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Cost controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Automatic guardrails
            </h4>
          </div>
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-3">
              <Label htmlFor="degradation" className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">Downgrade models at 80%</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Kicks in at{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatCurrency(metrics.budgetAmount * 0.8, 0)}
                  </span>{" "}
                  · switches to cheaper models automatically
                </span>
              </Label>
              <Switch
                id="degradation"
                checked={budget?.degradationEnabled ?? true}
                onCheckedChange={(checked) => handleUpdate({ degradationEnabled: checked })}
              />
            </div>

            <div
              className={cn(
                "space-y-3 rounded-md border border-border/60 p-3",
                budget?.hardLimitEnabled && "border-red-500/30 bg-red-500/[0.03]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <Label htmlFor="hard-limit" className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">Hard stop</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Block non-essential AI features once usage crosses the limit below.
                  </span>
                </Label>
                <Switch
                  id="hard-limit"
                  checked={budget?.hardLimitEnabled ?? false}
                  onCheckedChange={(checked) => handleUpdate({ hardLimitEnabled: checked })}
                />
              </div>
              {budget?.hardLimitEnabled && (
                <div className="flex items-end justify-between gap-4 border-t border-border/60 pt-3">
                  <div className="space-y-1">
                    <Label
                      htmlFor="hard-limit-percent"
                      className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Cap at
                    </Label>
                    <div className="flex items-baseline gap-1">
                      <Input
                        id="hard-limit-percent"
                        type="number"
                        min="100"
                        max="500"
                        step="10"
                        value={localHardLimit}
                        onChange={(e) => onHardLimitChange(e.target.value)}
                        onBlur={onHardLimitCommit}
                        className="h-auto w-16 rounded-none border-0 border-b border-border bg-transparent px-0 text-lg font-semibold tabular-nums shadow-none focus-visible:border-primary focus-visible:ring-0"
                      />
                      <span className="text-lg text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Blocks at</div>
                    <div className="font-semibold tabular-nums text-foreground">
                      {formatCurrency(metrics.budgetAmount * (parseInt(localHardLimit || "100", 10) / 100), 0)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function AIUsageAdminPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const idbUsers = useWorkspaceUsers(workspaceId ?? "")

  const { data: usage, isLoading: usageLoading } = useAIUsage(workspaceId ?? "")
  const { data: budget, isLoading: budgetLoading } = useAIBudget(workspaceId ?? "")

  // Local state for inline-editable budget + hard limit. Synced from server,
  // committed on blur.
  const initialBudget = budget?.budget?.monthlyBudgetUsd ?? 50
  const initialHardLimit = budget?.budget?.hardLimitPercent ?? 100
  const [localBudget, setLocalBudget] = useState<string>(String(initialBudget))
  const [localHardLimit, setLocalHardLimit] = useState<string>(String(initialHardLimit))

  const updateBudget = useUpdateAIBudget(workspaceId ?? "")

  useEffect(() => {
    if (budget?.budget?.monthlyBudgetUsd !== undefined) {
      setLocalBudget(budget.budget.monthlyBudgetUsd.toString())
    }
  }, [budget?.budget?.monthlyBudgetUsd])

  useEffect(() => {
    if (budget?.budget?.hardLimitPercent !== undefined) {
      setLocalHardLimit(budget.budget.hardLimitPercent.toString())
    }
  }, [budget?.budget?.hardLimitPercent])

  const handleBudgetCommit = useCallback(() => {
    const value = parseFloat(localBudget)
    if (!isNaN(value) && value >= 0 && value !== budget?.budget?.monthlyBudgetUsd) {
      updateBudget.mutate({ monthlyBudgetUsd: value })
    }
  }, [localBudget, budget?.budget?.monthlyBudgetUsd, updateBudget])

  const handleHardLimitCommit = useCallback(() => {
    const value = parseInt(localHardLimit, 10)
    if (!isNaN(value) && value >= 100 && value <= 500 && value !== budget?.budget?.hardLimitPercent) {
      updateBudget.mutate({ hardLimitPercent: value })
    }
  }, [localHardLimit, budget?.budget?.hardLimitPercent, updateBudget])

  const userNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const user of idbUsers) {
      map.set(user.id, user.name || user.email || user.slug)
    }
    return map
  }, [idbUsers])

  const systemCost = useMemo(() => {
    if (!usage?.byOrigin) return 0
    const systemUsage = usage.byOrigin.find((o) => o.origin === "system")
    return systemUsage?.totalCostUsd ?? 0
  }, [usage?.byOrigin])

  const assistantCost = useMemo(() => {
    if (!usage?.byUser) return 0
    return usage.byUser.filter((u) => u.userId !== null).reduce((sum, u) => sum + u.totalCostUsd, 0)
  }, [usage?.byUser])

  // Reflect the optimistic local budget in metrics so the hero chart responds
  // immediately when the user edits the amount in-place.
  const optimisticBudget = useMemo(() => {
    const parsed = parseFloat(localBudget)
    if (!isNaN(parsed) && parsed >= 0) return parsed
    return budget?.budget?.monthlyBudgetUsd ?? 50
  }, [localBudget, budget?.budget?.monthlyBudgetUsd])

  const metrics = useMemo<BudgetMetrics>(
    () =>
      computeMetrics({
        totalCost: usage?.total.totalCostUsd ?? 0,
        budgetAmount: optimisticBudget,
        percentUsed: optimisticBudget > 0 ? ((usage?.total.totalCostUsd ?? 0) / optimisticBudget) * 100 : 0,
        periodStart: usage?.period.start ?? new Date().toISOString(),
        periodEnd: usage?.period.end ?? new Date().toISOString(),
        hardLimitEnabled: budget?.budget?.hardLimitEnabled ?? false,
        hardLimitPercent: budget?.budget?.hardLimitPercent ?? 100,
      }),
    [
      usage?.total.totalCostUsd,
      usage?.period.start,
      usage?.period.end,
      optimisticBudget,
      budget?.budget?.hardLimitEnabled,
      budget?.budget?.hardLimitPercent,
    ]
  )

  if (!workspaceId) {
    return null
  }

  const isLoading = usageLoading || budgetLoading

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 items-center gap-3 border-b px-4">
        <Link to={`/w/${workspaceId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold">AI Usage &amp; Budget</h1>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <BudgetHealthHero metrics={metrics} isLoading={isLoading} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <UsageSplitCard
                systemCost={systemCost}
                assistantCost={assistantCost}
                totalCost={usage?.total.totalCostUsd ?? 0}
                isLoading={usageLoading}
              />
              <TopSpendersCard
                byUser={usage?.byUser ?? []}
                userNames={userNames}
                assistantTotal={assistantCost}
                isLoading={usageLoading}
              />
            </div>

            <div className="lg:sticky lg:top-6 lg:self-start">
              <BudgetControlsPanel
                workspaceId={workspaceId}
                budget={budget?.budget ?? null}
                nextReset={budget?.nextReset ?? new Date().toISOString()}
                metrics={metrics}
                localBudget={localBudget}
                onBudgetChange={setLocalBudget}
                onBudgetCommit={handleBudgetCommit}
                localHardLimit={localHardLimit}
                onHardLimitChange={setLocalHardLimit}
                onHardLimitCommit={handleHardLimitCommit}
                isLoading={budgetLoading}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
