import { useEffect, useRef } from 'react';

// Rocky's fixed canvas dimensions
const ROCKY_W = 200;
const ROCKY_H = 250;
const MARGIN = 4; // Tight edge margin — stays inside window

/**
 * Maps a position command string or absolute screen point to renderer-relative coords.
 *
 * MULTI-MONITOR FIX: When a MOVE_AGENT event carries absolute OS screen coordinates
 * (anchor: 'near' or a raw {x, y} object), those coordinates come from Windows and
 * are relative to the virtual screen origin — not the Electron renderer window.
 * We subtract window.screenX / window.screenY (the Electron window's top-left corner
 * in screen space) to convert them to renderer-local coordinates.
 *
 * Named positions ('top left', 'center', etc.) are always relative to the renderer
 * window and need no translation.
 */
function getPosition(pos) {
  const W = window.innerWidth;
  const H = window.innerHeight;

  if (pos && typeof pos === 'object') {
    const rawX = Number(pos.x);
    const rawY = Number(pos.y);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;

    // Translate from absolute OS screen coords to renderer-relative coords.
    // window.screenX / window.screenY give the Electron window's position on the display.
    const rendererX = rawX - (window.screenX || 0);
    const rendererY = rawY - (window.screenY || 0);

    if (pos.anchor === 'near') {
      const preferLeft = rendererX > W * 0.55;
      const preferAbove = rendererY > H * 0.55;
      return {
        x: rendererX + (preferLeft ? -ROCKY_W - 28 : 28),
        y: rendererY + (preferAbove ? -ROCKY_H - 28 : 28),
      };
    }

    return {
      x: rendererX - ROCKY_W / 2,
      y: rendererY - ROCKY_H / 2,
    };
  }

  switch (pos) {
    case 'top left':
      return { x: MARGIN, y: MARGIN };
    case 'top right':
      return { x: W - ROCKY_W - MARGIN, y: MARGIN };
    case 'bottom left':
      return { x: MARGIN, y: H - ROCKY_H - MARGIN };
    case 'bottom right':
      return { x: W - ROCKY_W - MARGIN, y: H - ROCKY_H - MARGIN };
    case 'center':
      return { x: (W - ROCKY_W) / 2, y: (H - ROCKY_H) / 2 };
    default:
      return null;
  }
}

/**
 * Clamp position so Rocky never goes off-screen.
 */
function clamp(x, y) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    x: Math.max(0, Math.min(x, W - ROCKY_W)),
    y: Math.max(0, Math.min(y, H - ROCKY_H)),
  };
}

/**
 * useRockyMovement
 * Drives Rocky's position on screen using requestAnimationFrame + direct DOM transform.
 * Origin is top:0, left:0. All positions are absolute screen coords.
 */
export default function useRockyMovement(containerRef, agentState, movementCommand, movementDataRef) {
  // Start at bottom-left
  const startPos = getPosition('bottom left') || { x: MARGIN, y: window.innerHeight - ROCKY_H - MARGIN };
  const position = useRef({ ...startPos });
  const target   = useRef({ ...startPos });
  const time     = useRef(0);

  // Keep command and agentState fresh without restarting the rAF loop
  const commandRef = useRef(movementCommand);
  const agentStateRef = useRef(agentState);

  useEffect(() => { agentStateRef.current = agentState; }, [agentState]);

  // Whenever movementCommand changes, immediately resolve + lock the target
  useEffect(() => {
    commandRef.current = movementCommand;
    if (movementCommand) {
      const resolved = typeof movementCommand === 'string'
        ? getPosition(movementCommand.toLowerCase())
        : getPosition(movementCommand);
      if (resolved) {
        const safe = clamp(resolved.x, resolved.y);
        target.current = safe;
      }
    }
  }, [movementCommand]);

  // Single rAF loop — runs once, never restarts
  useEffect(() => {
    let animationFrameId;
    let isActive = true;

    const LERP = 0.08;

    const animate = () => {
      if (!isActive) return;
      time.current += 0.016;

      const hasCmd = !!commandRef.current;

      // State-based micro-movement only when no explicit command
      if (!hasCmd) {
        if (agentStateRef.current === 'listening') {
          // Slight upward attention shift — limited so he doesn't drift
          const lifted = clamp(target.current.x, target.current.y - 15);
          target.current.y = lifted.y;
        }
      }

      // Lerp toward target
      const dx = target.current.x - position.current.x;
      const dy = target.current.y - position.current.y;
      position.current.x += dx * LERP;
      position.current.y += dy * LERP;

      // Clamp current position too (window resize safety)
      const safe = clamp(position.current.x, position.current.y);
      position.current.x = safe.x;
      position.current.y = safe.y;

      // Update 3D rotation data for the animation controller
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (movementDataRef && movementDataRef.current) {
        if (distance > 4) {
          movementDataRef.current.angle = Math.atan2(dy, dx);
          movementDataRef.current.isMoving = true;
          movementDataRef.current.reachedTarget = false;
        } else {
          movementDataRef.current.isMoving = false;
          if (hasCmd) movementDataRef.current.reachedTarget = true;
        }
      }

      // Apply ONLY transform from (0,0) origin — no mixing with bottom/left offsets
      if (containerRef.current) {
        containerRef.current.style.transform =
          `translate(${Math.round(position.current.x)}px, ${Math.round(position.current.y)}px)`;
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      isActive = false;
      cancelAnimationFrame(animationFrameId);
    };
  }, [containerRef, movementDataRef]);

  return null;
}
