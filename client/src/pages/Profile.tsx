import { useRef, useState, type FormEvent } from "react";
import { Camera, Trash2 } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { resizeAvatar } from "../lib";
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  async function choosePhoto(file: File) {
    setPhotoBusy(true);
    setError("");
    try {
      if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
      const blob = await resizeAvatar(file).catch(() => {
        throw new Error("That image couldn't be read. Try a PNG or JPEG.");
      });
      const body = new FormData();
      body.append("avatar", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
      await api.upload("/auth/avatar", body);
      await refresh();
      toast("Profile photo updated.", "success");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await api.del("/auth/avatar");
      await refresh();
      toast("Profile photo removed.", "success");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPhotoBusy(false);
    }
  }

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
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
              <Avatar user={{ id: me!.id, avatarUpdatedAt: me!.avatarUpdatedAt, displayName: form.displayName || "?", avatarColor: form.avatarColor }} size={80} />
              <div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <input
                    ref={photoInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void choosePhoto(f);
                      e.target.value = "";
                    }}
                  />
                  <Button small type="button" onClick={() => photoInput.current?.click()} disabled={photoBusy}>
                    <Camera size={14} /> {me!.avatarUpdatedAt ? "Change photo" : "Upload photo"}
                  </Button>
                  {me!.avatarUpdatedAt && (
                    <Button small variant="ghost" type="button" onClick={removePhoto} disabled={photoBusy}>
                      <Trash2 size={14} /> Remove
                    </Button>
                  )}
                </div>
                <div className="chips" style={{ marginBottom: 6 }}>
                  {me!.roles.map((r) => <RoleChip key={r.id} role={r} />)}
                </div>
                <div className="muted small">@{me!.username}{me!.email ? ` · ${me!.email}` : ""}</div>
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
            <Field label="Avatar color" hint="Used behind your initials when you have no photo.">
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
