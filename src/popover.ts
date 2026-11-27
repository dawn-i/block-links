import { App, Keymap, Menu, Scope, TFile, setIcon } from "obsidian";
import { IncomingRef } from "./linkIndex";

export interface PopoverOptions {
  anchor: HTMLElement;
  title: string;
  refs: IncomingRef[];
  /** The note the popover opened from; for including in this-note group. */
  currentPath?: string;
  /** Opened by a mouse click; for hiding the keyboard focus-highlight until a key is pressed. */
  pointer?: boolean;
  /** The available rename kinds; for running the appropriate dialog or opening a menu to select from. */
  renames: RenameChoice[];
}

export interface RenameChoice {
  label: string;
  run: () => void;
}

let current: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function closePopover() {
  cleanup?.();
  cleanup = null;
  current?.remove();
  current = null;
}

/** Click-to-open popover. */
export async function showPopover(app: App, opts: PopoverOptions) {
  closePopover();

  // Keyboard focus moves into the popover; Escape returns focus to where it was.
  const returnTo = document.activeElement as HTMLElement | null;

  const el = document.createElement("div");
  el.className = "dxi-popover";
  el.tabIndex = -1;
  if (opts.pointer) el.classList.add("dxi-popover-pointer");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "dxi-popover-title");

  const header = el.createDiv({ cls: "dxi-popover-header" });
  header.createSpan({
    cls: "dxi-popover-title",
    attr: { id: "dxi-popover-title" },
    text: `${opts.refs.length} link${opts.refs.length === 1 ? "" : "s"}`,
  });
  if (opts.renames.length > 0) {
    const rename = header.createEl("button", { cls: "dxi-popover-rename", text: "Rename..." });
    rename.addEventListener("click", () => {
      if (opts.renames.length === 1) {
        closePopover();
        opts.renames[0].run();
        return;
      }
      const menu = new Menu();
      for (const choice of opts.renames) {
        menu.addItem((item) =>
          item.setTitle(choice.label).onClick(() => {
            closePopover();
            choice.run();
          })
        );
      }
      const rect = rename.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });
  }

  el.createDiv({ cls: "dxi-popover-subtitle", text: opts.title });

  const list = el.createDiv({ cls: "dxi-popover-list" });

  // Group by source note. Notes sort alphabetically by name, but with the current note first. Links sort by position in the note, with frontmatter links first.
  const groups = new Map<string, { file: TFile; refs: IncomingRef[] }>();
  for (const ref of opts.refs) {
    const file = app.vault.getAbstractFileByPath(ref.sourcePath);
    if (!(file instanceof TFile)) continue;
    const group = groups.get(file.path) ?? { file, refs: [] };
    group.refs.push(ref);
    groups.set(file.path, group);
  }
  const isCurrent = (path: string) => path === opts.currentPath;
  const sorted = [...groups.values()].sort(
    (a, b) =>
      Number(isCurrent(b.file.path)) - Number(isCurrent(a.file.path)) ||
      a.file.basename.localeCompare(b.file.basename, undefined, { sensitivity: "base", numeric: true }) ||
      a.file.path.localeCompare(b.file.path)
  );

  // Each row's follow action, so Enter can pass along modifier keys the way a click would.
  const followers = new Map<HTMLElement, (e: MouseEvent | KeyboardEvent) => void>();

  for (const { file, refs } of sorted) {
    refs.sort((a, b) => a.line - b.line || a.col - b.col);

    const current = isCurrent(file.path);
    const group = list.createEl("details", {
      cls: "dxi-popover-group" + (current ? " dxi-popover-group-current" : ""),
    });
    group.open = true;
    const summary = group.createEl("summary", { cls: "dxi-popover-note" });
    setIcon(summary.createSpan({ cls: "dxi-popover-chevron" }), "chevron-down");
    summary.createSpan({ cls: "dxi-popover-name", text: current ? "This note" : file.basename });
    summary.createSpan({ cls: "dxi-popover-count", text: String(refs.length) });

    for (const ref of refs) {
      const row = group.createDiv({ cls: "dxi-popover-inlink" });
      row.tabIndex = 0;
      row.setAttribute("role", "link");
      const isFrontmatter = ref.frontmatterKey !== undefined;

      // Link tags to identify links to a heading's block ID, embedded links, and links in properties.
      const tags: Array<[text: string, kind: string, hint: string]> = [];
      if (ref.viaBlock) tags.push([ref.viaBlock, "block", `Links to the block ID ${ref.viaBlock}`]);
      if (ref.embed) tags.push(["embed", "embed", "Embedded"]);
      if (isFrontmatter) tags.push(["property", "property", `Property: ${ref.frontmatterKey}`]);
      if (tags.length > 0) {
        const tagsEl = row.createDiv({ cls: "dxi-popover-tags" });
        for (const [text, kind, hint] of tags) {
          tagsEl.createSpan({ cls: `dxi-popover-tag dxi-popover-tag-${kind}`, text, attr: { title: hint } });
        }
      }

      const ctx = row.createDiv({
        cls: "dxi-popover-context",
        text: isFrontmatter ? `${ref.frontmatterKey}: ${ref.original}` : ref.original,
      });
      const follow = (e: MouseEvent | KeyboardEvent) => {
        closePopover();
        // Same as Obsidian's modifier-key rules for opening links: Ctrl new tab, Ctrl+Alt split, Ctrl+Alt+Shift new window, middle click new tab.
        app.workspace
          .getLeaf(Keymap.isModEvent(e))
          .openFile(file, isFrontmatter ? undefined : { eState: { line: ref.line } });
      };
      followers.set(row, follow);
      row.addEventListener("click", follow);
      row.addEventListener("mousedown", (e) => {
        if (e.button === 1) e.preventDefault();
      });
      row.addEventListener("auxclick", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        follow(e);
      });

      // Fill in the surrounding line asynchronously. Because frontmatter links have no meaningful line, their context is the property name and link text.
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

  // Up and down arrows, Tab, and Shift+Tab navigate among the Rename button, notes, and links. Left and right arrows collapse and expand notes. Home goes to the first note. End goes to the last link. Enter and Space select.
  const items = () =>
    Array.from(
      el.querySelectorAll<HTMLElement>(".dxi-popover-rename, summary, details[open] > .dxi-popover-inlink")
    );
  el.addEventListener("keydown", (e) => {
    // The first key press after a click reveals the already focused first note rather than moving on from it.
    const reveal = el.classList.contains("dxi-popover-pointer");
    el.classList.remove("dxi-popover-pointer");
    const target = e.target as HTMLElement;
    const all = items();
    const i = all.indexOf(target);
    const first = el.querySelector<HTMLElement>("summary") ?? all[0];
    const isRow = target.classList.contains("dxi-popover-inlink");
    const isSummary = target.tagName === "SUMMARY";
    let next: HTMLElement | undefined;
    switch (e.key) {
      case "ArrowDown":
        next = reveal || i < 0 ? first : all[Math.min(i + 1, all.length - 1)];
        break;
      case "ArrowUp":
        next = reveal || i < 0 ? first : all[Math.max(i - 1, 0)];
        break;
      case "Home":
        next = first;
        break;
      case "End":
        next = all[all.length - 1];
        break;
      case "ArrowRight":
        if (!isSummary) return;
        (target.parentElement as HTMLDetailsElement).open = true;
        break;
      case "ArrowLeft":
        if (isSummary) (target.parentElement as HTMLDetailsElement).open = false;
        else if (isRow) next = target.parentElement?.querySelector<HTMLElement>("summary") ?? undefined;
        else return;
        break;
      case "Enter":
      case " ":
        if (!isRow) return;
        followers.get(target)?.(e);
        break;
      default:
        return;
    }
    e.preventDefault();
    next?.focus();
  });
  (el.querySelector<HTMLElement>("summary") ?? el).focus();

  // Push a `Scope`, imitating Obsidian's modals, to allow the popover to act on Ctrl+Enter and Ctrl+Alt+Enter, otherwise Obsidian swallows the hotkeys before the popover sees them.
  const scope = new Scope(app.scope);
  const followFocused = (e: KeyboardEvent) => {
    const follow = followers.get(document.activeElement as HTMLElement);
    if (!follow) return true;
    follow(e);
    return false;
  };
  for (const mods of [["Mod"], ["Mod", "Alt"], ["Mod", "Alt", "Shift"]] as const) {
    scope.register([...mods], "Enter", followFocused);
  }
  app.keymap.pushScope(scope);

  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) closePopover();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    closePopover();
    returnTo?.focus();
  };
  // Defer so the click that opened the popover doesn't close it.
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  cleanup = () => {
    app.keymap.popScope(scope);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
}
