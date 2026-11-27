import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TFile, debounce } from "obsidian";
import { EditorView } from "@codemirror/view";
import { BadgeTarget, badgeExtension, lineTarget, refreshEffect, refsForTarget } from "./badge";
import { LinkIndex } from "./linkIndex";
import { showPopover } from "./popover";
import { openRenameDialog } from "./rename";

export default class BlockLinksPlugin extends Plugin {
  index!: LinkIndex;

  async onload() {
    this.index = new LinkIndex(this.app);

    this.registerEditorExtension(
      badgeExtension(this.index, (t) => this.openFor(t, true))
    );

    this.addCommand({
      id: "show-incoming-links",
      name: "Show incoming links under cursor",
      editorCallback: (editor, ctx) => this.showUnderCursor(editor, ctx),
    });

    const refresh = debounce(() => this.refreshEditors(), 150, true);
    const rebuild = debounce(() => {
      this.index.rebuildAll();
      this.refreshEditors();
    }, 300, true);

    // The metadata cache isn't ready at load time on a cold start.
    this.app.workspace.onLayoutReady(() => {
      this.index.rebuildAll();
      this.refreshEditors();
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.index.indexFile(file);
        refresh();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("deleted", (file) => {
        this.index.removeFile(file.path);
        refresh();
      })
    );
    this.registerEvent(this.app.vault.on("rename", () => rebuild()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => rebuild()));
  }

  onunload() {
    // Obsidian removes editor extensions and events registered through the plugin; nothing else to clean up.
  }

  private refreshEditors() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
      cm?.dispatch({ effects: refreshEffect.of(null) });
    });
  }

  private showUnderCursor(editor: Editor, ctx: MarkdownView | MarkdownFileInfo) {
    const cm = (editor as unknown as { cm?: EditorView }).cm;
    const line = editor.getCursor().line;
    const target = lineTarget(editor.getLine(line), line);
    const refs =
      ctx.file instanceof TFile && target ? refsForTarget(this.index.refsFor(ctx.file), target) : [];
    if (!cm || !target || refs.length === 0) {
      new Notice("No incoming links under the cursor.");
      return;
    }

    // Anchor the popover to the line's badge; fall back to the line, then the editor.
    const node = cm.domAtPos(cm.state.doc.line(line + 1).from).node;
    const lineEl = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".cm-line");
    const anchor = lineEl?.querySelector<HTMLElement>(".dxi-badge") ?? lineEl ?? cm.dom;
    this.openFor({ view: cm, anchor, line, kind: target.kind, refs, title: target.title });
  }

  private openFor(t: BadgeTarget, pointer = false) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const rename = (kind: "heading" | "block") => () => {
      if (!view || !(view.file instanceof TFile)) {
        new Notice("Open the note in the editor first.");
        return;
      }
      openRenameDialog(view, t.line, kind);
    };

    // Offer the rename dialogs according to the line's incoming-link types: heading and/or block ID.
    const idCount = t.refs.filter((r) => r.viaBlock).length;
    const headingCount = t.refs.length - idCount;
    const viaId = idCount > 0;
    const viaHeading = t.kind === "heading" && headingCount > 0;
    const plural = (n: number) => `${n} link${n === 1 ? "" : "s"}`;

    // Warn what the rename kind leaves behind.
    const warn = (text: string) => () => new Notice(text, 8000);
    const hintHeading = warn(`${plural(idCount)} will break if you change the ^block-ID text at the end of this heading.\n\nBlock links do not update when renaming a heading.`);
    const hintId = warn(`${plural(headingCount)} will break if you rename this block ID.\n\nHeading links do not update when renaming a block ID.`);
    const renames =
      t.kind === "block" || (viaId && !viaHeading)
        ? [{ label: "Rename block ID...", run: rename("block") }]
        : viaId
          ? [
              {
                label: "Rename heading...",
                run: () => {
                  hintHeading();
                  rename("heading")();
                },
              },
              {
                label: "Rename block ID...",
                run: () => {
                  hintId();
                  rename("block")();
                },
              },
            ]
          : [{ label: "Rename heading...", run: rename("heading") }];

    showPopover(this.app, {
      anchor: t.anchor,
      title: t.title,
      refs: t.refs,
      currentPath: view?.file?.path,
      pointer,
      renames,
    });
  }
}
