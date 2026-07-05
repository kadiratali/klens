import React, { useEffect } from 'react';

function nodeLabel(node) {
  const a = node.attrs;
  const shortTag = node.tag.split('.').pop();
  const id = a['resource-id'] ? a['resource-id'].split('/').pop() : a.name || '';
  const text = a.text || a.label || a.value || '';
  return { shortTag, id, text };
}

function TreeNode({ node, selectedId, hoverId, expanded, onToggle, onSelect, onHover }) {
  const isOpen = expanded.has(node.id);
  const { shortTag, id, text } = nodeLabel(node);
  const classes = [
    'tree-row',
    node.id === selectedId && 'selected',
    node.id === hoverId && 'hovered',
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
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
    </div>
  );
}

export default function TreePane({
  tree,
  selectedId,
  hoverId,
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
      {tree ? (
        <div className="tree-scroll">
          <TreeNode
            node={tree}
            selectedId={selectedId}
            hoverId={hoverId}
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
