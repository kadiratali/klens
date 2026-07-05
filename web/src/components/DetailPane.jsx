import React, { useState } from 'react';
import { locatorSnippet, SNIPPET_LANGS, STRATEGY_LABELS } from '../snippets.js';

function isTypable(node) {
  const cls = node.attrs.class || node.tag;
  return /EditText|TextField|SearchView|AutoComplete/i.test(cls) || node.attrs.focusable === 'true';
}

function LocatorTable({ locators }) {
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
            return (
              <tr key={key}>
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

export default function DetailPane({ selected, hits, locators, onSelect, onTapElement, onType }) {
  const [text, setText] = useState('');
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
          {locators && locators.length > 0 && <LocatorTable locators={locators} />}
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
    </section>
  );
}
