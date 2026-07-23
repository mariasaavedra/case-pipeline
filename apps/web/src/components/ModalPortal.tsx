// =============================================================================
// ModalPortal — renders overlays directly under <body>
// =============================================================================
// `position: fixed` is only relative to the viewport when NO ancestor has a
// transform, filter or contain. Ours do: `.animate-in` is
// `animation: fadeIn 0.4s ease-out both`, and fadeIn's last keyframe is
// `transform: translateY(0)` — with fill-mode `both` that transform sticks
// around forever after the animation ends, making every `.animate-in` wrapper a
// containing block for fixed descendants.
//
// The visible bug: FilePreviewModal inside the Documents tab sized itself to the
// file listing instead of the screen, so a folder holding one document produced
// a preview a few rows tall. Every page shell is `.animate-in`, so this applies
// to every modal, not just that one.
//
// Portalling to <body> escapes the containing block entirely, which also means
// this keeps working if someone adds a transform to a different ancestor later.
// =============================================================================

import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
