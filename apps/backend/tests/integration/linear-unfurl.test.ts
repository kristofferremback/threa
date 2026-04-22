import { describe, test, expect, beforeAll, afterAll, beforeEach, spyOn } from "bun:test"
import { Pool } from "pg"
import { setupTestDatabase } from "./setup"
import {
  WorkspaceIntegrationService,
  WorkspaceIntegrationRepository,
  createLinearInstallState,
} from "../../src/features/workspace-integrations"
import { fetchLinearPreview } from "../../src/features/link-previews/linear-preview"
import { workspaceId as makeWorkspaceId, userId as makeUserId } from "../../src/lib/id"
import { WorkspaceIntegrationProviders, WorkspaceIntegrationStatuses } from "@threa/types"

/**
 * End-to-end happy path for Linear URL unfurling.
 *
 * Seeds a workspace with an admin user, runs the full OAuth callback through
 * `handleLinearCallback` (mocked fetch for token exchange + viewer query),
 * then exercises the preview pipeline by calling `fetchLinearPreview` against
 * a seeded `linear_issue` GraphQL response. Verifies the complete flow from
 * signed install-state round-trip through encrypted credential persistence,
 * organization-slug gating, and preview payload construction.
 */

const LINEAR_CLIENT_ID = "linear_client_123"
const LINEAR_CLIENT_SECRET = "linear_client_secret_456"
const LINEAR_REDIRECT_URI = "https://threa.test/api/integrations/linear/callback"
const INTEGRATION_SECRET = "test-workspace-integration-secret"

describe("Linear URL unfurl — integration", () => {
  let pool: Pool
  let service: WorkspaceIntegrationService
  let wsId: string
  let adminUserWorkosId: string

  beforeAll(async () => {
    pool = await setupTestDatabase()
    service = new WorkspaceIntegrationService({
      pool,
      github: {
        enabled: false,
        appId: "",
        appSlug: "",
        privateKey: "",
        integrationSecret: INTEGRATION_SECRET,
      },
      linear: {
        enabled: true,
        clientId: LINEAR_CLIENT_ID,
        clientSecret: LINEAR_CLIENT_SECRET,
        redirectUri: LINEAR_REDIRECT_URI,
        integrationSecret: INTEGRATION_SECRET,
      },
    })
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    // Clean slate for workspace-scoped rows that this suite touches.
    wsId = makeWorkspaceId()
    adminUserWorkosId = `workos_${makeUserId()}`

    await pool.query(`DELETE FROM workspace_integrations WHERE workspace_id = $1`, [wsId])

    // Minimal workspace + admin user so `handleLinearCallback`'s role check passes.
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [wsId, "Integration Test", `it-${wsId.slice(-8)}`, "seed"]
    )
    await pool.query(
      `INSERT INTO users (id, workspace_id, workos_user_id, email, role, slug, name, joined_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'admin', $5, $6, NOW(), NOW(), NOW())
       ON CONFLICT (workspace_id, workos_user_id) DO NOTHING`,
      [makeUserId(), wsId, adminUserWorkosId, "admin@test.local", `admin-${wsId.slice(-8)}`, "Admin"]
    )
  })

  test("OAuth callback persists encrypted credentials, then fetchLinearPreview unfurls an issue URL", async () => {
    // 1. Mock global fetch for the callback token-exchange + viewer query +
    //    later GraphQL call from `fetchLinearPreview`.
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString()
      const body = typeof init?.body === "string" ? init.body : ""

      if (url === "https://api.linear.app/oauth/token") {
        return new Response(
          JSON.stringify({
            access_token: "at_e2e",
            refresh_token: "rt_e2e",
            token_type: "Bearer",
            expires_in: 86399,
            scope: "read,app:assignable,app:mentionable",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }

      if (url === "https://api.linear.app/graphql") {
        if (body.includes("InstallViewer")) {
          return new Response(
            JSON.stringify({
              data: {
                organization: { id: "org_e2e", name: "Acme Threa", urlKey: "acme" },
                viewer: { id: "user_e2e", name: "Admin", email: "admin@test.local" },
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-RateLimit-Requests-Remaining": "4999",
                "X-RateLimit-Requests-Reset": "9999999999",
              },
            }
          )
        }

        // Any other GraphQL call is the issue preview query.
        return new Response(
          JSON.stringify({
            data: {
              issue: {
                id: "iss_e2e",
                identifier: "ENG-42",
                title: "Ship the Linear integration",
                priority: 2,
                priorityLabel: "High",
                estimate: 3,
                dueDate: null,
                state: { name: "In Progress", type: "started", color: "#f2c94c" },
                assignee: { id: "user_e2e", name: "Admin", displayName: "Admin", avatarUrl: null },
                team: { key: "ENG", name: "Engineering" },
                labels: { nodes: [{ name: "integration", color: "#5e6ad2" }] },
                project: { id: "prj_e2e", name: "Integrations" },
                createdAt: "2026-04-22T10:00:00.000Z",
                updatedAt: "2026-04-22T11:00:00.000Z",
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-RateLimit-Requests-Remaining": "4998",
              "X-RateLimit-Requests-Reset": "9999999999",
              "X-RateLimit-Complexity-Remaining": "1999000",
              "X-RateLimit-Complexity-Reset": "9999999999",
            },
          }
        )
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    try {
      // 2. Complete the Linear OAuth callback (this persists encrypted credentials + metadata).
      const state = createLinearInstallState(INTEGRATION_SECRET, wsId)
      await service.handleLinearCallback({ state, code: "auth_code_e2e", workosUserId: adminUserWorkosId })

      // 3. Verify the integration row landed correctly.
      const integration = await service.getLinearIntegration(wsId)
      expect(integration).not.toBeNull()
      expect(integration?.status).toBe(WorkspaceIntegrationStatuses.ACTIVE)
      expect(integration?.organizationUrlKey).toBe("acme")
      expect(integration?.organizationName).toBe("Acme Threa")
      expect(integration?.authorizedUser?.name).toBe("Admin")

      const record = await WorkspaceIntegrationRepository.findByWorkspaceAndProvider(
        pool,
        wsId,
        WorkspaceIntegrationProviders.LINEAR
      )
      // Credentials MUST be encrypted at rest — no plaintext tokens in the JSONB blob.
      const credsBlob = JSON.stringify(record?.credentials ?? {})
      expect(credsBlob).not.toContain("at_e2e")
      expect(credsBlob).not.toContain("rt_e2e")
      expect(record?.credentials).toMatchObject({ v: expect.any(Number), ciphertext: expect.any(String) })

      // 4. Unfurl a matching Linear issue URL end-to-end.
      const preview = await fetchLinearPreview(
        wsId,
        "https://linear.app/acme/issue/ENG-42/ship-the-linear-integration",
        service
      )

      expect(preview).not.toBeNull()
      expect(preview).toMatchObject({
        previewType: "linear_issue",
        siteName: "Linear",
        status: "completed",
        previewData: {
          type: "linear_issue",
          organization: { id: "org_e2e", urlKey: "acme", name: "Acme Threa" },
          data: {
            identifier: "ENG-42",
            title: "Ship the Linear integration",
            team: { key: "ENG", name: "Engineering" },
            state: { name: "In Progress", type: "started" },
            priority: { label: "High", value: 2 },
          },
        },
      })

      // 5. A URL from a different Linear workspace must not unfurl (organizationUrlKey gate).
      const strangerPreview = await fetchLinearPreview(
        wsId,
        "https://linear.app/not-our-workspace/issue/ENG-42",
        service
      )
      expect(strangerPreview).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
