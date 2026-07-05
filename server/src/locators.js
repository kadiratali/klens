import { DOMParser } from '@xmldom/xmldom';
import xpathEngine from 'xpath';

/** Quote a value for XPath 1.0; returns null when it can't be quoted safely. */
function q(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return null; // contains both quote kinds; skip this candidate
}

/** Path (tag[index] per level) of a DOM element — same scheme as xmlParser. */
function domPath(el) {
  const segs = [];
  let cur = el;
  while (cur && cur.nodeType === 1) {
    let i = 1;
    let sib = cur.previousSibling;
    while (sib) {
      if (sib.nodeType === 1 && sib.nodeName === cur.nodeName) i += 1;
      sib = sib.previousSibling;
    }
    segs.unshift(`${cur.nodeName}[${i}]`);
    cur = cur.parentNode;
  }
  return '/' + segs.join('/');
}

/** Evaluate an XPath over the raw page source; returns matched node paths. */
export function xpathMatches(xml, query) {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  const nodes = xpathEngine.select(query, doc);
  if (!Array.isArray(nodes)) {
    throw new Error('XPath must select elements (not a string/number/boolean result)');
  }
  return nodes.filter((n) => n.nodeType === 1).map(domPath);
}

function countWhere(root, pred) {
  let count = 0;
  (function walk(n) {
    if (pred(n)) count += 1;
    n.children.forEach(walk);
  })(root);
  return count;
}

function ancestorsOf(root, path) {
  const chain = [];
  let cur = root;
  while (cur && path.startsWith(cur.path + '/')) {
    chain.push(cur);
    cur = cur.children.find((c) => path === c.path || path.startsWith(c.path + '/'));
  }
  return chain.reverse(); // nearest ancestor first
}

/** Shortest XPath that uniquely matches the node, verified against the XML. */
function optimizedXPath(node, root, xml) {
  const a = node.attrs;
  const candidates = [];
  const rid = a['resource-id'] ? q(a['resource-id']) : null;
  const desc = a['content-desc'] ? q(a['content-desc']) : null;
  const text = a.text ? q(a.text) : null;
  if (rid) candidates.push(`//${node.tag}[@resource-id=${rid}]`);
  if (rid && text) candidates.push(`//${node.tag}[@resource-id=${rid} and @text=${text}]`);
  if (desc) candidates.push(`//${node.tag}[@content-desc=${desc}]`);
  if (text) candidates.push(`//${node.tag}[@text=${text}]`);

  // Anchor on the nearest ancestor that has a unique resource-id, then append
  // the relative tag[index] segments (valid child-axis XPath by construction).
  for (const anc of ancestorsOf(root, node.path)) {
    const ancRid = anc.attrs['resource-id'] ? q(anc.attrs['resource-id']) : null;
    if (!ancRid) continue;
    candidates.push(`//${anc.tag}[@resource-id=${ancRid}]${node.path.slice(anc.path.length)}`);
    break;
  }

  for (const cand of candidates) {
    try {
      const matches = xpathMatches(xml, cand);
      if (matches.length === 1 && matches[0] === node.path) {
        return { selector: cand, matches: 1 };
      }
    } catch {
      /* malformed candidate; try the next one */
    }
  }
  return { selector: node.path, matches: 1 }; // absolute path always works
}

/**
 * Locator suggestions for a node, each with how many elements in the current
 * snapshot it matches (1 = unique, safe to use).
 */
export function suggestLocators(node, root, xml) {
  const a = node.attrs;
  const out = [];

  if (a['content-desc']) {
    out.push({
      strategy: 'accessibility-id',
      selector: a['content-desc'],
      matches: countWhere(root, (n) => n.attrs['content-desc'] === a['content-desc']),
    });
  }
  if (a['resource-id']) {
    out.push({
      strategy: 'id',
      selector: a['resource-id'],
      matches: countWhere(root, (n) => n.attrs['resource-id'] === a['resource-id']),
    });
  }
  if (a.text) {
    out.push({
      strategy: 'text',
      selector: a.text,
      matches: countWhere(root, (n) => n.attrs.text === a.text),
    });
  }

  // class + instance (UiSelector semantics: index among same-class nodes in
  // document order — matches exactly one element by construction).
  const cls = a.class || node.tag;
  let instance = 0;
  let seen = 0;
  (function walk(n) {
    if ((n.attrs.class || n.tag) === cls) {
      if (n.path === node.path) instance = seen;
      seen += 1;
    }
    n.children.forEach(walk);
  })(root);
  out.push({
    strategy: 'class-instance',
    selector: `${cls} #${instance}`,
    meta: { className: cls, instance },
    matches: 1,
  });

  out.push({ strategy: 'xpath', ...optimizedXPath(node, root, xml) });

  // Unique suggestions first, then stable order.
  return out.sort((x, y) => (x.matches === 1 ? 0 : 1) - (y.matches === 1 ? 0 : 1));
}
