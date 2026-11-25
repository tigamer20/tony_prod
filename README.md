# Tony Prod

A production hub for a video production team: accounts with roles and permissions, Discord-style chat,
calendar, productions, tasks, announcements, and documents with import and export.

## Features

- **Accounts & access** – the first account becomes the workspace owner. After that, admins (anyone allowed to manage
  members) create accounts right in the app with just a username (email is optional), or share an invite link.
  New members get a temporary password and must choose their own on first sign-in. Admins can reset a forgotten
  password, which also signs that member out everywhere. Managers see each member's last login, and accounts that
  haven't signed in yet are marked "Pending". Custom roles with fine-grained permissions, disabled
  accounts, and profile photos (cropped and shrunk in the browser, stored in the database). Admins can delete an
  account for good: the member's messages, documents and other work stay, credited to "Deleted user". The owner
  and your own account can't be deleted, and only administrators can delete administrators.
- **Chat** – channels grouped by category, private channels limited to chosen roles, direct messages, replies,
  reactions, edits, pins, file/image attachments up to 10 MB (drag & drop or paste), typing indicators, unread badges,
  online presence, message search. Messages arrive live over WebSockets. Individual messages, whole channels (managers)
  and direct messages (either person) can be deleted; on a phone, tap a message to reveal its actions.
  Type `@` to mention someone (with autocomplete). Members with the "Mention everyone" permission (Producer and
  Department Head by default) can use `@everyone` to notify everyone who can see the channel.
- **Calendar** – month and agenda views, event types (shoot, meeting, scout, review, deadline, delivery), attendees
  with accept/decline, per-production filter, `.ics` export for Google/Apple/Outlook.
- **Productions** – one per video: status pipeline, shoot date, shoot end date, target release date, location, team,
  budget (hidden from people without access), and an
  auto-created chat channel per production.
- **Tasks** – drag-and-drop board (To do / In progress / In review / Done) with priorities, due dates and assignees.
- **Announcements** – priorities, pinning, read receipts, live toast notifications.
- **Documents** – rich-text editor with tables, autosave, version history and restore, templates (call sheet,
  shot list, script, treatment, schedule, budget, meeting notes). **Import** `.docx`, `.md`, `.txt`.
  **Export** to Word (`.docx`), PDF, Markdown and plain text. Budget and contract documents are restricted by permission.
  Type `@` in a document to mention a teammate who can open it.
- **Mentions** – anyone mentioned in chat or in a document gets a live pop-up and an entry in the Mentions section
  of their Home dashboard (with an unread badge). Opening the channel or clicking the entry marks it read.

## Roles & permissions

Default roles: **Admin**, **Producer**, **Department Head**, **Crew** (default for new members), **Client / Guest**.
Roles are fully editable under *Team → Roles & permissions*. Available permissions: administrator, manage
members/roles/invites/channels, send/moderate messages, upload files, create/manage productions, manage tasks,
manage calendar, post announcements, create/edit/delete documents, view budgets & contracts.
The workspace owner always has every permission.

## Run it locally

Requirements: Node 20+, Docker (for the local Postgres).

```powershell
npm install
npm run db:up                      # starts Postgres on localhost:5433
copy .env.example server\.env      # then set JWT_SECRET (see the file for a one-liner)
npm run db:migrate                 # creates the tables
npm run db:seed                    # optional: demo members, production, tasks, events (local only)
npm run dev                        # API on :4000, web app on :5173
```

Open http://localhost:5173. On a fresh database the first account you create becomes the owner.
Demo members from the seed: `maya` (Producer), `leo` (Department Head), `sam` (Crew), `nina` (Client / Guest);
the seed script prints their shared demo password. Never run the seed in production (it refuses to).

## Deploy

`npm run build` compiles the server and the client. In production the API also serves the built web app, so a single
Node service is enough (for example Render): build command `npm install && npm run build`, start command
`npm run start`. Set `DATABASE_URL` (a Neon connection string works), a long random `JWT_SECRET`, and
`NODE_ENV=production`. Chat attachments are stored in the database (10 MB per file, 300 MB in total by default; change
the total with `UPLOAD_STORAGE_LIMIT_MB`), so they survive hosts with ephemeral disks such as Render's free plan.
Neon's free plan holds 0.5 GB for everything, so for large video files move uploads to object storage instead.

## Layout

```
server/   Express + Socket.IO API, Prisma schema (PostgreSQL), document import/export
client/   React + Vite web app, Tiptap editor
```

## Known limits

- Real-time co-editing of a document is not supported. Autosave protects against overwrites: if someone else saves
  first you are warned and asked to reload.
- Images inside imported Word files are not carried over (text, headings, lists and tables are).
- PDF export uses built-in fonts, so characters outside Latin-1 (for example emoji) print as `?`.
- Prisma's CLI tooling currently reports advisories in its own dev dependencies; they do not run in the web server.
