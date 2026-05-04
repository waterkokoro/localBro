import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FolderActionsMenu from "./FolderActionsMenu";

/**
 * Draggable floating action button. Positioned relative to the main
 * content area (the `.main` element) rather than the viewport, so it
 * automatically follows when the AI panel or preview pane expand /
 * collapse. Position is stored as right/bottom offsets from the main
 * area's bottom-right corner, which survives layout changes.
 *
 * Clicking the button (without dragging) opens `FolderActionsMenu`,
 * which is also reachable via right-click on empty space inside the
 * file list — both entry points share the exact same commands.
 */

const POS_KEY = "lb.fab.pos.v2";
const SIZE = 52;
const EDGE = 12;
const DRAG_THRESHOLD = 4;

interface Pos {
  right: number;
  bottom: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function clampPos(p: Pos, rect: Rect): Pos {
  const maxR = Math.max(EDGE, rect.width - SIZE - EDGE);
  const maxB = Math.max(EDGE, rect.height - SIZE - EDGE);
  return {
    right: Math.max(EDGE, Math.min(maxR, p.right)),
    bottom: Math.max(EDGE, Math.min(maxB, p.bottom)),
  };
}

function defaultPos(): Pos {
  return { right: 24, bottom: 24 };
}

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.right === "number" &&
      typeof parsed.bottom === "number"
    ) {
      return parsed as Pos;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function savePos(p: Pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota errors */
  }
}

export default function FloatingActions() {
  const { t } = useTranslation();
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<Pos>(() => loadPos() ?? defaultPos());
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  // Observe the main content area and mirror its bbox into state. When
  // AI/preview panels toggle, the main column resizes — ResizeObserver
  // fires, we re-render, and the FAB naturally slides to the new
  // right-bottom edge.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".main");
    if (!el) {
      // Fallback to viewport if the main area hasn't mounted yet.
      const update = () =>
        setRect({
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight,
        });
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Re-clamp the stored offsets when the main area shrinks so the FAB
  // never escapes. We deliberately don't save here — we preserve the
  // user's intended distance from the edge and only snap on drag end.
  useEffect(() => {
    if (!rect) return;
    setPos((p) => clampPos(p, rect));
  }, [rect?.width, rect?.height]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || !rect) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startR = pos.right;
      const startB = pos.bottom;
      let moved = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
          moved = true;
          setDragging(true);
          setOpen(false);
          document.body.style.userSelect = "none";
        }
        if (moved) {
          // Moving right (dx > 0) means the right-offset shrinks.
          setPos(
            clampPos(
              { right: startR - dx, bottom: startB - dy },
              rect,
            ),
          );
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        if (moved) {
          setDragging(false);
          setPos((p) => {
            savePos(p);
            return p;
          });
        } else {
          setOpen((v) => !v);
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos.right, pos.bottom, rect],
  );

  if (!rect) return null;

  const clamped = clampPos(pos, rect);
  const left = rect.right - SIZE - clamped.right;
  const top = rect.bottom - SIZE - clamped.bottom;

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={`fab${dragging ? " dragging" : ""}${open ? " active" : ""}`}
        style={{ left, top }}
        onMouseDown={onMouseDown}
        title={t("fab.title")}
        aria-label={t("fab.title")}
      >
        ＋
      </button>
      {open && (
        <FolderActionsMenu
          anchor={{
            // Bottom-right corner of the FAB → menu grows up-and-left.
            x: left + SIZE,
            y: top - 6,
            placement: "above",
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
