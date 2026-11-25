import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
} from "docx";
import PDFDocument from "pdfkit";
import type { PMNode } from "./templates.js";

type Mark = NonNullable<PMNode["marks"]>[number];

const hasMark = (n: PMNode, type: string) => n.marks?.find((m) => m.type === type);

// ─── Plain text & Markdown ───────────────────────────────────────────────

/** How an @mention reads in an export: "@Maya Chen". */
const mentionText = (n: PMNode) => `@${String(n.attrs?.label ?? "")}`;

export function inlineText(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => (n.type === "hardBreak" ? "\n" : n.type === "mention" ? mentionText(n) : (n.text ?? inlineText(n.content))))
    .join("");
}

function blockText(node: PMNode): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map(blockText).join("\n\n");
    case "bulletList":
    case "orderedList":
      return (node.content ?? [])
        .map((li, i) => `${node.type === "orderedList" ? `${i + 1}.` : "-"} ${(li.content ?? []).map(blockText).join("\n")}`)
        .join("\n");
    case "table":
      return (node.content ?? [])
        .map((row) => (row.content ?? []).map((c) => (c.content ?? []).map(blockText).join(" ")).join("\t"))
        .join("\n");
    case "horizontalRule":
      return "----------";
    case "blockquote":
      return (node.content ?? []).map(blockText).join("\n\n");
    default:
      return inlineText(node.content);
  }
}

export const toPlainText = (title: string, content: PMNode) => `${title}\n${"=".repeat(Math.min(title.length, 60))}\n\n${blockText(content)}\n`;

function mdInline(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "mention") return `**${mentionText(n)}**`;
      let t = n.text ?? "";
      if (!t) return mdInline(n.content);
      const link = hasMark(n, "link");
      if (hasMark(n, "code")) t = `\`${t}\``;
      if (hasMark(n, "bold")) t = `**${t}**`;
      if (hasMark(n, "italic")) t = `*${t}*`;
      if (hasMark(n, "strike")) t = `~~${t}~~`;
      if (hasMark(n, "underline")) t = `<u>${t}</u>`;
      if (hasMark(n, "highlight")) t = `==${t}==`;
      if (link) t = `[${t}](${String((link as Mark).attrs?.href ?? "")})`;
      return t;
    })
    .join("");
}

function mdBlock(node: PMNode, indent = ""): string {
  const kids = node.content ?? [];
  switch (node.type) {
    case "doc":
      return kids.map((k) => mdBlock(k)).join("\n\n");
    case "paragraph":
      return indent + mdInline(kids);
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${mdInline(kids)}`;
    case "bulletList":
    case "orderedList":
      return kids
        .map((li, i) => {
          const marker = node.type === "orderedList" ? `${i + 1}. ` : "- ";
          const [first, ...rest] = li.content ?? [];
          const head = indent + marker + (first ? mdBlock(first).replace(/^\s+/, "") : "");
          const tail = rest.map((r) => mdBlock(r, indent + "  "));
          return [head, ...tail].join("\n");
        })
        .join("\n");
    case "blockquote":
      return kids
        .map((k) => mdBlock(k))
        .join("\n\n")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "codeBlock":
      return "```\n" + inlineText(kids) + "\n```";
    case "horizontalRule":
      return "---";
    case "table": {
      const rows = kids.map((row) =>
        (row.content ?? []).map((c) => (c.content ?? []).map((b) => mdBlock(b)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
      const [head, ...body] = rows.map(pad);
      return [
        `| ${head!.join(" | ")} |`,
        `| ${head!.map(() => "---").join(" | ")} |`,
        ...body.map((r) => `| ${r.join(" | ")} |`),
      ].join("\n");
    }
    default:
      return inlineText(kids);
  }
}

export const toMarkdown = (title: string, content: PMNode) => `# ${title}\n\n${mdBlock(content)}\n`;

// ─── Word (.docx) ────────────────────────────────────────────────────────

const HEADINGS = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
];

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

function docxRuns(nodes: PMNode[] = []): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const n of nodes) {
    if (n.type === "hardBreak") {
      out.push(new TextRun({ break: 1 }));
      continue;
    }
    if (n.type === "mention") {
      out.push(new TextRun({ text: mentionText(n), bold: true, color: "3B46C9" }));
      continue;
    }
    if (n.text === undefined) {
      out.push(...docxRuns(n.content));
      continue;
    }
    const code = hasMark(n, "code");
    const run = new TextRun({
      text: n.text,
      bold: !!hasMark(n, "bold"),
      italics: !!hasMark(n, "italic"),
      strike: !!hasMark(n, "strike"),
      underline: hasMark(n, "underline") ? {} : undefined,
      highlight: hasMark(n, "highlight") ? "yellow" : undefined,
      font: code ? "Courier New" : undefined,
    });
    const link = hasMark(n, "link");
    const href = link ? String((link as Mark).attrs?.href ?? "") : "";
    out.push(/^(https?:|mailto:)/i.test(href) ? new ExternalHyperlink({ link: href, children: [run] }) : run);
  }
  return out;
}

interface DocxCtx {
  numbering: { reference: string; levels: ILevelsOptions[] }[];
}

const orderedLevels = (): ILevelsOptions[] =>
  Array.from({ length: 4 }, (_, level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

function docxBlocks(nodes: PMNode[] = [], ctx: DocxCtx, listLevel = -1, listRef?: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const node of nodes) {
    const alignment = ALIGN[String(node.attrs?.textAlign ?? "")];
    switch (node.type) {
      case "paragraph":
        out.push(new Paragraph({ children: docxRuns(node.content), alignment }));
        break;
      case "heading":
        out.push(
          new Paragraph({
            heading: HEADINGS[Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6) - 1],
            children: docxRuns(node.content),
            alignment,
          }),
        );
        break;
      case "bulletList":
      case "orderedList": {
        const ordered = node.type === "orderedList";
        let ref = listRef;
        if (ordered && listLevel < 0) {
          ref = `ol-${ctx.numbering.length}`;
          ctx.numbering.push({ reference: ref, levels: orderedLevels() });
        }
        const level = Math.min(listLevel + 1, 3);
        for (const li of node.content ?? []) {
          const [first, ...rest] = li.content ?? [];
          out.push(
            new Paragraph({
              children: docxRuns(first?.content),
              ...(ordered ? { numbering: { reference: ref!, level } } : { bullet: { level } }),
            }),
          );
          out.push(...docxBlocks(rest, ctx, level, ref));
        }
        break;
      }
      case "blockquote":
        for (const b of docxBlocks(node.content, ctx)) {
          out.push(b);
        }
        break;
      case "codeBlock":
        out.push(
          new Paragraph({
            children: [new TextRun({ text: inlineText(node.content), font: "Courier New" })],
            shading: { type: ShadingType.CLEAR, fill: "F2F3F5" },
          }),
        );
        break;
      case "horizontalRule":
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } }));
        break;
      case "table": {
        const rows = (node.content ?? []).map(
          (row) =>
            new TableRow({
              children: (row.content ?? []).map((cell) => {
                const children = docxBlocks(cell.content, ctx);
                return new TableCell({
                  children: children.length ? children : [new Paragraph("")],
                  shading: cell.type === "tableHeader" ? { type: ShadingType.CLEAR, fill: "E8EAED" } : undefined,
                });
              }),
            }),
        );
        if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        out.push(new Paragraph(""));
        break;
      }
      default:
        if (node.content) out.push(...docxBlocks(node.content, ctx, listLevel, listRef));
    }
  }
  return out;
}

export async function toDocx(title: string, content: PMNode): Promise<Buffer> {
  const ctx: DocxCtx = { numbering: [] };
  const body = docxBlocks(content.content, ctx);
  const document = new Document({
    title,
    creator: "Tony Prod",
    numbering: { config: ctx.numbering },
    sections: [
      {
        children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }), ...body],
      },
    ],
  });
  return Packer.toBuffer(document);
}

// ─── PDF ─────────────────────────────────────────────────────────────────

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link?: string;
}

function pdfRuns(nodes: PMNode[] = []): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    if (n.type === "hardBreak") out.push({ text: "\n", bold: false, italic: false, underline: false, strike: false, code: false });
    else if (n.type === "mention") out.push({ text: mentionText(n), bold: true, italic: false, underline: false, strike: false, code: false });
    else if (n.text !== undefined) {
      const link = hasMark(n, "link");
      const href = link ? String((link as Mark).attrs?.href ?? "") : "";
      out.push({
        text: n.text,
        bold: !!hasMark(n, "bold"),
        italic: !!hasMark(n, "italic"),
        underline: !!hasMark(n, "underline") || !!link,
        strike: !!hasMark(n, "strike"),
        code: !!hasMark(n, "code"),
        link: /^(https?:|mailto:)/i.test(href) ? href : undefined,
      });
    } else out.push(...pdfRuns(n.content));
  }
  return out;
}

const fontFor = (r: Pick<Run, "bold" | "italic" | "code">, forceBold = false) => {
  if (r.code) return "Courier";
  const bold = r.bold || forceBold;
  return bold ? (r.italic ? "Helvetica-BoldOblique" : "Helvetica-Bold") : r.italic ? "Helvetica-Oblique" : "Helvetica";
};

// pdfkit's built-in fonts only cover Latin-1; replace characters they cannot draw.
const safe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .replace(/[^\u0009\u000A -ÿ]/g, "?");

interface PdfCtx {
  left: number;
  width: number;
}

export function toPdf(title: string, content: PMNode): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const MARGIN = 56;
    const pdf = new PDFDocument({ size: "LETTER", margin: MARGIN, bufferPages: true, info: { Title: title, Creator: "Tony Prod" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const pageBottom = () => pdf.page.height - pdf.page.margins.bottom;

    const writeRuns = (runs: Run[], ctx: PdfCtx, size: number, opts: { bold?: boolean; align?: string } = {}) => {
      if (runs.length === 0) runs = [{ text: " ", bold: false, italic: false, underline: false, strike: false, code: false }];
      runs.forEach((r, i) => {
        const options = {
          continued: i < runs.length - 1,
          width: ctx.width,
          align: (opts.align as "left" | "center" | "right" | "justify") ?? "left",
          underline: r.underline,
          strike: r.strike,
          link: r.link,
        };
        pdf.font(fontFor(r, opts.bold)).fontSize(r.code ? size - 1 : size).fillColor(r.link ? "#2563eb" : "#111111");
        if (i === 0) pdf.text(safe(r.text), ctx.left, pdf.y, options);
        else pdf.text(safe(r.text), options);
      });
    };

    const cellText = (node: PMNode): string => blockText(node);

    const renderBlocks = (nodes: PMNode[] = [], ctx: PdfCtx) => {
      for (const node of nodes) {
        switch (node.type) {
          case "paragraph":
            writeRuns(pdfRuns(node.content), ctx, 11, { align: String(node.attrs?.textAlign ?? "left") });
            pdf.moveDown(0.5);
            break;
          case "heading": {
            const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
            const size = [22, 18, 15, 13, 12, 11][level - 1]!;
            pdf.moveDown(0.3);
            writeRuns(pdfRuns(node.content), ctx, size, { bold: true, align: String(node.attrs?.textAlign ?? "left") });
            pdf.moveDown(0.4);
            break;
          }
          case "bulletList":
          case "orderedList":
            (node.content ?? []).forEach((li, i) => {
              const [first, ...rest] = li.content ?? [];
              const y = pdf.y;
              pdf.font("Helvetica").fontSize(11).fillColor("#111111");
              pdf.text(node.type === "orderedList" ? `${i + 1}.` : "-", ctx.left, y, {
                width: 20,
                lineBreak: false,
              });
              pdf.y = y;
              const inner = { left: ctx.left + 22, width: ctx.width - 22 };
              writeRuns(pdfRuns(first?.content), inner, 11);
              pdf.moveDown(0.2);
              renderBlocks(rest, inner);
            });
            pdf.moveDown(0.3);
            break;
          case "blockquote": {
            const startPage = pdf.bufferedPageRange().count;
            const startY = pdf.y;
            renderBlocks(node.content, { left: ctx.left + 16, width: ctx.width - 16 });
            if (pdf.bufferedPageRange().count === startPage) {
              pdf.save().moveTo(ctx.left + 4, startY).lineTo(ctx.left + 4, pdf.y - 6).lineWidth(2).strokeColor("#c7c9d1").stroke().restore();
            }
            break;
          }
          case "codeBlock":
            pdf.font("Courier").fontSize(10).fillColor("#111111").text(safe(inlineText(node.content)), ctx.left + 8, pdf.y, { width: ctx.width - 16 });
            pdf.moveDown(0.6);
            break;
          case "horizontalRule":
            pdf.moveDown(0.3);
            pdf.save().moveTo(ctx.left, pdf.y).lineTo(ctx.left + ctx.width, pdf.y).lineWidth(0.7).strokeColor("#999999").stroke().restore();
            pdf.moveDown(0.8);
            break;
          case "table": {
            const rows = node.content ?? [];
            const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
            const colW = ctx.width / cols;
            for (const row of rows) {
              const cells = row.content ?? [];
              const isHeader = cells.some((c) => c.type === "tableHeader");
              pdf.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(10);
              const texts = Array.from({ length: cols }, (_, i) => safe((cells[i]?.content ?? []).map(cellText).join("\n")));
              const heights = texts.map((t) => pdf.heightOfString(t || " ", { width: colW - 10 }));
              const rowH = Math.max(...heights) + 10;
              if (pdf.y + rowH > pageBottom()) pdf.addPage();
              const y = pdf.y;
              texts.forEach((t, i) => {
                const x = ctx.left + i * colW;
                if (isHeader) pdf.save().rect(x, y, colW, rowH).fill("#e8eaed").restore();
                pdf.save().rect(x, y, colW, rowH).lineWidth(0.5).strokeColor("#9ca3af").stroke().restore();
                pdf.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#111111");
                pdf.text(t, x + 5, y + 5, { width: colW - 10, height: rowH - 8, lineBreak: true });
              });
              pdf.x = ctx.left;
              pdf.y = y + rowH;
            }
            pdf.moveDown(0.8);
            break;
          }
          default:
            if (node.content) renderBlocks(node.content, ctx);
        }
      }
    };

    const ctx: PdfCtx = { left: MARGIN, width: pdf.page.width - MARGIN * 2 };
    pdf.font("Helvetica-Bold").fontSize(26).fillColor("#111111").text(safe(title), MARGIN, MARGIN, { width: ctx.width });
    pdf.moveDown(0.2);
    pdf.font("Helvetica").fontSize(9).fillColor("#6b7280").text(`Exported from Tony Prod on ${new Date().toLocaleDateString("en-CA")}`, { width: ctx.width });
    pdf.moveDown(0.6);
    pdf.save().moveTo(MARGIN, pdf.y).lineTo(MARGIN + ctx.width, pdf.y).lineWidth(1).strokeColor("#d1d5db").stroke().restore();
    pdf.moveDown(0.8);

    renderBlocks(content.content, ctx);

    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      const bottom = pdf.page.margins.bottom;
      pdf.page.margins.bottom = 0;
      pdf.font("Helvetica").fontSize(8).fillColor("#9ca3af");
      pdf.text(`${safe(title)}  -  Page ${i + 1} of ${range.count}`, MARGIN, pdf.page.height - 36, {
        width: ctx.width,
        align: "center",
        lineBreak: false,
      });
      pdf.page.margins.bottom = bottom;
    }
    pdf.end();
  });
}
