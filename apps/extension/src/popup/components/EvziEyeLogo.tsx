import { cn } from "@/lib/utils";

export type EvziEyeStatus = "blue" | "yellow" | "red" | "green";

/** Header status stripe + any UI that must stay in sync with the eye state (Playground#1). */
export const EVZI_STATUS_ACCENT: Record<EvziEyeStatus, string> = {
  blue: "#74CAFF",
  yellow: "#FFBE3B",
  green: "#29A383",
  red: "#E5484D",
};

/** Pixel assets you provided (exported from design); copied verbatim into `public/evzi-eye/`. */
const EYE_SRC: Record<EvziEyeStatus, string> = {
  blue: `${import.meta.env.BASE_URL}evzi-eye/blue.png`,
  yellow: `${import.meta.env.BASE_URL}evzi-eye/yellow.png`,
  red: `${import.meta.env.BASE_URL}evzi-eye/red.png`,
  green: `${import.meta.env.BASE_URL}evzi-eye/green.png`,
};

const STATUS_LABEL: Record<EvziEyeStatus, string> = {
  blue: "All clear",
  yellow: "Warning",
  red: "Error",
  green: "Success",
};

export interface EvziEyeLogoProps {
  status?: EvziEyeStatus;
  className?: string;
}

/**
 * Renders your original eye artwork per status (no vector redraw).
 * Files live in `public/evzi-eye/*.png` and are served as static assets.
 */
export function EvziEyeLogo({ status = "blue", className }: EvziEyeLogoProps) {
  const label = STATUS_LABEL[status];
  const src = EYE_SRC[status];

  return (
    <div className={cn("relative h-9 w-10 shrink-0", className)} role="img" aria-label={`Evzi — ${label}`}>
      <img src={src} alt="" width={40} height={36} className="h-9 w-10 object-contain object-left-top" draggable={false} />
    </div>
  );
}

export interface EvziStatusStripeProps {
  status?: EvziEyeStatus;
  className?: string;
}

/** Full-width 8px bar; color always matches `EVZI_STATUS_ACCENT` / eye state. */
export function EvziStatusStripe({ status = "blue", className }: EvziStatusStripeProps) {
  return (
    <div
      className={cn("h-[8px] w-full shrink-0", className)}
      style={{ backgroundColor: EVZI_STATUS_ACCENT[status] }}
      aria-hidden
    />
  );
}
