import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Copy, MessageSquare, Plus, Shield, Trash2 } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData } from "../data";
import type { Invite, Member, PermissionInfo, Role } from "../types";
import { Avatar, Badge, Button, Empty, Field, Modal, PageHeader, RoleChip, Spinner, useToast } from "../ui";

export function TeamPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"members" | "roles" | "invites">("members");
  return (
    <>
      <PageHeader title="Team" subtitle="Who's on the crew, what they can do, and who gets in." />
      <div className="tabs">
        <button className={`tab ${tab === "members" ? "active" : ""}`} onClick={() => setTab("members")}>Members</button>
        {can("roles.manage", "members.manage") && <button className={`tab ${tab === "roles" ? "active" : ""}`} onClick={() => setTab("roles")}>Roles & permissions</button>}
        {can("invites.manage") && <button className={`tab ${tab === "invites" ? "active" : ""}`} onClick={() => setTab("invites")}>Invites</button>}
      </div>
      {tab === "members" && <Members />}
      {tab === "roles" && <Roles />}
      {tab === "invites" && <Invites />}
    </>
  );
}

// ─── Members ─────────────────────────────────────────────────────────────

function Members() {
  const { me, can } = useAuth();
  const { users, online, roles, refreshUsers, refreshChannels } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [managing, setManaging] = useState<Member | null>(null);
  const manager = can("members.manage");

  const list = users.filter((u) => (u.displayName + u.username + (u.jobTitle ?? "")).toLowerCase().includes(q.toLowerCase()));

  async function dm(u: Member) {
    try {
      const { id } = await api.post<{ id: string }>("/channels/dm", { userId: u.id });
      await refreshChannels();
      navigate(`/chat/${id}`);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  return (
    <>
      <input type="search" style={{ maxWidth: 360, marginBottom: 14 }} placeholder="Search the team..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the team" />
      <div className="card scroll-x" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr><th>Member</th><th>Roles</th>{manager && <th>Contact</th>}{manager && <th>Status</th>}<th /></tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar user={u} size={36} online={online.has(u.id)} />
                    <div>
                      <div><b>{u.displayName}</b> {u.isOwner && <Badge color="#f0b232">Owner</Badge>}</div>
                      <div className="muted small">{u.jobTitle ?? `@${u.username}`}</div>
                    </div>
                  </div>
                </td>
                <td><div className="chips">{u.roles.map((r) => <RoleChip key={r.id} role={r} />)}</div></td>
                {manager && <td className="small">{u.email}{u.phone && <div className="muted">{u.phone}</div>}</td>}
                {manager && <td>{u.status === "DISABLED" ? <Badge color="#ed4245">Disabled</Badge> : <Badge color="#3ba55d">Active</Badge>}</td>}
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {u.id !== me!.id && u.status !== "DISABLED" && can("messages.send") && (
                    <Button small variant="ghost" onClick={() => dm(u)} aria-label={`Message ${u.displayName}`}><MessageSquare size={14} /> Message</Button>
                  )}
                  {manager && <Button small onClick={() => setManaging(u)}>Manage</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <Empty title="No one matches that search" />}
      </div>
      {managing && (
        <ManageMember
          member={managing}
          roles={roles}
          onClose={() => setManaging(null)}
          onSaved={async () => {
            await refreshUsers();
            setManaging(null);
          }}
        />
      )}
    </>
  );
}

function ManageMember({ member, roles, onClose, onSaved }: { member: Member; roles: Role[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const [roleIds, setRoleIds] = useState(member.roles.map((r) => r.id));
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [disabled, setDisabled] = useState(member.status === "DISABLED");
  const [busy, setBusy] = useState(false);
  const isAdmin = can("admin");

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/users/${member.id}`, { roleIds, jobTitle: jobTitle || null, status: disabled ? "DISABLED" : "ACTIVE" });
      toast("Member updated.", "success");
      await onSaved();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Manage ${member.displayName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>Save</Button>
        </>
      }
    >
      <Field label="Job title"><input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={80} /></Field>
      <Field label="Roles" hint="Permissions from all of a member's roles are combined.">
        <div className="chips">
          {roles.map((r) => {
            const locked = r.permissions.includes("admin") && !isAdmin;
            return (
              <button
                type="button"
                key={r.id}
                disabled={locked}
                title={locked ? "Only administrators can assign this role" : undefined}
                className={`chip ${roleIds.includes(r.id) ? "active" : ""}`}
                onClick={() => setRoleIds((ids) => (ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]))}
              >
                <i className="dot" style={{ background: r.color }} /> {r.name}
              </button>
            );
          })}
        </div>
      </Field>
      {member.id !== me!.id && !member.isOwner && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
          Disable account (they can no longer sign in)
        </label>
      )}
    </Modal>
  );
}

// ─── Roles ───────────────────────────────────────────────────────────────

function Roles() {
  const { can } = useAuth();
  const toast = useToast();
  const { refreshUsers } = useData();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const editable = can("roles.manage");

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([api.get<Role[]>("/roles"), api.get<PermissionInfo[]>("/permissions")]);
    setRoles(r);
    setCatalog(c);
    setSelectedId((cur) => cur ?? r[0]?.id ?? null);
  }, []);
  useEffect(() => void load(), [load]);

  if (!roles) return <Spinner />;
  const selected = selectedId === "new" ? null : roles.find((r) => r.id === selectedId);

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(200px, 260px) 1fr", alignItems: "start" }}>
      <div className="card" style={{ padding: 8 }}>
        {roles.map((r) => (
          <button key={r.id} className={`ch-item ${selectedId === r.id ? "active" : ""}`} onClick={() => setSelectedId(r.id)}>
            <i className="dot" style={{ background: r.color }} />
            <span className="ellipsis">{r.name}</span>
            <span className="muted small" style={{ marginLeft: "auto" }}>{r._count?.users ?? 0}</span>
          </button>
        ))}
        {editable && (
          <Button small variant="ghost" style={{ width: "100%", marginTop: 6 }} onClick={() => setSelectedId("new")}>
            <Plus size={14} /> New role
          </Button>
        )}
      </div>

      {(selected || selectedId === "new") && (
        <RoleEditor
          key={selectedId}
          role={selected ?? null}
          catalog={catalog}
          editable={editable}
          onSaved={async (id) => {
            await load();
            await refreshUsers();
            if (id) setSelectedId(id);
          }}
          onDeleted={async () => {
            setSelectedId(null);
            await load();
            await refreshUsers();
            toast("Role deleted.", "success");
          }}
        />
      )}
    </div>
  );
}

function RoleEditor({
  role,
  catalog,
  editable,
  onSaved,
  onDeleted,
}: {
  role: Role | null;
  catalog: PermissionInfo[];
  editable: boolean;
  onSaved: (id?: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    name: role?.name ?? "",
    color: role?.color ?? "#99aab5",
    permissions: role?.permissions ?? ([] as string[]),
    isDefault: role?.isDefault ?? false,
  });
  const [busy, setBusy] = useState(false);
  const isAdminActor = can("admin");
  const readOnly = !editable || (!!role?.permissions.includes("admin") && !isAdminActor);
  const groups = [...new Set(catalog.map((p) => p.group))];

  const toggle = (key: string) =>
    setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key] }));

  async function save() {
    setBusy(true);
    try {
      const saved = role ? await api.patch<Role>(`/roles/${role.id}`, form) : await api.post<Role>("/roles", form);
      toast("Role saved.", "success");
      await onSaved(saved.id);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!role || !window.confirm(`Delete the "${role.name}" role? Members will lose its permissions.`)) return;
    try {
      await api.del(`/roles/${role.id}`);
      await onDeleted();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  return (
    <section className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Shield size={18} />
        <h3 style={{ margin: 0 }}>{role ? role.name : "New role"}</h3>
        {readOnly && <Badge>View only</Badge>}
      </div>
      <div className="row">
        <Field label="Name"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={readOnly} maxLength={40} /></Field>
        <Field label="Color"><input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} disabled={readOnly} style={{ width: "100%", height: 38, padding: 2, background: "var(--bg)", border: 0, borderRadius: 6 }} /></Field>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} disabled={readOnly} />
        Give this role to new members by default
      </label>

      {groups.map((g) => (
        <fieldset key={g} style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>{g}</legend>
          {catalog
            .filter((p) => p.group === g)
            .map((p) => (
              <label key={p.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "5px 0" }}>
                <input
                  type="checkbox"
                  checked={form.permissions.includes(p.key)}
                  onChange={() => toggle(p.key)}
                  disabled={readOnly || (p.key === "admin" && !isAdminActor)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  {p.label}
                  <span className="muted small" style={{ display: "block" }}>{p.description}</span>
                </span>
              </label>
            ))}
        </fieldset>
      ))}

      {!readOnly && (
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" onClick={save} disabled={busy || !form.name.trim()}>{role ? "Save role" : "Create role"}</Button>
          {role && !role.isSystem && <Button variant="danger" onClick={remove}><Trash2 size={14} /> Delete role</Button>}
        </div>
      )}
    </section>
  );
}

// ─── Invites ─────────────────────────────────────────────────────────────

function Invites() {
  const { roles } = useData();
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", roleId: "", maxUses: 1, expiresInDays: 7 });

  const load = useCallback(async () => setInvites(await api.get<Invite[]>("/invites")), []);
  useEffect(() => void load(), [load]);

  const link = (code: string) => `${window.location.origin}/?code=${encodeURIComponent(code)}`;

  async function create() {
    try {
      const inv = await api.post<Invite>("/invites", {
        email: form.email || undefined,
        roleId: form.roleId || null,
        maxUses: form.maxUses,
        expiresInDays: form.expiresInDays || null,
      });
      setCreating(false);
      await load();
      await copy(link(inv.code));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Invite link copied to clipboard.", "success");
    } catch {
      window.prompt("Copy this invite link:", text);
    }
  }

  if (!invites) return <Spinner />;
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New invite</Button>
      </div>
      {invites.length === 0 ? (
        <Empty title="No invites yet">New members need an invite link to create an account.</Empty>
      ) : (
        <div className="card scroll-x" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Code</th><th>Role</th><th>For</th><th>Uses</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {invites.map((i) => {
                const expired = i.expiresAt && new Date(i.expiresAt) < new Date();
                const used = i.uses >= i.maxUses;
                return (
                  <tr key={i.id}>
                    <td><code>{i.code}</code> {(expired || used) && <Badge color="#ed4245">{used ? "used up" : "expired"}</Badge>}</td>
                    <td>{i.role ? <RoleChip role={i.role} /> : <span className="muted">Default role</span>}</td>
                    <td className="small">{i.email ?? <span className="muted">Anyone</span>}</td>
                    <td>{i.uses} / {i.maxUses}</td>
                    <td className="small">{i.expiresAt ? format(new Date(i.expiresAt), "MMM d, yyyy") : "Never"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button small onClick={() => copy(link(i.code))} disabled={!!expired || used}><Copy size={13} /> Copy link</Button>{" "}
                      <Button small variant="danger" aria-label="Revoke invite" onClick={async () => { await api.del(`/invites/${i.id}`); await load(); }}><Trash2 size={13} /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal
          title="New invite"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="primary" onClick={create}>Create & copy link</Button>
            </>
          }
        >
          <Field label="Role they'll get">
            <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">Default role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Restrict to email (optional)" hint="Only this address can use the invite.">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <div className="row">
            <Field label="Number of uses"><input type="number" min={1} max={100} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) || 1 })} /></Field>
            <Field label="Expires in (days)"><input type="number" min={1} max={90} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) || 0 })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
