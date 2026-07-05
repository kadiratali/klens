import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  trimValues: true,
});

const ANDROID_BOUNDS_RE = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

function rectFromAttrs(attrs) {
  // Android (uiautomator2): bounds="[x1,y1][x2,y2]"
  if (attrs.bounds) {
    const m = ANDROID_BOUNDS_RE.exec(attrs.bounds);
    if (m) {
      const [x1, y1, x2, y2] = m.slice(1).map(Number);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }
  // iOS (XCUITest): x / y / width / height attributes (in points)
  if (attrs.x !== undefined && attrs.width !== undefined) {
    const x = Number(attrs.x);
    const y = Number(attrs.y);
    const w = Number(attrs.width);
    const h = Number(attrs.height);
    if ([x, y, w, h].every(Number.isFinite)) return { x, y, w, h };
  }
  return null;
}

/**
 * Parses an Appium page source XML string into a JSON tree.
 * Each node: { id, tag, attrs, rect, path, depth, children }
 * `rect` is in the coordinate space of the source (px on Android, pt on iOS).
 * `path` is an absolute XPath usable to relocate the element; `id` equals
 * `path` so node identity is stable across refreshes (enables incremental
 * diffs and selection that survives a refresh).
 */
export function parsePageSource(xml) {
  const parsed = parser.parse(xml);

  function transform(raw, parentPath, depth, siblingIndexes) {
    const tag = Object.keys(raw).find((k) => k !== ':@' && k !== '#text');
    // Skip processing instructions (<?xml ...?>) and comments.
    if (!tag || tag.startsWith('?') || tag.startsWith('!')) return null;

    siblingIndexes[tag] = (siblingIndexes[tag] || 0) + 1;
    const path = `${parentPath}/${tag}[${siblingIndexes[tag]}]`;
    const attrs = raw[':@'] || {};
    const node = {
      id: path,
      tag,
      attrs,
      rect: rectFromAttrs(attrs),
      path,
      depth,
      children: [],
    };

    const childIndexes = {};
    for (const child of raw[tag] || []) {
      const childNode = transform(child, path, depth + 1, childIndexes);
      if (childNode) node.children.push(childNode);
    }
    return node;
  }

  const rootIndexes = {};
  for (const raw of parsed) {
    const node = transform(raw, '', 0, rootIndexes);
    if (node) return node;
  }
  throw new Error('No element found in page source XML');
}
