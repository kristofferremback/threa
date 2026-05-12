/**
 * WorkOS multi-account compatibility probes.
 *
 * Verifies the OIDC behaviors the multi-account login design depends on
 * BEFORE we ship any frontend or routing changes. Treat failures as a hard
 * gate — if any probe fails, the cookie-jar design in
 * `docs/plans/multi-account-login.md` cannot ship as written.
 *
 * Usage:
 *   bun apps/control-plane/scripts/workos-probe.ts [--probe=N]
 *
 * Probes:
 *   1) `prompt=login` forces re-auth even when a WorkOS SSO session exists.
 *   2) `login_hint=<email>` pre-fills the email field on the AuthKit page.
 *   3) `screen_hint=sign-up` lands the user on the registration screen.
 *   4) Two concurrent sealed sessions for different WorkOS users coexist
 *      and refresh independently — invalidating one does not invalidate
 *      the other.
 *   5) `getLogoutUrl(returnTo)` only invalidates the passed sealed session.
 *
 * Probes 1, 2, 3 emit URLs the operator opens in a browser and visually
 * verifies. Probes 4 and 5 require two real WorkOS user accounts and are
 * driven by interactive prompts.
 *
 * Output is JSON to stdout for easy archival under the design doc's
 * "WorkOS Compatibility — verified" section.
 */

import { WorkOS } from "@workos-inc/node"
import { loadControlPlaneConfig } from "../src/config"

interface ProbeResult {
  probe: number
  name: string
  outcome: "url-emitted" | "needs-manual-check" | "skipped"
  url?: string
  notes?: string
}

const MIN_PROBE = 1
const MAX_PROBE = 5

function pickProbeFilter(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--probe="))
  if (!arg) return null
  const raw = arg.split("=")[1]
  const n = Number(raw)
  if (!Number.isInteger(n) || n < MIN_PROBE || n > MAX_PROBE) {
    console.error(`Invalid --probe value "${raw}". Expected an integer in ${MIN_PROBE}..${MAX_PROBE}.`)
    process.exit(1)
  }
  return n
}

async function main() {
  const config = loadControlPlaneConfig()
  const workos = new WorkOS(config.workos.apiKey, { clientId: config.workos.clientId })
  const filter = pickProbeFilter()
  const results: ProbeResult[] = []

  const baseParams = {
    provider: "authkit" as const,
    redirectUri: config.workos.redirectUri,
    clientId: config.workos.clientId,
  }

  // Probe 1: prompt=login forces re-prompt.
  if (filter === null || filter === 1) {
    // Cast to `unknown` — `prompt` isn't on the public type yet but the
    // server forwards arbitrary OIDC params straight through.
    const url = workos.userManagement.getAuthorizationUrl({
      ...baseParams,
      state: Buffer.from("probe:1").toString("base64"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prompt: "login",
    } as any)
    results.push({
      probe: 1,
      name: "prompt=login forces re-prompt",
      outcome: "url-emitted",
      url,
      notes:
        "Open in a browser already signed in to WorkOS for this tenant. Expected: AuthKit re-prompts for credentials instead of silently completing.",
    })
  }

  // Probe 2: login_hint pre-fills email.
  if (filter === null || filter === 2) {
    const hintEmail = process.env.PROBE_LOGIN_HINT_EMAIL ?? "probe+hint@example.com"
    const url = workos.userManagement.getAuthorizationUrl({
      ...baseParams,
      state: Buffer.from("probe:2").toString("base64"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loginHint: hintEmail,
    } as any)
    results.push({
      probe: 2,
      name: "login_hint pre-fills email",
      outcome: "url-emitted",
      url,
      notes: `Open in an incognito window. Expected: the AuthKit email field is pre-populated with "${hintEmail}".`,
    })
  }

  // Probe 3: screen_hint=sign-up.
  if (filter === null || filter === 3) {
    const url = workos.userManagement.getAuthorizationUrl({
      ...baseParams,
      state: Buffer.from("probe:3").toString("base64"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      screenHint: "sign-up",
    } as any)
    results.push({
      probe: 3,
      name: "screen_hint=sign-up lands on registration",
      outcome: "url-emitted",
      url,
      notes: "Expected: the AuthKit landing screen is sign-up, not sign-in.",
    })
  }

  // Probe 4: concurrent sealed sessions for different users.
  if (filter === null || filter === 4) {
    results.push({
      probe: 4,
      name: "two sealed sessions coexist & refresh independently",
      outcome: "needs-manual-check",
      notes:
        "Manual: " +
        "1) Authenticate user A in a regular tab; copy the sealed cookie value. " +
        "2) Authenticate user B in an incognito tab; copy that sealed cookie value. " +
        "3) Drop both into a Node REPL with WorkosAuthService, call authenticateSession() on each. " +
        "Expected: both succeed, no cross-invalidation. Run this with two real test users from the staging tenant.",
    })
  }

  // Probe 5: getLogoutUrl only invalidates the passed session.
  if (filter === null || filter === 5) {
    results.push({
      probe: 5,
      name: "getLogoutUrl(returnTo) only invalidates the passed sealed session",
      outcome: "needs-manual-check",
      notes:
        "Manual: with sessions A and B from probe 4, call workos.userManagement.loadSealedSession(A).getLogoutUrl({...}) and follow the URL. " +
        "Then call authenticateSession on the unchanged B cookie — it must still authenticate. " +
        "If it doesn't, account remove cannot scope to the leaving account.",
    })
  }

  console.log(JSON.stringify({ results }, null, 2))
}

main().catch((err) => {
  console.error("Probe script failed:", err)
  process.exit(1)
})
