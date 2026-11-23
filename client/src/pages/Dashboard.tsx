import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { CalendarDays, Clapperboard, ListChecks, Megaphone } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { EVENT_TYPES, PRIORITY_COLOR } from "../lib";
import type { Announcement, CalEvent, Task } from "../types";
import { Avatar, Badge, Empty, PageHeader, Spinner } from "../ui";

interface DashboardData {
  events: CalEvent[];
  tasks: Task[];
  announcements: (Announcement & { author: Announcement["author"] })[];
  activeProductions: number;
  unreadAnnouncements: number;
}

export function Dashboard() {
  const { me } = useAuth();
  const { totalUnread } = useData();
  const [data, setData] = useState<DashboardData | null>(null);
  const load = useCallback(() => void api.get<DashboardData>("/dashboard").then(setData), []);
  useEffect(load, [load]);
  useSocketEvent("events:changed", load);
  useSocketEvent("tasks:changed", load);
  useSocketEvent("announcements:changed", load);
  useSocketEvent("announcement:new", load);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader title={`${greeting}, ${me!.displayName.split(" ")[0]}`} subtitle={format(new Date(), "EEEE, MMMM d")} />

      <div className="stat-row">
        <Link to="/productions" className="stat" style={{ textDecoration: "none", color: "inherit" }}>
          <b>{data.activeProductions}</b><span><Clapperboard size={13} /> Active productions</span>
        </Link>
        <Link to="/tasks" className="stat" style={{ textDecoration: "none", color: "inherit" }}>
          <b>{data.tasks.length}</b><span><ListChecks size={13} /> Your open tasks</span>
        </Link>
        <Link to="/announcements" className="stat" style={{ textDecoration: "none", color: "inherit" }}>
          <b>{data.unreadAnnouncements}</b><span><Megaphone size={13} /> Unread announcements</span>
        </Link>
        <Link to="/chat" className="stat" style={{ textDecoration: "none", color: "inherit" }}>
          <b>{totalUnread}</b><span>Unread chat messages</span>
        </Link>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h3>Coming up</h3>
          {data.events.length === 0 ? (
            <Empty icon={<CalendarDays size={32} />} title="Nothing scheduled">The next two weeks are clear.</Empty>
          ) : (
            <div className="list">
              {data.events.map((e) => (
                <Link key={e.id} to="/calendar" className="list-item">
                  <i className="dot" style={{ background: EVENT_TYPES[e.type]!.color }} />
                  <div className="grow">
                    <div className="ellipsis"><b>{e.title}</b></div>
                    <div className="muted small">
                      {e.allDay ? format(new Date(e.start), "EEE, MMM d") : format(new Date(e.start), "EEE, MMM d · HH:mm")}
                      {e.production && ` · ${e.production.title}`}
                    </div>
                  </div>
                  <Badge color={EVENT_TYPES[e.type]!.color}>{EVENT_TYPES[e.type]!.label}</Badge>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3>Your tasks</h3>
          {data.tasks.length === 0 ? (
            <Empty icon={<ListChecks size={32} />} title="All caught up">No open tasks are assigned to you.</Empty>
          ) : (
            <div className="list">
              {data.tasks.map((t) => {
                const overdue = t.dueDate && new Date(t.dueDate) < new Date();
                return (
                  <Link key={t.id} to="/tasks" className="list-item">
                    <i className="dot" style={{ background: PRIORITY_COLOR[t.priority] }} />
                    <div className="grow">
                      <div className="ellipsis"><b>{t.title}</b></div>
                      <div className="muted small">{t.production?.title ?? "No production"}</div>
                    </div>
                    {t.dueDate && <span className={`small ${overdue ? "overdue" : "muted"}`}>{format(new Date(t.dueDate), "MMM d")}</span>}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>Latest announcements</h3>
          {data.announcements.length === 0 ? (
            <Empty icon={<Megaphone size={32} />} title="No announcements yet" />
          ) : (
            <div className="list">
              {data.announcements.map((a) => (
                <Link key={a.id} to="/announcements" className="list-item">
                  <Avatar user={a.author} size={32} />
                  <div className="grow">
                    <div className="ellipsis"><b>{a.title}</b></div>
                    <div className="muted small">{a.author.displayName} · {format(new Date(a.createdAt), "MMM d, HH:mm")}</div>
                  </div>
                  {a.priority !== "NORMAL" && <Badge color={PRIORITY_COLOR[a.priority === "URGENT" ? "URGENT" : "HIGH"]}>{a.priority.toLowerCase()}</Badge>}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
