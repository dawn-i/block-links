import { App, TFile, parseLinktext, resolveSubpath } from "obsidian";

/** One incoming link to a heading or block, as shown in the popover. */
export interface IncomingRef {
  sourcePath: string;
  /** 0-based line in the source file (0 for frontmatter links). */
  line: number;
  /** The link text as written, e.g. `[[note#heading]]`. */
  original: string;
  /** Set when the link lives in a frontmatter property (its name). */
  frontmatterKey?: string;
}

interface RawLink {
  targetPath: string;
  /** Includes the leading `#`, e.g. `#heading` or `#^block-id`. */
  subpath: string;
  line: number;
  original: string;
  frontmatterKey?: string;
}

export const headingKey = (line: number) => `h:${line}`;
export const blockKey = (id: string) => `b:${id.toLowerCase()}`;

/**
  Reverse index of links that point at a heading or block.
  
  Raw links are stored per source file. Subpaths are resolved lazily against the *target's* current metadata with Obsidian's own `resolveSubpath`, so the matching rules (case, punctuation, duplicate headings -> first one wins) are Obsidian's, not ours. Results are keyed by the heading's line or the block's id, never by heading text.
 */
export class LinkIndex {
  /** Bumped on any change; consumers use it to know when to repaint. */
  rev = 0;

  private raw = new Map<string, RawLink[]>();
  private incoming = new Map<string, Set<string>>();
  private memo = new Map<string, { rev: number; refs: Map<string, IncomingRef[]> }>();

  constructor(private app: App) {}

  rebuildAll() {
    this.raw.clear();
    this.incoming.clear();
    for (const file of this.app.vault.getMarkdownFiles()) this.scan(file);
    this.rev++;
  }

  indexFile(file: TFile) {
    if (file.extension !== "md") return;
    this.unscan(file.path);
    this.scan(file);
    this.rev++;
  }

  removeFile(path: string) {
    this.unscan(path);
    this.rev++;
  }

  /** key (see headingKey/blockKey) -> incoming refs, for one target file. */
  refsFor(target: TFile): Map<string, IncomingRef[]> {
    const hit = this.memo.get(target.path);
    if (hit && hit.rev === this.rev) return hit.refs;

    const refs = new Map<string, IncomingRef[]>();
    const cache = this.app.metadataCache.getFileCache(target);
    if (cache) {
      for (const sourcePath of this.incoming.get(target.path) ?? []) {
        for (const rl of this.raw.get(sourcePath) ?? []) {
          if (rl.targetPath !== target.path) continue;
          const res = resolveSubpath(cache, rl.subpath);
          if (!res) continue;
          let key: string;
          if (res.type === "heading") key = headingKey(res.current.position.start.line);
          else if (res.type === "block") key = blockKey(res.block.id);
          else continue; // footnotes aren't tracked
          const list = refs.get(key) ?? [];
          list.push({
            sourcePath,
            line: rl.line,
            original: rl.original,
            frontmatterKey: rl.frontmatterKey,
          });
          refs.set(key, list);
        }
      }
    }
    this.memo.set(target.path, { rev: this.rev, refs });
    return refs;
  }

  private scan(file: TFile) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return;

    const found: RawLink[] = [];
    const add = (link: string, original: string, line: number, frontmatterKey?: string) => {
      const { path, subpath } = parseLinktext(link);
      if (!subpath) return; // plain note link, not a heading/block link
      const target = path
        ? this.app.metadataCache.getFirstLinkpathDest(path, file.path)
        : file; // `[[#heading]]` -> this note
      if (!target) return;
      found.push({ targetPath: target.path, subpath, line, original, frontmatterKey });
    };

    for (const l of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
      add(l.link, l.original, l.position.start.line);
    }
    for (const l of cache.frontmatterLinks ?? []) {
      add(l.link, l.original, 0, l.key);
    }

    this.raw.set(file.path, found);
    for (const rl of found) {
      const set = this.incoming.get(rl.targetPath) ?? new Set<string>();
      set.add(file.path);
      this.incoming.set(rl.targetPath, set);
    }
  }

  private unscan(path: string) {
    for (const rl of this.raw.get(path) ?? []) {
      this.incoming.get(rl.targetPath)?.delete(path);
    }
    this.raw.delete(path);
  }
}
