/**
 * Applies a server diff ({ added, removed, changed }) to the client's tree.
 * Throws on any mismatch so the caller can fall back to a full fetch.
 */
export function applyDiff(root, diff) {
  const clone = structuredClone(root);
  const byPath = new Map();
  (function index(n) {
    byPath.set(n.path, n);
    n.children.forEach(index);
  })(clone);

  for (const c of diff.changed) {
    const node = byPath.get(c.path);
    if (!node) throw new Error(`diff mismatch: changed node not found: ${c.path}`);
    node.attrs = c.attrs;
    node.rect = c.rect;
  }

  for (const p of diff.removed) {
    const parent = byPath.get(p.slice(0, p.lastIndexOf('/')));
    if (!parent) throw new Error(`diff mismatch: parent of removed node not found: ${p}`);
    parent.children = parent.children.filter((ch) => ch.path !== p);
  }

  // Parents first (shorter paths), then by target index, so splice offsets hold.
  const adds = [...diff.added].sort(
    (a, b) => a.parentPath.length - b.parentPath.length || a.index - b.index
  );
  for (const a of adds) {
    const parent = byPath.get(a.parentPath);
    if (!parent) throw new Error(`diff mismatch: parent of added node not found: ${a.parentPath}`);
    parent.children.splice(Math.min(a.index, parent.children.length), 0, a.node);
    (function index(n) {
      byPath.set(n.path, n);
      n.children.forEach(index);
    })(a.node);
  }

  return clone;
}
