import { useRef, useState } from "react";
import { errorMessage } from "../../kit/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../kit/ui/index";
import { Icon } from "../../kit/ui/index";
import { toast } from "sonner";
import type { PageMetaView } from "../contract";
import type { Rpc } from "./shared";

const PAGE_ICONS = ["📄", "📝", "📋", "✅", "📊", "📈", "🗺️", "🧭", "💡", "🚀", "🧪", "🛠️", "📚", "🗓️", "🎯", "🔥", "⭐", "🧠", "🤖", "📣"];

export function PageIconPicker({ page, rpc, children }: { page: PageMetaView; rpc: Rpc; children: React.ReactNode }) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const update = async (icon: string) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await rpc.call("pages.update", { id: page.id, icon });
    } catch (error) {
      toast.error("Couldn't change the page icon", { description: errorMessage(error) });
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2">
        <div className="grid grid-cols-8 gap-1">
          {PAGE_ICONS.map((icon) => (
            <button key={icon} type="button" disabled={pending} className="rounded p-1 text-lg hover:bg-state-hover" onClick={() => void update(icon)}>
              {icon}
            </button>
          ))}
        </div>
        {page.icon ? (
          <DropdownMenuItem disabled={pending} className="mt-1" onSelect={() => void update("")}>
            <Icon name="X" className="size-4" /> Remove icon
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
