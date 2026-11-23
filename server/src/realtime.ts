import type { Server as HttpServer } from "node:http";
import { parse as parseCookie } from "cookie";
import { Server } from "socket.io";
import { canAccessChannel } from "./access.js";
import { COOKIE_NAME, loadAuthUser, verifyToken, type AuthUser } from "./auth.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

let io: Server | null = null;
const online = new Map<string, number>(); // userId -> open socket count

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: config.clientOrigin, credentials: true },
    maxHttpBufferSize: 1e6,
  });

  io.use(async (socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? "");
    const token = verifyToken(cookies[COOKIE_NAME]);
    const user = token ? await loadAuthUser(token.sub, token.iat) : null;
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;
    socket.join(`user:${user.id}`);
    online.set(user.id, (online.get(user.id) ?? 0) + 1);
    if (online.get(user.id) === 1) io!.emit("presence", { userId: user.id, online: true });
    socket.emit("presence:list", [...online.keys()]);

    socket.on("subscribe", async (channelIds: unknown) => {
      if (!Array.isArray(channelIds)) return;
      for (const id of channelIds.slice(0, 500)) {
        if (typeof id !== "string") continue;
        if (await canAccessChannel(user, id)) socket.join(`channel:${id}`);
      }
    });

    socket.on("typing", async (channelId: unknown) => {
      if (typeof channelId !== "string" || !socket.rooms.has(`channel:${channelId}`)) return;
      socket.to(`channel:${channelId}`).emit("typing", {
        channelId,
        user: { id: user.id, displayName: user.displayName },
      });
    });

    socket.on("disconnect", () => {
      const left = (online.get(user.id) ?? 1) - 1;
      if (left <= 0) {
        online.delete(user.id);
        io!.emit("presence", { userId: user.id, online: false });
        prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      } else {
        online.set(user.id, left);
      }
    });
  });
}

export const isOnline = (userId: string) => online.has(userId);
export const onlineUserIds = () => [...online.keys()];

export function emitToChannel(channelId: string, event: string, payload: unknown) {
  io?.to(`channel:${channelId}`).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  for (const id of userIds) io?.to(`user:${id}`).emit(event, payload);
}

export function emitAll(event: string, payload: unknown) {
  io?.emit(event, payload);
}

/** Make a user's live sockets join a channel (used after creating a DM or granting access). */
export function joinUsersToChannel(userIds: string[], channelId: string) {
  for (const id of userIds) io?.in(`user:${id}`).socketsJoin(`channel:${channelId}`);
}
