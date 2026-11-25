import { format, isSameDay, isToday, isYesterday } from "date-fns";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** ISO string -> value for <input type="datetime-local"> in local time. */
export const toLocalInput = (iso: string | Date | null | undefined) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "");
export const toDateInput = (iso: string | Date | null | undefined) => (iso ? format(new Date(iso), "yyyy-MM-dd") : "");
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
export const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

export function formatMessageTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return `Today at ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, "HH:mm")}`;
  return format(d, "yyyy-MM-dd HH:mm");
}

export const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE, MMMM d, yyyy");
};

export { isSameDay };

export const fileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export const money = (n: number | null) =>
  n == null ? "-" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

export const STATUS_LABEL: Record<string, string> = {
  DEVELOPMENT: "Development",
  PRE_PRODUCTION: "Pre-production",
  PRODUCTION: "In production",
  POST_PRODUCTION: "Post-production",
  DELIVERED: "Delivered",
  ARCHIVED: "Archived",
};

export const STATUS_COLOR: Record<string, string> = {
  DEVELOPMENT: "#99aab5",
  PRE_PRODUCTION: "#f0b232",
  PRODUCTION: "#ed4245",
  POST_PRODUCTION: "#5865f2",
  DELIVERED: "#3ba55d",
  ARCHIVED: "#80848e",
};

export const EVENT_TYPES: Record<string, { label: string; color: string }> = {
  SHOOT: { label: "Shoot", color: "#ed4245" },
  MEETING: { label: "Meeting", color: "#5865f2" },
  SCOUT: { label: "Location scout", color: "#3ba55d" },
  REVIEW: { label: "Review", color: "#f0b232" },
  DEADLINE: { label: "Deadline", color: "#eb459e" },
  DELIVERY: { label: "Delivery", color: "#1abc9c" },
  OTHER: { label: "Other", color: "#99aab5" },
};

export const DOC_TYPES: Record<string, string> = {
  SCRIPT: "Script",
  CALL_SHEET: "Call sheet",
  SHOT_LIST: "Shot list",
  TREATMENT: "Treatment",
  SCHEDULE: "Schedule",
  BUDGET: "Budget",
  CONTRACT: "Contract",
  NOTES: "Notes",
  OTHER: "Other",
};

export const PRIORITY_COLOR: Record<string, string> = {
  LOW: "#99aab5",
  MEDIUM: "#5865f2",
  HIGH: "#f0b232",
  URGENT: "#ed4245",
};

/** Readable random password without look-alike characters (no 0/O, 1/l/I). */
export function generatePassword(length = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** "Maya Chen" -> "maya.chen", for suggesting a username. */
export const suggestUsername = (displayName: string) =>
  displayName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24);

/** Center-crops an image to a square and shrinks it, so profile photos stay tiny (a few KB). */
export async function resizeAvatar(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const toBlob = (type: string, quality: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  const webp = await toBlob("image/webp", 0.88);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg", 0.88);
  if (!jpeg) throw new Error("Could not process that image.");
  return jpeg;
}
