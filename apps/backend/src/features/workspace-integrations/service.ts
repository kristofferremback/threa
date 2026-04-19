import type { Pool } from "pg"
import { App, Octokit } from "octokit"
import type { WorkosOrgService } from "@threa/backend-common"
import { logger } from "../../lib/logger"
import { HttpError } from "../../lib/errors"
import type { AuthSessionClaims } from "@threa/backend-common"
import { workspaceIntegrationId } from "../../lib/id"
import type { GitHubAppConfig } from "../../lib/env"
import { UserRepository } from "../workspaces"
import { resolveWorkspaceAuthorization } from "../../middleware/workspace-authz-resolver"
import {
  WorkspaceIntegrationProviders,
  WorkspaceIntegrationStatuses,
  type GitHubInstalledRepository,
  type GitHubWorkspaceIntegration,
} from "@threa/types"
import { decryptJson, encryptJson, createGithubInstallState, verifyGithubInstallState } from "./crypto"
import { WorkspaceIntegrationRepository, type WorkspaceIntegrationRecord } from "./repository"

const log = logger.child({ module: "workspace-integrations" })

const GITHUB_RATE_LIMIT_NEAR_THRESHOLD = 100
const GITHUB_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

interface GitHubIntegrationCredentials {
  installationId: number
  accessToken: string
  tokenExpiresAt: string
}

interface GitHubIntegrationMetadata extends Record<string, unknown> {
  organizationName: string | null
  repositorySelection: "all" | "selected" | null
  permissions: Record<string, string>
  repositories: GitHubInstalledRepository[]
  rateLimitRemaining: number | null
  rateLimitResetAt: string | null
}

interface RefreshResult {
  record: WorkspaceIntegrationRecord
  credentials: GitHubIntegrationCredentials
  metadata: GitHubIntegrationMetadata
}

interface GitHubApiHeaders {
  [key: string]: string | number | string[] | undefined
}

export class GitHubClient {
  private octokit: Octokit

  constructor(
    private service: WorkspaceIntegrationService,
    private workspaceId: string,
    private record: WorkspaceIntegrationRecord,
    private credentials: GitHubIntegrationCredentials,
    private metadata: GitHubIntegrationMetadata
  ) {
    this.octokit = new Octokit({ auth: credentials.accessToken })
  }

  async request<T>(route: string, parameters: Record<string, unknown> = {}): Promise<T> {
    return this.requestInternal<T>(route, parameters, false)
  }

  private async requestInternal<T>(route: string, parameters: Record<string, unknown>, retried: boolean): Promise<T> {
    try {
      const response = await this.octokit.request(route, parameters)
      await this.captureRateLimit(response.headers as GitHubApiHeaders)
      return response.data as T
    } catch (error) {
      const status = getErrorStatus(error)
      const headers = getErrorHeaders(error)
      await this.captureRateLimit(headers)

      if (status === 401 && !retried) {
        const refreshed = await this.service.refreshGithubCredentialsForClient(this.workspaceId, this.record)
        if (!refreshed) {
          throw error
        }
        this.record = refreshed.record
        this.credentials = refreshed.credentials
        this.metadata = refreshed.metadata
        this.octokit = new Octokit({ auth: refreshed.credentials.accessToken })
        return this.requestInternal<T>(route, parameters, true)
      }

      throw error
    }
  }

  private async captureRateLimit(headers: GitHubApiHeaders | undefined): Promise<void> {
    if (!headers) return
    const remaining = parseIntegerHeader(headers["x-ratelimit-remaining"])
    const resetSeconds = parseIntegerHeader(headers["x-ratelimit-reset"])
    const resetAt = resetSeconds ? new Date(resetSeconds * 1000).toISOString() : null

    if (remaining === this.metadata.rateLimitRemaining && resetAt === this.metadata.rateLimitResetAt) {
      return
    }

    this.metadata = await this.service.updateGithubRateLimitMetadata(
      this.workspaceId,
      this.metadata,
      remaining,
      resetAt
    )
  }
}

interface WorkspaceIntegrationServiceDeps {
  pool: Pool
  github: GitHubAppConfig
  workosOrgService: WorkosOrgService
}

export class WorkspaceIntegrationService {
  private app: App | null

  constructor(private deps: WorkspaceIntegrationServiceDeps) {
    this.app =
      deps.github.enabled && deps.github.privateKey
        ? new App({ appId: deps.github.appId, privateKey: deps.github.privateKey })
        : null
  }

  isGitHubEnabled(): boolean {
    return this.app !== null
  }

  async getGithubIntegration(workspaceId: string): Promise<GitHubWorkspaceIntegration | null> {
    const record = await WorkspaceIntegrationRepository.findByWorkspaceAndProvider(
      this.deps.pool,
      workspaceId,
      WorkspaceIntegrationProviders.GITHUB
    )
    if (!record) return null

    const metadata = this.parseMetadata(record.metadata)
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      provider: "github",
      status: record.status,
      installedBy: record.installedBy,
      organizationName: metadata.organizationName,
      repositorySelection: metadata.repositorySelection,
      permissions: metadata.permissions,
      repositories: metadata.repositories,
      rateLimit: {
        remaining: metadata.rateLimitRemaining,
        resetAt: metadata.rateLimitResetAt,
      },
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }

  getGithubConnectUrl(workspaceId: string): string {
    this.requireGitHubEnabled()
    const state = createGithubInstallState(this.deps.github.integrationSecret, workspaceId)
    return `https://github.com/apps/${this.deps.github.appSlug}/installations/new?state=${encodeURIComponent(state)}`
  }

  async disconnectGithubIntegration(workspaceId: string): Promise<void> {
    await WorkspaceIntegrationRepository.update(this.deps.pool, workspaceId, WorkspaceIntegrationProviders.GITHUB, {
      status: WorkspaceIntegrationStatuses.INACTIVE,
      credentials: {},
      metadata: {},
    })
  }

  async handleGithubCallback(params: {
    state: string
    installationId: string
    workosUserId: string
    session?: AuthSessionClaims
  }): Promise<{ workspaceId: string }> {
    this.requireGitHubEnabled()

    let workspaceId: string
    try {
      workspaceId = verifyGithubInstallState(this.deps.github.integrationSecret, params.state).workspaceId
    } catch (error) {
      throw new HttpError((error as Error).message, { status: 400, code: "INVALID_GITHUB_INSTALL_STATE" })
    }

    const access = await UserRepository.findWorkspaceUserAccess(this.deps.pool, workspaceId, params.workosUserId)
    if (!access.workspaceExists) {
      throw new HttpError("Workspace not found", { status: 404, code: "WORKSPACE_NOT_FOUND" })
    }
    if (!access.user) {
      throw new HttpError("Not a member of this workspace", { status: 403, code: "FORBIDDEN" })
    }

    const authz = await resolveWorkspaceAuthorization({
      pool: this.deps.pool,
      workspaceId,
      userId: access.user.id,
      source: "session",
      session: params.session,
    })
    if (authz.status !== "ok" || !authz.value.permissions.has("workspace:admin")) {
      throw new HttpError("Only admins can connect GitHub", { status: 403, code: "FORBIDDEN" })
    }

    await this.completeGithubInstallation(workspaceId, access.user.id, params.installationId)
    return { workspaceId }
  }

  async getGithubClient(workspaceId: string): Promise<GitHubClient | null> {
    if (!this.app) return null

    const record = await WorkspaceIntegrationRepository.findByWorkspaceAndProvider(
      this.deps.pool,
      workspaceId,
      WorkspaceIntegrationProviders.GITHUB
    )
    if (!record || record.status !== WorkspaceIntegrationStatuses.ACTIVE) {
      return null
    }

    const metadata = this.parseMetadata(record.metadata)
    if (this.isNearGithubRateLimit(metadata)) {
      return null
    }

    let credentials: GitHubIntegrationCredentials
    try {
      credentials = this.parseCredentials(workspaceId, record.credentials)
    } catch (error) {
      log.warn({ err: error, workspaceId }, "GitHub integration credentials could not be decrypted")
      return null
    }

    if (this.shouldRefreshToken(credentials.tokenExpiresAt)) {
      const refreshed = await this.refreshGithubCredentialsForClient(workspaceId, record)
      if (!refreshed) return null
      return new GitHubClient(this, workspaceId, refreshed.record, refreshed.credentials, refreshed.metadata)
    }

    return new GitHubClient(this, workspaceId, record, credentials, metadata)
  }

  async updateGithubRateLimitMetadata(
    workspaceId: string,
    metadata: GitHubIntegrationMetadata,
    remaining: number | null,
    resetAt: string | null
  ): Promise<GitHubIntegrationMetadata> {
    const nextMetadata: GitHubIntegrationMetadata = {
      ...metadata,
      rateLimitRemaining: remaining,
      rateLimitResetAt: resetAt,
    }

    await WorkspaceIntegrationRepository.update(this.deps.pool, workspaceId, WorkspaceIntegrationProviders.GITHUB, {
      metadata: nextMetadata,
    })

    return nextMetadata
  }

  async refreshGithubCredentialsForClient(
    workspaceId: string,
    record: WorkspaceIntegrationRecord
  ): Promise<RefreshResult | null> {
    if (!this.app) return null

    let credentials: GitHubIntegrationCredentials
    try {
      credentials = this.parseCredentials(workspaceId, record.credentials)
    } catch (error) {
      log.warn({ err: error, workspaceId }, "Failed to parse GitHub credentials during refresh")
      return null
    }

    const metadata = this.parseMetadata(record.metadata)
    return this.refreshGithubCredentials(workspaceId, record, credentials.installationId, metadata)
  }

  private async completeGithubInstallation(
    workspaceId: string,
    installedByUserId: string,
    installationIdRaw: string
  ): Promise<void> {
    const installationId = Number.parseInt(installationIdRaw, 10)
    if (!Number.isFinite(installationId)) {
      throw new HttpError("Invalid GitHub installation ID", { status: 400, code: "INVALID_GITHUB_INSTALLATION" })
    }

    const installation = await this.getAppOctokit().request("GET /app/installations/{installation_id}", {
      installation_id: installationId,
    })

    const accountType = getInstallationAccountType(installation.data.account) ?? installation.data.target_type ?? null
    if (accountType !== "Organization") {
      throw new HttpError("GitHub App must be installed on an organization", {
        status: 400,
        code: "GITHUB_ORGANIZATION_REQUIRED",
      })
    }

    const refreshed = await this.refreshGithubCredentials(
      workspaceId,
      (await WorkspaceIntegrationRepository.findByWorkspaceAndProvider(
        this.deps.pool,
        workspaceId,
        WorkspaceIntegrationProviders.GITHUB
      )) ?? {
        id: workspaceIntegrationId(),
        workspaceId,
        provider: WorkspaceIntegrationProviders.GITHUB,
        status: WorkspaceIntegrationStatuses.INACTIVE,
        credentials: {},
        metadata: {},
        installedBy: installedByUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      installationId,
      {
        organizationName: getInstallationAccountLogin(installation.data.account),
        repositorySelection: normalizeRepositorySelection(installation.data.repository_selection),
        permissions: normalizePermissions(installation.data.permissions),
        repositories: [],
        rateLimitRemaining: null,
        rateLimitResetAt: null,
      },
      installedByUserId,
      true
    )

    if (!refreshed) {
      throw new HttpError("Failed to activate GitHub integration", {
        status: 502,
        code: "GITHUB_INTEGRATION_ACTIVATION_FAILED",
      })
    }
  }

  private async refreshGithubCredentials(
    workspaceId: string,
    record: WorkspaceIntegrationRecord,
    installationId: number,
    metadata: GitHubIntegrationMetadata,
    installedByOverride?: string,
    hydrateRepositories = false
  ): Promise<RefreshResult | null> {
    try {
      const tokenResponse = await this.getAppOctokit().request(
        "POST /app/installations/{installation_id}/access_tokens",
        {
          installation_id: installationId,
        }
      )

      const accessToken = tokenResponse.data.token
      const tokenExpiresAt = tokenResponse.data.expires_at
      const nextMetadata: GitHubIntegrationMetadata = {
        ...metadata,
        permissions: normalizePermissions(tokenResponse.data.permissions) || metadata.permissions,
      }

      if (hydrateRepositories) {
        const installationOctokit = new Octokit({ auth: accessToken })
        nextMetadata.repositories = await listInstallationRepositories(installationOctokit)
      }

      const updated = await WorkspaceIntegrationRepository.upsert(this.deps.pool, {
        id: record.id,
        workspaceId,
        provider: WorkspaceIntegrationProviders.GITHUB,
        status: WorkspaceIntegrationStatuses.ACTIVE,
        credentials: encryptJson(
          this.deps.github.integrationSecret,
          {
            installationId,
            accessToken,
            tokenExpiresAt,
          },
          { workspaceId, provider: WorkspaceIntegrationProviders.GITHUB }
        ),
        metadata: nextMetadata,
        installedBy: installedByOverride ?? record.installedBy,
      })

      return {
        record: updated,
        credentials: {
          installationId,
          accessToken,
          tokenExpiresAt,
        },
        metadata: nextMetadata,
      }
    } catch (error) {
      log.warn({ err: error, workspaceId, installationId }, "GitHub installation token refresh failed")
      return null
    }
  }

  private parseCredentials(workspaceId: string, payload: Record<string, unknown>): GitHubIntegrationCredentials {
    const decrypted = decryptJson<Partial<GitHubIntegrationCredentials>>(this.deps.github.integrationSecret, payload, {
      workspaceId,
      provider: WorkspaceIntegrationProviders.GITHUB,
    })
    if (
      !decrypted ||
      typeof decrypted.installationId !== "number" ||
      typeof decrypted.accessToken !== "string" ||
      typeof decrypted.tokenExpiresAt !== "string"
    ) {
      throw new Error("Malformed GitHub integration credentials")
    }
    return decrypted as GitHubIntegrationCredentials
  }

  private parseMetadata(payload: Record<string, unknown>): GitHubIntegrationMetadata {
    return {
      organizationName: typeof payload.organizationName === "string" ? payload.organizationName : null,
      repositorySelection: normalizeRepositorySelection(payload.repositorySelection),
      permissions: normalizePermissions(payload.permissions),
      repositories: normalizeRepositories(payload.repositories),
      rateLimitRemaining:
        typeof payload.rateLimitRemaining === "number" && Number.isFinite(payload.rateLimitRemaining)
          ? payload.rateLimitRemaining
          : null,
      rateLimitResetAt: typeof payload.rateLimitResetAt === "string" ? payload.rateLimitResetAt : null,
    }
  }

  private isNearGithubRateLimit(metadata: GitHubIntegrationMetadata): boolean {
    if (metadata.rateLimitRemaining === null || !metadata.rateLimitResetAt) {
      return false
    }
    return (
      metadata.rateLimitRemaining <= GITHUB_RATE_LIMIT_NEAR_THRESHOLD &&
      new Date(metadata.rateLimitResetAt) > new Date()
    )
  }

  private shouldRefreshToken(tokenExpiresAt: string): boolean {
    return new Date(tokenExpiresAt).getTime() - Date.now() <= GITHUB_TOKEN_REFRESH_SKEW_MS
  }

  private requireGitHubEnabled(): void {
    if (!this.app) {
      throw new HttpError("GitHub integration is not configured", {
        status: 503,
        code: "GITHUB_INTEGRATION_NOT_CONFIGURED",
      })
    }
  }

  private getAppOctokit() {
    this.requireGitHubEnabled()
    return this.app!.octokit
  }
}

async function listInstallationRepositories(octokit: Octokit): Promise<GitHubInstalledRepository[]> {
  const repositories: GitHubInstalledRepository[] = []
  let page = 1

  for (;;) {
    const response = await octokit.request("GET /installation/repositories", {
      per_page: 100,
      page,
    })
    repositories.push(
      ...response.data.repositories.map((repo) => ({
        fullName: repo.full_name,
        private: repo.private,
      }))
    )
    if (response.data.repositories.length < 100) {
      break
    }
    page += 1
  }

  return repositories
}

function normalizePermissions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
}

function normalizeRepositories(value: unknown): GitHubInstalledRepository[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const fullName = (entry as { fullName?: unknown }).fullName
    const isPrivate = (entry as { private?: unknown }).private
    if (typeof fullName !== "string" || typeof isPrivate !== "boolean") return []
    return [{ fullName, private: isPrivate }]
  })
}

function normalizeRepositorySelection(value: unknown): "all" | "selected" | null {
  return value === "all" || value === "selected" ? value : null
}

function getInstallationAccountType(account: unknown): string | null {
  if (!account || typeof account !== "object") return null
  const type = (account as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

function getInstallationAccountLogin(account: unknown): string | null {
  if (!account || typeof account !== "object") return null
  const login = (account as { login?: unknown }).login
  return typeof login === "string" ? login : null
}

function parseIntegerHeader(value: string | number | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null
  }
  const parsed = Number.parseInt(String(raw), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null
  const status = (error as { status?: unknown }).status
  return typeof status === "number" ? status : null
}

function getErrorHeaders(error: unknown): GitHubApiHeaders | undefined {
  if (!error || typeof error !== "object") return undefined
  return (error as { response?: { headers?: GitHubApiHeaders } }).response?.headers
}
