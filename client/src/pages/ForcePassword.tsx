import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { Button, Field } from "../ui";

/** Shown instead of the app when an admin created the account (or reset the password) and the member hasn't chosen their own yet. */
export function ForcePassword() {
  const { me, refresh, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      await api.post("/auth/password", { currentPassword: current, newPassword: next });
      await refresh();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <div className="nav-logo">
            <KeyRound size={20} />
          </div>
          <h1>Choose your password</h1>
        </div>
        <p className="muted" style={{ marginBottom: 20 }}>
          Welcome, {me!.displayName}! Your account was set up with a temporary password. Pick a new one that only you know before continuing.
        </p>

        {error && <div className="error-text" role="alert">{error}</div>}

        <Field label="Temporary password">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Repeat new password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        </Field>

        <Button variant="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Saving..." : "Save and continue"}
        </Button>
        <div className="auth-switch">
          <button type="button" onClick={() => void logout()}>Sign out</button>
        </div>
      </form>
    </div>
  );
}
