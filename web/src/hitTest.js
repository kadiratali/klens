function isHittable(node) {
  const { rect, attrs } = node;
  if (!rect || rect.w <= 0 || rect.h <= 0) return false;
  // Skip elements the platform reports as invisible (Appium Inspector does not).
  if (attrs.displayed === 'false' || attrs.visible === 'false') return false;
  return true;
}

function contains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * All visible nodes whose bounding box contains (x, y), best match first.
 * Unlike Appium Inspector's deepest-DFS pick, we rank by smallest area
 * (ties broken by depth), which handles overlays and full-screen containers
 * far better — and we return every candidate so the UI can offer them all.
 */
export function nodesAt(root, x, y) {
  const hits = [];
  (function walk(node) {
    if (isHittable(node) && contains(node.rect, x, y)) hits.push(node);
    node.children.forEach(walk);
  })(root);
  hits.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h || b.depth - a.depth);
  return hits;
}

/** Bounding box of the whole hierarchy — defines the coordinate space of rects. */
export function boundsSpace(root) {
  let maxX = 0;
  let maxY = 0;
  (function walk(node) {
    if (node.rect) {
      maxX = Math.max(maxX, node.rect.x + node.rect.w);
      maxY = Math.max(maxY, node.rect.y + node.rect.h);
    }
    node.children.forEach(walk);
  })(root);
  return { w: maxX, h: maxY };
}

/** Flat maps for O(1) lookups: id -> node, id -> parent id. */
export function indexTree(root) {
  const byId = new Map();
  const parentOf = new Map();
  (function walk(node, parent) {
    byId.set(node.id, node);
    if (parent) parentOf.set(node.id, parent.id);
    node.children.forEach((c) => walk(c, node));
  })(root, null);
  return { byId, parentOf };
}

export function ancestorIds(id, parentOf) {
  const ids = [];
  let cur = parentOf.get(id);
  while (cur !== undefined) {
    ids.push(cur);
    cur = parentOf.get(cur);
  }
  return ids;
}
