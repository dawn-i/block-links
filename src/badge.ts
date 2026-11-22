import { editorInfoField, TFile } from "obsidian";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { IncomingRef, LinkIndex, blockKey, headingKey } from "./linkIndex";

/** Dispatch this to every editor when the index changes, to force a repaint. */
export const refreshEffect = StateEffect.define<null>();

export interface BadgeTarget {
  view: EditorView;
  anchor: HTMLElement;
  line: number; // 0-based
  kind: "heading" | "block";
  refs: IncomingRef[];
  title: string;
}

const HEADING_RE = /^ {0,3}#{1,6}\s+\S/;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

class BadgeWidget extends WidgetType {
  constructor(
    private count: number,
    private active: boolean,
    private line: number,
    private kind: "heading" | "block",
    private key: string,
    private onClick: (el: HTMLElement, view: EditorView) => void
  ) {
    super();
  }

  eq(other: BadgeWidget) {
    return (
      other.count === this.count &&
      other.active === this.active &&
      other.key === this.key &&
      other.line === this.line
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "dxi-badge" + (this.active ? " dxi-badge-active" : "");
    el.setAttribute("aria-label", `${this.count} incoming link${this.count === 1 ? "" : "s"}`);
    el.textContent = `↩ ${this.count}`;
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      this.onClick(el, view);
    });
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

export function badgeExtension(
  index: LinkIndex,
  open: (t: BadgeTarget) => void
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate) {
        const refreshed = u.transactions.some((t) => t.effects.some((e) => e.is(refreshEffect)));
        if (u.docChanged || u.selectionSet || u.viewportChanged || refreshed) {
          this.decorations = this.build(u.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const file = view.state.field(editorInfoField, false)?.file;
        if (!(file instanceof TFile)) return builder.finish();

        const refsByKey = index.refsFor(file);
        if (refsByKey.size === 0) return builder.finish();

        const doc = view.state.doc;
        const cursorLine = doc.lineAt(view.state.selection.main.head).number;
        const seen = new Set<number>();

        for (const range of view.visibleRanges) {
          const first = doc.lineAt(range.from).number;
          const last = doc.lineAt(range.to).number;
          for (let n = first; n <= last; n++) {
            if (seen.has(n)) continue;
            seen.add(n);
            const line = doc.line(n);
            const idx = n - 1;

            let kind: "heading" | "block" | null = null;
            let key = "";
            const bm = BLOCK_ID_RE.exec(line.text);
            if (HEADING_RE.test(line.text)) {
              kind = "heading";
              key = headingKey(idx);
            } else if (bm) {
              kind = "block";
              key = blockKey(bm[1]);
            }
            if (!kind) continue;

            const refs = refsByKey.get(key);
            if (!refs || refs.length === 0) continue;

            const title = line.text.replace(/^\s*#{1,6}\s+/, "").trim();
            const k = kind;
            builder.add(
              line.to,
              line.to,
              Decoration.widget({
                side: 1,
                widget: new BadgeWidget(refs.length, n === cursorLine, idx, k, key, (el, v) =>
                  open({ view: v, anchor: el, line: idx, kind: k, refs, title })
                ),
              })
            );
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}
