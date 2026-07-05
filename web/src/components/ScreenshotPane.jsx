import React, { useRef, useState } from 'react';

// Drags shorter than this (in on-screen px) count as a tap, not a swipe.
const TAP_SLOP_PX = 8;
// Holds longer than this before release count as a long-press.
const LONG_PRESS_MS = 600;

/** Converts a rect in bounds-space to percentage-based CSS so it tracks the
 *  rendered image size with zero resize handling. */
function rectStyle(rect, space) {
  return {
    left: `${(rect.x / space.w) * 100}%`,
    top: `${(rect.y / space.h) * 100}%`,
    width: `${(rect.w / space.w) * 100}%`,
    height: `${(rect.h / space.h) * 100}%`,
  };
}

export default function ScreenshotPane({
  shot,
  space,
  mode,
  selected,
  hover,
  onHover,
  onInspectClick,
  onTap,
  onLongPress,
  onSwipe,
}) {
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [feedback, setFeedback] = useState(null); // { xPct, yPct } tap ripple

  function toBoundsSpace(e) {
    const box = imgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * space.w,
      y: ((e.clientY - box.top) / box.height) * space.h,
    };
  }

  function showFeedback(e) {
    const box = imgRef.current.getBoundingClientRect();
    setFeedback({
      xPct: ((e.clientX - box.left) / box.width) * 100,
      yPct: ((e.clientY - box.top) / box.height) * 100,
    });
    setTimeout(() => setFeedback(null), 400);
  }

  function handleMouseDown(e) {
    if (mode !== 'interact') return;
    dragRef.current = { ...toBoundsSpace(e), clientX: e.clientX, clientY: e.clientY, t: Date.now() };
  }

  function handleMouseUp(e) {
    if (mode !== 'interact' || !dragRef.current) return;
    const start = dragRef.current;
    dragRef.current = null;
    const end = toBoundsSpace(e);
    const dist = Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY);
    const heldMs = Date.now() - start.t;
    showFeedback(e);
    if (dist < TAP_SLOP_PX) {
      if (heldMs >= LONG_PRESS_MS) onLongPress(end.x, end.y, heldMs);
      else onTap(end.x, end.y);
    } else {
      onSwipe(start, end, Math.max(heldMs, 100));
    }
  }

  if (!shot) {
    return (
      <section className="shot-pane empty">
        <p>Attach to a session and hit Refresh to capture the screen.</p>
      </section>
    );
  }

  return (
    <section className="shot-pane">
      <div className={`shot-wrap ${mode}`}>
        <img
          ref={imgRef}
          src={`data:image/png;base64,${shot}`}
          alt="device screenshot"
          draggable={false}
          onMouseMove={(e) => {
            if (mode !== 'inspect') return;
            const { x, y } = toBoundsSpace(e);
            onHover(x, y);
          }}
          onMouseLeave={() => {
            dragRef.current = null;
            onHover(-1, -1);
          }}
          onClick={(e) => {
            if (mode !== 'inspect') return;
            const { x, y } = toBoundsSpace(e);
            onInspectClick(x, y);
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
        {mode === 'inspect' && hover?.rect && space.w > 0 && (
          <div className="overlay hover-overlay" style={rectStyle(hover.rect, space)} />
        )}
        {mode === 'inspect' && selected?.rect && space.w > 0 && (
          <div className="overlay selected-overlay" style={rectStyle(selected.rect, space)} />
        )}
        {feedback && (
          <div className="tap-ripple" style={{ left: `${feedback.xPct}%`, top: `${feedback.yPct}%` }} />
        )}
      </div>
    </section>
  );
}
