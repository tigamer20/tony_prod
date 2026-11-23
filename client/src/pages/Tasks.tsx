import { useCallback, useEffect, useState } from "react";
import { format, isPast } from "date-fns";
import { Plus } from "lucide-react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useData, useSocketEvent } from "../data";
import { PRIORITY_COLOR, fromDateInput, toDateInput } from "../lib";
import type { Task, TaskPriority, TaskStatus } from "../types";
import { Avatar, Badge, Button, Empty, Field, Modal, PageHeader, Spinner, useToast } from "../ui";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "TODO", label: "To do" },
  { status: "IN_PROGRESS", label: "In progress" },
  { status: "REVIEW", label: "In review" },
  { status: "DONE", label: "Done" },
];

export function TasksPage() {
  const { productions } = useData();
  const [filter, setFilter] = useState<{ mine: boolean; productionId: string }>({ mine: false, productionId: "" });
  return (
    <>
      <PageHeader title="Tasks" subtitle="Track what needs to happen, and who is doing it." />
      <div className="row" style={{ maxWidth: 520, marginBottom: 16 }}>
        <select aria-label="Filter by production" value={filter.productionId} onChange={(e) => setFilter({ ...filter, productionId: e.target.value })}>
          <option value="">All productions</option>
          {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <select aria-label="Filter by assignee" value={filter.mine ? "mine" : "all"} onChange={(e) => setFilter({ ...filter, mine: e.target.value === "mine" })}>
          <option value="all">Everyone's tasks</option>
          <option value="mine">Assigned to me</option>
        </select>
      </div>
      <TaskBoard productionId={filter.productionId || undefined} mine={filter.mine} />
    </>
  );
}

export function TaskBoard({ productionId, mine }: { productionId?: string; mine?: boolean }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (productionId) qs.set("productionId", productionId);
    if (mine) qs.set("mine", "1");
    setTasks(await api.get<Task[]>(`/tasks?${qs}`));
  }, [productionId, mine]);
  useEffect(() => void load(), [load]);
  useSocketEvent("tasks:changed", () => void load());

  async function move(id: string, status: TaskStatus) {
    const task = tasks?.find((t) => t.id === id);
    if (!task || task.status === status) return;
    setTasks((prev) => prev!.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await api.patch(`/tasks/${id}`, { status });
    } catch (e) {
      toast(errMsg(e), "error");
      void load();
    }
  }

  const canMove = (t: Task) => can("tasks.manage") || t.assignee?.id === me!.id || t.createdBy.id === me!.id;

  if (!tasks) return <Spinner />;
  return (
    <>
      {can("tasks.manage") && (
        <div style={{ marginBottom: 12 }}>
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> New task
          </Button>
        </div>
      )}
      {tasks.length === 0 && <Empty title="No tasks here yet">{can("tasks.manage") ? "Create a task to get started." : "Nothing has been assigned yet."}</Empty>}
      <div className="board">
        {COLUMNS.map((col) => {
          const list = tasks.filter((t) => t.status === col.status);
          return (
            <div
              key={col.status}
              className={`column ${over === col.status ? "over" : ""}`}
              onDragOver={(e) => {
                if (dragId) {
                  e.preventDefault();
                  setOver(col.status);
                }
              }}
              onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragId) void move(dragId, col.status);
              }}
              aria-label={col.label}
            >
              <div className="column-head">
                {col.label}
                <span>{list.length}</span>
              </div>
              {list.map((t) => {
                const overdue = t.dueDate && t.status !== "DONE" && isPast(new Date(t.dueDate));
                return (
                  <div
                    key={t.id}
                    className={`task-card ${dragId === t.id ? "dragging" : ""}`}
                    style={{ borderLeftColor: PRIORITY_COLOR[t.priority] }}
                    draggable={canMove(t)}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    onClick={() => setEditing(t)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setEditing(t)}
                  >
                    <div><b>{t.title}</b></div>
                    <div className="task-meta">
                      {t.production && !productionId && <Badge color={t.production.color}>{t.production.title}</Badge>}
                      {t.dueDate && <span className={overdue ? "overdue" : ""}>{format(new Date(t.dueDate), "MMM d")}</span>}
                      <span style={{ flex: 1 }} />
                      {t.assignee && <Avatar user={t.assignee} size={22} />}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {editing && (
        <TaskModal
          task={editing === "new" ? null : editing}
          defaultProductionId={productionId}
          readOnly={editing !== "new" && !can("tasks.manage")}
          canMove={editing !== "new" && canMove(editing)}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

function TaskModal({
  task,
  defaultProductionId,
  readOnly,
  canMove,
  onClose,
  onSaved,
}: {
  task: Task | null;
  defaultProductionId?: string;
  readOnly: boolean;
  canMove: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { users, productions } = useData();
  const toast = useToast();
  const [form, setForm] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: (task?.status ?? "TODO") as TaskStatus,
    priority: (task?.priority ?? "MEDIUM") as TaskPriority,
    dueDate: toDateInput(task?.dueDate),
    productionId: task?.productionId ?? defaultProductionId ?? "",
    assigneeId: task?.assignee?.id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      const body = readOnly
        ? { status: form.status }
        : {
            ...form,
            description: form.description || null,
            dueDate: fromDateInput(form.dueDate),
            productionId: form.productionId || null,
            assigneeId: form.assigneeId || null,
          };
      if (task) await api.patch(`/tasks/${task.id}`, body);
      else await api.post("/tasks", body);
      await onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!task || !window.confirm("Delete this task?")) return;
    try {
      await api.del(`/tasks/${task.id}`);
      await onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  return (
    <Modal
      title={task ? (readOnly ? "Task" : "Edit task") : "New task"}
      onClose={onClose}
      footer={
        <>
          {task && !readOnly && <Button variant="danger" onClick={remove} style={{ marginRight: "auto" }}>Delete</Button>}
          <Button variant="ghost" onClick={onClose}>{readOnly && !canMove ? "Close" : "Cancel"}</Button>
          {(!readOnly || canMove) && (
            <Button variant="primary" onClick={save} disabled={busy || !form.title.trim()}>Save</Button>
          )}
        </>
      }
    >
      <Field label="Title">
        <input type="text" value={form.title} onChange={set("title")} disabled={readOnly} autoFocus maxLength={200} />
      </Field>
      <Field label="Description">
        <textarea value={form.description} onChange={set("description")} disabled={readOnly} />
      </Field>
      <div className="row">
        <Field label="Status">
          <select value={form.status} onChange={set("status")} disabled={readOnly && !canMove}>
            {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={form.priority} onChange={set("priority")} disabled={readOnly}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Assignee">
          <select value={form.assigneeId} onChange={set("assigneeId")} disabled={readOnly}>
            <option value="">Unassigned</option>
            {users.filter((u) => u.status !== "DISABLED").map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </Field>
        <Field label="Due date">
          <input type="date" value={form.dueDate} onChange={set("dueDate")} disabled={readOnly} />
        </Field>
      </div>
      <Field label="Production">
        <select value={form.productionId} onChange={set("productionId")} disabled={readOnly}>
          <option value="">None</option>
          {productions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </Field>
    </Modal>
  );
}
