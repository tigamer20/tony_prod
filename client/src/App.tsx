import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  CalendarDays,
  Clapperboard,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Ellipsis,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Play,
  UserCog,
  Users,
} from "lucide-react";
import { useAuth } from "./auth";
import { DataProvider, useData } from "./data";
import { Avatar, Spinner } from "./ui";
import { AnnouncementsPage } from "./pages/Announcements";
import { AuthPage } from "./pages/AuthPage";
import { CalendarPage } from "./pages/Calendar";
import { ChatPage } from "./pages/Chat";
import { Dashboard } from "./pages/Dashboard";
import { DocumentEditor } from "./pages/DocumentEditor";
import { DocumentsPage } from "./pages/Documents";
import { ForcePassword } from "./pages/ForcePassword";
import { ProductionDetail, ProductionsPage } from "./pages/Productions";
import { ProfileModal } from "./pages/Profile";
import { TasksPage } from "./pages/Tasks";
import { TeamPage } from "./pages/Team";

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <AuthPage />;
  if (me.mustChangePassword) return <ForcePassword />;
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}

function Shell() {
  const { me, logout } = useAuth();
  const { totalUnread, unreadAnnouncements, unreadMentions } = useData();
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [profile, setProfile] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const flush = pathname.startsWith("/chat") || /^\/documents\/[^/]+/.test(pathname);

  // On iPhone the keyboard shrinks only the visible area, so size the app to that and keep the page from sliding up.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  // The phone's "More" sheet closes whenever you move to another page.
  useEffect(() => setMore(false), [pathname]);

  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Tony Prod` : "Tony Prod";
  }, [totalUnread]);

  const items: { to: string; icon: LucideIcon; label: string; end?: boolean; count?: number; secondary?: boolean }[] = [
    { to: "/", icon: LayoutDashboard, label: "Home", end: true, count: unreadMentions },
    { to: "/chat", icon: MessageSquare, label: "Chat", count: totalUnread },
    { to: "/calendar", icon: CalendarDays, label: "Calendar" },
    { to: "/productions", icon: Clapperboard, label: "Projects" },
    { to: "/tasks", icon: ListChecks, label: "Tasks" },
    { to: "/announcements", icon: Megaphone, label: "News", count: unreadAnnouncements, secondary: true },
    { to: "/documents", icon: FileText, label: "Docs", secondary: true },
    { to: "/team", icon: Users, label: "Team", secondary: true },
  ];
  const moreCount = items.filter((i) => i.secondary).reduce((sum, i) => sum + (i.count ?? 0), 0);

  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <div className="nav-logo" aria-hidden>
          <Play size={22} fill="currentColor" />
        </div>
        {items.map(({ to, icon: Icon, label, end, count, secondary }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${secondary ? "secondary" : ""} ${isActive ? "active" : ""}`}>
            <Icon size={22} />
            {label}
            {!!count && <span className="nav-count">{count > 99 ? "99+" : count}</span>}
          </NavLink>
        ))}
        <button className={`nav-item nav-more ${more || items.some((i) => i.secondary && (i.end ? pathname === i.to : pathname.startsWith(i.to))) ? "active" : ""}`} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label="More">
          <Ellipsis size={22} />
          More
          {moreCount > 0 && <span className="nav-count">{moreCount > 99 ? "99+" : moreCount}</span>}
        </button>
        <div className="nav-spacer" />
        <div className="menu" ref={menuRef}>
          <button className="me-btn" onClick={() => setMenu((m) => !m)} aria-label="Account menu" aria-expanded={menu}>
            <Avatar user={me!} size={40} />
          </button>
          {menu && (
            <div className="menu-pop left-up">
              <div style={{ padding: "6px 10px" }}>
                <b>{me!.displayName}</b>
                <div className="muted small">@{me!.username}</div>
              </div>
              <div className="sep" />
              <button onClick={() => { setMenu(false); setProfile(true); }}>
                <UserCog size={16} /> Profile & password
              </button>
              <button onClick={() => void logout()}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </nav>
      {more && (
        <>
          <div className="sheet-backdrop" onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-label="More">
            <div className="sheet-user">
              <Avatar user={me!} size={40} />
              <div>
                <b>{me!.displayName}</b>
                <div className="muted small">@{me!.username}</div>
              </div>
            </div>
            {items.filter((i) => i.secondary).map(({ to, icon: Icon, label, count }) => (
              <NavLink key={to} to={to} className="sheet-item">
                <Icon size={20} />
                <span className="grow">{label}</span>
                {!!count && <span className="nav-count static">{count > 99 ? "99+" : count}</span>}
              </NavLink>
            ))}
            <div className="sep" />
            <button className="sheet-item" onClick={() => { setMore(false); setProfile(true); }}>
              <UserCog size={20} /> Profile & password
            </button>
            <button className="sheet-item" onClick={() => void logout()}>
              <LogOut size={20} /> Sign out
            </button>
          </div>
        </>
      )}
      <main className={`content ${flush ? "flush" : ""}`}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat/:channelId?" element={<ChatPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/productions" element={<ProductionsPage />} />
          <Route path="/productions/:id" element={<ProductionDetail />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<DocumentEditor />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {profile && <ProfileModal onClose={() => setProfile(false)} />}
    </div>
  );
}

