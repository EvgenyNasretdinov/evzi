import { cn } from "@/lib/utils";
import { AnimatedEye } from "./AnimatedEye";

/** Idle header mark: vector eye from `AnimatedEye.jsx` (motion + 15s cycle). */
export function EvziIdleEye({ className }: { className?: string }) {
  return (
    <div className={cn("shrink-0", className)} role="img" aria-label="Evzi">
      <AnimatedEye size={40} />
    </div>
  );
}
