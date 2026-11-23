import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";

/** Shared by the editor and by the HTML importer so both understand exactly the same document shape. */
export const editorExtensions = [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] },
  }),
  Highlight,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];
