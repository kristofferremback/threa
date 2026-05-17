import { useCallback, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { API_BASE, ApiError, api } from "@/api/client"
import { useAuth } from "@/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import { ThreaLogo } from "@/components/threa-logo"
import { clearLastWorkspaceId } from "@/lib/last-workspace"

type Step = "picker" | "email" | "verify"

const MAGIC_CODE_LENGTH = 6

export function AddAccountPage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { refetch } = useAuth()
  const [step, setStep] = useState<Step>("picker")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redirectTo = search.get("redirect_to") || undefined

  const goSocial = useCallback(
    (provider: "GoogleOAuth" | "MicrosoftOAuth") => {
      // Same shape as the existing login flow: a full-page navigation to the
      // backend so the OAuth callback's cookie writes land before the SPA
      // boots. `intent=add` + a social provider together bypass AuthKit and
      // the IdP shows its native account picker.
      const qs = new URLSearchParams({ intent: "add", provider })
      if (redirectTo) qs.set("redirect_to", redirectTo)
      window.location.href = `${API_BASE}/api/auth/login?${qs.toString()}`
    },
    [redirectTo]
  )

  const sendCode = useCallback(async () => {
    if (!email) return
    setBusy(true)
    setError(null)
    try {
      await api.post("/api/auth/magic/send", { email })
      setStep("verify")
    } catch {
      // The endpoint deliberately replies 200 even when the email is unknown
      // (no account-existence oracle), so the only way we land here is a
      // network/server failure.
      setError("Couldn't send the code right now. Please try again.")
    } finally {
      setBusy(false)
    }
  }, [email])

  const verifyCode = useCallback(async () => {
    if (code.length !== MAGIC_CODE_LENGTH) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ ok: boolean; redirectPath: string }>("/api/auth/magic/verify", {
        email,
        code,
        intent: "add",
      })
      // A successful add makes the new account active; the stale last-workspace
      // pointer would route us back into the *previous* account. Same dance
      // the OAuth callback / AuthProvider mount-effect does on accountAdded=1.
      clearLastWorkspaceId()
      await refetch()
      navigate(result.redirectPath, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === "MAX_ACCOUNTS_REACHED") {
        toast.error("You're signed in to the maximum number of accounts. Remove one to add another.")
        navigate(-1)
        return
      }
      if (err instanceof ApiError && err.status === 401) {
        setError("That code didn't match. Check your email and try again.")
        setCode("")
        return
      }
      setError("Couldn't verify the code right now. Please try again.")
    } finally {
      setBusy(false)
    }
  }, [code, email, navigate, refetch])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <ThreaLogo size="lg" />
          <div className="text-center">
            <h1 className="text-xl font-light tracking-[0.15em] uppercase text-primary">Add account</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {step === "picker" && "Choose how to add another account."}
              {step === "email" && "We'll email you a one-time code."}
              {step === "verify" && `Enter the 6-digit code we sent to ${email}.`}
            </p>
          </div>
        </div>

        {step === "picker" && (
          <div className="flex w-full flex-col gap-3">
            <Button onClick={() => goSocial("GoogleOAuth")} variant="outline" size="lg" className="justify-start gap-3">
              <GoogleIcon />
              <span>Continue with Google</span>
            </Button>
            <Button
              onClick={() => goSocial("MicrosoftOAuth")}
              variant="outline"
              size="lg"
              className="justify-start gap-3"
            >
              <MicrosoftIcon />
              <span>Continue with Microsoft</span>
            </Button>
            <Button onClick={() => setStep("email")} variant="outline" size="lg" className="justify-start gap-3">
              <MailIcon />
              <span>Continue with email code</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mt-2">
              Cancel
            </Button>
          </div>
        )}

        {step === "email" && (
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              sendCode()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-account-email">Email</Label>
              <Input
                id="add-account-email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" disabled={busy || !email}>
              {busy ? "Sending..." : "Send code"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep("picker")} disabled={busy}>
              Back
            </Button>
          </form>
        )}

        {step === "verify" && (
          <form
            className="flex w-full flex-col items-center gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              verifyCode()
            }}
          >
            <InputOTP
              maxLength={MAGIC_CODE_LENGTH}
              value={code}
              onChange={setCode}
              autoFocus
              disabled={busy}
              containerClassName="justify-center"
            >
              <InputOTPGroup>
                {Array.from({ length: MAGIC_CODE_LENGTH }).map((_, i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" disabled={busy || code.length !== MAGIC_CODE_LENGTH} className="w-full">
              {busy ? "Verifying..." : "Verify"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep("email")
                setCode("")
                setError(null)
              }}
              disabled={busy}
            >
              Use a different email
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
      <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
      <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
      <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}
