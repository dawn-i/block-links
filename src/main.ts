import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TFile, debounce } from "obsidian";
import { EditorView } from "@codemirror/view";
import { BadgeTarget, badgeExtension, lineTarget, refreshEffect } from "./badge";
import { LinkIndex } from "./linkIndex";
import { showPopover } from "./popover";
import { openNativeRename } from "./rename";

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
    const refs = ctx.file instanceof TFile && target ? this.index.refsFor(ctx.file).get(target.key) : undefined;
    if (!cm || !target || !refs || refs.length === 0) {
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
    showPopover(this.app, {
      anchor: t.anchor,
      title: t.title,
      refs: t.refs,
      pointer,
      onRename: () => {
        if (!view || !(view.file instanceof TFile)) {
          new Notice("Open the note in the editor first.");
          return;
        }
        openNativeRename(view, t.line, t.kind);
      },
    });
  }
}
