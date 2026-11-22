import { MarkdownView, Notice, Plugin, TFile, debounce } from "obsidian";
import { EditorView } from "@codemirror/view";
import { BadgeTarget, badgeExtension, refreshEffect } from "./badge";
import { LinkIndex } from "./linkIndex";
import { showPopover } from "./popover";
import { openNativeRename } from "./rename";

export default class BlockLinksPlugin extends Plugin {
  index!: LinkIndex;

  async onload() {
    this.index = new LinkIndex(this.app);

    this.registerEditorExtension(
      badgeExtension(this.index, (t) => this.openFor(t))
    );

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
    // Editor extensions and events registered through the plugin are removed by Obsidian; nothing else to clean up.
  }

  private refreshEditors() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
      cm?.dispatch({ effects: refreshEffect.of(null) });
    });
  }

  private openFor(t: BadgeTarget) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    showPopover(this.app, {
      anchor: t.anchor,
      title: t.title,
      refs: t.refs,
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
