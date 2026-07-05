import React, { useRef } from 'react';

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

export default function ScreenshotPane({ shot, space, selected, hover, onHover, onClick }) {
  const imgRef = useRef(null);

  function toBoundsSpace(e) {
    const box = imgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * space.w,
      y: ((e.clientY - box.top) / box.height) * space.h,
    };
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
      <div className="shot-wrap">
        <img
          ref={imgRef}
          src={`data:image/png;base64,${shot}`}
          alt="device screenshot"
          draggable={false}
          onMouseMove={(e) => {
            const { x, y } = toBoundsSpace(e);
            onHover(x, y);
          }}
          onMouseLeave={() => onHover(-1, -1)}
          onClick={(e) => {
            const { x, y } = toBoundsSpace(e);
            onClick(x, y);
          }}
        />
        {hover?.rect && space.w > 0 && (
          <div className="overlay hover-overlay" style={rectStyle(hover.rect, space)} />
        )}
        {selected?.rect && space.w > 0 && (
          <div className="overlay selected-overlay" style={rectStyle(selected.rect, space)} />
        )}
      </div>
    </section>
  );
}
