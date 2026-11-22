import { App, TFile, setIcon } from "obsidian";
import { IncomingRef } from "./linkIndex";

export interface PopoverOptions {
  anchor: HTMLElement;
  title: string;
  refs: IncomingRef[];
  onRename: () => void;
}

let current: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function closePopover() {
  cleanup?.();
  cleanup = null;
  current?.remove();
  current = null;
}

/** Click-to-open popover: incoming links with a line of context, plus Rename. */
export async function showPopover(app: App, opts: PopoverOptions) {
  closePopover();

  const el = document.createElement("div");
  el.className = "dxi-popover";

  const header = el.createDiv({ cls: "dxi-popover-header" });
  header.createSpan({
    cls: "dxi-popover-title",
    text: `${opts.refs.length} incoming link${opts.refs.length === 1 ? "" : "s"}`,
  });
  const rename = header.createEl("button", { cls: "dxi-popover-rename", text: "Rename..." });
  rename.addEventListener("click", () => {
    closePopover();
    opts.onRename();
  });

  el.createDiv({ cls: "dxi-popover-subtitle", text: opts.title });

  const list = el.createDiv({ cls: "dxi-popover-list" });

  // Group by source note. Notes sort alphabetically by name; links sort by position in the note, with frontmatter links first.
  const groups = new Map<string, { file: TFile; refs: IncomingRef[] }>();
  for (const ref of opts.refs) {
    const file = app.vault.getAbstractFileByPath(ref.sourcePath);
    if (!(file instanceof TFile)) continue;
    const group = groups.get(file.path) ?? { file, refs: [] };
    group.refs.push(ref);
    groups.set(file.path, group);
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      a.file.basename.localeCompare(b.file.basename, undefined, { sensitivity: "base", numeric: true }) ||
      a.file.path.localeCompare(b.file.path)
  );

  for (const { file, refs } of sorted) {
    refs.sort((a, b) => a.line - b.line || a.col - b.col);

    const group = list.createEl("details", { cls: "dxi-popover-group" });
    group.open = true;
    const summary = group.createEl("summary", { cls: "dxi-popover-note" });
    setIcon(summary.createSpan({ cls: "dxi-popover-chevron" }), "chevron-down");
    summary.createSpan({ cls: "dxi-popover-name", text: file.basename });
    summary.createSpan({ cls: "dxi-popover-count", text: String(refs.length) });

    for (const ref of refs) {
      const row = group.createDiv({ cls: "dxi-popover-row" });
      const isFrontmatter = ref.frontmatterKey !== undefined;
      const ctx = row.createDiv({
        cls: "dxi-popover-context",
        text: isFrontmatter ? `${ref.frontmatterKey}: ${ref.original}` : ref.original,
      });
      row.addEventListener("click", () => {
        closePopover();
        app.workspace
          .getLeaf(false)
          .openFile(file, isFrontmatter ? undefined : { eState: { line: ref.line } });
      });

      // Fill in the surrounding line asynchronously. Frontmatter links have no meaningful line, so their context is the property name and link text.
      if (!isFrontmatter) {
        app.vault.cachedRead(file).then((content) => {
          const line = content.split("\n")[ref.line]?.trim();
          if (line) ctx.setText(line.length > 160 ? line.slice(0, 157) + "..." : line);
        });
      }
    }
  }

  document.body.appendChild(el);
  current = el;

  const rect = opts.anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  el.style.top = `${rect.bottom + window.scrollY + 4}px`;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;

  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) closePopover();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closePopover();
  };
  // Defer so the click that opened the popover doesn't close it.
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  cleanup = () => {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
}
