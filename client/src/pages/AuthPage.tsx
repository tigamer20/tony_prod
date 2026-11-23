import { useEffect, useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { Button, Field } from "../ui";

export function AuthPage() {
  const { login, register } = useAuth();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const inviteFromUrl = new URLSearchParams(window.location.search).get("code") ?? "";
  const [mode, setMode] = useState<"login" | "register">(inviteFromUrl ? "register" : "login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ identifier: "", email: "", username: "", displayName: "", password: "", inviteCode: inviteFromUrl });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>("/auth/setup")
      .then((r) => {
        setNeedsSetup(r.needsSetup);
        if (r.needsSetup) setMode("register");
      })
      .catch(() => setNeedsSetup(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(form.identifier, form.password);
      else {
        const { identifier: _i, ...rest } = form;
        await register(rest);
      }
      if (inviteFromUrl) window.history.replaceState({}, "", "/");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <div className="nav-logo">
            <Play size={20} fill="currentColor" />
          </div>
          <h1>Tony Prod</h1>
        </div>
        <p className="muted" style={{ marginBottom: 20 }}>
          {needsSetup
            ? "Welcome! Create the first account to set up your workspace. You'll be the owner."
            : mode === "login"
              ? "Sign in to your production hub."
              : "Create your account with the invite code you were given."}
        </p>

        {error && <div className="error-text" role="alert">{error}</div>}

        {mode === "login" ? (
          <Field label="Email or username">
            <input type="text" value={form.identifier} onChange={set("identifier")} autoComplete="username" required autoFocus />
          </Field>
        ) : (
          <>
            <div className="row">
              <Field label="Display name">
                <input type="text" value={form.displayName} onChange={set("displayName")} autoComplete="name" required autoFocus />
              </Field>
              <Field label="Username">
                <input type="text" value={form.username} onChange={set("username")} autoComplete="username" required />
              </Field>
            </div>
            <Field label="Email">
              <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
            </Field>
            {!needsSetup && (
              <Field label="Invite code">
                <input type="text" value={form.inviteCode} onChange={set("inviteCode")} required />
              </Field>
            )}
          </>
        )}
        <Field label="Password" hint={mode === "register" ? "At least 8 characters." : undefined}>
          <input
            type="password"
            value={form.password}
            onChange={set("password")}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 8 : undefined}
            required
          />
        </Field>

        <Button variant="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Please wait..." : mode === "login" ? "Sign in" : needsSetup ? "Create workspace" : "Create account"}
        </Button>

        {!needsSetup && (
          <div className="auth-switch">
            {mode === "login" ? (
              <>
                Have an invite code?{" "}
                <button type="button" onClick={() => { setMode("register"); setError(""); }}>Create an account</button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
