import { useMemo, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import type { DecodedAction, UserIntent } from "@intent-check/types";
import { EvziEyeLogo, EvziStatusStripe, type EvziEyeStatus } from "./EvziEyeLogo";
import type { AmountRow } from "@/popup/lib/decodedDisplay";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const DEFAULT_AI = {
  title: "Let's take a second look....",
  description: "I noticed a few things worth checking before you continue...",
} as const;

const KIND_OPTIONS: { value: UserIntent["kind"]; label: string }[] = [
  { value: "swap", label: "Swap" },
  { value: "approve", label: "Approve" },
  { value: "deposit", label: "Deposit" },
  { value: "mint", label: "Mint" },
  { value: "bridge", label: "Bridge" },
  { value: "transfer", label: "Transfer" },
  { value: "sign", label: "Sign message" },
  { value: "other", label: "Other" },
];

export interface ConfirmIntentScreenProps {
  /** Iris reflects system posture; defaults to calm blue. */
  eyeStatus?: EvziEyeStatus;
  /** AI copy; override per response later. */
  aiMessage?: Partial<{ title: string; description: string }>;
  initial: UserIntent;
  /** Origin or full URL shown in the “Connected site” line. */
  connectedOrigin: string;
  decoded?: DecodedAction;
  /** No longer used by the simplified screen; kept for backward-compat. */
  amountPreview?: { from: AmountRow; to: AmountRow };
  onConfirm: (intent: UserIntent) => void;
  onClose?: () => void;
  onTalkToEvzi?: () => void;
  className?: string;
}

/**
 * Simplified confirm screen — one editable summary is the primary input.
 * The kind dropdown lets the user override the inferred kind, and a
 * "what feels off" textarea appears only when the user flags the site.
 *
 * Concretely, when the user clicks "Something feels off", that signal
 *   1. lowers the user-stated confidence,
 *   2. adds the user's free-text concern to intent.summary so the LLM
 *      judge has the same gut feeling the user did when reasoning about
 *      whether to escalate to CAUTION/DANGER.
 */
export function ConfirmIntentScreen({
  eyeStatus = "blue",
  aiMessage,
  initial,
  connectedOrigin,
  // decoded is intentionally unused now; kept in props for compat with any
  // callers that pass it. The summary string from intent inference already
  // captures everything the user needs to confirm.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  decoded: _decoded,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  amountPreview: _amountPreview,
  onConfirm,
  onClose,
  onTalkToEvzi,
  className,
}: ConfirmIntentScreenProps) {
  const mergedAi = useMemo(
    () => ({
      title: aiMessage?.title ?? DEFAULT_AI.title,
      description: aiMessage?.description ?? DEFAULT_AI.description,
    }),
    [aiMessage?.title, aiMessage?.description]
  );

  const [siteOk, setSiteOk] = useState<"yes" | "off">("yes");
  const [kind, setKind] = useState<UserIntent["kind"]>(initial.kind);
  // Editable summary — pre-filled from the LLM's inferred summary.
  const [summary, setSummary] = useState(initial.summary);
  // Optional concern: only meaningful when siteOk === "off". Captures the user's
  // reason ("the dApp page UI changed", "URL has weird unicode", "amount looks wrong"),
  // which gets merged into the intent so the judge has it as additional context.
  const [concern, setConcern] = useState("");

  const siteLine = `Connected site ${connectedOrigin}`;

  function buildIntent(): UserIntent {
    const parts: string[] = [];
    const trimmedSummary = summary.trim();
    if (trimmedSummary.length > 0) parts.push(trimmedSummary);
    if (siteOk === "off" && concern.trim().length > 0) {
      parts.push(`User concern: ${concern.trim()}`);
    } else if (siteOk === "off") {
      parts.push("User flagged site as suspicious without specific reason.");
    }
    return {
      ...initial,
      kind,
      summary: parts.join(" — "),
      // When the user signals doubt, downweight confidence so the prompt's
      // trust ladder treats this as a "verify carefully" case.
      confidence: siteOk === "yes" ? Math.max(initial.confidence, 0.85) : 0.4,
    };
  }

  function handlePrimary() {
    onConfirm(buildIntent());
  }

  return (
    <section className={cn("evzi-popup-surface shadow-popup w-full max-w-[420px]", className)}>
      <header className="flex items-center justify-between px-6 py-4">
        <EvziEyeLogo status={eyeStatus} />
        {onClose ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground/70" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <span className="h-8 w-8" aria-hidden />
        )}
      </header>

      <EvziStatusStripe status={eyeStatus} />

      <div className="space-y-0">
        <div className="px-6 py-6">
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-bold leading-8 tracking-tight text-foreground">{mergedAi.title}</h1>
            <p className="text-sm leading-5 text-neutral-800">{mergedAi.description}</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-6 px-6 py-6">
          {/* Site sanity check + adjacent concern field. The "What feels off?"
              textarea sits directly under the toggle so the user's reasoning is
              captured at the moment they flag the site, not three fields away. */}
          <div className="space-y-2">
            <p className="text-sm leading-5 text-neutral-800">{siteLine}</p>
            <div className="inline-flex h-9 rounded-md bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setSiteOk("yes")}
                className={cn(
                  "rounded-md px-2 py-1 text-sm font-medium transition-colors",
                  siteOk === "yes"
                    ? "border border-border bg-background text-foreground shadow-sm"
                    : "text-foreground hover:bg-background/60"
                )}
              >
                Yes, that's right
              </button>
              <button
                type="button"
                onClick={() => setSiteOk("off")}
                className={cn(
                  "rounded-md px-2 py-1 text-sm font-medium transition-colors",
                  siteOk === "off"
                    ? "border border-border bg-background text-foreground shadow-sm"
                    : "text-foreground hover:bg-background/60"
                )}
              >
                Something feels off
              </button>
            </div>
            {siteOk === "off" && (
              <div className="space-y-2 pt-1">
                <Textarea
                  value={concern}
                  onChange={(e) => setConcern(e.target.value)}
                  placeholder="What feels off? e.g. URL has unusual characters, page just changed, amount looks bigger than I picked…"
                  className="min-h-[4rem] resize-y text-sm shadow-sm"
                  aria-label="What feels off"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Your note goes to the agent so it can look for what you noticed.
                </p>
              </div>
            )}
          </div>

          {/* Kind override — keeps the inferred kind unless the user disagrees. */}
          <div className="space-y-2">
            <Label className="text-sm font-normal text-neutral-800">Does this match what you're trying to do?</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as UserIntent["kind"])}>
              <SelectTrigger className="h-9 shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Primary input: the inferred summary, freely editable. */}
          <div className="space-y-2">
            <Label className="text-sm font-normal text-neutral-800">What you want to do</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="min-h-[5rem] resize-y text-sm shadow-sm"
              placeholder="Describe in your own words…"
              aria-label="Intent summary"
            />
          </div>
        </div>

        <Separator />

        <footer className="flex items-center justify-between gap-3 px-6 py-4">
          <Button
            type="button"
            className="h-9 rounded-md bg-[#171717] px-4 text-sm font-medium text-[#fafafa] shadow-sm hover:bg-[#171717]/90"
            onClick={handlePrimary}
          >
            Confirm and check
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 gap-1.5 rounded-md border-border px-2.5 text-sm font-medium shadow-sm"
            onClick={() => onTalkToEvzi?.()}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            Talk to Evzi.
          </Button>
        </footer>
      </div>
    </section>
  );
}
