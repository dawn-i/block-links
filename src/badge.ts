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

export interface LineTarget {
  kind: "heading" | "block";
  /** Index key for the line itself; see headingKey/blockKey. */
  key: string;
  /** The line's block ID, if it has one. */
  blockId?: string;
  title: string;
}

/** Classifies a line as a heading, a block-ID line, or null (won't have a badge). */
export function lineTarget(text: string, idx: number): LineTarget | null {
  const bm = BLOCK_ID_RE.exec(text);
  if (HEADING_RE.test(text)) {
    const full = text.replace(/^\s*#{1,6}\s+/, "").trim();
    // A heading's title is its name, without any block ID.
    const title = (bm ? full.replace(BLOCK_ID_RE, "").trim() : full) || full;
    return { kind: "heading", key: headingKey(idx), blockId: bm?.[1], title };
  }
  // A block's title is a caret and block ID, without additional line text.
  if (bm) return { kind: "block", key: blockKey(bm[1]), blockId: bm[1], title: `^${bm[1]}` };
  return null;
}

/**
  All incoming links for a line's badge. A link to a heading's block ID is marked with `viaBlock` so the popover can tell it from a link to the heading.
 */
export function refsForTarget(byKey: Map<string, IncomingRef[]>, t: LineTarget): IncomingRef[] {
  const own = byKey.get(t.key) ?? [];
  if (t.kind !== "heading" || !t.blockId) return own;
  const viaBlock = `^${t.blockId}`;
  const viaId = (byKey.get(blockKey(t.blockId)) ?? []).map((r) => ({ ...r, viaBlock }));
  return [...own, ...viaId];
}

class BadgeWidget extends WidgetType {
  constructor(
    private count: number,
    /** How many of a heading's `count` link to the block ID rather than to the heading section. */
    private viaBlock: number,
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
      other.viaBlock === this.viaBlock &&
      other.active === this.active &&
      other.kind === this.kind &&
      other.key === this.key &&
      other.line === this.line
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = `dxi-badge dxi-badge-${this.kind}` + (this.active ? " dxi-badge-active" : "");
    let label = `${this.count} incoming link${this.count === 1 ? "" : "s"}`;
    if (this.viaBlock > 0 && this.viaBlock < this.count) {
      label += `: ${this.count - this.viaBlock} to heading, ${this.viaBlock} to block ID`;
    }
    el.setAttribute("aria-label", label);
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

            const target = lineTarget(line.text, idx);
            if (!target) continue;
            const { kind, key, title } = target;

            const refs = refsForTarget(refsByKey, target);
            if (refs.length === 0) continue;
            const viaBlock = refs.filter((r) => r.viaBlock).length;

            const k = kind;
            builder.add(
              line.to,
              line.to,
              Decoration.widget({
                side: 1,
                widget: new BadgeWidget(refs.length, viaBlock, n === cursorLine, idx, k, key, (el, v) =>
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
