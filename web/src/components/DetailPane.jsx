import React from 'react';

export default function DetailPane({ selected, hits, onSelect }) {
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
