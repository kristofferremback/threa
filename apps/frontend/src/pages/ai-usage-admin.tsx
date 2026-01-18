import { useState, useCallback, useMemo, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, DollarSign, Bot, Cog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useAIUsage, useAIBudget, useUpdateAIBudget, useWorkspaceBootstrap } from "@/hooks"
import type { UpdateAIBudgetInput, AIUsageByUser } from "@threa/types"

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

function SummaryCards({
  totalCost,
  percentUsed,
  budgetAmount,
  isLoading,
}: {
  totalCost: number
  percentUsed: number
  budgetAmount: number
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalCost)}</div>
          <p className="text-xs text-muted-foreground">of {formatCurrency(budgetAmount)} budget this month</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Budget Used</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{percentUsed.toFixed(1)}%</div>
          <Progress value={Math.min(percentUsed, 100)} className="mt-2" />
        </CardContent>
      </Card>
    </div>
  )
}

interface UsageBarItem {
  label: string
  cost: number
  percentage: number
}

function UsageBarList({ items, maxItems = 10 }: { items: UsageBarItem[]; maxItems?: number }) {
  const displayItems = items.slice(0, maxItems)

  return (
    <ScrollArea className="h-[280px]">
      <div className="space-y-3 pr-4">
        {displayItems.map((item, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate">{item.label}</span>
              <span className="text-muted-foreground tabular-nums">{formatCurrency(item.cost)}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(item.percentage, 100)}%` }}
              />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="flex h-[200px] items-center justify-center text-muted-foreground">No usage data yet</div>
        )}
      </div>
    </ScrollArea>
  )
}

function SystemUsageCard({
  systemCost,
  totalCost,
  isLoading,
}: {
  systemCost: number
  totalCost: number
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cog className="h-5 w-5" />
            System Operations
          </CardTitle>
          <CardDescription>Automated background processes</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[80px] w-full" />
        </CardContent>
      </Card>
    )
  }

  const percentage = totalCost > 0 ? (systemCost / totalCost) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cog className="h-5 w-5" />
          System Operations
        </CardTitle>
        <CardDescription>Automated background processes</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold">{formatCurrency(systemCost)}</span>
            <span className="text-sm text-muted-foreground">{percentage.toFixed(1)}% of total</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AssistantUsageCard({
  byUser,
  userNames,
  totalCost,
  isLoading,
}: {
  byUser: AIUsageByUser[]
  userNames: Map<string, string>
  totalCost: number
  isLoading: boolean
}) {
  const items = useMemo(() => {
    // Filter to only user-attributed usage (agent invocations)
    const userUsage = byUser.filter((u) => u.userId !== null)
    const maxCost = Math.max(...userUsage.map((u) => u.totalCostUsd), 0.0001)

    return userUsage.map((u) => ({
      label: userNames.get(u.userId!) ?? "Unknown User",
      cost: u.totalCostUsd,
      percentage: (u.totalCostUsd / maxCost) * 100,
    }))
  }, [byUser, userNames])

  const assistantTotal = useMemo(() => {
    return byUser.filter((u) => u.userId !== null).reduce((sum, u) => sum + u.totalCostUsd, 0)
  }, [byUser])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Assistant Usage
          </CardTitle>
          <CardDescription>Companion responses by team member</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    )
  }

  const percentage = totalCost > 0 ? (assistantTotal / totalCost) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Assistant Usage
        </CardTitle>
        <CardDescription>
          {formatCurrency(assistantTotal)} total ({percentage.toFixed(1)}% of all usage)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UsageBarList items={items} />
      </CardContent>
    </Card>
  )
}

function BudgetSettings({
  workspaceId,
  budget,
  percentUsed,
  nextReset,
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
  percentUsed: number
  nextReset: string
  isLoading: boolean
}) {
  const updateBudget = useUpdateAIBudget(workspaceId)
  const [localBudget, setLocalBudget] = useState<string>(budget?.monthlyBudgetUsd?.toString() ?? "50")
  const [localHardLimit, setLocalHardLimit] = useState<string>(budget?.hardLimitPercent?.toString() ?? "100")

  // Sync local state when server budget changes
  useEffect(() => {
    if (budget?.monthlyBudgetUsd !== undefined) {
      setLocalBudget(budget.monthlyBudgetUsd.toString())
    }
  }, [budget?.monthlyBudgetUsd])

  useEffect(() => {
    if (budget?.hardLimitPercent !== undefined) {
      setLocalHardLimit(budget.hardLimitPercent.toString())
    }
  }, [budget?.hardLimitPercent])

  const handleUpdate = useCallback(
    (updates: UpdateAIBudgetInput) => {
      updateBudget.mutate(updates)
    },
    [updateBudget]
  )

  const handleBudgetBlur = useCallback(() => {
    const value = parseFloat(localBudget)
    if (!isNaN(value) && value >= 0) {
      handleUpdate({ monthlyBudgetUsd: value })
    }
  }, [localBudget, handleUpdate])

  const handleHardLimitBlur = useCallback(() => {
    const value = parseInt(localHardLimit, 10)
    if (!isNaN(value) && value >= 100 && value <= 500) {
      handleUpdate({ hardLimitPercent: value })
    }
  }, [localHardLimit, handleUpdate])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Budget Settings</CardTitle>
          <CardDescription>Configure spending limits and alerts</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    )
  }

  const resetDate = new Date(nextReset)
  const resetDateStr = resetDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget Settings</CardTitle>
        <CardDescription>Configure spending limits and alerts. Resets on {resetDateStr}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="monthly-budget">Monthly Budget (USD)</Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">$</span>
            <Input
              id="monthly-budget"
              type="number"
              min="0"
              step="1"
              value={localBudget}
              onChange={(e) => setLocalBudget(e.target.value)}
              onBlur={handleBudgetBlur}
              className="w-32"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Current usage: {formatCurrency(parseFloat(localBudget) * (percentUsed / 100))} ({percentUsed.toFixed(1)}%)
          </p>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-medium">Alert Thresholds</h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="alert-50" className="flex flex-col gap-1">
                <span>50% threshold</span>
                <span className="font-normal text-muted-foreground">Notify when half the budget is used</span>
              </Label>
              <Switch
                id="alert-50"
                checked={budget?.alertThreshold50 ?? true}
                onCheckedChange={(checked) => handleUpdate({ alertThreshold50: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="alert-80" className="flex flex-col gap-1">
                <span>80% threshold</span>
                <span className="font-normal text-muted-foreground">Notify when nearing the limit</span>
              </Label>
              <Switch
                id="alert-80"
                checked={budget?.alertThreshold80 ?? true}
                onCheckedChange={(checked) => handleUpdate({ alertThreshold80: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="alert-100" className="flex flex-col gap-1">
                <span>100% threshold</span>
                <span className="font-normal text-muted-foreground">Notify when budget is exceeded</span>
              </Label>
              <Switch
                id="alert-100"
                checked={budget?.alertThreshold100 ?? true}
                onCheckedChange={(checked) => handleUpdate({ alertThreshold100: checked })}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-medium">Cost Controls</h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="degradation" className="flex flex-col gap-1">
                <span>Model degradation</span>
                <span className="font-normal text-muted-foreground">
                  Use cheaper models when soft limit (80%) is reached
                </span>
              </Label>
              <Switch
                id="degradation"
                checked={budget?.degradationEnabled ?? true}
                onCheckedChange={(checked) => handleUpdate({ degradationEnabled: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="hard-limit" className="flex flex-col gap-1">
                <span>Hard limit</span>
                <span className="font-normal text-muted-foreground">
                  Block non-essential AI features when limit is reached
                </span>
              </Label>
              <Switch
                id="hard-limit"
                checked={budget?.hardLimitEnabled ?? false}
                onCheckedChange={(checked) => handleUpdate({ hardLimitEnabled: checked })}
              />
            </div>
            {budget?.hardLimitEnabled && (
              <div className="ml-4 space-y-2">
                <Label htmlFor="hard-limit-percent">Hard limit percentage</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="hard-limit-percent"
                    type="number"
                    min="100"
                    max="500"
                    step="10"
                    value={localHardLimit}
                    onChange={(e) => setLocalHardLimit(e.target.value)}
                    onBlur={handleHardLimitBlur}
                    className="w-24"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Block AI features when usage exceeds this percentage of the budget
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function AIUsageAdminPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")

  const { data: usage, isLoading: usageLoading } = useAIUsage(workspaceId ?? "")
  const { data: budget, isLoading: budgetLoading } = useAIBudget(workspaceId ?? "")

  // Build user name lookup map
  const userNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const user of bootstrap?.users ?? []) {
      map.set(user.id, user.name || user.email || "Unknown")
    }
    return map
  }, [bootstrap?.users])

  // Get system usage from byOrigin data
  const systemCost = useMemo(() => {
    if (!usage?.byOrigin) return 0
    const systemUsage = usage.byOrigin.find((o) => o.origin === "system")
    return systemUsage?.totalCostUsd ?? 0
  }, [usage?.byOrigin])

  if (!workspaceId) {
    return null
  }

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
          <h1 className="font-semibold">AI Usage & Budget</h1>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <SummaryCards
            totalCost={usage?.total.totalCostUsd ?? 0}
            percentUsed={budget?.percentUsed ?? 0}
            budgetAmount={budget?.budget?.monthlyBudgetUsd ?? 50}
            isLoading={usageLoading || budgetLoading}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <SystemUsageCard
              systemCost={systemCost}
              totalCost={usage?.total.totalCostUsd ?? 0}
              isLoading={usageLoading}
            />
            <AssistantUsageCard
              byUser={usage?.byUser ?? []}
              userNames={userNames}
              totalCost={usage?.total.totalCostUsd ?? 0}
              isLoading={usageLoading}
            />
          </div>

          <BudgetSettings
            workspaceId={workspaceId}
            budget={budget?.budget ?? null}
            percentUsed={budget?.percentUsed ?? 0}
            nextReset={budget?.nextReset ?? new Date().toISOString()}
            isLoading={budgetLoading}
          />
        </div>
      </main>
    </div>
  )
}
