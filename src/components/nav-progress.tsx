"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Top-of-viewport indeterminate progress bar that animates on every pathname
 * change. Driven entirely by client-side route detection. The bar grows toward
 * 90% over the duration of the transition, then snaps to 100% once the new
 * page renders, then fades out.
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const lastKey = useRef<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On initial mount, capture the first key so we don't animate on first paint.
  useEffect(() => {
    const key = `${pathname}?${searchParams?.toString() ?? ""}`;
    if (lastKey.current === null) {
      lastKey.current = key;
      return;
    }
    if (lastKey.current === key) return;
    lastKey.current = key;
    // New navigation just landed → snap to 100, fade, reset.
    setProgress(100);
    setVisible(true);
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 260);
  }, [pathname, searchParams]);

  const start = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setVisible(true);
    setProgress(15);
    tickRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        const delta = prev < 30 ? 4 : prev < 60 ? 2 : 0.7;
        return Math.min(prev + delta, 90);
      });
    }, 120);
  }, []);

  // Listen for link clicks to start the bar before the new render arrives.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor || event.defaultPrevented) return;
      if (anchor.target === "_blank") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      try {
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        const target = `${url.pathname}?${url.searchParams.toString()}`;
        if (target === lastKey.current) return;
      } catch {
        return;
      }
      start();
    };
    const handleSubmit = () => start();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, [start]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="h-full origin-left bg-gradient-to-r from-primary via-primary to-primary/60 shadow-[0_0_8px_var(--color-primary)] transition-all duration-200 ease-out"
        style={{
          transform: `scaleX(${progress / 100})`,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}
