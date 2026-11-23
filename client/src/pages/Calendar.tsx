import { useCallback, useEffect, useMemo, useState } from "react";
import {

  addMonths,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Download, MapPin, Plus } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { EVENT_TYPES, fromDateInput, fromLocalInput, toDateInput, toLocalInput } from "../lib";
import type { CalEvent, EventType, Rsvp } from "../types";
import { Avatar, Badge, Button, Empty, Field, MemberPicker, Modal, PageHeader, Spinner, useToast } from "../ui";

export function CalendarPage() {
  const { can } = useAuth();
  const { productions } = useData();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [view, setView] = useState<"month" | "agenda">("month");
  const [productionId, setProductionId] = useState("");
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [editing, setEditing] = useState<{ event: CalEvent | null; day?: Date } | null>(null);

  const range = useMemo(
    () => ({ from: startOfWeek(startOfMonth(cursor)), to: endOfWeek(endOfMonth(cursor)) }),
    [cursor],
  );

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    if (productionId) qs.set("productionId", productionId);
    setEvents(await api.get<CalEvent[]>(`/events?${qs}`));
  }, [range, productionId]);
  useEffect(() => void load(), [load]);
  useSocketEvent("events:changed", () => void load());

  const days = eachDayOfInterval({ start: range.from, end: range.to });
  const eventsOn = (day: Date) =>
    (events ?? []).filter((e) => new Date(e.start) <= endOfDay(day) && new Date(e.end) >= startOfDay(day));

  const agenda = days
    .filter((d) => isSameMonth(d, cursor))
    .map((d) => ({ day: d, events: eventsOn(d) }))
    .filter((d) => d.events.length);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Shoots, meetings, deadlines and deliveries."
        actions={
          <>
            <a className="btn" href="/api/calendar.ics" download title="Download as .ics for Google, Apple or Outlook calendar">
              <Download size={16} /> Export .ics
            </a>
            {can("events.manage") && (
              <Button variant="primary" onClick={() => setEditing({ event: null, day: new Date() })}>
                <Plus size={16} /> New event
              </Button>
            )}
          </>
        }
      />

      <div className="cal-toolbar">
        <Button small onClick={() => setCursor(startOfMonth(new Date()))}>Today</Button>
        <button className="icon-btn" aria-label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft size={20} /></button>
        <button className="icon-btn" aria-label="Next month" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight size={20} /></button>
        <h2>{format(cursor, "MMMM yyyy")}</h2>
        <span style={{ flex: 1 }} />
        <select style={{ width: "auto" }} aria-label="Filter by production" value={productionId} onChange={(e) => setProductionId(e.target.value)}>
          <option value="">All productions</option>
          {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <select style={{ width: "auto" }} aria-label="View" value={view} onChange={(e) => setView(e.target.value as "month" | "agenda")}>
          <option value="month">Month</option>
          <option value="agenda">Agenda</option>
        </select>
      </div>

      {!events ? (
        <Spinner />
      ) : view === "month" ? (
        <div className="cal-grid" role="grid" aria-label={format(cursor, "MMMM yyyy")}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {days.map((day) => {
            const list = eventsOn(day);
            return (
              <div
                key={day.toISOString()}
                className={`cal-cell ${isSameMonth(day, cursor) ? "" : "other"} ${isSameDay(day, new Date()) ? "today" : ""}`}
                onClick={() => can("events.manage") && setEditing({ event: null, day })}
                role="gridcell"
              >
                <div className="cal-day">{format(day, "d")}</div>
                {list.slice(0, 3).map((e) => (
                  <button
                    key={e.id}
                    className="cal-ev"
                    style={{ borderLeftColor: EVENT_TYPES[e.type]!.color }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditing({ event: e });
                    }}
                    title={e.title}
                  >
                    {!e.allDay && <span className="muted">{format(new Date(e.start), "HH:mm")} </span>}
                    {e.title}
                  </button>
                ))}
                {list.length > 3 && <div className="cal-more">+{list.length - 3} more</div>}
              </div>
            );
          })}
        </div>
      ) : agenda.length === 0 ? (
        <Empty icon={<CalendarDays size={40} />} title="No events this month" />
      ) : (
        agenda.map(({ day, events: list }) => (
          <div key={day.toISOString()} className="agenda-day">
            <h3>{format(day, "EEEE, MMMM d")}</h3>
            {list.map((e) => (
              <button key={e.id} className="agenda-ev" style={{ borderLeftColor: EVENT_TYPES[e.type]!.color }} onClick={() => setEditing({ event: e })}>
                <div style={{ minWidth: 92 }} className="muted small">
                  {e.allDay ? "All day" : `${format(new Date(e.start), "HH:mm")} - ${format(new Date(e.end), "HH:mm")}`}
                </div>
                <div className="grow">
                  <b>{e.title}</b>
                  <div className="muted small">
                    {EVENT_TYPES[e.type]!.label}
                    {e.production && ` · ${e.production.title}`}
                    {e.location && ` · ${e.location}`}
                  </div>
                </div>
                <div className="chips">{e.attendees.slice(0, 4).map((a) => <Avatar key={a.userId} user={a.user} size={24} />)}</div>
              </button>
            ))}
          </div>
        ))
      )}

      <div className="legend">
        {Object.entries(EVENT_TYPES).map(([k, v]) => (
          <span key={k}><i className="dot" style={{ background: v.color }} />{v.label}</span>
        ))}
      </div>

      {editing && <EventModal event={editing.event} day={editing.day} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  );
}

function EventModal({ event, day, onClose, onSaved }: { event: CalEvent | null; day?: Date; onClose: () => void; onSaved: () => Promise<void> }) {
  const { me, can } = useAuth();
  const { users, productions } = useData();
  const toast = useToast();
  const manager = can("events.manage");
  const readOnly = !!event && !manager;

  const base = day ?? new Date();
  const [form, setForm] = useState(() => {
    const defStart = new Date(base);
    defStart.setHours(9, 0, 0, 0);
    const defEnd = new Date(defStart.getTime() + 3600_000);
    return {
      title: event?.title ?? "",
      description: event?.description ?? "",
      type: (event?.type ?? "SHOOT") as EventType,
      allDay: event?.allDay ?? false,
      start: event ? (event.allDay ? toDateInput(event.start) : toLocalInput(event.start)) : toLocalInput(defStart),
      end: event ? (event.allDay ? toDateInput(event.end) : toLocalInput(event.end)) : toLocalInput(defEnd),
      location: event?.location ?? "",
      productionId: event?.productionId ?? "",
      attendeeIds: event?.attendees.map((a) => a.userId) ?? ([] as string[]),
    };
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const myRsvp = event?.attendees.find((a) => a.userId === me!.id);

  function toggleAllDay(allDay: boolean) {
    setForm((f) => ({
      ...f,
      allDay,
      start: allDay ? f.start.slice(0, 10) : `${f.start.slice(0, 10)}T09:00`,
      end: allDay ? f.end.slice(0, 10) : `${f.end.slice(0, 10)}T10:00`,
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const start = form.allDay ? fromDateInput(form.start) : fromLocalInput(form.start);
      let end = form.allDay ? fromDateInput(form.end || form.start) : fromLocalInput(form.end);
      if (form.allDay && end) end = endOfDay(new Date(end)).toISOString();
      const body = {
        title: form.title,
        description: form.description || null,
        type: form.type,
        allDay: form.allDay,
        start: form.allDay && start ? startOfDay(new Date(start)).toISOString() : start,
        end,
        location: form.location || null,
        productionId: form.productionId || null,
        attendeeIds: form.attendeeIds,
      };
      if (event) await api.patch(`/events/${event.id}`, body);
      else await api.post("/events", body);
      await onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event || !window.confirm(`Delete "${event.title}"?`)) return;
    try {
      await api.del(`/events/${event.id}`);
      await onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function rsvp(status: Rsvp) {
    try {
      await api.post(`/events/${event!.id}/rsvp`, { status });
      await onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  if (readOnly && event) {
    const t = EVENT_TYPES[event.type]!;
    return (
      <Modal title={event.title} onClose={onClose}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Badge color={t.color}>{t.label}</Badge>
          {event.production && <Badge color={event.production.color}>{event.production.title}</Badge>}
        </div>
        <dl className="kv">
          <dt>When</dt>
          <dd>
            {event.allDay
              ? format(new Date(event.start), "EEE, MMM d")
              : `${format(new Date(event.start), "EEE, MMM d · HH:mm")} - ${format(new Date(event.end), isSameDay(new Date(event.start), new Date(event.end)) ? "HH:mm" : "EEE, MMM d · HH:mm")}`}
          </dd>
          {event.location && (<><dt>Where</dt><dd><MapPin size={13} /> {event.location}</dd></>)}
          {event.description && (<><dt>Details</dt><dd style={{ whiteSpace: "pre-wrap" }}>{event.description}</dd></>)}
          <dt>Who</dt>
          <dd>
            <div className="chips">
              {event.attendees.map((a) => (
                <span key={a.userId} className="chip"><Avatar user={a.user} size={18} />{a.user.displayName} <span className="muted small">{a.status.toLowerCase()}</span></span>
              ))}
              {event.attendees.length === 0 && <span className="muted">Everyone</span>}
            </div>
          </dd>
        </dl>
        {myRsvp && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button variant={myRsvp.status === "ACCEPTED" ? "primary" : "default"} onClick={() => rsvp("ACCEPTED")}>Accept</Button>
            <Button variant={myRsvp.status === "DECLINED" ? "danger" : "default"} onClick={() => rsvp("DECLINED")}>Decline</Button>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={event ? "Edit event" : "New event"}
      onClose={onClose}
      wide
      footer={
        <>
          {event && <Button variant="danger" onClick={remove} style={{ marginRight: "auto" }}>Delete</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !form.title.trim()}>Save</Button>
        </>
      }
    >
      <Field label="Title">
        <input type="text" value={form.title} onChange={set("title")} autoFocus maxLength={200} />
      </Field>
      <div className="row">
        <Field label="Type">
          <select value={form.type} onChange={set("type")}>
            {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Production">
          <select value={form.productionId} onChange={set("productionId")}>
            <option value="">None</option>
            {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input type="checkbox" checked={form.allDay} onChange={(e) => toggleAllDay(e.target.checked)} /> All day
      </label>
      <div className="row">
        <Field label="Starts">
          <input type={form.allDay ? "date" : "datetime-local"} value={form.start} onChange={set("start")} />
        </Field>
        <Field label="Ends">
          <input type={form.allDay ? "date" : "datetime-local"} value={form.end} onChange={set("end")} min={form.start} />
        </Field>
      </div>
      <Field label="Location">
        <input type="text" value={form.location} onChange={set("location")} placeholder="Address or venue" maxLength={200} />
      </Field>
      <Field label="Details">
        <textarea value={form.description} onChange={set("description")} />
      </Field>
      <Field label="Who's needed" hint="They'll be notified and can accept or decline.">
        <MemberPicker users={users.filter((u) => u.status !== "DISABLED")} value={form.attendeeIds} onChange={(ids) => setForm({ ...form, attendeeIds: ids })} />
      </Field>
    </Modal>
  );
}

