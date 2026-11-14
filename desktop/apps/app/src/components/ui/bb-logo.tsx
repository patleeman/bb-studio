import { cn } from "@bb/shared-ui/lib/utils";
const bbLogoUrl = "/icon-192.png";

export function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src={bbLogoUrl}
      alt=""
      aria-hidden="true"
      className={cn(className, "rounded-[22%] object-contain")}
    />
  );
}
