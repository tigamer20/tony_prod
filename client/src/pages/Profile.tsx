import { useState, type FormEvent } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { Avatar, Button, Field, Modal, RoleChip, useToast } from "../ui";

const COLORS = ["#5865f2", "#eb459e", "#3ba55d", "#f0b232", "#ed4245", "#1abc9c", "#9b59b6", "#e67e22"];

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<"profile" | "password">("profile");
  const [form, setForm] = useState({
    displayName: me!.displayName,
    jobTitle: me!.jobTitle ?? "",
    phone: me!.phone ?? "",
    bio: me!.bio ?? "",
    avatarColor: me!.avatarColor,
  });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "profile") {
        await api.patch("/auth/me", {
          displayName: form.displayName,
          jobTitle: form.jobTitle || null,
          phone: form.phone || null,
          bio: form.bio || null,
          avatarColor: form.avatarColor,
        });
        await refresh();
        toast("Profile updated.", "success");
      } else {
        await api.post("/auth/password", pw);
        setPw({ currentPassword: "", newPassword: "" });
        toast("Password changed.", "success");
      }
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Your account"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="profile-form" type="submit" disabled={busy}>Save</Button>
        </>
      }
    >
      <div className="tabs">
        <button className={`tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>Profile</button>
        <button className={`tab ${tab === "password" ? "active" : ""}`} onClick={() => setTab("password")}>Password</button>
      </div>
      {error && <div className="error-text" role="alert">{error}</div>}
      <form id="profile-form" onSubmit={save}>
        {tab === "profile" ? (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
              <Avatar user={{ displayName: form.displayName || "?", avatarColor: form.avatarColor }} size={56} />
              <div>
                <div className="chips" style={{ marginBottom: 6 }}>
                  {me!.roles.map((r) => <RoleChip key={r.id} role={r} />)}
                </div>
                <div className="muted small">@{me!.username} · {me!.email}</div>
              </div>
            </div>
            <Field label="Display name">
              <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
            </Field>
            <div className="row">
              <Field label="Job title">
                <input type="text" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="Editor, Gaffer, Producer..." />
              </Field>
              <Field label="Phone">
                <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>
            <Field label="Bio">
              <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={500} />
            </Field>
            <Field label="Avatar color">
              <div className="chips">
                {COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    aria-label={`Color ${c}`}
                    onClick={() => setForm({ ...form, avatarColor: c })}
                    style={{ width: 28, height: 28, borderRadius: "50%", background: c, border: form.avatarColor === c ? "3px solid #fff" : "3px solid transparent" }}
                  />
                ))}
              </div>
            </Field>
          </>
        ) : (
          <>
            <Field label="Current password">
              <input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" required />
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              <input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" minLength={8} required />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
