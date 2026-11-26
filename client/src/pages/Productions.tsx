import { useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, isSameDay } from "date-fns";
import { ArrowLeft, Clapperboard, FileText, MessageSquare, Plus, Trash2, UserPlus } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { DOC_TYPES, EVENT_TYPES, STATUS_COLOR, STATUS_LABEL, fromDateInput, money, toDateInput } from "../lib";
import type { CalEvent, DocListItem, EquipmentItem, Production, ProductionStatus } from "../types";
import { Avatar, Badge, Button, Empty, Field, MemberPicker, Modal, PageHeader, Participants, Spinner, useToast } from "../ui";
import { EquipmentTab } from "./Equipment";
import { TaskBoard } from "./Tasks";

/** A date that hasn't been decided yet is stored as empty and shown as "TBD". */
const dateOrTbd = (iso: string | null, fmt = "MMM d, yyyy") => (iso ? format(new Date(iso), fmt) : "TBD");

function shootLabel(p: Production) {
  if (!p.shootDate && !p.shootEndDate) return "TBD";
  if (p.shootDate && p.shootEndDate && isSameDay(new Date(p.shootDate), new Date(p.shootEndDate))) return dateOrTbd(p.shootDate, "MMM d");
  return `${dateOrTbd(p.shootDate, "MMM d")} to ${dateOrTbd(p.shootEndDate, "MMM d")}`;
}

export function ProductionsPage() {
  const { can } = useAuth();
  const { productions } = useData();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"active" | "all" | "done">("active");

  const list = productions.filter((p) =>
    filter === "all" ? true : filter === "done" ? ["DELIVERED", "ARCHIVED"].includes(p.status) : !["DELIVERED", "ARCHIVED"].includes(p.status),
  );

  return (
    <>
      <PageHeader
        title="Productions"
        subtitle="Every video, from first idea to release day."
        actions={
          can("productions.create") && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New production
            </Button>
          )
        }
      />
      <div className="tabs">
        {(["active", "done", "all"] as const).map((f) => (
          <button key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f === "active" ? "In progress" : f === "done" ? "Delivered & archived" : "All"}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={<Clapperboard size={40} />} title="No productions here">
          {can("productions.create") ? "Create your first production to start organising the team." : "You'll see productions here once they're created."}
        </Empty>
      ) : (
        <div className="grid cols-3">
          {list.map((p) => (
            <Link key={p.id} to={`/productions/${p.id}`} className="card prod-card" style={{ borderTopColor: p.color }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <h3 style={{ margin: 0 }}>{p.title}</h3>
                <Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              </div>
              <div style={{ margin: "8px 0 10px", display: "grid", gap: 2 }} className="small">
                <div>
                  <span className="muted">Shoot: </span>
                  <b>{shootLabel(p)}</b>
                </div>
                <div>
                  <span className="muted">Release: </span>
                  <b>{dateOrTbd(p.releaseDate)}</b>
                </div>
              </div>
              <div className="chips" style={{ margin: "10px 0" }}>
                {p.participants.slice(0, 6).map((x) => <Avatar key={x.id} user={x.user ?? { displayName: x.name, avatarColor: "#6d6f78" }} size={26} />)}
                {p.participants.length > 6 && <span className="muted small">+{p.participants.length - 6}</span>}
                {p.participants.length === 0 && <span className="muted small">No participants yet</span>}
              </div>
              <div className="muted small">{p._count.tasks} tasks · {p._count.events} events · {p._count.documents} documents</div>
            </Link>
          ))}
        </div>
      )}
      {creating && <ProductionModal onClose={() => setCreating(false)} />}
    </>
  );
}

export function ProductionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, can } = useAuth();
  const { users, refreshProductions } = useData();
  const toast = useToast();
  const [production, setProduction] = useState<Production | null>(null);
  const [tab, setTab] = useState<"overview" | "tasks" | "schedule" | "equipment" | "documents">("overview");
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [managingParticipants, setManagingParticipants] = useState(false);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setProduction(await api.get<Production>(`/productions/${id}`));
      setEvents(await api.get<CalEvent[]>(`/events?productionId=${id}`));
      setDocs(await api.get<DocListItem[]>(`/documents?productionId=${id}`));
      setEquipment(await api.get<EquipmentItem[]>(`/productions/${id}/equipment`));
    } catch {
      setMissing(true);
    }
  }, [id]);
  useEffect(() => void load(), [load]);
  useSocketEvent("productions:changed", () => void load());
  useSocketEvent("events:changed", () => void load());
  useSocketEvent("documents:changed", () => void load());

  if (missing) return <Empty title="Production not found"><Link to="/productions">Back to productions</Link></Empty>;
  if (!production) return <Spinner />;

  const canEdit = can("productions.manage") || production.createdById === me!.id;

  async function removeMember(userId: string) {
    try {
      await api.del(`/productions/${production!.id}/members/${userId}`);
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${production!.title}" along with its tasks, events, documents and chat channel? This can't be undone.`)) return;
    try {
      await api.del(`/productions/${production!.id}`);
      await refreshProductions();
      navigate("/productions");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  const p = production;
  return (
    <>
      <Link to="/productions" className="muted small" style={{ display: "inline-flex", gap: 4, alignItems: "center", marginBottom: 8 }}>
        <ArrowLeft size={14} /> All productions
      </Link>
      <PageHeader
        title={p.title}
        subtitle={`Target release: ${dateOrTbd(p.releaseDate, "EEEE, MMMM d, yyyy")}`}
        actions={
          <>
            <Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
            {p.channels[0] && (
              <Button onClick={() => navigate(`/chat/${p.channels[0]!.id}`)}>
                <MessageSquare size={16} /> Open chat
              </Button>
            )}
            {canEdit && <Button onClick={() => setEditing(true)}>Edit</Button>}
            {canEdit && <Button variant="danger" onClick={remove} aria-label="Delete production"><Trash2 size={16} /></Button>}
          </>
        }
      />

      <section className="participants-bar" aria-label="Participants">
        <div className="participants-head">
          <h4>Participants ({p.participants.length}) <span>in the video</span></h4>
          {canEdit && <Button small variant="ghost" onClick={() => setManagingParticipants(true)}><UserPlus size={14} /> Manage</Button>}
        </div>
        <Participants participants={p.participants} />
      </section>

      <div className="tabs">
        {([["overview", "Overview"], ["tasks", `Tasks (${p._count.tasks})`], ["schedule", `Schedule (${events.length})`], ["equipment", `Equipment (${equipment.length})`], ["documents", `Documents (${docs.length})`]] as const).map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid cols-2">
          <section className="card">
            <h3>Details</h3>
            {p.description && <p style={{ whiteSpace: "pre-wrap", marginBottom: 14 }}>{p.description}</p>}
            <dl className="kv">
              <dt>Location</dt><dd>{p.location ?? "-"}</dd>
              <dt>Shoot date</dt><dd>{dateOrTbd(p.shootDate, "EEE, MMM d, yyyy")}</dd>
              <dt>Shoot end date</dt><dd>{dateOrTbd(p.shootEndDate, "EEE, MMM d, yyyy")}</dd>
              <dt>Target release</dt><dd>{dateOrTbd(p.releaseDate, "EEE, MMM d, yyyy")}</dd>
              {p.budget !== null && (<><dt>Budget</dt><dd>{money(p.budget)}</dd></>)}
            </dl>
          </section>
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Crew ({p.members.length})</h3>
              {canEdit && <Button small onClick={() => setAdding(true)}><UserPlus size={14} /> Add</Button>}
            </div>
            <div className="list">
              {p.members.map((m) => (
                <div key={m.userId} className="list-item">
                  <Avatar user={m.user} size={32} />
                  <div className="grow">
                    <div>{m.user.displayName}</div>
                    <div className="muted small">{m.jobTitle ?? users.find((u) => u.id === m.userId)?.jobTitle ?? ""}</div>
                  </div>
                  {canEdit && <button className="icon-btn" aria-label={`Remove ${m.user.displayName}`} onClick={() => removeMember(m.userId)}><Trash2 size={15} /></button>}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "tasks" && <TaskBoard productionId={p.id} />}

      {tab === "equipment" && (
        <EquipmentTab production={p} items={equipment} canEdit={canEdit} canTick={canEdit || p.members.some((m) => m.userId === me!.id)} onChanged={load} />
      )}

      {tab === "schedule" &&
        (events.length === 0 ? (
          <Empty title="Nothing scheduled" >Add events from the Calendar and link them to this production.</Empty>
        ) : (
          <div className="list" style={{ maxWidth: 720 }}>
            {events.map((e) => (
              <Link key={e.id} to="/calendar" className="list-item">
                <i className="dot" style={{ background: EVENT_TYPES[e.type]!.color }} />
                <div className="grow">
                  <b>{e.title}</b>
                  <div className="muted small">{e.allDay ? format(new Date(e.start), "EEE, MMM d") : format(new Date(e.start), "EEE, MMM d · HH:mm")}{e.location && ` · ${e.location}`}</div>
                </div>
                <Badge color={EVENT_TYPES[e.type]!.color}>{EVENT_TYPES[e.type]!.label}</Badge>
              </Link>
            ))}
          </div>
        ))}

      {tab === "documents" &&
        (docs.length === 0 ? (
          <Empty icon={<FileText size={40} />} title="No documents yet">Create call sheets, scripts and shot lists from the Documents page.</Empty>
        ) : (
          <div className="grid cols-3">
            {docs.map((d) => (
              <Link key={d.id} to={`/documents/${d.id}`} className="card doc-card">
                <b>{d.title}</b>
                <span className="muted small">{DOC_TYPES[d.type]} · updated {format(new Date(d.updatedAt), "MMM d")}</span>
              </Link>
            ))}
          </div>
        ))}

      {editing && <ProductionModal production={p} onClose={() => setEditing(false)} onSaved={load} />}
      {managingParticipants && <ParticipantsModal production={p} onChanged={load} onClose={() => setManagingParticipants(false)} />}
      {adding && (
        <Modal title="Add crew members" onClose={() => setAdding(false)}>
          <div className="list">
            {users
              .filter((u) => u.status !== "DISABLED" && !p.members.some((m) => m.userId === u.id))
              .map((u) => (
                <button
                  key={u.id}
                  className="list-item"
                  style={{ background: "none", border: 0, textAlign: "left", color: "inherit" }}
                  onClick={async () => {
                    try {
                      await api.post(`/productions/${p.id}/members`, { userId: u.id, jobTitle: u.jobTitle });
                      await load();
                    } catch (e) {
                      toast(errMsg(e), "error");
                    }
                  }}
                >
                  <Avatar user={u} size={32} />
                  <div className="grow">{u.displayName}<div className="muted small">{u.jobTitle ?? `@${u.username}`}</div></div>
                  <Plus size={16} />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/** Add and remove the people who appear in the video: people with an account, or just a name. */
function ParticipantsModal({ production, onChanged, onClose }: { production: Production; onChanged: () => Promise<void> | void; onClose: () => void }) {
  const { users } = useData();
  const toast = useToast();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  async function add(body: { userId?: string; name?: string }) {
    try {
      await api.post(`/productions/${production.id}/participants`, { ...body, role: role.trim() || null });
      setName("");
      await onChanged();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/productions/${production.id}/participants/${id}`);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  const linked = new Set(production.participants.map((x) => x.user?.id).filter(Boolean));
  const available = users.filter((u) => u.status !== "DISABLED" && !linked.has(u.id));

  return (
    <Modal title="Participants in the video" onClose={onClose}>
      <p className="muted small" style={{ marginBottom: 12 }}>The people who appear on camera. They can have an account or not, and they are separate from the crew.</p>

      <div className="list" style={{ marginBottom: 14 }}>
        {production.participants.length === 0 && <div className="muted small">No one added yet.</div>}
        {production.participants.map((x) => (
          <div key={x.id} className="list-item">
            <Avatar user={x.user ?? { displayName: x.name, avatarColor: "#6d6f78" }} size={32} />
            <div className="grow">
              <div>{x.user?.displayName ?? x.name}{!x.user && <> <Badge>No account</Badge></>}</div>
              <div className="muted small">{x.role ?? ""}</div>
            </div>
            <button className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => remove(x.id)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <form
        className="guest-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void add({ name: name.trim() });
        }}
      >
        <h4>Add someone</h4>
        <div className="row">
          <Field label="Name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Someone without an account" /></Field>
          <Field label="Role in the video (optional)"><input type="text" value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder="e.g. Host, Guest" /></Field>
        </div>
        <Button variant="primary" type="submit" disabled={!name.trim()}><Plus size={16} /> Add by name</Button>
      </form>

      {available.length > 0 && (
        <>
          <h4 style={{ margin: "18px 0 4px" }}>Or pick someone with an account</h4>
          <div className="list">
            {available.map((u) => (
              <button key={u.id} className="list-item" style={{ background: "none", border: 0, textAlign: "left", color: "inherit" }} onClick={() => void add({ userId: u.id })}>
                <Avatar user={u} size={32} />
                <div className="grow">{u.displayName}<div className="muted small">{u.jobTitle ?? `@${u.username}`}</div></div>
                <Plus size={16} />
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function ProductionModal({ production, onClose, onSaved }: { production?: Production; onClose: () => void; onSaved?: () => Promise<void> }) {
  const { can } = useAuth();
  const { users, refreshProductions } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: production?.title ?? "",
    status: (production?.status ?? "DEVELOPMENT") as ProductionStatus,
    description: production?.description ?? "",
    location: production?.location ?? "",
    budget: production?.budget?.toString() ?? "",
    color: production?.color ?? "#5865f2",
    shootDate: toDateInput(production?.shootDate),
    shootEndDate: toDateInput(production?.shootEndDate),
    releaseDate: toDateInput(production?.releaseDate),
    // Ticked = "TBD": the date isn't decided yet and is saved as empty.
    shootDateTbd: !production?.shootDate,
    shootEndDateTbd: !production?.shootEndDate,
    releaseDateTbd: !production?.releaseDate,
    memberIds: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const showBudget = can("productions.manage", "documents.sensitive");

  async function save() {
    setBusy(true);
    try {
      const body = {
        title: form.title,
        status: form.status,
        description: form.description || null,
        location: form.location || null,
        ...(showBudget ? { budget: form.budget ? Number(form.budget) : null } : {}),
        color: form.color,
        shootDate: form.shootDateTbd ? null : fromDateInput(form.shootDate),
        shootEndDate: form.shootEndDateTbd ? null : fromDateInput(form.shootEndDate),
        releaseDate: form.releaseDateTbd ? null : fromDateInput(form.releaseDate),
      };
      if (production) {
        await api.patch(`/productions/${production.id}`, body);
        await onSaved?.();
      } else {
        const created = await api.post<Production>("/productions", { ...body, memberIds: form.memberIds });
        await refreshProductions();
        navigate(`/productions/${created.id}`);
      }
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={production ? "Edit production" : "New production"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !form.title.trim()}>{production ? "Save" : "Create production"}</Button>
        </>
      }
    >
      <Field label="Title"><input type="text" value={form.title} onChange={set("title")} autoFocus maxLength={120} /></Field>
      <div className="row">
        <Field label="Status">
          <select value={form.status} onChange={set("status")}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Color"><input type="color" value={form.color} onChange={set("color")} style={{ width: "100%", height: 38, padding: 2, background: "var(--bg)", border: 0, borderRadius: 6 }} /></Field>
      </div>
      <Field label="Description"><textarea value={form.description} onChange={set("description")} /></Field>
      <div className="row">
        <Field label="Location"><input type="text" value={form.location} onChange={set("location")} /></Field>
        {showBudget && <Field label="Budget (CAD)"><input type="number" min={0} value={form.budget} onChange={set("budget")} /></Field>}
      </div>
      <div className="row">
        <DateField
          label="Shoot date"
          value={form.shootDate}
          tbd={form.shootDateTbd}
          onChange={(shootDate, shootDateTbd) => setForm((f) => ({ ...f, shootDate, shootDateTbd }))}
        />
        <DateField
          label="Shoot end date"
          value={form.shootEndDate}
          tbd={form.shootEndDateTbd}
          min={form.shootDateTbd ? undefined : form.shootDate || undefined}
          onChange={(shootEndDate, shootEndDateTbd) => setForm((f) => ({ ...f, shootEndDate, shootEndDateTbd }))}
        />
        <DateField
          label="Target release date"
          value={form.releaseDate}
          tbd={form.releaseDateTbd}
          onChange={(releaseDate, releaseDateTbd) => setForm((f) => ({ ...f, releaseDate, releaseDateTbd }))}
        />
      </div>
      {!production && (
        <Field label="Team" hint="You're added automatically. A chat channel is created for the production.">
          <MemberPicker users={users.filter((u) => u.status !== "DISABLED")} value={form.memberIds} onChange={(ids) => setForm({ ...form, memberIds: ids })} />
        </Field>
      )}
    </Modal>
  );
}

/** A date input with a "TBD" checkbox for dates that aren't decided yet. */
function DateField({
  label,
  value,
  tbd,
  min,
  onChange,
}: {
  label: string;
  value: string;
  tbd: boolean;
  min?: string;
  onChange: (value: string, tbd: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} type="date" value={tbd ? "" : value} min={min} disabled={tbd} onChange={(e) => onChange(e.target.value, false)} />
      <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={tbd} onChange={(e) => onChange(e.target.checked ? "" : value, e.target.checked)} />
        TBD (not decided yet)
      </label>
    </div>
  );
}
