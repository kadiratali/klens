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

/** Shortest XPath that uniquely matches the node, verified against the XML.
 *  `basis` records which signal it relies on, so scoreRobustness doesn't
 *  have to re-derive it by parsing the selector string back apart. */
function optimizedXPath(node, root, xml) {
  const a = node.attrs;
  const rid = a['resource-id'] ? q(a['resource-id']) : null;
  const desc = a['content-desc'] ? q(a['content-desc']) : null;
  const text = a.text ? q(a.text) : null;
  const candidates = [];
  if (rid) candidates.push({ selector: `//${node.tag}[@resource-id=${rid}]`, basis: 'resource-id' });
  if (rid && text)
    candidates.push({
      selector: `//${node.tag}[@resource-id=${rid} and @text=${text}]`,
      basis: 'resource-id+text',
    });
  if (desc) candidates.push({ selector: `//${node.tag}[@content-desc=${desc}]`, basis: 'content-desc' });
  if (text) candidates.push({ selector: `//${node.tag}[@text=${text}]`, basis: 'text' });

  // Anchor on the nearest ancestor that has a unique resource-id, then append
  // the relative tag[index] segments (valid child-axis XPath by construction).
  let ancestorSuffix = null;
  for (const anc of ancestorsOf(root, node.path)) {
    const ancRid = anc.attrs['resource-id'] ? q(anc.attrs['resource-id']) : null;
    if (!ancRid) continue;
    ancestorSuffix = node.path.slice(anc.path.length);
    candidates.push({
      selector: `//${anc.tag}[@resource-id=${ancRid}]${ancestorSuffix}`,
      basis: 'ancestor-resource-id',
      relSuffix: ancestorSuffix,
    });
    break;
  }

  for (const cand of candidates) {
    try {
      const matches = xpathMatches(xml, cand.selector);
      if (matches.length === 1 && matches[0] === node.path) {
        return { selector: cand.selector, matches: 1, basis: cand.basis, relSuffix: cand.relSuffix };
      }
    } catch {
      /* malformed candidate; try the next one */
    }
  }
  return { selector: node.path, matches: 1, basis: 'absolute' }; // always works
}

// --- Robustness scoring -----------------------------------------------------
// Deterministic, rule-based estimate of "will this locator still correctly
// identify the same element after the app changes" — distinct from `matches`,
// which is only about *right now*. No LLM involved.

const BASE_SCORE = {
  'content-desc': 85,
  'resource-id': 80,
  'resource-id+text': 80,
  text: 55,
  'ancestor-resource-id': 55,
  position: 35,
  absolute: 15,
};

const ID_HASHLIKE_RE = /^[0-9a-f]{6,}$/i;
const ID_GENERIC_RE = /^(view|widget|layout|element|node)[0-9]+$/i;
const NUMERIC_TEXT_RE = /^\d+([.,]\d+)?$/;
const DATE_TEXT_RE = /\d{1,2}[/.\-]\d{1,2}([/.\-]\d{2,4})?/;

function idLocalName(resourceId) {
  const idx = resourceId.lastIndexOf('/');
  return idx >= 0 ? resourceId.slice(idx + 1) : resourceId;
}

function scoreResourceId(resourceId) {
  const local = idLocalName(resourceId);
  if (local.length <= 2 || ID_HASHLIKE_RE.test(local) || ID_GENERIC_RE.test(local)) {
    return {
      delta: -35,
      reason: {
        type: 'negative',
        text: `"${local}" derleyici tarafından otomatik üretilmiş bir kimliğe benziyor; build'ler arası değişebilir.`,
      },
    };
  }
  return { delta: 5, reason: { type: 'positive', text: 'Anlamlı, elle verilmiş bir kaynak kimliği.' } };
}

function scoreText(text) {
  if (NUMERIC_TEXT_RE.test(text.trim())) {
    return {
      delta: -25,
      reason: { type: 'negative', text: 'Metin sayısal görünüyor; içerikle birlikte sık değişebilir.' },
    };
  }
  if (DATE_TEXT_RE.test(text)) {
    return { delta: -25, reason: { type: 'negative', text: 'Metin tarih gibi görünüyor; her görüntülemede değişir.' } };
  }
  if (text.length > 40) {
    return {
      delta: -20,
      reason: { type: 'negative', text: 'Metin uzun; kullanıcı verisi veya dinamik içerik olabilir.' },
    };
  }
  return { delta: 0, reason: { type: 'warning', text: 'Metin lokalizasyona bağlı; uygulama dili değişirse kırılır.' } };
}

function hasNonFirstIndex(relPath) {
  return [...relPath.matchAll(/\[(\d+)\]/g)].some((m) => Number(m[1]) > 1);
}

function labelFor(score) {
  if (score >= 70) return 'robust';
  if (score >= 35) return 'moderate';
  return 'fragile';
}

// Direct (non-xpath) strategies map to the same "kind" vocabulary xpath's
// `basis` uses, so both go through one scoring path below.
const STRATEGY_TO_KIND = {
  'accessibility-id': 'content-desc',
  id: 'resource-id',
  text: 'text',
  'class-instance': 'position',
};

/** Robustness score (0-100) + human-readable reasons for a single candidate. */
function scoreRobustness(loc, ctx) {
  const kind = loc.strategy === 'xpath' ? loc.basis : STRATEGY_TO_KIND[loc.strategy];
  let score = BASE_SCORE[kind] ?? 50;
  const reasons = [];

  const idValue = loc.strategy === 'id' ? loc.selector : ctx.resourceId;
  const textValue = loc.strategy === 'text' ? loc.selector : ctx.text;

  if (kind === 'resource-id' || kind === 'resource-id+text') {
    const r = scoreResourceId(idValue);
    score += r.delta;
    reasons.push(r.reason);
    if (kind === 'resource-id+text') {
      score -= 5;
      reasons.push({ type: 'warning', text: 'Metin koşulu da ekleniyor; gereksiz yere kırılganlık katabilir.' });
    }
  } else if (kind === 'text') {
    const r = scoreText(textValue);
    score += r.delta;
    reasons.push(r.reason);
  } else if (kind === 'content-desc') {
    reasons.push({ type: 'positive', text: 'Erişilebilirlik amaçlı etiketler genelde kararlıdır.' });
  } else if (kind === 'position') {
    const penalty = Math.min(25, ctx.sameClassCount * 3);
    score -= penalty;
    reasons.push({
      type: 'negative',
      text: `Konuma bağlı (aynı sınıftan ${ctx.sameClassCount} eleman var); sıralama veya koşullu görünürlük değişirse kırılabilir.`,
    });
  } else if (kind === 'ancestor-resource-id') {
    reasons.push({
      type: 'warning',
      text: 'Benzersiz kimlikli bir üst elemente göreli; üst eleman kararlıysa iyi bir seçenektir.',
    });
    if (loc.relSuffix && hasNonFirstIndex(loc.relSuffix)) {
      score -= 10;
      reasons.push({
        type: 'negative',
        text: 'Göreli yol içinde sıra numarası kullanıyor; kardeş sayısı değişirse kırılabilir.',
      });
    }
  } else if (kind === 'absolute') {
    reasons.push({
      type: 'negative',
      text: 'Mutlak yol; ekrandaki en ufak yapısal değişiklik bile bunu kırar. Son çare olarak kullan.',
    });
  }

  if (loc.matches !== 1) {
    score = Math.min(score, 20);
    reasons.push({ type: 'negative', text: `Şu anda tek bir elemente karşılık gelmiyor (×${loc.matches} eşleşme).` });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: labelFor(score), reasons };
}

/**
 * Locator suggestions for a node, each with how many elements in the current
 * snapshot it matches (1 = unique, safe to use) and a deterministic
 * robustness score/label/reasons (independent of current uniqueness).
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

  const ctx = { resourceId: a['resource-id'], text: a.text, sameClassCount: seen };
  for (const loc of out) loc.robustness = scoreRobustness(loc, ctx);

  // Unique first, then most robust first within each group.
  return out.sort((x, y) => {
    const uniqueDiff = (x.matches === 1 ? 0 : 1) - (y.matches === 1 ? 0 : 1);
    return uniqueDiff !== 0 ? uniqueDiff : y.robustness.score - x.robustness.score;
  });
}
