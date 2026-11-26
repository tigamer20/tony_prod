export interface MiniUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  /** When the profile photo was last set; null/undefined means no photo. */
  avatarUpdatedAt?: string | null;
}

export interface RoleBrief {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface Member extends MiniUser {
  jobTitle: string | null;
  roles: RoleBrief[];
  email?: string | null;
  mustChangePassword?: boolean;
  phone?: string | null;
  bio?: string | null;
  status?: "ACTIVE" | "DISABLED";
  isOwner?: boolean;
  createdAt?: string;
  lastSeenAt?: string | null;
  /** Most recent sign-in; null means the member has never signed in ("Pending"). Managers only. */
  lastLoginAt?: string | null;
}

export interface Role {
  id: string;
  name: string;
  color: string;
  permissions: string[];
  position: number;
  isDefault: boolean;
  isSystem: boolean;
  _count?: { users: number };
}

export interface PermissionInfo {
  key: string;
  label: string;
  description: string;
  group: string;
}

export interface Invite {
  id: string;
  code: string;
  email: string | null;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  role: { id: string; name: string; color: string } | null;
  createdBy: { displayName: string };
}

export interface Channel {
  id: string;
  name: string;
  topic: string | null;
  type: "TEXT" | "DM";
  category: string;
  position: number;
  isPrivate: boolean;
  productionId: string | null;
  allowedRoleIds: string[];
  unread: number;
  dmUser: MiniUser | null;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface Message {
  id: string;
  channelId: string;
  author: MiniUser;
  content: string;
  deleted: boolean;
  pinned: boolean;
  /** The author used @everyone and was allowed to, so it notified the channel. */
  mentionsEveryone: boolean;
  editedAt: string | null;
  createdAt: string;
  attachments: Attachment[];
  reactions: { emoji: string; userIds: string[] }[];
  replyTo: { id: string; author: string; content: string; deleted: boolean } | null;
}

export type ProductionStatus = "DEVELOPMENT" | "PRE_PRODUCTION" | "PRODUCTION" | "POST_PRODUCTION" | "DELIVERED" | "ARCHIVED";

/** Someone who appears in the video. May be linked to an account, or just a name. */
export type EquipmentStatus = "NEEDED" | "SECURED" | "PACKED" | "RETURNED";

export interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  status: EquipmentStatus;
  source: string | null;
  notes: string | null;
}

export interface ProductionParticipant {
  id: string;
  name: string;
  role: string | null;
  user: MiniUser | null;
}

export interface Production {
  id: string;
  title: string;
  status: ProductionStatus;
  description: string | null;
  location: string | null;
  budget: number | null;
  color: string;
  /** First day of filming. */
  shootDate: string | null;
  /** Last day of filming. */
  shootEndDate: string | null;
  /** The date the video should come out. */
  releaseDate: string | null;
  createdById: string;
  members: { userId: string; jobTitle: string | null; user: MiniUser }[];
  /** The people in the video (in front of the camera), as opposed to the crew in `members`. */
  participants: ProductionParticipant[];
  channels: { id: string; name: string }[];
  _count: { tasks: number; documents: number; events: number };
}

export type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  productionId: string | null;
  production: { id: string; title: string; color: string } | null;
  assigneeId: string | null;
  assignee: MiniUser | null;
  createdBy: MiniUser;
}

export type EventType = "SHOOT" | "MEETING" | "SCOUT" | "REVIEW" | "DEADLINE" | "DELIVERY" | "OTHER";
export type Rsvp = "PENDING" | "ACCEPTED" | "DECLINED";

export interface CalEvent {
  id: string;
  title: string;
  description: string | null;
  type: EventType;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  productionId: string | null;
  production: { id: string; title: string; color: string } | null;
  attendees: { userId: string; status: Rsvp; user: MiniUser }[];
  createdBy: MiniUser;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: "NORMAL" | "IMPORTANT" | "URGENT";
  pinned: boolean;
  productionId: string | null;
  production: { id: string; title: string; color: string } | null;
  author: MiniUser;
  createdAt: string;
  read: boolean;
  readCount: number;
}

export type DocType = "SCRIPT" | "CALL_SHEET" | "SHOT_LIST" | "TREATMENT" | "SCHEDULE" | "BUDGET" | "CONTRACT" | "NOTES" | "OTHER";

export interface DocListItem {
  id: string;
  title: string;
  type: DocType;
  productionId: string | null;
  production: { id: string; title: string; color: string } | null;
  createdBy: MiniUser;
  updatedBy: MiniUser;
  createdAt: string;
  updatedAt: string;
}

export interface DocDetail extends DocListItem {
  content: Record<string, unknown>;
}

export interface DocTemplate {
  key: string;
  title: string;
  type: DocType;
  description: string;
}

/** A "someone mentioned you" entry on the dashboard. */
export interface MentionItem {
  id: string;
  kind: "message" | "document";
  /** Reached through @everyone rather than by name. */
  everyone: boolean;
  createdAt: string;
  readAt: string | null;
  by: MiniUser;
  channel: { id: string; name: string; type: "TEXT" | "DM" } | null;
  snippet: string | null;
  document: { id: string; title: string } | null;
}
