// Document templates, expressed as Tiptap/ProseMirror JSON.

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const text = (t: string, bold = false): PMNode => ({ type: "text", text: t, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const p = (t = "", bold = false): PMNode => (t ? { type: "paragraph", content: [text(t, bold)] } : { type: "paragraph" });
const h = (level: number, t: string): PMNode => ({ type: "heading", attrs: { level }, content: [text(t)] });
const ul = (items: string[]): PMNode => ({
  type: "bulletList",
  content: items.map((i) => ({ type: "listItem", content: [p(i)] })),
});
const hr = (): PMNode => ({ type: "horizontalRule" });
const table = (header: string[], rows: string[][]): PMNode => ({
  type: "table",
  content: [
    { type: "tableRow", content: header.map((t) => ({ type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [p(t, true)] })) },
    ...rows.map((r) => ({
      type: "tableRow",
      content: r.map((t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [p(t)] })),
    })),
  ],
});
const blankRows = (cols: number, n: number) => Array.from({ length: n }, () => Array<string>(cols).fill(""));
const doc = (...content: PMNode[]) => ({ type: "doc", content });

export interface TemplateInfo {
  key: string;
  title: string;
  type: "SCRIPT" | "CALL_SHEET" | "SHOT_LIST" | "TREATMENT" | "SCHEDULE" | "BUDGET" | "CONTRACT" | "NOTES" | "OTHER";
  description: string;
  build: () => ReturnType<typeof doc>;
}

export const TEMPLATES: TemplateInfo[] = [
  {
    key: "blank",
    title: "Untitled document",
    type: "OTHER",
    description: "Start from an empty page.",
    build: () => doc(p()),
  },
  {
    key: "call-sheet",
    title: "Call Sheet",
    type: "CALL_SHEET",
    description: "Daily call sheet with timings, location, scenes and crew call times.",
    build: () =>
      doc(
        h(1, "CALL SHEET"),
        table(["Field", "Detail"], [
          ["Production", ""],
          ["Shoot date", ""],
          ["Day", "Day 1 of"],
          ["General crew call", ""],
          ["Sunrise / Sunset", ""],
          ["Weather", ""],
          ["Nearest hospital", ""],
        ]),
        h(2, "Location"),
        table(["Name", "Address", "Parking / Notes"], blankRows(3, 2)),
        h(2, "Schedule"),
        table(["Time", "Scene / Setup", "Description", "Cast", "Notes"], blankRows(5, 6)),
        h(2, "Cast"),
        table(["Role", "Name", "Pickup", "Hair / Makeup", "On set"], blankRows(5, 3)),
        h(2, "Crew"),
        table(["Department", "Name", "Phone", "Call time"], blankRows(4, 8)),
        h(2, "Notes"),
        ul(["Safety briefing at general call.", "Lunch at"]),
      ),
  },
  {
    key: "shot-list",
    title: "Shot List",
    type: "SHOT_LIST",
    description: "Scene-by-scene shot table with lens, movement and notes.",
    build: () =>
      doc(
        h(1, "SHOT LIST"),
        p("Production: "),
        table(["#", "Scene", "Shot", "Description", "Lens", "Movement", "Notes"], [
          ["1", "1", "WS", "Establishing shot", "24mm", "Static", ""],
          ...blankRows(7, 9),
        ]),
      ),
  },
  {
    key: "script",
    title: "Script",
    type: "SCRIPT",
    description: "Two-column-style script layout: scene headings, action and dialogue.",
    build: () =>
      doc(
        h(1, "TITLE OF THE PIECE"),
        p("Written by"),
        hr(),
        h(3, "INT. LOCATION - DAY"),
        p("Describe what we see and hear. Keep action lines short and visual."),
        p("CHARACTER", true),
        p("Dialogue goes here."),
        h(3, "EXT. LOCATION - NIGHT"),
        p(),
      ),
  },
  {
    key: "treatment",
    title: "Treatment",
    type: "TREATMENT",
    description: "Creative pitch: logline, concept, tone, visual approach and deliverables.",
    build: () =>
      doc(
        h(1, "Treatment"),
        h(2, "Logline"),
        p("One or two sentences that capture the whole piece."),
        h(2, "Concept"),
        p(),
        h(2, "Tone & Style"),
        ul(["Reference 1", "Reference 2"]),
        h(2, "Visual Approach"),
        p("Camera, lighting, color, locations."),
        h(2, "Sound & Music"),
        p(),
        h(2, "Deliverables"),
        ul(["Master edit", "Cut-downs", "Social versions"]),
      ),
  },
  {
    key: "schedule",
    title: "Production Schedule",
    type: "SCHEDULE",
    description: "Phase-by-phase timeline from pre-production to delivery.",
    build: () =>
      doc(
        h(1, "Production Schedule"),
        table(["Phase", "Start", "End", "Owner", "Notes"], [
          ["Development", "", "", "", ""],
          ["Pre-production", "", "", "", ""],
          ["Shoot", "", "", "", ""],
          ["Offline edit", "", "", "", ""],
          ["Client review", "", "", "", ""],
          ["Online / color / sound", "", "", "", ""],
          ["Delivery", "", "", "", ""],
        ]),
      ),
  },
  {
    key: "budget",
    title: "Budget",
    type: "BUDGET",
    description: "Line-item budget by department. Visible only to people allowed to see budgets.",
    build: () =>
      doc(
        h(1, "Budget"),
        table(["Category", "Item", "Qty", "Rate", "Total"], [
          ["Pre-production", "", "", "", ""],
          ["Crew", "", "", "", ""],
          ["Equipment", "", "", "", ""],
          ["Talent", "", "", "", ""],
          ["Locations", "", "", "", ""],
          ["Post-production", "", "", "", ""],
          ["Contingency (10%)", "", "", "", ""],
        ]),
        p("Grand total: ", true),
      ),
  },
  {
    key: "meeting-notes",
    title: "Meeting Notes",
    type: "NOTES",
    description: "Agenda, decisions and action items.",
    build: () =>
      doc(
        h(1, "Meeting Notes"),
        p("Date: "),
        p("Attendees: "),
        h(2, "Agenda"),
        ul(["Topic 1", "Topic 2"]),
        h(2, "Decisions"),
        ul([""]),
        h(2, "Action items"),
        table(["Action", "Owner", "Due"], blankRows(3, 3)),
      ),
  },
];
