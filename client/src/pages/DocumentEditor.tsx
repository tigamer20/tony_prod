import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  ChevronDown,
  Code2,
  Download,
  Highlighter,
  History,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Printer,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { api, ApiError, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { editorExtensions } from "../editorExtensions";
import { DOC_TYPES } from "../lib";
import type { DocDetail, DocType, MiniUser } from "../types";
import { Avatar, Button, Empty, Modal, Spinner, useToast } from "../ui";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export function DocumentEditor() {
  const { id } = useParams();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setDoc(null);
    setMissing(false);
    api.get<DocDetail>(`/documents/${id}`).then(setDoc).catch(() => setMissing(true));
  }, [id]);

  if (missing) return <div className="content"><Empty title="Document not found">It may have been deleted, or you may not have access. <Link to="/documents">Back to documents</Link></Empty></div>;
  if (!doc) return <Spinner />;
  return <Editor key={doc.id} initial={doc} />;
}

function Editor({ initial }: { initial: DocDetail }) {
  const { me, can } = useAuth();
  const { productions, userById } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const canEdit = initial.createdBy.id === me!.id || can("documents.edit");
  const canDelete = initial.createdBy.id === me!.id || can("documents.delete");

  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState<DocType>(initial.type);
  const [productionId, setProductionId] = useState(initial.productionId ?? "");
  const [meta, setMeta] = useState({ updatedBy: initial.updatedBy, updatedAt: initial.updatedAt });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [showVersions, setShowVersions] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const updatedAtRef = useRef(initial.updatedAt);
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const saving = useRef(false);
  const latest = useRef({ title, type, productionId });
  latest.current = { title, type, productionId };

  // @mention autocomplete: people who can open this document, and the "@query" being typed at the cursor.
  const [mentionUsers, setMentionUsers] = useState<MiniUser[]>([]);
  const [suggest, setSuggest] = useState<{ from: number; to: number; query: string; left: number; top: number; bottom: number } | null>(null);
  const [suggestIndex, setSuggestIndex] = useState(0);
  // The editor is created once, so its callbacks read the latest logic through refs.
  const detectRef = useRef<(ed: TiptapEditor) => void>(() => {});
  const keyRef = useRef<(e: KeyboardEvent) => boolean>(() => false);

  const editor = useEditor({
    extensions: [...editorExtensions, Placeholder.configure({ placeholder: "Start writing..." })],
    content: initial.content,
    editable: canEdit,
    onUpdate: ({ editor: ed }) => {
      markDirty();
      detectRef.current(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => detectRef.current(ed),
    editorProps: { handleKeyDown: (_view, event) => keyRef.current(event) },
  });

  useEffect(() => {
    if (!canEdit) return;
    api.get<{ users: MiniUser[] }>(`/documents/${initial.id}/mentionable`).then((r) => setMentionUsers(r.users)).catch(() => {});
  }, [canEdit, initial.id]);

  const options = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase();
    const matches = mentionUsers.filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
    matches.sort((a, b) => Number(b.username.toLowerCase().startsWith(q)) - Number(a.username.toLowerCase().startsWith(q)));
    return matches.slice(0, 7);
  }, [suggest?.query, mentionUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  detectRef.current = (ed) => {
    const { $from, empty } = ed.state.selection;
    if (!canEdit || !empty) return setSuggest(null);
    // Text before the cursor in this paragraph; ￼ stands in for inline items such as an earlier mention.
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const m = /(^|[\s￼])@([^\s@]{0,24})$/.exec(before);
    if (!m) return setSuggest(null);
    const to = $from.pos;
    const coords = ed.view.coordsAtPos(to);
    setSuggest((prev) => {
      if (!prev || prev.query !== m[2]) setSuggestIndex(0);
      return { from: to - m[2]!.length - 1, to, query: m[2]!, left: coords.left, top: coords.top, bottom: coords.bottom };
    });
  };

  keyRef.current = (event) => {
    if (!suggest || options.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setSuggestIndex((i) => (i + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      pickMention(options[suggestIndex] ?? options[0]!);
      return true;
    }
    if (event.key === "Escape") {
      setSuggest(null);
      return true;
    }
    return false;
  };

  function pickMention(user: MiniUser) {
    if (!suggest || !editor) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: suggest.from, to: suggest.to }, [{ type: "mention", attrs: { id: user.id, label: user.displayName } }, { type: "text", text: " " }])
      .run();
    setSuggest(null);
  }

  const save = useCallback(async () => {
    if (!editor || saving.current || !dirtyRef.current) return;
    saving.current = true;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      const l = latest.current;
      const updated = await api.patch<DocDetail>(`/documents/${initial.id}`, {
        title: l.title.trim() || "Untitled document",
        type: l.type,
        productionId: l.productionId || null,
        content: editor.getJSON(),
        expectedUpdatedAt: updatedAtRef.current,
      });
      updatedAtRef.current = updated.updatedAt;
      setMeta({ updatedBy: updated.updatedBy, updatedAt: updated.updatedAt });
      setSaveState(dirtyRef.current ? "dirty" : "saved");
    } catch (e) {
      dirtyRef.current = true;
      setSaveState(e instanceof ApiError && e.status === 409 ? "conflict" : "error");
      if (!(e instanceof ApiError && e.status === 409)) toast(errMsg(e), "error");
    } finally {
      saving.current = false;
      if (dirtyRef.current && !timer.current) schedule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, initial.id, toast]);

  function schedule() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void save();
    }, 1200);
  }

  function markDirty() {
    if (!canEdit) return;
    dirtyRef.current = true;
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
    schedule();
  }

  // Warn before leaving with unsaved work, and flush on unmount.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timer.current);
      if (dirtyRef.current) void save();
    };
  }, [save]);

  // Pull in changes made by someone else (only if we have nothing unsaved).
  useSocketEvent<{ id?: string }>("documents:changed", async (p) => {
    if (p?.id !== initial.id || dirtyRef.current || saving.current) return;
    try {
      const fresh = await api.get<DocDetail>(`/documents/${initial.id}`);
      if (fresh.updatedAt === updatedAtRef.current) return;
      updatedAtRef.current = fresh.updatedAt;
      editor?.commands.setContent(fresh.content, { emitUpdate: false });
      setTitle(fresh.title);
      setType(fresh.type);
      setMeta({ updatedBy: fresh.updatedBy, updatedAt: fresh.updatedAt });
      toast(`${fresh.updatedBy.displayName} updated this document.`, "info");
    } catch {
      /* ignore */
    }
  });

  async function remove() {
    if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
    try {
      dirtyRef.current = false;
      await api.del(`/documents/${initial.id}`);
      navigate("/documents");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  const stateLabel: Record<SaveState, string> = {
    saved: "All changes saved",
    dirty: "Unsaved changes...",
    saving: "Saving...",
    error: "Save failed, retrying",
    conflict: "Edit conflict",
  };

  return (
    <div className="doc-layout">
      <div className="doc-top">
        <Link to="/documents" className="icon-btn" aria-label="Back to documents"><ArrowLeft size={18} /></Link>
        <input
          className="doc-title"
          type="text"
          value={title}
          readOnly={!canEdit}
          onChange={(e) => { setTitle(e.target.value); markDirty(); }}
          aria-label="Document title"
          maxLength={160}
        />
        <select style={{ width: "auto" }} value={type} disabled={!canEdit} onChange={(e) => { setType(e.target.value as DocType); markDirty(); }} aria-label="Document type">
          {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ width: "auto", maxWidth: 180 }} value={productionId} disabled={!canEdit} onChange={(e) => { setProductionId(e.target.value); markDirty(); }} aria-label="Production">
          <option value="">No production</option>
          {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <span className="save-state" role="status">{canEdit ? stateLabel[saveState] : "View only"}</span>
        <span style={{ flex: 1 }} />
        <span className="muted small" title={format(new Date(meta.updatedAt), "PPpp")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Avatar user={userById(meta.updatedBy.id) ?? meta.updatedBy} size={18} /> {format(new Date(meta.updatedAt), "MMM d, HH:mm")}
        </span>
        <div className="menu">
          <Button small onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>
            <Download size={15} /> Export <ChevronDown size={14} />
          </Button>
          {exportOpen && (
            <div className="menu-pop" onMouseLeave={() => setExportOpen(false)}>
              {[["docx", "Word (.docx)"], ["pdf", "PDF"], ["md", "Markdown (.md)"], ["txt", "Plain text (.txt)"]].map(([f, label]) => (
                <a key={f} href={`/api/documents/${initial.id}/export?format=${f}`} download onClick={() => setExportOpen(false)}>{label}</a>
              ))}
            </div>
          )}
        </div>
        <Button small variant="ghost" onClick={() => window.print()} aria-label="Print"><Printer size={15} /></Button>
        <Button small variant="ghost" onClick={() => setShowVersions(true)}><History size={15} /> History</Button>
        {canDelete && <Button small variant="danger" onClick={remove}>Delete</Button>}
      </div>

      {saveState === "conflict" && (
        <div className="error-text" style={{ margin: 0, padding: "8px 20px", background: "#ed424522" }} role="alert">
          Someone else changed this document while you were editing. Your edits are still on screen but were not saved.{" "}
          <button className="btn small" onClick={() => window.location.reload()}>Reload latest version</button>
        </div>
      )}

      {canEdit && <Toolbar editor={editor} />}

      <div className="doc-scroll">
        <div className={`paper ${canEdit ? "" : "readonly"}`}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {suggest && options.length > 0 && (
        <div
          className="suggest floating"
          role="listbox"
          aria-label="Mention suggestions"
          style={{
            left: Math.max(8, Math.min(suggest.left, window.innerWidth - 336)),
            ...(window.innerHeight - suggest.bottom < 280 ? { bottom: window.innerHeight - suggest.top + 6 } : { top: suggest.bottom + 6 }),
          }}
        >
          <div className="suggest-head">Mention someone</div>
          {options.map((u, i) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={i === suggestIndex}
              className={`suggest-item ${i === suggestIndex ? "active" : ""}`}
              // mousedown (not click) so the editor keeps focus and the cursor position.
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(u);
              }}
              onMouseEnter={() => setSuggestIndex(i)}
            >
              <Avatar user={u} size={26} />
              <span className="grow ellipsis">
                <b>{u.displayName}</b> <span className="muted">@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {showVersions && (
        <VersionsModal
          docId={initial.id}
          canRestore={canEdit}
          onClose={() => setShowVersions(false)}
          onRestored={(d) => {
            dirtyRef.current = false;
            updatedAtRef.current = d.updatedAt;
            editor?.commands.setContent(d.content, { emitUpdate: false });
            setTitle(d.title);
            setMeta({ updatedBy: d.updatedBy, updatedAt: d.updatedAt });
            setSaveState("saved");
            setShowVersions(false);
            toast("Version restored.", "success");
          }}
        />
      )}
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────────────

function Toolbar({ editor }: { editor: TiptapEditor | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
            highlight: e.isActive("highlight"), code: e.isActive("codeBlock"), quote: e.isActive("blockquote"),
            bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), link: e.isActive("link"),
            h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
            left: e.isActive({ textAlign: "left" }), center: e.isActive({ textAlign: "center" }), right: e.isActive({ textAlign: "right" }),
            inTable: e.isActive("table"), canUndo: e.can().undo(), canRedo: e.can().redo(),
          }
        : null,
  });
  if (!editor || !s) return <div className="toolbar" />;
  const chain = () => editor.chain().focus();

  const Btn = ({ on, label, run, disabled, children }: { on?: boolean; label: string; run: () => void; disabled?: boolean; children: React.ReactNode }) => (
    <button type="button" className={`tb-btn ${on ? "on" : ""}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {children}
    </button>
  );

  function setLink() {
    const prev = editor!.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address (https://...)", prev ?? "https://");
    if (url === null) return;
    if (url === "") return void chain().unsetLink().run();
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return void window.alert("Links must start with http://, https:// or mailto:");
    chain().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="Undo" run={() => chain().undo().run()} disabled={!s.canUndo}><Undo2 size={16} /></Btn>
      <Btn label="Redo" run={() => chain().redo().run()} disabled={!s.canRedo}><Redo2 size={16} /></Btn>
      <span className="tb-sep" />
      <Btn label="Heading 1" on={s.h1} run={() => chain().toggleHeading({ level: 1 }).run()}>H1</Btn>
      <Btn label="Heading 2" on={s.h2} run={() => chain().toggleHeading({ level: 2 }).run()}>H2</Btn>
      <Btn label="Heading 3" on={s.h3} run={() => chain().toggleHeading({ level: 3 }).run()}>H3</Btn>
      <span className="tb-sep" />
      <Btn label="Bold" on={s.bold} run={() => chain().toggleBold().run()}><Bold size={16} /></Btn>
      <Btn label="Italic" on={s.italic} run={() => chain().toggleItalic().run()}><Italic size={16} /></Btn>
      <Btn label="Underline" on={s.underline} run={() => chain().toggleUnderline().run()}><UnderlineIcon size={16} /></Btn>
      <Btn label="Strikethrough" on={s.strike} run={() => chain().toggleStrike().run()}><Strikethrough size={16} /></Btn>
      <Btn label="Highlight" on={s.highlight} run={() => chain().toggleHighlight().run()}><Highlighter size={16} /></Btn>
      <Btn label="Link" on={s.link} run={setLink}><Link2 size={16} /></Btn>
      <span className="tb-sep" />
      <Btn label="Bulleted list" on={s.bullet} run={() => chain().toggleBulletList().run()}><List size={16} /></Btn>
      <Btn label="Numbered list" on={s.ordered} run={() => chain().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
      <Btn label="Quote" on={s.quote} run={() => chain().toggleBlockquote().run()}><Quote size={16} /></Btn>
      <Btn label="Code block" on={s.code} run={() => chain().toggleCodeBlock().run()}><Code2 size={16} /></Btn>
      <Btn label="Divider" run={() => chain().setHorizontalRule().run()}><Minus size={16} /></Btn>
      <span className="tb-sep" />
      <Btn label="Align left" on={s.left} run={() => chain().setTextAlign("left").run()}><AlignLeft size={16} /></Btn>
      <Btn label="Align center" on={s.center} run={() => chain().setTextAlign("center").run()}><AlignCenter size={16} /></Btn>
      <Btn label="Align right" on={s.right} run={() => chain().setTextAlign("right").run()}><AlignRight size={16} /></Btn>
      <span className="tb-sep" />
      <Btn label="Insert table" run={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></Btn>
      {s.inTable && (
        <>
          <Btn label="Add row below" run={() => chain().addRowAfter().run()}>+Row</Btn>
          <Btn label="Add column right" run={() => chain().addColumnAfter().run()}>+Col</Btn>
          <Btn label="Delete row" run={() => chain().deleteRow().run()}>-Row</Btn>
          <Btn label="Delete column" run={() => chain().deleteColumn().run()}>-Col</Btn>
          <Btn label="Toggle header row" run={() => chain().toggleHeaderRow().run()}>Hdr</Btn>
          <Btn label="Delete table" run={() => chain().deleteTable().run()}>Del</Btn>
        </>
      )}
    </div>
  );
}

// ─── Version history ─────────────────────────────────────────────────────

interface VersionRow {
  id: string;
  title: string;
  createdAt: string;
  createdBy: { displayName: string; avatarColor: string };
}

function VersionsModal({ docId, canRestore, onClose, onRestored }: { docId: string; canRestore: boolean; onClose: () => void; onRestored: (d: DocDetail) => void }) {
  const toast = useToast();
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  useEffect(() => void api.get<VersionRow[]>(`/documents/${docId}/versions`).then(setVersions), [docId]);

  async function restore(v: VersionRow) {
    if (!window.confirm(`Restore the version from ${format(new Date(v.createdAt), "MMM d, HH:mm")}? The current version is kept in history.`)) return;
    try {
      onRestored(await api.post<DocDetail>(`/documents/${docId}/restore/${v.id}`));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  return (
    <Modal title="Version history" onClose={onClose}>
      <p className="muted small" style={{ marginBottom: 10 }}>A snapshot is saved automatically at most every 10 minutes while editing.</p>
      {!versions ? <Spinner /> : versions.length === 0 ? <p className="muted">No earlier versions yet.</p> : null}
      {versions?.map((v) => (
        <div key={v.id} className="version-row">
          <Avatar user={v.createdBy} size={26} />
          <div className="grow">
            <div>{v.title}</div>
            <div className="muted small">{format(new Date(v.createdAt), "MMM d, yyyy HH:mm")} · {v.createdBy.displayName}</div>
          </div>
          {canRestore && <Button small onClick={() => restore(v)}>Restore</Button>}
        </div>
      ))}
    </Modal>
  );
}
