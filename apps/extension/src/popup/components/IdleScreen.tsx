import { MessageCircle, X } from "lucide-react";
import { EvziIdleEye } from "./EvziIdleEye";
import { EvziStatusStripe } from "./EvziEyeLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const wordmarkSrc = () => `${import.meta.env.BASE_URL}evzi-idle/wordmark.svg`;

export interface IdleScreenProps {
  onClose?: () => void;
  onTalkToEvzi?: () => void;
  className?: string;
}

/** Figma Idle: wordmark row, blue stripe, status line + Talk to Evzi. */
export function IdleScreen({ onClose, onTalkToEvzi, className }: IdleScreenProps) {
  return (
    <section className={cn("evzi-popup-surface shadow-popup w-full max-w-[420px]", className)}>
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <EvziIdleEye />
          <img src={wordmarkSrc()} alt="EVZI." width={86} height={36} className="h-9 w-[86px] shrink-0 object-contain" draggable={false} />
        </div>
        {onClose ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground/70" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <span className="h-8 w-8" aria-hidden />
        )}
      </header>

      <EvziStatusStripe status="blue" />

      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <p className="text-sm font-normal leading-5 text-foreground">Keeping an eye...</p>
        <Button
          type="button"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 rounded-md border-border px-2.5 text-sm font-medium shadow-sm"
          onClick={() => onTalkToEvzi?.()}
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Talk to Evzi.
        </Button>
      </div>
    </section>
  );
}
