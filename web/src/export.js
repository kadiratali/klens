// Desktop-only helpers for exporting a locator into a source file: turning an
// element into a suggested constant name and filling the user's template.

function toCamelCase(raw) {
  const words = String(raw)
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w, i) =>
      i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join('');
}

// Pick the most identifying attribute and camel-case it, e.g.
// resource-id "com.app:id/login_button" -> "loginButton". The user confirms or
// edits the result before it's written, so a rough guess is fine.
export function suggestName(node) {
  const a = node?.attrs || {};
  const resourceId = a['resource-id'] || a.resourceId;
  const raw =
    (resourceId && resourceId.split('/').pop()) ||
    a['content-desc'] ||
    a.text ||
    (node?.tag || 'element').split('.').pop();
  return toCamelCase(raw) || 'element';
}

// Substitute {name} / {selector} / {strategy} placeholders in the user template.
export function fillTemplate(template, { name = '', selector = '', strategy = '' }) {
  return template
    .replaceAll('{name}', name)
    .replaceAll('{selector}', selector)
    .replaceAll('{strategy}', strategy);
}

export const DEFAULT_TEMPLATE = 'public static final String {name} = "{selector}";';

// Show just the file name in menus; keep the full path in a tooltip.
export function baseName(filePath) {
  return filePath.split(/[\\/]/).pop();
}
