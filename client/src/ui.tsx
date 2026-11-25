import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { initials } from "./lib";
import type { MiniUser } from "./types";

// ─── Toasts ──────────────────────────────────────────────────────────────

interface ToastItem {
  id: number;
  text: string;
  detail?: string;
  kind: "info" | "error" | "success";
}

type ToastFn = (text: string, kind?: ToastItem["kind"], detail?: string) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback<ToastFn>((text, kind = "info", detail) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-3), { id, text, kind, detail }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === "error" ? 6000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────

/** Latest photo version per member, so a changed photo shows up everywhere without a reload. */
export const AvatarVersions = createContext<Map<string, string | null>>(new Map());

export function Avatar({
  user,
  size = 36,
  online,
}: {
  user: Pick<MiniUser, "displayName" | "avatarColor"> & Partial<Pick<MiniUser, "id" | "avatarUpdatedAt">>;
  size?: number;
  online?: boolean;
}) {
  const versions = useContext(AvatarVersions);
  const version = user.id && versions.has(user.id) ? versions.get(user.id) : user.avatarUpdatedAt;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [version]);
  const src = user.id && version && !failed ? `/api/avatars/${user.id}?v=${encodeURIComponent(version)}` : null;
  return (
    <span className="avatar" style={{ width: size, height: size, background: user.avatarColor, fontSize: size * 0.4 }} aria-hidden>
      {src ? <img src={src} alt="" onError={() => setFailed(true)} draggable={false} /> : initials(user.displayName)}
      {online !== undefined && <span className={`presence ${online ? "on" : ""}`} />}
    </span>
  );
}

/** Everyone taking part in a production, as name chips with their photo and job title. */
export function Participants({ members }: { members: { userId: string; jobTitle: string | null; user: MiniUser }[] }) {
  if (members.length === 0) return <span className="muted small">No participants yet</span>;
  return (
    <div className="chips participants">
      {members.map((m) => (
        <span key={m.userId} className="chip" title={m.jobTitle ?? undefined}>
          <Avatar user={m.user} size={22} />
          {m.user.displayName}
          {m.jobTitle && <span className="muted small">· {m.jobTitle}</span>}
        </span>
      ))}
    </div>
  );
}

export function Badge({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <span className="badge" style={color ? { background: `${color}26`, color, borderColor: `${color}55` } : undefined}>
      {children}
    </span>
  );
}

export function RoleChip({ role }: { role: { name: string; color: string } }) {
  return (
    <span className="role-chip">
      <i style={{ background: role.color }} />
      {role.name}
    </span>
  );
}

export function Button({
  variant = "default",
  small,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost"; small?: boolean }) {
  return (
    <button {...rest} className={`btn ${variant} ${small ? "small" : ""} ${rest.className ?? ""}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Spinner() {
  return <div className="spinner" role="progressbar" aria-label="Loading" />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="page-actions">{actions}</div>
    </header>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Pick several members, shown as toggleable chips. */
export function MemberPicker({
  users,
  value,
  onChange,
}: {
  users: { id: string; displayName: string; avatarColor: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="chips">
      {users.map((u) => (
        <button type="button" key={u.id} className={`chip ${value.includes(u.id) ? "active" : ""}`} onClick={() => toggle(u.id)}>
          <Avatar user={u} size={18} />
          {u.displayName}
        </button>
      ))}
    </div>
  );
}
