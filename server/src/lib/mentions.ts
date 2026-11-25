import type { MentionableUser } from "../access.js";

/** The @handles in a chat message, lower-cased. An email address like a@b.com is not a mention. */
export function extractHandles(content: string): string[] {
  const found = new Set<string>();
  for (const m of content.matchAll(/(?:^|[^\w@])@([a-z0-9_.-]{3,24})/gi)) found.add(m[1]!.toLowerCase());
  return [...found];
}

/** "@maya." at the end of a sentence still means maya: trim trailing punctuation until a name matches. */
function resolveHandle(handle: string, byUsername: Map<string, MentionableUser>): MentionableUser | "everyone" | null {
  let h = handle;
  while (h.length >= 3) {
    if (h === "everyone") return "everyone";
    const user = byUsername.get(h);
    if (user) return user;
    if (/[.\-_]$/.test(h)) h = h.slice(0, -1);
    else break;
  }
  return null;
}

export interface ChatMentions {
  /** People named directly (never the author, never someone who can't see the channel). */
  named: string[];
  /** People reached only through @everyone. */
  everyoneIds: string[];
  /** The message used @everyone and the author was allowed to. */
  everyone: boolean;
}

/** `audience` is everyone who can see the channel, so people without access are never notified. */
export function chatMentions(content: string, audience: MentionableUser[], authorId: string, canEveryone: boolean): ChatMentions {
  const byUsername = new Map(audience.map((u) => [u.username.toLowerCase(), u]));
  const named = new Set<string>();
  let everyone = false;
  for (const handle of extractHandles(content)) {
    const hit = resolveHandle(handle, byUsername);
    if (hit === "everyone") everyone = canEveryone || everyone;
    else if (hit && hit.id !== authorId) named.add(hit.id);
  }
  const everyoneIds = everyone ? audience.filter((u) => u.id !== authorId && !named.has(u.id)).map((u) => u.id) : [];
  return { named: [...named], everyoneIds, everyone };
}

/** The ids of every @mention node in a document's editor content. */
export function documentMentionIds(content: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; attrs?: { id?: unknown }; content?: unknown };
    if (n.type === "mention" && typeof n.attrs?.id === "string") ids.add(n.attrs.id);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return [...ids];
}
