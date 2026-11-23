export interface MiniUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
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
  email?: string;
  phone?: string | null;
  bio?: string | null;
  status?: "ACTIVE" | "DISABLED";
  isOwner?: boolean;
  createdAt?: string;
  lastSeenAt?: string | null;
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
  editedAt: string | null;
  createdAt: string;
  attachments: Attachment[];
  reactions: { emoji: string; userIds: string[] }[];
  replyTo: { id: string; author: string; content: string; deleted: boolean } | null;
}

export type ProductionStatus = "DEVELOPMENT" | "PRE_PRODUCTION" | "PRODUCTION" | "POST_PRODUCTION" | "DELIVERED" | "ARCHIVED";

export interface Production {
  id: string;
  title: string;
  client: string | null;
  kind: string;
  status: ProductionStatus;
  description: string | null;
  location: string | null;
  budget: number | null;
  color: string;
  startDate: string | null;
  endDate: string | null;
  deliveryDate: string | null;
  createdById: string;
  members: { userId: string; jobTitle: string | null; user: MiniUser }[];
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
