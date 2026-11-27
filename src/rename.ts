import { Editor, MarkdownView, Menu, Notice } from "obsidian";

/**
 Opens Obsidian's `Rename this heading...` or `Rename this block ID...` dialog, which rewrites links across the vault.
 
 No public API.
 
 The "Rename" item is added to the `editor-menu` workspace event when the cursor is on the heading line or inside the block ID. Method: move the cursor, build a menu that doesn't get shown, trigger the event, and invoke the item's callback. Each step is guarded and falls back to a notice.
 */
export function openRenameDialog(
  view: MarkdownView,
  line: number,
  kind: "heading" | "block"
): boolean {
  const editor: Editor = view.editor;
  const text = editor.getLine(line);

  // Heading: anywhere on the line. Block ID: inside the `^id` text.
  const ch = kind === "heading" ? text.length : Math.max(0, text.length - 2);
  editor.setCursor({ line, ch });
  editor.focus();

  const menu = new Menu();
  view.app.workspace.trigger("editor-menu", menu, editor, view);

  const wanted = kind === "heading" ? /Rename this heading/i : /Rename this block/i;
  // `items` and `titleEl` are not in the public typings.
  const items = ((menu as unknown as { items?: unknown[] }).items ?? []) as Array<{
    titleEl?: HTMLElement;
    callback?: () => void;
  }>;
  const item = items.find((i) => wanted.test(i.titleEl?.textContent ?? ""));

  if (!item || typeof item.callback !== "function") {
    new Notice(
      "Couldn't open Obsidian's rename dialog. Right-click the " +
        (kind === "heading" ? "heading" : "block ID") +
        " and choose Rename instead."
    );
    return false;
  }

  item.callback.call(item);
  return true;
}
