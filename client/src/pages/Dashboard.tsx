import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { AtSign, CalendarDays, Check, Clapperboard, ListChecks, Megaphone } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { EVENT_TYPES, PRIORITY_COLOR, STATUS_COLOR, STATUS_LABEL } from "../lib";
import type { Announcement, CalEvent, Task } from "../types";
import type { MentionItem } from "../types";
import { Avatar, Badge, Button, Empty, PageHeader, Participants, Spinner } from "../ui";

interface DashboardData {
  events: CalEvent[];
  tasks: Task[];
  announcements: (Announcement & { author: Announcement["author"] })[];
  activeProductions: number;
  unreadAnnouncements: number;
}

export function Dashboard() {
  const { me } = useAuth();
  const { totalUnread, mentions, unreadMentions, refreshMentions, productions } = useData();
  const running = productions.filter((p) => p.status !== "DELIVERED" && p.status !== "ARCHIVED");
  const navigate = useNavigate();

  async function openMention(m: MentionItem) {
    if (!m.readAt) await api.post(`/mentions/${m.id}/read`).catch(() => {});
    refreshMentions();
    navigate(m.kind === "document" ? `/documents/${m.document!.id}` : `/chat/${m.channel!.id}`);
  }

  async function markAllRead() {
    await api.post("/mentions/read-all");
    refreshMentions();
  }
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
        <a href="#mentions" className={`stat ${unreadMentions ? "stat-accent" : ""}`} style={{ textDecoration: "none", color: "inherit" }}>
          <b>{unreadMentions}</b><span><AtSign size={13} /> Unread mentions</span>
        </a>
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

      <section className="card" id="mentions" style={{ marginBottom: 16 }} aria-label="Mentions">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Mentions</h3>
          {unreadMentions > 0 && (
            <Button small variant="ghost" onClick={markAllRead}>
              <Check size={14} /> Mark all read
            </Button>
          )}
        </div>
        {mentions.length === 0 ? (
          <p className="muted small" style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0 2px" }}>
            <AtSign size={16} style={{ flex: "none" }} /> No mentions yet. When someone @mentions you in chat or in a document, it shows up here.
          </p>
        ) : (
          <div className="list">
            {mentions.slice(0, 8).map((m) => (
              <button key={m.id} className={`list-item mention-row ${m.readAt ? "read" : "unread"}`} onClick={() => void openMention(m)}>
                <Avatar user={m.by} size={34} />
                <div className="grow">
                  <div>
                    <b>{m.by.displayName}</b> mentioned {m.everyone ? "everyone" : "you"} in{" "}
                    <b>
                      {m.kind === "document"
                        ? `"${m.document!.title}"`
                        : m.channel!.type === "DM"
                          ? "a direct message"
                          : `#${m.channel!.name}`}
                    </b>
                  </div>
                  {m.snippet && <div className="muted small ellipsis">{m.snippet}</div>}
                </div>
                <span className="muted small" style={{ whiteSpace: "nowrap" }} title={format(new Date(m.createdAt), "PPpp")}>
                  {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                </span>
                {!m.readAt && <span className="unread-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: 16 }} aria-label="Productions in progress">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Productions in progress</h3>
          <Link to="/productions" className="muted small">All productions</Link>
        </div>
        {running.length === 0 ? (
          <Empty icon={<Clapperboard size={32} />} title="Nothing in progress">Productions that aren't delivered or archived show up here with their participants.</Empty>
        ) : (
          <div className="list">
            {running.map((p) => (
              <div key={p.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <i className="dot" style={{ background: p.color, marginTop: 7 }} />
                <div className="grow">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <Link to={`/productions/${p.id}`}><b>{p.title}</b></Link>
                    <Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    <span className="muted small">Release: {p.releaseDate ? format(new Date(p.releaseDate), "MMM d, yyyy") : "TBD"}</span>
                  </div>
                  <Participants members={p.members} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
