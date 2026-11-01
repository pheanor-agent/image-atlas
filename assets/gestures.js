'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasGestures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function createGestureController(adapter, options = {}) {
    const minZoom = options.minZoom || 1, maxZoom = options.maxZoom || 4;
    const pointers = new Map();
    let mode = 'idle', start = null, pinch = null, moved = false, blockedSwipe = false, lastTap = null;
    const point = event => ({ x: event.clientX, y: event.clientY });
    function reset() {
      pointers.clear(); mode = 'idle'; start = null; pinch = null; moved = false; blockedSwipe = true; lastTap = null;
      adapter.reset?.();
    }
    function down(event) {
      if (event.pointerType === 'mouse') {
        lastTap = null;
        if (event.button !== 0 || adapter.zoom() <= 1) return;
        pointers.set(event.pointerId, point(event)); mode = 'mouse'; start = { ...point(event), time: Date.now() };
        adapter.capture?.(event.pointerId); event.preventDefault?.(); return;
      }
      if (pointers.size === 0 && mode === 'idle') blockedSwipe = false;
      pointers.set(event.pointerId, point(event));
      adapter.capture?.(event.pointerId);
      if (pointers.size === 1) {
        mode = 'one'; start = { ...point(event), time: Date.now(), zoom: adapter.zoom() };
        moved = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], anchor = midpoint(a, b);
        mode = 'pinch'; blockedSwipe = true; moved = true; lastTap = null;
        pinch = { distance: distance(a, b) || 1, zoom: adapter.zoom(), anchor: adapter.captureAnchor?.(anchor) ?? anchor };
        event.preventDefault?.();
      } else {
        mode = 'blocked'; blockedSwipe = true; moved = true; lastTap = null; event.preventDefault?.();
      }
    }
    function move(event) {
      if (!pointers.has(event.pointerId)) return;
      const previous = pointers.get(event.pointerId), current = point(event);
      pointers.set(event.pointerId, current);
      if (mode === 'mouse') { adapter.panBy?.(previous.x - current.x, previous.y - current.y); moved = true; lastTap = null; event.preventDefault?.(); return; }
      if (mode === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const next = clamp(pinch.zoom * (distance(a, b) / pinch.distance), minZoom, maxZoom);
        adapter.setZoomAt?.(next, midpoint(a, b), pinch.anchor); event.preventDefault?.(); return;
      }
      if (mode === 'one' && start && start.zoom > 1) {
        adapter.panBy?.(previous.x - current.x, previous.y - current.y); moved = true; lastTap = null; event.preventDefault?.();
      } else if (mode === 'one' && start && Math.hypot(current.x - start.x, current.y - start.y) > 10) { moved = true; lastTap = null; }
    }
    function up(event, cancelled = false) {
      if (!pointers.has(event.pointerId)) return;
      const current = point(event), initial = start, oldMode = mode;
      pointers.delete(event.pointerId);
      if (cancelled) { blockedSwipe = true; moved = true; lastTap = null; }
      if (oldMode === 'pinch' || oldMode === 'blocked' || oldMode === 'mouse' || cancelled) {
        blockedSwipe = true;
        if (!pointers.size) { mode = 'idle'; start = null; pinch = null; }
        else if (pointers.size === 1) {
          const remaining = [...pointers.entries()][0];
          if (oldMode === 'pinch' && !cancelled) {
            mode = 'one'; start = { ...remaining[1], time: Date.now(), zoom: adapter.zoom() }; moved = true;
          } else { mode = 'blocked'; start = null; pinch = null; }
        }
        return;
      }
      if (pointers.size) return;
      mode = 'idle'; start = null;
      if (oldMode !== 'one' || !initial) return;
      const dx = current.x - initial.x, dy = current.y - initial.y;
      const elapsed = Date.now() - initial.time, now = Date.now();
      if (Math.hypot(dx, dy) < 12 && !moved) {
        const nearLastTap = lastTap && now - lastTap.time < 350 && Math.hypot(current.x - lastTap.point.x, current.y - lastTap.point.y) < 32;
        if (elapsed < 350 && nearLastTap) {
          const next = adapter.zoom() > 1 ? minZoom : Math.min(2, maxZoom);
          const anchor = adapter.captureAnchor?.(current) ?? current;
          adapter.setZoomAt?.(next, current, anchor); lastTap = null; blockedSwipe = true;
        } else lastTap = { time: now, point: current };
      } else if (initial.zoom <= 1 && !blockedSwipe && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        adapter.navigate?.(dx < 0 ? 1 : -1); blockedSwipe = true; lastTap = null;
      } else { blockedSwipe = true; lastTap = null; }
      if (!pointers.size) { pinch = null; moved = false; }
    }
    function attach(target) {
      target.addEventListener('pointerdown', down);
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', event => up(event, false));
      target.addEventListener('pointercancel', event => up(event, true));
      target.addEventListener('lostpointercapture', event => up(event, true));
      return { reset, down, move, up: event => up(event, false), cancel: event => up(event, true) };
    }
    return { reset, down, move, up: event => up(event, false), cancel: event => up(event, true), attach };
  }
  return { clamp, midpoint, distance, createGestureController };
});
