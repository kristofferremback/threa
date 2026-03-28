import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { workspacesApi } from "@/api/workspaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useFormattedDate } from "@/hooks/use-formatted-date"
import { API_KEY_PERMISSIONS, type ApiKeyScope } from "@threa/types"
import { Copy, Plus, Trash2, Eye, EyeOff } from "lucide-react"

interface UserApiKeysSectionProps {
  workspaceId: string
}

export function UserApiKeysSection({ workspaceId }: UserApiKeysSectionProps) {
  const queryClient = useQueryClient()
  const queryKey = ["user-api-keys", workspaceId]
  const { formatDate } = useFormattedDate()

  const { data: keys = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => workspacesApi.listUserApiKeys(workspaceId),
  })

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [selectedScopes, setSelectedScopes] = useState<Set<ApiKeyScope>>(new Set())
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null)
  const [showKeyValue, setShowKeyValue] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null)

  const createMutation = useMutation({
    mutationFn: (params: { name: string; scopes: ApiKeyScope[] }) =>
      workspacesApi.createUserApiKey(workspaceId, params),
    onSuccess: (data) => {
      setCreatedKeyValue(data.value)
      setShowKeyValue(true)
      setNewKeyName("")
      setSelectedScopes(new Set())
      setShowCreateForm(false)
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => workspacesApi.revokeUserApiKey(workspaceId, keyId),
    onSuccess: () => {
      setRevokeTarget(null)
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const toggleScope = (scope: ApiKeyScope) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) {
        next.delete(scope)
      } else {
        next.add(scope)
      }
      return next
    })
  }

  const handleCreate = () => {
    if (!newKeyName.trim() || selectedScopes.size === 0) return
    createMutation.mutate({ name: newKeyName.trim(), scopes: [...selectedScopes] })
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const activeKeys = keys.filter((k) => !k.revokedAt)
  const revokedKeys = keys.filter((k) => k.revokedAt)

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-4">
      {createdKeyValue && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
          <p className="text-sm font-medium">API key created. Copy it now — it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted p-2 rounded break-all font-mono">
              {showKeyValue ? createdKeyValue : "••••••••••••••••••••••••••••••••"}
            </code>
            <Button variant="ghost" size="icon" onClick={() => setShowKeyValue(!showKeyValue)}>
              {showKeyValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => copyToClipboard(createdKeyValue)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCreatedKeyValue(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Personal API keys act on your behalf with the same access as your account.
        </p>
        {!showCreateForm && (
          <Button variant="outline" size="sm" onClick={() => setShowCreateForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New key
          </Button>
        )}
      </div>

      {showCreateForm && (
        <div className="rounded-md border p-3 space-y-3">
          <div>
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              placeholder="e.g. My automation script"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Permissions</Label>
            <div className="mt-1 space-y-2">
              {API_KEY_PERMISSIONS.map((perm) => (
                <label key={perm.slug} className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={selectedScopes.has(perm.slug)}
                    onCheckedChange={() => toggleScope(perm.slug)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium">{perm.name}</span>
                    <p className="text-xs text-muted-foreground">{perm.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!newKeyName.trim() || selectedScopes.size === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create key"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreateForm(false)
                setNewKeyName("")
                setSelectedScopes(new Set())
              }}
            >
              Cancel
            </Button>
          </div>
          {createMutation.error && <p className="text-sm text-destructive">Failed to create key. Please try again.</p>}
        </div>
      )}

      {activeKeys.length > 0 && (
        <div className="space-y-2">
          {activeKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{key.name}</span>
                  <code className="text-xs text-muted-foreground font-mono">threa_uk_{key.keyPrefix}...</code>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {key.scopes.map((scope) => (
                    <Badge key={scope} variant="secondary" className="text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Created {formatDate(new Date(key.createdAt))}
                  {key.lastUsedAt && ` · Last used ${formatDate(new Date(key.lastUsedAt))}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                title="Revoke key"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {activeKeys.length === 0 && !showCreateForm && (
        <p className="text-sm text-muted-foreground text-center py-4">No API keys yet.</p>
      )}

      {revokedKeys.length > 0 && (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">
            {revokedKeys.length} revoked key{revokedKeys.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 space-y-1">
            {revokedKeys.map((key) => (
              <div key={key.id} className="flex items-center gap-2 px-3 py-2 opacity-50">
                <span className="text-sm line-through">{key.name}</span>
                <code className="text-xs text-muted-foreground font-mono">threa_uk_{key.keyPrefix}...</code>
                <Badge variant="outline" className="text-xs">
                  revoked
                </Badge>
              </div>
            ))}
          </div>
        </details>
      )}

      {revokeMutation.error && <p className="text-sm text-destructive">Failed to revoke key. Please try again.</p>}

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke <strong>{revokeTarget?.name}</strong>. Any applications using this key will
              lose access immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
