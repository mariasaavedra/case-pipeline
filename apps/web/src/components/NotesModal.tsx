import type { ClientUpdate } from "../api";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

interface Props {
  updates: ClientUpdate[];
  title: string;
  onClose: () => void;
}

export function NotesModal({ updates, title, onClose }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="flex-shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
            {title}
          </DialogTitle>
          <DialogDescription>
            {updates.length} note{updates.length !== 1 ? "s" : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <UpdatesTimeline updates={updates} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
