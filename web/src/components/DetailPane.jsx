import React, { useState, useEffect, useCallback } from 'react';
import { locatorSnippet, SNIPPET_LANGS, STRATEGY_LABELS } from '../snippets.js';
import { suggestName, fillTemplate, baseName } from '../export.js';

// Desktop-only: writing to files needs the Electron bridge. In the browser
// build `window.klens` is undefined and every export affordance stays hidden.
const isDesktop = typeof window !== 'undefined' && !!window.klens?.isDesktop;

function isTypable(node) {
  const cls = node.attrs.class || node.tag;
  return /EditText|TextField|SearchView|AutoComplete/i.test(cls) || node.attrs.focusable === 'true';
}

function LocatorTable({ locators, onExportMenu }) {
  const [lang, setLang] = useState('java');
  const [copied, setCopied] = useState(null);

  function copy(key, value) {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 900);
  }

  return (
    <div className="locators">
      <div className="locators-head">
        <h3>Suggested locators</h3>
        <div className="lang-switch">
          {SNIPPET_LANGS.map((l) => (
            <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <table className="locator-table">
        <tbody>
          {locators.map((loc) => {
            const key = `${loc.strategy}:${loc.selector}`;
            const r = loc.robustness;
            const reasonText = r?.reasons.map((x) => `[${x.type}] ${x.text}`).join('\n');
            return (
              <tr
                key={key}
                onContextMenu={onExportMenu ? (e) => onExportMenu(e, loc, lang) : undefined}
                title={onExportMenu ? 'Right-click to copy or insert into a file' : undefined}
              >
                <td className="loc-strategy">{STRATEGY_LABELS[loc.strategy] || loc.strategy}</td>
                <td className="loc-selector" title={loc.selector}>
                  {loc.selector}
                </td>
                <td>
                  <span
                    className={`badge ${loc.matches === 1 ? 'unique' : 'dupe'}`}
                    title={loc.matches === 1 ? 'Matches exactly one element' : 'Matches multiple elements'}
                  >
                    {loc.matches === 1 ? 'unique' : `×${loc.matches}`}
                  </span>
                </td>
                {r && (
                  <td>
                    <span className={`robustness-badge ${r.label}`} title={reasonText}>
                      {r.label} {r.score}
                    </span>
                  </td>
                )}
                <td className="loc-actions">
                  <button onClick={() => copy(key, loc.selector)}>
                    {copied === key ? '✓' : 'Copy'}
                  </button>
                  <button
                    onClick={() => copy(key + lang, locatorSnippet(lang, loc))}
                    title={locatorSnippet(lang, loc)}
                  >
                    {copied === key + lang ? '✓' : 'Code'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Right-click menu + name prompt + template editor for writing a locator into a
// source file. Self-contained; only mounted on the desktop build.
function LocatorExporter({ selected, menu, setMenu, prefs, setPrefs, onToast }) {
  const [prompt, setPrompt] = useState(null); // { loc, filePath, name }
  const [templateDraft, setTemplateDraft] = useState(null); // string | null

  // Left-click anywhere (or Escape) dismisses the open context menu.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, setMenu]);

  const openPrompt = useCallback(
    (loc, filePath) => {
      setMenu(null);
      setPrompt({ loc, filePath, name: suggestName(selected) });
    },
    [selected, setMenu]
  );

  const chooseFile = useCallback(
    async (loc) => {
      const filePath = await window.klens.chooseTargetFile();
      if (filePath) openPrompt(loc, filePath);
      else setMenu(null);
    },
    [openPrompt, setMenu]
  );

  const confirmInsert = useCallback(async () => {
    const { loc, filePath, name } = prompt;
    const line = fillTemplate(prefs.template, {
      name,
      selector: loc.selector,
      strategy: loc.strategy,
    });
    const res = await window.klens.appendToFile(filePath, line);
    if (res.ok) {
      setPrefs((p) => ({ ...p, recentFiles: res.recentFiles }));
      onToast(`Added ${name} → ${baseName(filePath)}`);
    } else {
      onToast(`Failed: ${res.error}`);
    }
    setPrompt(null);
  }, [prompt, prefs.template, setPrefs, onToast]);

  const saveTemplate = useCallback(async () => {
    const next = await window.klens.setPrefs({ template: templateDraft });
    setPrefs(next);
    setTemplateDraft(null);
  }, [templateDraft, setPrefs]);

  const preview =
    prompt &&
    fillTemplate(prefs.template, {
      name: prompt.name,
      selector: prompt.loc.selector,
      strategy: prompt.loc.strategy,
    });

  return (
    <>
      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              navigator.clipboard.writeText(menu.loc.selector);
              setMenu(null);
            }}
          >
            Copy selector
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              navigator.clipboard.writeText(locatorSnippet(menu.lang, menu.loc));
              setMenu(null);
            }}
          >
            Copy as code ({menu.lang})
          </button>
          <div className="ctx-sep" />
          <div className="ctx-label">Insert into file</div>
          {prefs.recentFiles.length === 0 && (
            <div className="ctx-hint">No recent files yet</div>
          )}
          {prefs.recentFiles.map((f) => (
            <button
              key={f}
              className="ctx-item"
              title={f}
              onClick={() => openPrompt(menu.loc, f)}
            >
              {baseName(f)}
            </button>
          ))}
          <button className="ctx-item" onClick={() => chooseFile(menu.loc)}>
            Choose file…
          </button>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={() => setTemplateDraft(prefs.template)}>
            Edit template…
          </button>
        </div>
      )}

      {prompt && (
        <div className="modal-backdrop" onClick={() => setPrompt(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Insert locator</h3>
            <label className="field">
              Constant name
              <input
                autoFocus
                value={prompt.name}
                onChange={(e) => setPrompt((p) => ({ ...p, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && prompt.name.trim()) confirmInsert();
                  if (e.key === 'Escape') setPrompt(null);
                }}
              />
            </label>
            <div className="insert-preview">
              <span className="muted">→ {baseName(prompt.filePath)}</span>
              <code>{preview}</code>
            </div>
            <div className="modal-actions">
              <button onClick={() => setPrompt(null)}>Cancel</button>
              <button
                className="primary"
                disabled={!prompt.name.trim()}
                onClick={confirmInsert}
              >
                Append
              </button>
            </div>
          </div>
        </div>
      )}

      {templateDraft != null && (
        <div className="modal-backdrop" onClick={() => setTemplateDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Constant template</h3>
            <p className="muted">
              Placeholders: <code>{'{name}'}</code> <code>{'{selector}'}</code>{' '}
              <code>{'{strategy}'}</code>
            </p>
            <textarea
              rows={3}
              value={templateDraft}
              onChange={(e) => setTemplateDraft(e.target.value)}
            />
            <div className="modal-actions">
              <button onClick={() => setTemplateDraft(null)}>Cancel</button>
              <button className="primary" onClick={saveTemplate}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function DetailPane({ selected, hits, locators, onSelect, onTapElement, onType }) {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(null); // { x, y, loc, lang }
  const [prefs, setPrefs] = useState({ template: '', recentFiles: [] });
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!isDesktop) return;
    window.klens.getPrefs().then(setPrefs).catch(() => {});
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2500);
  }, []);

  const openMenu = useCallback((e, loc, lang) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, loc, lang });
  }, []);

  return (
    <section className="detail-pane">
      <h2>Element</h2>
      {hits.length > 1 && (
        <div className="candidates">
          <span className="muted">{hits.length} overlapping elements at this point:</span>
          <div className="candidate-chips">
            {hits.slice(0, 8).map((n) => (
              <button
                key={n.id}
                className={`chip ${selected?.id === n.id ? 'active' : ''}`}
                onClick={() => onSelect(n.id)}
                title={n.path}
              >
                {n.tag.split('.').pop()}
              </button>
            ))}
          </div>
        </div>
      )}
      {selected ? (
        <>
          <div className="xpath-row">
            <code className="xpath" title={selected.path}>
              {selected.path}
            </code>
            <button onClick={() => navigator.clipboard.writeText(selected.path)}>Copy</button>
          </div>
          <div className="element-actions">
            <button onClick={() => onTapElement(selected.path)} disabled={!selected.rect}>
              Tap element
            </button>
            <input
              placeholder={isTypable(selected) ? 'Text to type…' : 'Text (element may not accept input)'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onType(selected.path, text, false);
              }}
            />
            <button onClick={() => onType(selected.path, text, false)}>Type</button>
            <button onClick={() => onType(selected.path, text, true)} title="Clear the field first">
              Clear & type
            </button>
          </div>
          {locators && locators.length > 0 && (
            <LocatorTable locators={locators} onExportMenu={isDesktop ? openMenu : undefined} />
          )}
          <table className="attr-table">
            <tbody>
              {Object.entries(selected.attrs).map(([key, value]) => (
                <tr key={key}>
                  <td className="attr-key">{key}</td>
                  <td className="attr-val">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">Click the screenshot or a tree node to inspect an element.</p>
      )}

      {isDesktop && (
        <LocatorExporter
          selected={selected}
          menu={menu}
          setMenu={setMenu}
          prefs={prefs}
          setPrefs={setPrefs}
          onToast={showToast}
        />
      )}
      {toast && <div className="export-toast">{toast}</div>}
    </section>
  );
}
