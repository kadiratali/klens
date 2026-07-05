import React, { useEffect, useState } from 'react';

function nodeLabel(node) {
  const a = node.attrs;
  const shortTag = node.tag.split('.').pop();
  const id = a['resource-id'] ? a['resource-id'].split('/').pop() : a.name || '';
  const text = a.text || a.label || a.value || '';
  return { shortTag, id, text };
}

function TreeNode({ node, selectedId, hoverId, matchSet, expanded, onToggle, onSelect, onHover }) {
  const isOpen = expanded.has(node.id);
  const { shortTag, id, text } = nodeLabel(node);
  const classes = [
    'tree-row',
    node.id === selectedId && 'selected',
    node.id === hoverId && 'hovered',
    matchSet.has(node.id) && 'match',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="tree-node">
      <div
        id={`tree-node-${node.id}`}
        className={classes}
        style={{ paddingLeft: `${node.depth * 14 + 6}px` }}
        onClick={() => onSelect(node.id)}
        onMouseEnter={() => onHover(node.id)}
        onMouseLeave={() => onHover(null)}
      >
        {node.children.length > 0 ? (
          <span
            className="twisty"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          >
            {isOpen ? '▾' : '▸'}
          </span>
        ) : (
          <span className="twisty leaf">·</span>
        )}
        <span className="tag">{shortTag}</span>
        {id && <span className="rid">#{id}</span>}
        {text && <span className="text">“{text.length > 30 ? text.slice(0, 30) + '…' : text}”</span>}
      </div>
      {isOpen &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            selectedId={selectedId}
            hoverId={hoverId}
            matchSet={matchSet}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
    </div>
  );
}

function SearchBar({ onSearch }) {
  const [strategy, setStrategy] = useState('text');
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(null);

  async function run() {
    setTotal(await onSearch(strategy, query));
  }

  function clear() {
    setQuery('');
    setTotal(null);
    onSearch(strategy, '');
  }

  return (
    <div className="search-row">
      <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
        <option value="text">Text</option>
        <option value="id">ID</option>
        <option value="xpath">XPath</option>
      </select>
      <input
        placeholder={strategy === 'xpath' ? '//android.widget.Button[@text="OK"]' : 'Search…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run();
          if (e.key === 'Escape') clear();
        }}
      />
      <button onClick={run}>Find</button>
      {total != null && (
        <span className={`search-count ${total ? '' : 'none'}`}>{total} match{total === 1 ? '' : 'es'}</span>
      )}
      {total != null && <button onClick={clear}>✕</button>}
    </div>
  );
}

export default function TreePane({
  tree,
  selectedId,
  hoverId,
  matchSet,
  onSearch,
  expanded,
  setExpanded,
  onSelect,
  onHover,
}) {
  useEffect(() => {
    if (selectedId == null) return;
    document
      .getElementById(`tree-node-${selectedId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <section className="tree-pane">
      <h2>Source</h2>
      <SearchBar onSearch={onSearch} />
      {tree ? (
        <div className="tree-scroll">
          <TreeNode
            node={tree}
            selectedId={selectedId}
            hoverId={hoverId}
            matchSet={new Set(matchSet)}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
            onHover={onHover}
          />
        </div>
      ) : (
        <p className="muted">No page source yet.</p>
      )}
    </section>
  );
}
