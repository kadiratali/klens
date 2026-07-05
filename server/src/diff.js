// Incremental tree diff keyed by node path (tag + sibling index), so it is
// deterministic across parses. Structural shifts that rename sibling paths
// degrade to remove+add pairs; callers fall back to a full tree when churn
// is too high for a diff to be worth it.

function attrsEqual(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export function countNodes(root) {
  let n = 0;
  (function walk(node) {
    n += 1;
    node.children.forEach(walk);
  })(root);
  return n;
}

/**
 * Diff two parsed trees. Returns null when the roots don't line up
 * (caller should send the full tree instead).
 * added:   [{ parentPath, index, node }]  — node is the full new subtree
 * removed: [path]
 * changed: [{ path, attrs, rect }]        — same position, different attrs
 */
export function diffTrees(oldRoot, newRoot) {
  if (oldRoot.path !== newRoot.path) return null;
  const added = [];
  const removed = [];
  const changed = [];

  (function walkPair(o, n) {
    if (!attrsEqual(o.attrs, n.attrs)) {
      changed.push({ path: n.path, attrs: n.attrs, rect: n.rect });
    }
    const oldByPath = new Map(o.children.map((c) => [c.path, c]));
    const newPaths = new Set(n.children.map((c) => c.path));
    for (const oc of o.children) {
      if (!newPaths.has(oc.path)) removed.push(oc.path);
    }
    n.children.forEach((nc, i) => {
      const oc = oldByPath.get(nc.path);
      if (oc) walkPair(oc, nc);
      else added.push({ parentPath: n.path, index: i, node: nc });
    });
  })(oldRoot, newRoot);

  return { added, removed, changed };
}
