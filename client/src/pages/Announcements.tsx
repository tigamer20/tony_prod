import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Eye, Megaphone, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { PRIORITY_COLOR } from "../lib";
import type { Announcement, MiniUser } from "../types";
import { Avatar, Badge, Button, Empty, Field, Modal, PageHeader, Spinner, useToast } from "../ui";

export function AnnouncementsPage() {
  const { can } = useAuth();
  const { productions, refreshAnnouncements } = useData();
  const toast = useToast();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [composing, setComposing] = useState<Announcement | "new" | null>(null);
  const [readers, setReaders] = useState<{ title: string; list: (MiniUser & { readAt: string })[] } | null>(null);

  const load = useCallback(async () => {
    setItems(await api.get<Announcement[]>("/announcements"));
    refreshAnnouncements();
  }, [refreshAnnouncements]);
  useEffect(() => void load(), [load]);
  useSocketEvent("announcement:new", () => void load());
  useSocketEvent("announcements:changed", () => void load());

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const unread = items?.filter((a) => !a.read) ?? [];

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Important updates for the whole team."
        actions={
          <>
            {unread.length > 0 && (
              <Button onClick={() => run(() => Promise.all(unread.map((a) => api.post(`/announcements/${a.id}/read`))))}>
                <Check size={16} /> Mark all read
              </Button>
            )}
            {can("announcements.post") && (
              <Button variant="primary" onClick={() => setComposing("new")}>
                <Plus size={16} /> New announcement
              </Button>
            )}
          </>
        }
      />
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty icon={<Megaphone size={40} />} title="No announcements yet">
          {can("announcements.post") ? "Post the first one to keep everyone in the loop." : "Updates from the production team will appear here."}
        </Empty>
      ) : (
        <div className="grid" style={{ maxWidth: 820 }}>
          {items.map((a) => (
            <article key={a.id} className={`card announcement ${a.priority} ${a.read ? "" : "unread"}`}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Avatar user={a.author} size={40} />
                <div className="grow">
                  <h3 style={{ margin: 0 }}>
                    {a.pinned && <Pin size={14} color="var(--yellow)" style={{ marginRight: 6 }} aria-label="Pinned" />}
                    {a.title}
                  </h3>
                  <div className="muted small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {a.author.displayName} · {format(new Date(a.createdAt), "MMM d, yyyy HH:mm")}
                    {a.priority !== "NORMAL" && <Badge color={PRIORITY_COLOR[a.priority === "URGENT" ? "URGENT" : "HIGH"]}>{a.priority.toLowerCase()}</Badge>}
                    {a.production && <Badge color={a.production.color}>{a.production.title}</Badge>}
                  </div>
                </div>
              </div>
              <div className="body">{a.body}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!a.read && (
                  <Button small onClick={() => run(() => api.post(`/announcements/${a.id}/read`))}>
                    <Check size={14} /> Mark as read
                  </Button>
                )}
                {can("announcements.post") && (
                  <>
                    <Button small variant="ghost" onClick={async () => setReaders({ title: a.title, list: await api.get(`/announcements/${a.id}/reads`) })}>
                      <Eye size={14} /> Read by {a.readCount}
                    </Button>
                    <Button small variant="ghost" onClick={() => run(() => api.patch(`/announcements/${a.id}`, { pinned: !a.pinned }))}>
                      {a.pinned ? <PinOff size={14} /> : <Pin size={14} />} {a.pinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button small variant="ghost" onClick={() => setComposing(a)}>Edit</Button>
                    <Button
                      small
                      variant="ghost"
                      onClick={() => window.confirm("Delete this announcement?") && run(() => api.del(`/announcements/${a.id}`))}
                      aria-label="Delete announcement"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {composing && (
        <Composer
          existing={composing === "new" ? null : composing}
          productions={productions.map((p) => ({ id: p.id, title: p.title }))}
          onClose={() => setComposing(null)}
          onSaved={load}
        />
      )}
      {readers && (
        <Modal title={`Read receipts: ${readers.title}`} onClose={() => setReaders(null)}>
          {readers.list.length === 0 && <p className="muted">Nobody has read this yet.</p>}
          <div className="list">
            {readers.list.map((r) => (
              <div key={r.id} className="list-item">
                <Avatar user={r} size={28} />
                <span className="grow">{r.displayName}</span>
                <span className="muted small">{format(new Date(r.readAt), "MMM d, HH:mm")}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function Composer({
  existing,
  productions,
  onClose,
  onSaved,
}: {
  existing: Announcement | null;
  productions: { id: string; title: string }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: existing?.title ?? "",
    body: existing?.body ?? "",
    priority: existing?.priority ?? "NORMAL",
    pinned: existing?.pinned ?? false,
    productionId: existing?.productionId ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = { ...form, productionId: form.productionId || null };
      if (existing) await api.patch(`/announcements/${existing.id}`, body);
      else await api.post("/announcements", body);
      await onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? "Edit announcement" : "New announcement"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !form.title.trim() || !form.body.trim()}>
            {existing ? "Save" : "Publish"}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus maxLength={160} />
      </Field>
      <Field label="Message">
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ minHeight: 160 }} />
      </Field>
      <div className="row">
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })}>
            <option value="NORMAL">Normal</option>
            <option value="IMPORTANT">Important</option>
            <option value="URGENT">Urgent</option>
          </select>
        </Field>
        <Field label="Production (optional)">
          <select value={form.productionId} onChange={(e) => setForm({ ...form, productionId: e.target.value })}>
            <option value="">Whole team</option>
            {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
        Pin to the top
      </label>
    </Modal>
  );
}
