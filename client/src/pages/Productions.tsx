import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Clapperboard, FileText, MessageSquare, Plus, Trash2, UserPlus } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { DOC_TYPES, EVENT_TYPES, PRODUCTION_KINDS, STATUS_LABEL, fromDateInput, money, toDateInput } from "../lib";
import type { CalEvent, DocListItem, Production, ProductionStatus } from "../types";
import { Avatar, Badge, Button, Empty, Field, MemberPicker, Modal, PageHeader, Spinner, useToast } from "../ui";
import { TaskBoard } from "./Tasks";

const STATUS_COLOR: Record<ProductionStatus, string> = {
  DEVELOPMENT: "#99aab5",
  PRE_PRODUCTION: "#f0b232",
  PRODUCTION: "#ed4245",
  POST_PRODUCTION: "#5865f2",
  DELIVERED: "#3ba55d",
  ARCHIVED: "#80848e",
};

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
        subtitle="Every project, from first idea to final delivery."
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
              <div className="muted small" style={{ marginBottom: 10 }}>{[p.client, p.kind].filter(Boolean).join(" · ")}</div>
              {p.deliveryDate && <div className="small">Delivery: <b>{format(new Date(p.deliveryDate), "MMM d, yyyy")}</b></div>}
              <div className="chips" style={{ margin: "10px 0" }}>
                {p.members.slice(0, 6).map((m) => <Avatar key={m.userId} user={m.user} size={26} />)}
                {p.members.length > 6 && <span className="muted small">+{p.members.length - 6}</span>}
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
  const [tab, setTab] = useState<"overview" | "tasks" | "schedule" | "documents">("overview");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setProduction(await api.get<Production>(`/productions/${id}`));
      setEvents(await api.get<CalEvent[]>(`/events?productionId=${id}`));
      setDocs(await api.get<DocListItem[]>(`/documents?productionId=${id}`));
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
        subtitle={[p.client, p.kind].filter(Boolean).join(" · ")}
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

      <div className="tabs">
        {([["overview", "Overview"], ["tasks", `Tasks (${p._count.tasks})`], ["schedule", `Schedule (${events.length})`], ["documents", `Documents (${docs.length})`]] as const).map(([k, label]) => (
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
              <dt>Start</dt><dd>{p.startDate ? format(new Date(p.startDate), "MMM d, yyyy") : "-"}</dd>
              <dt>Wrap</dt><dd>{p.endDate ? format(new Date(p.endDate), "MMM d, yyyy") : "-"}</dd>
              <dt>Delivery</dt><dd>{p.deliveryDate ? format(new Date(p.deliveryDate), "MMM d, yyyy") : "-"}</dd>
              {p.budget !== null && (<><dt>Budget</dt><dd>{money(p.budget)}</dd></>)}
            </dl>
          </section>
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Team ({p.members.length})</h3>
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
      {adding && (
        <Modal title="Add team members" onClose={() => setAdding(false)}>
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

function ProductionModal({ production, onClose, onSaved }: { production?: Production; onClose: () => void; onSaved?: () => Promise<void> }) {
  const { can } = useAuth();
  const { users, refreshProductions } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: production?.title ?? "",
    client: production?.client ?? "",
    kind: production?.kind ?? "Commercial",
    status: (production?.status ?? "DEVELOPMENT") as ProductionStatus,
    description: production?.description ?? "",
    location: production?.location ?? "",
    budget: production?.budget?.toString() ?? "",
    color: production?.color ?? "#5865f2",
    startDate: toDateInput(production?.startDate),
    endDate: toDateInput(production?.endDate),
    deliveryDate: toDateInput(production?.deliveryDate),
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
        client: form.client || null,
        kind: form.kind,
        status: form.status,
        description: form.description || null,
        location: form.location || null,
        ...(showBudget ? { budget: form.budget ? Number(form.budget) : null } : {}),
        color: form.color,
        startDate: fromDateInput(form.startDate),
        endDate: fromDateInput(form.endDate),
        deliveryDate: fromDateInput(form.deliveryDate),
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
        <Field label="Client"><input type="text" value={form.client} onChange={set("client")} /></Field>
        <Field label="Type">
          <select value={form.kind} onChange={set("kind")}>{PRODUCTION_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        </Field>
      </div>
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
        <Field label="Start"><input type="date" value={form.startDate} onChange={set("startDate")} /></Field>
        <Field label="Wrap"><input type="date" value={form.endDate} onChange={set("endDate")} /></Field>
        <Field label="Delivery"><input type="date" value={form.deliveryDate} onChange={set("deliveryDate")} /></Field>
      </div>
      {!production && (
        <Field label="Team" hint="You're added automatically. A chat channel is created for the production.">
          <MemberPicker users={users.filter((u) => u.status !== "DISABLED")} value={form.memberIds} onChange={(ids) => setForm({ ...form, memberIds: ids })} />
        </Field>
      )}
    </Modal>
  );
}
