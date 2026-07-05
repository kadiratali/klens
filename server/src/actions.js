// W3C actions payload builders + node lookup for element-targeted actions.

export function tapActions(x, y, holdMs = 50) {
  return {
    actions: [
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: Math.round(holdMs) },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  };
}

export function swipeActions(from, to, durationMs = 300) {
  return {
    actions: [
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: Math.round(from.x), y: Math.round(from.y) },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: Math.round(durationMs), x: Math.round(to.x), y: Math.round(to.y) },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  };
}

export function findNodeByPath(root, path) {
  if (!root) return null;
  let found = null;
  (function walk(n) {
    if (found) return;
    if (n.path === path) {
      found = n;
      return;
    }
    // Prune: a node can only contain descendants whose path extends its own.
    if (path.startsWith(n.path + '/')) n.children.forEach(walk);
  })(root);
  return found;
}

export function rectCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export const ANDROID_KEYCODES = { back: 4, home: 3, recents: 187 };
