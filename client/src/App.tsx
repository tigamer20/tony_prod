import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  CalendarDays,
  Clapperboard,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
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
import { ProductionDetail, ProductionsPage } from "./pages/Productions";
import { ProfileModal } from "./pages/Profile";
import { TasksPage } from "./pages/Tasks";
import { TeamPage } from "./pages/Team";

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <AuthPage />;
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}

function Shell() {
  const { me, logout } = useAuth();
  const { totalUnread, unreadAnnouncements } = useData();
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const flush = pathname.startsWith("/chat") || /^\/documents\/[^/]+/.test(pathname);

  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Tony Prod` : "Tony Prod";
  }, [totalUnread]);

  const items = [
    { to: "/", icon: LayoutDashboard, label: "Home", end: true },
    { to: "/chat", icon: MessageSquare, label: "Chat", count: totalUnread },
    { to: "/calendar", icon: CalendarDays, label: "Calendar" },
    { to: "/productions", icon: Clapperboard, label: "Projects" },
    { to: "/tasks", icon: ListChecks, label: "Tasks" },
    { to: "/announcements", icon: Megaphone, label: "News", count: unreadAnnouncements },
    { to: "/documents", icon: FileText, label: "Docs" },
    { to: "/team", icon: Users, label: "Team" },
  ];

  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <div className="nav-logo" aria-hidden>
          <Play size={22} fill="currentColor" />
        </div>
        {items.map(({ to, icon: Icon, label, end, count }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
            <Icon size={22} />
            {label}
            {!!count && <span className="nav-count">{count > 99 ? "99+" : count}</span>}
          </NavLink>
        ))}
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

