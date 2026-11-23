import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { generateJSON } from "@tiptap/html";
import { FilePlus2, FileText, Upload } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { editorExtensions } from "../editorExtensions";
import { DOC_TYPES } from "../lib";
import type { DocDetail, DocListItem, DocTemplate, DocType } from "../types";
import { Avatar, Badge, Button, Empty, Field, Modal, PageHeader, Spinner, useToast } from "../ui";

export function DocumentsPage() {
  const { can } = useAuth();
  const { productions } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const [docs, setDocs] = useState<DocListItem[] | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [productionId, setProductionId] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (type) qs.set("type", type);
    if (productionId) qs.set("productionId", productionId);
    setDocs(await api.get<DocListItem[]>(`/documents?${qs}`));
  }, [q, type, productionId]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);
  useSocketEvent("documents:changed", () => void load());

  async function importFile(file: File) {
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { title, html } = await api.upload<{ title: string; html: string }>("/documents/import", form);
      const content = generateJSON(html || "<p></p>", editorExtensions);
      const doc = await api.post<DocDetail>("/documents", { title, type: "OTHER", content, productionId: productionId || null });
      toast(`Imported "${title}".`, "success");
      navigate(`/documents/${doc.id}`);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle="Scripts, call sheets, shot lists, treatments and more."
        actions={
          can("documents.create") && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".docx,.md,.markdown,.txt"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = "";
                }}
              />
              <Button onClick={() => fileInput.current?.click()} disabled={importing} title="Import a Word (.docx), Markdown or text file">
                <Upload size={16} /> {importing ? "Importing..." : "Import"}
              </Button>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <FilePlus2 size={16} /> New document
              </Button>
            </>
          )
        }
      />

      <div className="row" style={{ maxWidth: 720, marginBottom: 18 }}>
        <input type="search" placeholder="Search documents..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={productionId} onChange={(e) => setProductionId(e.target.value)} aria-label="Filter by production">
          <option value="">All productions</option>
          {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>

      {!docs ? (
        <Spinner />
      ) : docs.length === 0 ? (
        <Empty icon={<FileText size={40} />} title="No documents found">
          {can("documents.create") ? "Create one from a template or import an existing file." : "Documents shared with you will appear here."}
        </Empty>
      ) : (
        <div className="grid cols-3">
          {docs.map((d) => (
            <Link key={d.id} to={`/documents/${d.id}`} className="card doc-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b>{d.title}</b>
                <Badge>{DOC_TYPES[d.type]}</Badge>
              </div>
              {d.production && <span className="small" style={{ color: d.production.color }}>{d.production.title}</span>}
              <div className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Avatar user={d.updatedBy} size={18} /> {d.updatedBy.displayName} · {format(new Date(d.updatedAt), "MMM d, HH:mm")}
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating && <NewDocumentModal defaultProductionId={productionId} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewDocumentModal({ defaultProductionId, onClose }: { defaultProductionId: string; onClose: () => void }) {
  const { productions } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [selected, setSelected] = useState("blank");
  const [title, setTitle] = useState("");
  const [productionId, setProductionId] = useState(defaultProductionId);
  const [busy, setBusy] = useState(false);

  useEffect(() => void api.get<DocTemplate[]>("/documents/templates").then(setTemplates), []);
  const tpl = templates.find((t) => t.key === selected);

  async function create() {
    setBusy(true);
    try {
      const doc = await api.post<DocDetail>("/documents", {
        title: title.trim() || tpl?.title || "Untitled document",
        type: (tpl?.type ?? "OTHER") as DocType,
        template: selected,
        productionId: productionId || null,
      });
      navigate(`/documents/${doc.id}`);
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New document"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={busy}>Create</Button>
        </>
      }
    >
      <Field label="Start from">
        <div className="template-grid">
          {templates.map((t) => (
            <button key={t.key} type="button" className={`template-card ${selected === t.key ? "active" : ""}`} onClick={() => setSelected(t.key)}>
              <b>{t.key === "blank" ? "Blank document" : t.title}</b>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
      </Field>
      <div className="row">
        <Field label="Title">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tpl?.title ?? "Untitled document"} maxLength={160} />
        </Field>
        <Field label="Production (optional)">
          <select value={productionId} onChange={(e) => setProductionId(e.target.value)}>
            <option value="">None</option>
            {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
