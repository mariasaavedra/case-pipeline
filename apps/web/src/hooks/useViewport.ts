import { useState, useEffect } from "react";

/**
 * Responsive breakpoints. Keep these in sync with the media queries in styles.css.
 *
 *   width <= MOBILE_MAX            -> off-canvas drawer + hamburger (phones)
 *   MOBILE_MAX < width <= RAIL_MAX -> icon-only sidebar rail (tablets / split-screen)
 *   width > RAIL_MAX               -> full sidebar, respects manual collapse
 */
export const MOBILE_MAX = 640;
export const RAIL_MAX = 1024;

export interface Viewport {
  width: number;
  /** <= 640px: sidebar is an off-canvas drawer opened via the hamburger. */
  isMobile: boolean;
  /** 641–1024px: sidebar is forced to a 60px icon-only rail. */
  isTabletRail: boolean;
}

function read(): Viewport {
  const width = typeof window !== "undefined" ? window.innerWidth : 1280;
  return {
    width,
    isMobile: width <= MOBILE_MAX,
    isTabletRail: width > MOBILE_MAX && width <= RAIL_MAX,
  };
}

/**
 * Tracks the viewport width and derives the current sidebar layout mode.
 * rAF-throttled so resize handling stays cheap.
 */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(read);

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return vp;
}
