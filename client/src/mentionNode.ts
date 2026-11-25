import { mergeAttributes, Node } from "@tiptap/core";

/**
 * An @mention inside a document: a single, unbreakable piece of text that remembers which member it points at.
 * The server notifies that member when a save adds one (see documentMentionIds on the server).
 */
export const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id"),
        renderHTML: (attrs) => ({ "data-id": attrs.id }),
      },
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label"),
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-mention": "", class: "mention" }, HTMLAttributes), `@${node.attrs.label}`];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});
