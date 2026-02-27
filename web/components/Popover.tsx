import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Click-outside dismissable popover. Positioned absolute relative to parent.
 * Parent should have `position: relative`.
 */
export function Popover({ open, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={ref} className="snapshot-popover card-elevated animate-in">
      {children}
    </div>
  );
}
