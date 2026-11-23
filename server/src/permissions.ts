export interface PermissionInfo {
  key: string;
  label: string;
  description: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionInfo[] = [
  { key: "admin", label: "Administrator", description: "Full access to everything. Grant sparingly.", group: "General" },
  { key: "members.manage", label: "Manage members", description: "Change member roles, titles and disable accounts.", group: "General" },
  { key: "roles.manage", label: "Manage roles", description: "Create, edit and delete roles and their permissions.", group: "General" },
  { key: "invites.manage", label: "Manage invites", description: "Create and revoke invite codes.", group: "General" },
  { key: "channels.manage", label: "Manage channels", description: "Create, edit and delete chat channels.", group: "Chat" },
  { key: "messages.send", label: "Send messages", description: "Post messages and reactions in channels they can see.", group: "Chat" },
  { key: "messages.moderate", label: "Moderate messages", description: "Delete or pin anyone's messages.", group: "Chat" },
  { key: "files.upload", label: "Upload files", description: "Attach files to chat messages.", group: "Chat" },
  { key: "productions.create", label: "Create productions", description: "Start new productions/projects.", group: "Productions" },
  { key: "productions.manage", label: "Manage productions", description: "Edit any production, its team and see budgets.", group: "Productions" },
  { key: "tasks.manage", label: "Manage tasks", description: "Create, assign and edit any task.", group: "Work" },
  { key: "events.manage", label: "Manage calendar", description: "Create and edit shoots, meetings and deadlines.", group: "Work" },
  { key: "announcements.post", label: "Post announcements", description: "Publish and edit announcements.", group: "Work" },
  { key: "documents.create", label: "Create documents", description: "Create and import production documents.", group: "Documents" },
  { key: "documents.edit", label: "Edit any document", description: "Edit documents created by other people.", group: "Documents" },
  { key: "documents.delete", label: "Delete documents", description: "Delete any document.", group: "Documents" },
  { key: "documents.sensitive", label: "View budgets & contracts", description: "See budget and contract documents.", group: "Documents" },
];

export const ALL_PERMISSION_KEYS = new Set(PERMISSION_CATALOG.map((p) => p.key));

export interface DefaultRole {
  name: string;
  color: string;
  position: number;
  isDefault?: boolean;
  permissions: string[];
}

const everythingButAdmin = PERMISSION_CATALOG.map((p) => p.key).filter((k) => k !== "admin" && k !== "roles.manage");

export const DEFAULT_ROLES: DefaultRole[] = [
  { name: "Admin", color: "#ed4245", position: 100, permissions: ["admin"] },
  { name: "Producer", color: "#f0b232", position: 80, permissions: everythingButAdmin },
  {
    name: "Department Head",
    color: "#3ba55d",
    position: 60,
    permissions: [
      "messages.send", "files.upload", "tasks.manage", "events.manage", "announcements.post",
      "documents.create", "documents.edit", "channels.manage",
    ],
  },
  {
    name: "Crew",
    color: "#5865f2",
    position: 40,
    isDefault: true,
    permissions: ["messages.send", "files.upload", "documents.create"],
  },
  { name: "Client / Guest", color: "#99aab5", position: 10, permissions: ["messages.send"] },
];

export interface PermissionSubject {
  isOwner: boolean;
  roles: { permissions: string[] }[];
}

export function permissionsFor(user: PermissionSubject): Set<string> {
  if (user.isOwner) return new Set(ALL_PERMISSION_KEYS);
  const set = new Set<string>();
  for (const role of user.roles) for (const p of role.permissions) set.add(p);
  if (set.has("admin")) return new Set(ALL_PERMISSION_KEYS);
  return set;
}
