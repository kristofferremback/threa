import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto"

const ENCRYPTION_VERSION = 1
const GCM_ALGORITHM = "aes-256-gcm"
const IV_LENGTH_BYTES = 12
const MAX_STATE_AGE_MS = 60 * 60 * 1000

export interface EncryptedJsonPayload extends Record<string, unknown> {
  v: number
  iv: string
  tag: string
  ciphertext: string
}

function deriveKey(secret: string, label: string): Buffer {
  return createHmac("sha256", secret).update(label).digest()
}

export function encryptJson(secret: string, value: unknown): EncryptedJsonPayload {
  const iv = randomBytes(IV_LENGTH_BYTES)
  const key = deriveKey(secret, "workspace-integration-credentials:v1")
  const cipher = createCipheriv(GCM_ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    v: ENCRYPTION_VERSION,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  }
}

export function decryptJson<T>(secret: string, payload: Record<string, unknown>): T {
  const iv = payload.iv
  const tag = payload.tag
  const ciphertext = payload.ciphertext
  const version = payload.v

  if (
    version !== ENCRYPTION_VERSION ||
    typeof iv !== "string" ||
    typeof tag !== "string" ||
    typeof ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted workspace integration payload")
  }

  const key = deriveKey(secret, "workspace-integration-credentials:v1")
  const decipher = createDecipheriv(GCM_ALGORITHM, key, Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString(
    "utf8"
  )

  return JSON.parse(plaintext) as T
}

function signStatePayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`github-install-state:${payload}`).digest("hex")
}

export function createGithubInstallState(secret: string, workspaceId: string, nowMs = Date.now()): string {
  const payload = `${workspaceId}.${nowMs}`
  return `${payload}.${signStatePayload(secret, payload)}`
}

export function extractWorkspaceIdFromGithubInstallState(state: string): string | null {
  const [workspaceId] = state.split(".")
  return workspaceId || null
}

export function verifyGithubInstallState(secret: string, state: string, nowMs = Date.now()): { workspaceId: string } {
  const [workspaceId, issuedAtRaw, signature] = state.split(".")
  if (!workspaceId || !issuedAtRaw || !signature) {
    throw new Error("Malformed GitHub install state")
  }

  const payload = `${workspaceId}.${issuedAtRaw}`
  const expectedSignature = signStatePayload(secret, payload)
  const expectedBuffer = Buffer.from(expectedSignature, "utf8")
  const providedBuffer = Buffer.from(signature, "utf8")
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new Error("Invalid GitHub install state signature")
  }

  const issuedAtMs = Number.parseInt(issuedAtRaw, 10)
  if (!Number.isFinite(issuedAtMs)) {
    throw new Error("Malformed GitHub install state timestamp")
  }

  if (nowMs - issuedAtMs > MAX_STATE_AGE_MS) {
    throw new Error("GitHub install state has expired")
  }

  return { workspaceId }
}
