import { useMemo, useState, type FormEvent } from "react";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { api, errMsg } from "../api";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_STATUS } from "../lib";
import type { EquipmentItem, EquipmentStatus, Production } from "../types";
import { Badge, Button, Empty, Field, Modal, useToast } from "../ui";

const STATUSES = Object.keys(EQUIPMENT_STATUS) as EquipmentStatus[];

/** The gear list of one production: what is needed, where it comes from, and whether it is secured, packed and returned. */
export function EquipmentTab({
  production,
  items,
  canEdit,
  canTick,
  onChanged,
}: {
  production: Production;
  items: EquipmentItem[];
  /** May add, edit and delete items. */
  canEdit: boolean;
  /** May move an item along (needed, secured, packed, returned). */
  canTick: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<EquipmentStatus | "ALL">("ALL");
  const [editing, setEditing] = useState<EquipmentItem | "new" | null>(null);

  const counts = useMemo(() => {
    const c: Record<EquipmentStatus, number> = { NEEDED: 0, SECURED: 0, PACKED: 0, RETURNED: 0 };
    for (const i of items) c[i.status] += 1;
    return c;
  }, [items]);

  const ready = counts.PACKED + counts.RETURNED;
  const shown = items.filter((i) => filter === "ALL" || i.status === filter);
  const groups = EQUIPMENT_CATEGORIES.map((category) => ({ category, rows: shown.filter((i) => i.category === category) })).filter((g) => g.rows.length > 0);

  async function setStatus(item: EquipmentItem, status: EquipmentStatus) {
    try {
      await api.patch(`/productions/${production.id}/equipment/${item.id}`, { status });
      await onChanged();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function remove(item: EquipmentItem) {
    if (!window.confirm(`Remove "${item.name}" from the equipment list?`)) return;
    try {
      await api.del(`/productions/${production.id}/equipment/${item.id}`);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  return (
    <>
      <div className="equip-head">
        <div className="equip-progress">
          <div className="equip-progress-label">
            <b>{items.length === 0 ? "No equipment yet" : `${ready} of ${items.length} packed`}</b>
            {counts.NEEDED > 0 && <span className="muted small"> · {counts.NEEDED} still to get</span>}
          </div>
          <div className="equip-bar" aria-hidden>
            <i className="s-packed" style={{ width: `${items.length ? (ready / items.length) * 100 : 0}%` }} />
            <i className="s-secured" style={{ width: `${items.length ? (counts.SECURED / items.length) * 100 : 0}%` }} />
          </div>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> Add equipment
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <div className="chips" style={{ marginBottom: 14 }}>
          <button className={`chip ${filter === "ALL" ? "active" : ""}`} onClick={() => setFilter("ALL")}>All ({items.length})</button>
          {STATUSES.map((s) => (
            <button key={s} className={`chip ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
              <i className="dot" style={{ background: EQUIPMENT_STATUS[s].color }} /> {EQUIPMENT_STATUS[s].label} ({counts[s]})
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <Empty icon={<Package size={40} />} title="No equipment listed">
          {canEdit ? "List the cameras, lenses, lights, audio gear and props this video needs, then tick them off as you secure and pack them." : "The gear for this production will show up here."}
        </Empty>
      ) : groups.length === 0 ? (
        <Empty title="Nothing with that status" />
      ) : (
        groups.map(({ category, rows }) => (
          <section key={category} className="card equip-group">
            <h3>{category} <span className="muted small">({rows.length})</span></h3>
            <div className="list">
              {rows.map((i) => (
                <div key={i.id} className="list-item equip-row">
                  <div className="grow">
                    <div className="equip-name">
                      {i.name}
                      {i.quantity > 1 && <Badge>× {i.quantity}</Badge>}
                    </div>
                    {(i.source || i.notes) && (
                      <div className="muted small">{[i.source, i.notes].filter(Boolean).join(" · ")}</div>
                    )}
                  </div>
                  {canTick ? (
                    <select
                      className="status-select"
                      style={{ color: EQUIPMENT_STATUS[i.status].color, borderColor: `${EQUIPMENT_STATUS[i.status].color}66` }}
                      value={i.status}
                      aria-label={`Status of ${i.name}`}
                      onChange={(e) => void setStatus(i, e.target.value as EquipmentStatus)}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{EQUIPMENT_STATUS[s].label}</option>)}
                    </select>
                  ) : (
                    <Badge color={EQUIPMENT_STATUS[i.status].color}>{EQUIPMENT_STATUS[i.status].label}</Badge>
                  )}
                  {canEdit && (
                    <>
                      <button className="icon-btn" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)}><Pencil size={15} /></button>
                      <button className="icon-btn" aria-label={`Remove ${i.name}`} onClick={() => void remove(i)}><Trash2 size={15} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {editing && (
        <EquipmentModal
          production={production}
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </>
  );
}

function EquipmentModal({ production, item, onClose, onSaved }: { production: Production; item: EquipmentItem | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "Camera");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [status, setStatus] = useState<EquipmentStatus>(item?.status ?? "NEEDED");
  const [source, setSource] = useState(item?.source ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, category, quantity: Math.max(1, Math.round(Number(quantity) || 1)), status, source: source.trim() || null, notes: notes.trim() || null };
    try {
      if (item) await api.patch(`/productions/${production.id}/equipment/${item.id}`, body);
      else await api.post(`/productions/${production.id}/equipment`, body);
      await onSaved();
    } catch (err) {
      toast(errMsg(err), "error");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={item ? "Edit equipment" : "Add equipment"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="equipment-form" disabled={busy || !name.trim()}>{busy ? "Saving..." : item ? "Save" : "Add"}</Button>
        </>
      }
    >
      <form id="equipment-form" onSubmit={submit}>
        <Field label="Item">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Sony FX3, 24-70mm lens, Aputure 300d" required autoFocus />
        </Field>
        <div className="row">
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Quantity">
            <input type="number" min={1} max={999} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as EquipmentStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{EQUIPMENT_STATUS[s].label}</option>)}
            </select>
          </Field>
          <Field label="Where it comes from" hint="Optional">
            <input type="text" value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} placeholder="Own, rental shop, borrowed..." />
          </Field>
        </div>
        <Field label="Notes" hint="Optional">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}
