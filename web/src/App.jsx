import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { ancestorIds, boundsSpace, indexTree, nodesAt } from './hitTest.js';
import { applyDiff } from './treeDiff.js';
import SessionBar from './components/SessionBar.jsx';
import ScreenshotPane from './components/ScreenshotPane.jsx';
import TreePane from './components/TreePane.jsx';
import DetailPane from './components/DetailPane.jsx';

const HEALTH_POLL_MS = 3000;

// Live-mode polling backs off while the screen is idle and snaps back to the
// fast rate as soon as something changes (or the user acts).
function liveDelayMs(unchangedStreak) {
  if (unchangedStreak < 3) return 1200;
  if (unchangedStreak < 6) return 2000;
  if (unchangedStreak < 10) return 3000;
  return 5000;
}

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
  const [mode, setMode] = useState('inspect'); // 'inspect' | 'interact'
  const [live, setLive] = useState(false);

  const [shot, setShot] = useState(null); // base64 png
  const [tree, setTree] = useState(null);
  const [consistent, setConsistent] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [hits, setHits] = useState([]); // overlapping candidates at last click
  const [expanded, setExpanded] = useState(() => new Set());
  const [searchMatches, setSearchMatches] = useState([]); // matched node paths
  const [locators, setLocators] = useState(null); // suggestions for selected node

  // Refs so refresh() can diff against the latest tree without re-creating itself.
  const versionRef = useRef(null);
  const treeRef = useRef(null);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  // Single-flight guard shared by manual refresh, live polling and actions.
  const busyRef = useRef(false);
  const pendingRef = useRef(false);
  const unchangedStreakRef = useRef(0);

  const { byId, parentOf } = useMemo(
    () => (tree ? indexTree(tree) : { byId: new Map(), parentOf: new Map() }),
    [tree]
  );
  const space = useMemo(() => (tree ? boundsSpace(tree) : { w: 0, h: 0 }), [tree]);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (busyRef.current) {
      // A capture is already running; run once more when it finishes.
      pendingRef.current = true;
      return;
    }
    busyRef.current = true;
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      let res = await api.inspect(versionRef.current);
      unchangedStreakRef.current = res.unchanged ? unchangedStreakRef.current + 1 : 0;
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
      // The reconnect banner already covers this state; don't stack an error on it.
      if (err.code !== 'reconnecting') setError(err.message);
    } finally {
      busyRef.current = false;
      setLoading(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        refresh({ silent: true });
      }
    }
  }, []);

  useEffect(() => {
    if (sessionId) refresh();
  }, [sessionId, refresh]);

  // Live mode: setTimeout chain (never overlapping requests) with adaptive
  // back-off while the screen is idle. Actions reset the streak so the loop
  // speeds back up the moment something happens.
  useEffect(() => {
    if (!live || !sessionId) return;
    let cancelled = false;
    let timer;
    const tick = async () => {
      if (cancelled) return;
      if (!busyRef.current) await refresh({ silent: true });
      if (cancelled) return;
      timer = setTimeout(tick, liveDelayMs(unchangedStreakRef.current));
    };
    timer = setTimeout(tick, liveDelayMs(0));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [live, sessionId, refresh]);

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

  // 'i' toggles inspect/interact, 'l' toggles live mode — unless typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'i') setMode((m) => (m === 'inspect' ? 'interact' : 'inspect'));
      if (e.key === 'l') setLive((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Native menu actions from the Electron shell mirror the 'i'/'l' shortcuts.
  // In the browser build `window.klens` is undefined, so this is a no-op.
  useEffect(() => {
    return window.klens?.onMenuAction((action) => {
      if (action === 'toggle-mode') setMode((m) => (m === 'inspect' ? 'interact' : 'inspect'));
      if (action === 'toggle-live') setLive((v) => !v);
    });
  }, []);

  // Runs a device action, then re-captures so the view follows the device.
  const runAction = useCallback(
    async (fn) => {
      setError(null);
      busyRef.current = true; // hold off live polling while the action runs
      try {
        await fn();
      } catch (err) {
        setError(err.message);
      } finally {
        busyRef.current = false;
      }
      unchangedStreakRef.current = 0; // screen likely changed: poll fast again
      await refresh();
    },
    [refresh]
  );

  const doTap = useCallback(
    (x, y) => runAction(() => api.tap({ x: Math.round(x), y: Math.round(y) })),
    [runAction]
  );
  const doLongPress = useCallback(
    (x, y, durationMs) =>
      runAction(() => api.longPress({ x: Math.round(x), y: Math.round(y), durationMs })),
    [runAction]
  );
  const doSwipe = useCallback(
    (from, to, durationMs) =>
      runAction(() =>
        api.swipe({
          from: { x: Math.round(from.x), y: Math.round(from.y) },
          to: { x: Math.round(to.x), y: Math.round(to.y) },
          durationMs: Math.min(Math.round(durationMs), 2000),
        })
      ),
    [runAction]
  );
  const doType = useCallback(
    (path, text, clear) => runAction(() => api.type({ path, text, clear })),
    [runAction]
  );
  const doPressKey = useCallback((name) => runAction(() => api.pressKey(name)), [runAction]);

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
  const matchNodes = useMemo(
    () => searchMatches.map((p) => byId.get(p)).filter(Boolean),
    [searchMatches, byId]
  );

  // Locator suggestions for the selected element (computed server-side on the
  // snapshot; refreshed when the selection or the tree changes).
  useEffect(() => {
    if (!selected) {
      setLocators(null);
      return;
    }
    let stale = false;
    api
      .locators(selected.path)
      .then((res) => !stale && setLocators(res.locators))
      .catch(() => !stale && setLocators(null));
    return () => {
      stale = true;
    };
  }, [selected]);

  const runSearch = useCallback(
    async (strategy, query) => {
      if (!query) {
        setSearchMatches([]);
        return 0;
      }
      setError(null);
      try {
        const res = await api.search(strategy, query);
        setSearchMatches(res.matches);
        if (res.matches.length) selectNode(res.matches[0]);
        return res.total;
      } catch (err) {
        setError(err.message);
        return 0;
      }
    },
    [selectNode]
  );

  return (
    <div className="app">
      <SessionBar
        sessionId={sessionId}
        health={health}
        mode={mode}
        onModeChange={setMode}
        live={live}
        onLiveChange={setLive}
        onPressKey={doPressKey}
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
          mode={mode}
          selected={selected}
          hover={hover}
          onHover={handleShotHover}
          onInspectClick={handleShotClick}
          onTap={doTap}
          onLongPress={doLongPress}
          onSwipe={doSwipe}
          matches={matchNodes}
        />
        <TreePane
          tree={tree}
          selectedId={selectedId}
          hoverId={hoverId}
          expanded={expanded}
          setExpanded={setExpanded}
          onSelect={selectNode}
          onHover={setHoverId}
          matchSet={searchMatches}
          onSearch={runSearch}
        />
        <DetailPane
          selected={selected}
          hits={hits}
          locators={locators}
          onSelect={selectNode}
          onTapElement={(path) => runAction(() => api.tap({ path }))}
          onType={doType}
        />
      </div>
    </div>
  );
}
