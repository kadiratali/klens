import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { ancestorIds, boundsSpace, indexTree, nodesAt } from './hitTest.js';
import { applyDiff } from './treeDiff.js';
import SessionBar from './components/SessionBar.jsx';
import ScreenshotPane from './components/ScreenshotPane.jsx';
import TreePane from './components/TreePane.jsx';
import DetailPane from './components/DetailPane.jsx';

const HEALTH_POLL_MS = 3000;

function allIds(root) {
  const ids = new Set();
  (function walk(n) {
    ids.add(n.id);
    n.children.forEach(walk);
  })(root);
  return ids;
}

export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const [shot, setShot] = useState(null); // base64 png
  const [tree, setTree] = useState(null);
  const [consistent, setConsistent] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [hits, setHits] = useState([]); // overlapping candidates at last click
  const [expanded, setExpanded] = useState(() => new Set());

  // Refs so refresh() can diff against the latest tree without re-creating itself.
  const versionRef = useRef(null);
  const treeRef = useRef(null);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const { byId, parentOf } = useMemo(
    () => (tree ? indexTree(tree) : { byId: new Map(), parentOf: new Map() }),
    [tree]
  );
  const space = useMemo(() => (tree ? boundsSpace(tree) : { w: 0, h: 0 }), [tree]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res = await api.inspect(versionRef.current);
      if (!res.unchanged) {
        let nextTree = null;
        if (res.tree) {
          nextTree = res.tree;
        } else if (res.diff && treeRef.current) {
          try {
            nextTree = applyDiff(treeRef.current, res.diff);
          } catch {
            // Diff didn't apply cleanly — recover with a full capture.
            res = await api.inspect(null);
            nextTree = res.tree;
          }
        }
        if (nextTree) {
          setTree(nextTree);
          setExpanded((prev) => {
            if (res.tree || prev.size === 0) return allIds(nextTree);
            const next = new Set(prev);
            (res.diff?.added || []).forEach((a) => {
              (function walk(n) {
                next.add(n.id);
                n.children.forEach(walk);
              })(a.node);
            });
            return next;
          });
        }
      }
      setShot(res.base64);
      setConsistent(res.consistent !== false);
      setHits([]);
      versionRef.current = res.version ?? versionRef.current;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) refresh();
  }, [sessionId, refresh]);

  // Health polling: shows liveness and picks up the new session id after an
  // automatic reconnect (which then triggers a refresh via the effect above).
  useEffect(() => {
    if (!sessionId) {
      setHealth(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const h = await api.getHealth();
        if (cancelled) return;
        setHealth(h);
        if (h.sessionId && h.sessionId !== sessionId) setSessionId(h.sessionId);
      } catch {
        /* backend itself unreachable; keep last known state */
      }
    };
    poll();
    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  const selectNode = useCallback(
    (id) => {
      setSelectedId(id);
      if (id != null) {
        setExpanded((prev) => {
          const next = new Set(prev);
          ancestorIds(id, parentOf).forEach((a) => next.add(a));
          next.add(id);
          return next;
        });
      }
    },
    [parentOf]
  );

  const handleShotClick = useCallback(
    (x, y) => {
      if (!tree) return;
      const found = nodesAt(tree, x, y);
      setHits(found);
      selectNode(found.length ? found[0].id : null);
    },
    [tree, selectNode]
  );

  const handleShotHover = useCallback(
    (x, y) => {
      if (!tree) return setHoverId(null);
      const found = nodesAt(tree, x, y);
      setHoverId(found.length ? found[0].id : null);
    },
    [tree]
  );

  // Selection survives refreshes because ids are XPaths; it simply clears
  // if the element no longer exists on screen.
  const selected = selectedId != null ? byId.get(selectedId) || null : null;
  const hover = hoverId != null ? byId.get(hoverId) || null : null;

  return (
    <div className="app">
      <SessionBar
        sessionId={sessionId}
        health={health}
        onSessionChange={setSessionId}
        onRefresh={refresh}
        loading={loading}
        onError={setError}
      />
      {error && <div className="error-bar">{error}</div>}
      {health?.status === 'reconnecting' && (
        <div className="warn-bar">
          Session lost ({health.code}). Reconnecting — attempt{' '}
          {health.reconnect?.attempt ?? 1}/{health.reconnect?.maxAttempts ?? '?'}…
        </div>
      )}
      {health?.status === 'dead' && <div className="error-bar">{health.message}</div>}
      {!consistent && (
        <div className="warn-bar">
          Screen was still changing during capture — screenshot and hierarchy may not match
          exactly. Refresh when the screen settles.
        </div>
      )}
      <div className="main">
        <ScreenshotPane
          shot={shot}
          space={space}
          selected={selected}
          hover={hover}
          onHover={handleShotHover}
          onClick={handleShotClick}
        />
        <TreePane
          tree={tree}
          selectedId={selectedId}
          hoverId={hoverId}
          expanded={expanded}
          setExpanded={setExpanded}
          onSelect={selectNode}
          onHover={setHoverId}
        />
        <DetailPane selected={selected} hits={hits} onSelect={selectNode} />
      </div>
    </div>
  );
}
