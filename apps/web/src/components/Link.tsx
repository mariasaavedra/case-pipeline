import type { AnchorHTMLAttributes } from "react";
import { navigate } from "../router";

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/**
 * SPA-aware <a> wrapper. Normal click → pushState + popstate.
 * Ctrl/Cmd+click → opens in new tab (default browser behavior).
 */
export function Link({ href, onClick, children, ...rest }: Props) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) onClick(e);
    // Allow modifier keys for new-tab behavior
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
