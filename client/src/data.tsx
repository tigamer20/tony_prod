import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "./api";
import { useAuth } from "./auth";
import { AvatarVersions, useToast } from "./ui";
import type { Announcement, Channel, Member, Message, Production, Role } from "./types";

interface DataState {
  users: Member[];
  userById: (id: string) => Member | undefined;
  roles: Role[];
  online: Set<string>;
  channels: Channel[];
  productions: Production[];
  unreadAnnouncements: number;
  totalUnread: number;
  socket: Socket | null;
  setActiveChannel: (id: string | null) => void;
  refreshChannels: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshProductions: () => Promise<void>;
  refreshAnnouncements: () => Promise<void>;
  markChannelRead: (id: string) => void;
}

const Ctx = createContext<DataState>(null!);
export const useData = () => useContext(Ctx);

/** Subscribe to a realtime event for the lifetime of a component. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const { socket } = useData();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => void socket.off(event, fn);
  }, [socket, event]);
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<Channel[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const activeChannel = useRef<string | null>(null);

  const refreshUsers = useCallback(async () => {
    const [u, r] = await Promise.all([
      api.get<{ users: Member[]; online: string[] }>("/users"),
      api.get<Role[]>("/roles"),
    ]);
    setUsers(u.users);
    setRoles(r);
    setOnline(new Set(u.online));
  }, []);

  const refreshChannels = useCallback(async () => {
    const list = await api.get<Channel[]>("/channels");
    setChannels(
      list.map((c) => (c.id === activeChannel.current ? { ...c, unread: 0 } : c)),
    );
  }, []);

  const refreshProductions = useCallback(async () => {
    setProductions(await api.get<Production[]>("/productions"));
  }, []);

  const refreshAnnouncements = useCallback(async () => {
    const list = await api.get<Announcement[]>("/announcements");
    setUnreadAnnouncements(list.filter((a) => !a.read).length);
  }, []);

  // Initial load + socket lifecycle, tied to the signed-in user.
  useEffect(() => {
    if (!me) {
      setSocket(null);
      return;
    }
    refreshUsers();
    refreshChannels();
    refreshProductions();
    refreshAnnouncements();
    const s = io({ withCredentials: true });
    setSocket(s);
    return () => void s.disconnect();
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the socket subscribed to every channel the user can see.
  const channelIds = channels.map((c) => c.id).join(",");
  useEffect(() => {
    if (!socket || !channelIds) return;
    const subscribe = () => socket.emit("subscribe", channelIds.split(","));
    subscribe();
    socket.on("connect", subscribe);
    return () => void socket.off("connect", subscribe);
  }, [socket, channelIds]);

  useEffect(() => {
    if (!socket) return;
    const handlers: Record<string, (p: never) => void> = {
      "presence:list": (ids: string[]) => setOnline(new Set(ids)),
      presence: ({ userId, online: on }: { userId: string; online: boolean }) =>
        setOnline((prev) => {
          const next = new Set(prev);
          if (on) next.add(userId);
          else next.delete(userId);
          return next;
        }),
      "channels:changed": () => void refreshChannels(),
      "users:changed": () => void refreshUsers(),
      "productions:changed": () => void refreshProductions(),
      "announcements:changed": () => void refreshAnnouncements(),
      "announcement:new": (a: { title: string; author: string; authorId: string; priority: string }) => {
        refreshAnnouncements();
        if (a.authorId !== me?.id) toast(`${a.priority === "URGENT" ? "Urgent: " : ""}${a.title}`, "info", `New announcement from ${a.author}`);
      },
      notify: (n: { text: string }) => toast(n.text, "info"),
      "message:new": (m: Message) => {
        if (m.author.id === me?.id || m.channelId === activeChannel.current) return;
        setChannels((prev) => prev.map((c) => (c.id === m.channelId ? { ...c, unread: c.unread + 1 } : c)));
      },
    };
    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn as never);
    return () => {
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn as never);
    };
  }, [socket, me?.id, refreshChannels, refreshUsers, refreshProductions, refreshAnnouncements, toast]);

  const value = useMemo<DataState>(
    () => ({
      users,
      userById: (id) => users.find((u) => u.id === id),
      roles,
      online,
      channels,
      productions,
      unreadAnnouncements,
      totalUnread: channels.reduce((n, c) => n + c.unread, 0),
      socket,
      setActiveChannel: (id) => {
        activeChannel.current = id;
      },
      refreshChannels,
      refreshUsers,
      refreshProductions,
      refreshAnnouncements,
      markChannelRead: (id) => {
        setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
        api.post(`/channels/${id}/read`).catch(() => {});
      },
    }),
    [users, roles, online, channels, productions, unreadAnnouncements, socket, refreshChannels, refreshUsers, refreshProductions, refreshAnnouncements],
  );

  const avatarVersions = useMemo(() => new Map(users.map((u) => [u.id, u.avatarUpdatedAt ?? null])), [users]);

  return (
    <Ctx.Provider value={value}>
      <AvatarVersions.Provider value={avatarVersions}>{children}</AvatarVersions.Provider>
    </Ctx.Provider>
  );
}
