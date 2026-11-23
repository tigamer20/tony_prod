import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  AtSign,
  CornerUpLeft,
  File as FileIcon,
  Hash,
  Lock,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { dayLabel, fileSize, formatMessageTime, isSameDay } from "../lib";
import type { Attachment, Channel, Message, MiniUser } from "../types";
import { Avatar, Button, Empty, Field, Modal, Spinner, useToast } from "../ui";

const EMOJIS = ["👍", "❤️", "😂", "🎬", "🔥", "👀", "✅", "🙏", "🎉", "😮", "😢", "💯"];
const INLINE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// ─── Page: channel list + selected conversation ──────────────────────────

export function ChatPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { channels, users, online, roles, refreshChannels } = useData();
  const [creating, setCreating] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);

  const current = channels.find((c) => c.id === channelId);

  // On wide screens, open the first channel automatically.
  useEffect(() => {
    if (!channelId && channels.length && window.matchMedia("(min-width: 821px)").matches) {
      const first = channels.find((c) => c.type === "TEXT") ?? channels[0]!;
      navigate(`/chat/${first.id}`, { replace: true });
    }
  }, [channelId, channels, navigate]);

  const textChannels = channels.filter((c) => c.type === "TEXT");
  const categories = [...new Set(textChannels.map((c) => c.category))];
  const dms = channels.filter((c) => c.type === "DM");

  const label = (c: Channel) => (c.type === "DM" ? (c.dmUser?.displayName ?? "Direct message") : c.name);

  return (
    <div className={`chat ${channelId ? "has-channel" : ""}`}>
      <aside className="chat-side" aria-label="Channels">
        <div className="chat-side-head">
          Channels
          <span>
            <button className="icon-btn" title="New direct message" aria-label="New direct message" onClick={() => setDmOpen(true)}>
              <MessageSquarePlus size={17} />
            </button>
          </span>
        </div>
        <div className="chat-side-scroll">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="cat-label">
                {cat}
                {can("channels.manage") && (
                  <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`New channel in ${cat}`} title="New channel" onClick={() => setCreating(true)}>
                    <Plus size={14} />
                  </button>
                )}
              </div>
              {textChannels
                .filter((c) => c.category === cat)
                .map((c) => (
                  <button key={c.id} className={`ch-item ${c.id === channelId ? "active" : ""} ${c.unread ? "unread" : ""}`} onClick={() => navigate(`/chat/${c.id}`)}>
                    {c.isPrivate ? <Lock size={15} /> : <Hash size={15} />}
                    <span className="ellipsis">{c.name}</span>
                    {c.unread > 0 && <span className="count">{c.unread}</span>}
                  </button>
                ))}
            </div>
          ))}
          <div className="cat-label">Direct messages</div>
          {dms.length === 0 && <div className="muted small" style={{ padding: "2px 8px" }}>No conversations yet.</div>}
          {dms.map((c) => (
            <button key={c.id} className={`ch-item ${c.id === channelId ? "active" : ""} ${c.unread ? "unread" : ""}`} onClick={() => navigate(`/chat/${c.id}`)}>
              {c.dmUser && <Avatar user={c.dmUser} size={22} online={online.has(c.dmUser.id)} />}
              <span className="ellipsis">{label(c)}</span>
              {c.unread > 0 && <span className="count">{c.unread}</span>}
            </button>
          ))}
        </div>
      </aside>

      {current ? (
        <ChatView key={current.id} channel={current} onEdit={() => setEditing(current)} />
      ) : (
        <div className="chat-main">
          <div className="chat-empty">
            <Empty icon={<Hash size={40} />} title="Pick a channel">
              {channels.length ? "Choose a channel on the left to start chatting." : "No channels available yet."}
            </Empty>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <ChannelModal
          channel={editing}
          existingCategories={categories}
          roles={roles}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={async (deletedId) => {
            await refreshChannels();
            if (deletedId && deletedId === channelId) navigate("/chat", { replace: true });
          }}
        />
      )}
      {dmOpen && (
        <DmModal
          users={users.filter((u) => u.status !== "DISABLED")}
          onClose={() => setDmOpen(false)}
          onPick={async (id) => {
            const { id: channel } = await api.post<{ id: string }>("/channels/dm", { userId: id });
            await refreshChannels();
            setDmOpen(false);
            navigate(`/chat/${channel}`);
          }}
        />
      )}
    </div>
  );
}

// ─── One conversation ────────────────────────────────────────────────────

function ChatView({ channel, onEdit }: { channel: Channel; onEdit: () => void }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { socket, setActiveChannel, markChannelRead, refreshChannels, users } = useData();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [panel, setPanel] = useState<"pins" | null>(null);
  const [pins, setPins] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTyping = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const prependHeight = useRef<number | null>(null);

  const canSend = can("messages.send");
  const title = channel.type === "DM" ? (channel.dmUser?.displayName ?? "Direct message") : channel.name;

  // Initial load.
  useEffect(() => {
    setActiveChannel(channel.id);
    let cancelled = false;
    api
      .get<{ messages: Message[]; hasMore: boolean }>(`/channels/${channel.id}/messages?limit=50`)
      .then((r) => {
        if (cancelled) return;
        setMessages(r.messages);
        setHasMore(r.hasMore);
        stick.current = true;
      })
      .catch((e) => toast(errMsg(e), "error"))
      .finally(() => !cancelled && setLoading(false));
    markChannelRead(channel.id);
    return () => {
      cancelled = true;
      setActiveChannel(null);
    };
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view pinned to the bottom for new messages, or preserve position after loading older ones.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prependHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prependHeight.current;
      prependHeight.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  useSocketEvent<Message>("message:new", (m) => {
    if (m.channelId !== channel.id) return;
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    setTyping((t) => {
      const { [m.author.id]: _gone, ...rest } = t;
      return rest;
    });
    if (document.visibilityState === "visible") markChannelRead(channel.id);
  });
  useSocketEvent<Message>("message:update", (m) => {
    if (m.channelId !== channel.id) return;
    setMessages((prev) => prev.map((p) => (p.id === m.id ? m : p)));
    setPins((prev) => (m.pinned ? (prev.some((p) => p.id === m.id) ? prev.map((p) => (p.id === m.id ? m : p)) : [m, ...prev]) : prev.filter((p) => p.id !== m.id)));
  });
  useSocketEvent<{ id: string; channelId: string }>("message:delete", ({ id, channelId }) => {
    if (channelId !== channel.id) return;
    setMessages((prev) => prev.map((p) => (p.id === id ? { ...p, deleted: true, content: "", attachments: [], reactions: [], pinned: false } : p)));
    setPins((prev) => prev.filter((p) => p.id !== id));
  });
  useSocketEvent<{ channelId: string; user: { id: string; displayName: string } }>("typing", ({ channelId, user }) => {
    if (channelId !== channel.id) return;
    setTyping((t) => ({ ...t, [user.id]: { name: user.displayName, until: Date.now() + 4000 } }));
  });
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((cur) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  async function loadOlder() {
    if (!hasMore || !messages.length) return;
    const el = listRef.current!;
    prependHeight.current = el.scrollHeight - el.scrollTop;
    const r = await api.get<{ messages: Message[]; hasMore: boolean }>(`/channels/${channel.id}/messages?limit=50&before=${messages[0]!.id}`);
    setMessages((prev) => [...r.messages, ...prev]);
    setHasMore(r.hasMore);
  }

  function onScroll() {
    const el = listRef.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60) void loadOlder();
  }

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      if (!can("files.upload")) return toast("You don't have permission to upload files.", "error");
      setUploading(true);
      try {
        const form = new FormData();
        files.slice(0, 5).forEach((f) => form.append("files", f));
        const created = await api.upload<Attachment[]>("/uploads", form);
        setPending((p) => [...p, ...created]);
      } catch (e) {
        toast(errMsg(e), "error");
      } finally {
        setUploading(false);
      }
    },
    [can, toast],
  );

  async function send() {
    const content = text.trim();
    if (editingId) {
      if (!content) return;
      try {
        await api.patch(`/messages/${editingId}`, { content });
        setEditingId(null);
        setText("");
      } catch (e) {
        toast(errMsg(e), "error");
      }
      return;
    }
    if (!content && pending.length === 0) return;
    try {
      stick.current = true;
      const m = await api.post<Message>(`/channels/${channel.id}/messages`, {
        content,
        replyToId: replyTo?.id ?? null,
        attachmentIds: pending.map((p) => p.id),
      });
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
      setText("");
      setPending([]);
      setReplyTo(null);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      setEditingId(null);
      setReplyTo(null);
      if (editingId) setText("");
    } else if (e.key === "ArrowUp" && !text && !editingId) {
      const mine = [...messages].reverse().find((m) => m.author.id === me!.id && !m.deleted);
      if (mine) startEdit(mine);
    }
  }

  function onChange(value: string) {
    setText(value);
    const now = Date.now();
    if (value && now - lastTyping.current > 2500) {
      lastTyping.current = now;
      socket?.emit("typing", channel.id);
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      void upload(files);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void upload([...e.dataTransfer.files]);
  }

  const startEdit = useCallback((m: Message) => {
    setEditingId(m.id);
    setReplyTo(null);
    setText(m.content);
    setTimeout(() => textRef.current?.focus(), 0);
  }, []);
  const startReply = useCallback((m: Message) => {
    setReplyTo(m);
    setEditingId(null);
    setTimeout(() => textRef.current?.focus(), 0);
  }, []);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    },
    [toast],
  );

  const onReact = useCallback((m: Message, emoji: string) => act(() => api.post(`/messages/${m.id}/reactions`, { emoji })), [act]);
  const onPin = useCallback((m: Message) => act(() => api.post(`/messages/${m.id}/pin`)), [act]);
  const onDelete = useCallback(
    (m: Message) => {
      if (window.confirm("Delete this message? This can't be undone.")) void act(() => api.del(`/messages/${m.id}`));
    },
    [act],
  );

  async function deleteConversation() {
    if (!window.confirm(`Delete your conversation with ${title}? Every message and file in it is deleted for both of you. This can't be undone.`)) return;
    try {
      await api.del(`/channels/${channel.id}`);
      await refreshChannels();
      navigate("/chat", { replace: true });
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function openPins() {
    if (panel === "pins") return setPanel(null);
    setPins(await api.get<Message[]>(`/channels/${channel.id}/pins`));
    setPanel("pins");
  }

  const typingNames = Object.values(typing).map((t) => t.name);
  const usernames = useMemo(() => new Map(users.map((u) => [u.username, u])), [users]);

  return (
    <section
      className="chat-main"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {dragging && <div className="drop-overlay">Drop files to attach</div>}

      <div className="chat-head">
        <button className="icon-btn chat-back" aria-label="Back to channels" onClick={() => navigate("/chat")}>
          <ArrowLeft size={18} />
        </button>
        {channel.type === "DM" ? <AtSign size={18} /> : channel.isPrivate ? <Lock size={18} /> : <Hash size={18} />}
        <strong>{title}</strong>
        {channel.topic && <span className="topic ellipsis">{channel.topic}</span>}
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Pinned messages" aria-label="Pinned messages" onClick={openPins}>
          <Pin size={17} />
        </button>
        <button className="icon-btn" title="Search messages" aria-label="Search messages" onClick={() => setSearching(true)}>
          <Search size={17} />
        </button>
        {channel.type === "TEXT" && can("channels.manage") && (
          <button className="icon-btn" title="Channel settings" aria-label="Channel settings" onClick={onEdit}>
            <Settings size={17} />
          </button>
        )}
        {channel.type === "DM" && (
          <button className="icon-btn" title="Delete conversation" aria-label="Delete conversation" onClick={() => void deleteConversation()}>
            <Trash2 size={17} />
          </button>
        )}
      </div>

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {loading ? (
          <Spinner />
        ) : (
          <>
            {!hasMore && (
              <div className="chat-empty" style={{ padding: "24px 16px" }}>
                <h2>{channel.type === "DM" ? `Your conversation with ${title}` : `Welcome to #${title}`}</h2>
                <p>{channel.topic ?? "This is the beginning of the conversation."}</p>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
              const compact =
                !!prev && !newDay && prev.author.id === m.author.id && !m.replyTo && +new Date(m.createdAt) - +new Date(prev.createdAt) < 7 * 60_000;
              return (
                <div key={m.id}>
                  {newDay && <div className="day-sep">{dayLabel(m.createdAt)}</div>}
                  <MessageRow
                    m={m}
                    compact={compact}
                    meId={me!.id}
                    myUsername={me!.username}
                    usernames={usernames}
                    canModerate={can("messages.moderate")}
                    canReact={canSend}
                    onReact={onReact}
                    onReply={startReply}
                    onEdit={startEdit}
                    onPin={onPin}
                    onDelete={onDelete}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="typing" aria-live="polite">
        {typingNames.length > 0 && `${typingNames.slice(0, 3).join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing...`}
      </div>

      <div className="composer">
        {canSend ? (
          <>
            {(replyTo || editingId) && (
              <div className="composer-bar">
                {editingId ? <Pencil size={14} /> : <CornerUpLeft size={14} />}
                <span className="grow ellipsis">{editingId ? "Editing message (Esc to cancel)" : `Replying to ${replyTo!.author.displayName}`}</span>
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  aria-label="Cancel"
                  onClick={() => {
                    setReplyTo(null);
                    if (editingId) setText("");
                    setEditingId(null);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="composer-box">
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
              <button className="icon-btn" aria-label="Attach files" title="Attach files" disabled={uploading || !can("files.upload")} onClick={() => fileInput.current?.click()}>
                <Paperclip size={18} />
              </button>
              <textarea
                ref={textRef}
                rows={1}
                value={text}
                placeholder={`Message ${channel.type === "DM" ? title : "#" + title}`}
                onChange={(e) => {
                  onChange(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                maxLength={4000}
                aria-label="Message"
              />
              <button className="icon-btn" aria-label="Send message" title="Send" onClick={() => void send()} disabled={uploading}>
                <Send size={18} />
              </button>
            </div>
            {(pending.length > 0 || uploading) && (
              <div className="pending-files">
                {pending.map((p) => (
                  <span key={p.id} className="chip">
                    <FileIcon size={14} /> {p.fileName}
                    <button className="icon-btn" style={{ width: 18, height: 18 }} aria-label={`Remove ${p.fileName}`} onClick={() => setPending((l) => l.filter((x) => x.id !== p.id))}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {uploading && <span className="muted small">Uploading...</span>}
              </div>
            )}
          </>
        ) : (
          <div className="composer-box" style={{ padding: 12, color: "var(--text-2)" }}>
            You don't have permission to send messages in this workspace.
          </div>
        )}
      </div>

      {panel === "pins" && (
        <aside className="side-panel" aria-label="Pinned messages">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <h3>Pinned messages</h3>
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button>
          </div>
          {pins.length === 0 && <p className="muted">Nothing pinned yet.</p>}
          {pins.map((m) => (
            <div key={m.id} className="card" style={{ marginBottom: 8, padding: 10 }}>
              <div className="muted small">{m.author.displayName} · {formatMessageTime(m.createdAt)}</div>
              <div className="msg-text">{renderContent(m.content, me!.username, usernames)}</div>
            </div>
          ))}
        </aside>
      )}
      {searching && <SearchModal onClose={() => setSearching(false)} onOpen={(id) => { setSearching(false); navigate(`/chat/${id}`); }} />}
    </section>
  );
}

// ─── A single message ────────────────────────────────────────────────────

interface RowProps {
  m: Message;
  compact: boolean;
  meId: string;
  myUsername: string;
  usernames: Map<string, MiniUser>;
  canModerate: boolean;
  canReact: boolean;
  onReact: (m: Message, emoji: string) => void;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onPin: (m: Message) => void;
  onDelete: (m: Message) => void;
}

const MessageRow = memo(function MessageRow({ m, compact, meId, myUsername, usernames, canModerate, canReact, onReact, onReply, onEdit, onPin, onDelete }: RowProps) {
  const [picker, setPicker] = useState(false);
  // On touch screens there is no hover, so tapping a message reveals its actions.
  const [selected, setSelected] = useState(false);
  const mine = m.author.id === meId;
  const mentioned = !m.deleted && new RegExp(`@${myUsername}\\b`, "i").test(m.content);

  return (
    <div
      className={`msg ${compact ? "" : "first"} ${m.pinned ? "pinned" : ""} ${mentioned ? "mentioned" : ""} ${selected ? "selected" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,video,img,textarea")) return;
        setSelected((s) => !s);
      }}
    >
      {compact ? (
        <span className="msg-gutter">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      ) : (
        <Avatar user={m.author} size={40} />
      )}
      <div className="msg-body">
        {m.replyTo && (
          <div className="reply-ref">
            <CornerUpLeft size={13} />
            <b>{m.replyTo.author}</b>
            <span className="ellipsis">{m.replyTo.deleted ? "Original message was deleted" : m.replyTo.content}</span>
          </div>
        )}
        {!compact && (
          <div className="msg-meta">
            <span className="msg-author" style={{ color: m.author.avatarColor }}>{m.author.displayName}</span>
            <span className="msg-time">{formatMessageTime(m.createdAt)}</span>
            {m.pinned && <Pin size={12} color="var(--yellow)" aria-label="Pinned" />}
          </div>
        )}
        {m.deleted ? (
          <div className="deleted-text">Message deleted</div>
        ) : (
          <>
            {m.content && (
              <div className="msg-text">
                {renderContent(m.content, myUsername, usernames)}
                {m.editedAt && <span className="edited"> (edited)</span>}
              </div>
            )}
            {m.attachments.length > 0 && (
              <div className="attachments">
                {m.attachments.map((a) =>
                  INLINE_IMAGES.has(a.mimeType) ? (
                    <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noopener noreferrer">
                      <img className="attachment-img" src={`/api/files/${a.id}`} alt={a.fileName} loading="lazy" />
                    </a>
                  ) : a.mimeType.startsWith("video/") && ["video/mp4", "video/webm"].includes(a.mimeType) ? (
                    <video key={a.id} className="attachment-img" src={`/api/files/${a.id}`} controls preload="metadata" />
                  ) : (
                    <a key={a.id} className="attachment-file" href={`/api/files/${a.id}`} download={a.fileName}>
                      <FileIcon size={18} /> {a.fileName} <span className="muted small">{fileSize(a.size)}</span>
                    </a>
                  ),
                )}
              </div>
            )}
            {m.reactions.length > 0 && (
              <div className="reactions">
                {m.reactions.map((r) => (
                  <button key={r.emoji} className={`reaction ${r.userIds.includes(meId) ? "mine" : ""}`} disabled={!canReact} onClick={() => onReact(m, r.emoji)} aria-label={`${r.emoji} ${r.userIds.length}`}>
                    {r.emoji} {r.userIds.length}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {!m.deleted && (
        <div className="msg-actions">
          {canReact && (
            <button className="icon-btn" title="Add reaction" aria-label="Add reaction" onClick={() => setPicker((p) => !p)}>
              <SmilePlus size={16} />
            </button>
          )}
          {canReact && (
            <button className="icon-btn" title="Reply" aria-label="Reply" onClick={() => onReply(m)}>
              <CornerUpLeft size={16} />
            </button>
          )}
          {mine && (
            <button className="icon-btn" title="Edit" aria-label="Edit message" onClick={() => onEdit(m)}>
              <Pencil size={16} />
            </button>
          )}
          {canModerate && (
            <button className="icon-btn" title={m.pinned ? "Unpin" : "Pin"} aria-label={m.pinned ? "Unpin message" : "Pin message"} onClick={() => onPin(m)}>
              <Pin size={16} />
            </button>
          )}
          {(mine || canModerate) && (
            <button className="icon-btn" title="Delete" aria-label="Delete message" onClick={() => onDelete(m)}>
              <Trash2 size={16} />
            </button>
          )}
          {picker && (
            <div className="emoji-pop">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => { setPicker(false); onReact(m, e); }}>{e}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Message text rendering (no raw HTML, ever) ──────────────────────────

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|https?:\/\/[^\s<]+|@[a-z0-9_.-]{3,24})/gi;

function renderInline(text: string, myUsername: string, usernames: Map<string, MiniUser>, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (!part) return null;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) return <s key={key}>{part.slice(2, -2)}</s>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^https?:\/\//i.test(part)) {
      const url = part.replace(/[.,!?)]+$/, "");
      return (
        <span key={key}>
          <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
          {part.slice(url.length)}
        </span>
      );
    }
    if (part.startsWith("@")) {
      const name = part.slice(1).toLowerCase();
      if (usernames.has(name)) {
        return <span key={key} className={`mention ${name === myUsername ? "me" : ""}`}>@{usernames.get(name)!.displayName}</span>;
      }
    }
    return part;
  });
}

function renderContent(content: string, myUsername: string, usernames: Map<string, MiniUser>): ReactNode {
  return content.split(/```/).map((chunk, i) =>
    i % 2 === 1 ? <pre key={i}>{chunk.replace(/^\n/, "")}</pre> : <span key={i}>{renderInline(chunk, myUsername, usernames, String(i))}</span>,
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────

function SearchModal({ onClose, onOpen }: { onClose: () => void; onOpen: (channelId: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<(Message & { channel: { id: string; name: string; type: string } })[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const t = setTimeout(() => {
      api.get<typeof results>(`/search/messages?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="Search messages" onClose={onClose} wide>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything you can see..." autoFocus aria-label="Search messages" />
      <div style={{ marginTop: 12 }}>
        {results === null && <p className="muted">Type at least two characters.</p>}
        {results?.length === 0 && <p className="muted">No messages found.</p>}
        {results?.map((r) => (
          <button key={r.id} className="list-item" style={{ width: "100%", background: "none", border: 0, textAlign: "left", color: "inherit" }} onClick={() => onOpen(r.channel.id)}>
            <Avatar user={r.author} size={32} />
            <div className="grow">
              <div className="muted small">
                {r.author.displayName} · {r.channel.type === "DM" ? "direct message" : `#${r.channel.name}`} · {formatMessageTime(r.createdAt)}
              </div>
              <div className="ellipsis">{r.content}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function DmModal({ users, onClose, onPick }: { users: { id: string; displayName: string; username: string; avatarColor: string; jobTitle: string | null }[]; onClose: () => void; onPick: (id: string) => Promise<void> }) {
  const { me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState("");
  const list = users.filter((u) => u.id !== me!.id && (u.displayName + u.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="New direct message" onClose={onClose}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a teammate..." autoFocus aria-label="Find a teammate" />
      <div className="list" style={{ marginTop: 10 }}>
        {list.map((u) => (
          <button key={u.id} className="list-item" style={{ background: "none", border: 0, textAlign: "left", color: "inherit" }} onClick={() => onPick(u.id).catch((e) => toast(errMsg(e), "error"))}>
            <Avatar user={u} size={32} />
            <div>
              <div>{u.displayName}</div>
              <div className="muted small">{u.jobTitle ?? `@${u.username}`}</div>
            </div>
          </button>
        ))}
        {list.length === 0 && <p className="muted">No one found.</p>}
      </div>
    </Modal>
  );
}

function ChannelModal({
  channel,
  existingCategories,
  roles,
  onClose,
  onDone,
}: {
  channel: Channel | null;
  existingCategories: string[];
  roles: { id: string; name: string; color: string }[];
  onClose: () => void;
  onDone: (deletedId?: string) => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: channel?.name ?? "",
    topic: channel?.topic ?? "",
    category: channel?.category ?? existingCategories[0] ?? "General",
    isPrivate: channel?.isPrivate ?? false,
    roleIds: channel?.allowedRoleIds ?? ([] as string[]),
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = { ...form, topic: form.topic || null };
      if (channel) await api.patch(`/channels/${channel.id}`, body);
      else await api.post("/channels", body);
      await onDone();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!channel || !window.confirm(`Delete #${channel.name} and all of its messages? This can't be undone.`)) return;
    try {
      await api.del(`/channels/${channel.id}`);
      await onDone(channel.id);
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  return (
    <Modal
      title={channel ? "Channel settings" : "New channel"}
      onClose={onClose}
      footer={
        <>
          {channel && <Button variant="danger" onClick={remove} style={{ marginRight: "auto" }}>Delete</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !form.name.trim()}>{channel ? "Save" : "Create channel"}</Button>
        </>
      }
    >
      <Field label="Name">
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. location-scouting" autoFocus maxLength={40} />
      </Field>
      <Field label="Topic">
        <input type="text" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} maxLength={200} />
      </Field>
      <Field label="Category">
        <input type="text" list="categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={40} />
        <datalist id="categories">{existingCategories.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} />
        Private channel (only selected roles can see it)
      </label>
      {form.isPrivate && (
        <Field label="Roles with access" hint="Administrators can always see every channel.">
          <div className="chips">
            {roles.map((r) => (
              <button
                type="button"
                key={r.id}
                className={`chip ${form.roleIds.includes(r.id) ? "active" : ""}`}
                onClick={() => setForm({ ...form, roleIds: form.roleIds.includes(r.id) ? form.roleIds.filter((x) => x !== r.id) : [...form.roleIds, r.id] })}
              >
                <i className="dot" style={{ background: r.color }} /> {r.name}
              </button>
            ))}
          </div>
        </Field>
      )}
    </Modal>
  );
}
