import { useMemo, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import type { DecodedAction, UserIntent } from "@intent-check/types";
import { EvziEyeLogo, EvziStatusStripe, type EvziEyeStatus } from "./EvziEyeLogo";
import { amountsFromDecoded, type AmountRow } from "@/popup/lib/decodedDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function kindLabel(kind: UserIntent["kind"]) {
  return KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind;
}

export interface ConfirmIntentScreenProps {
  /** Iris reflects system posture; defaults to calm blue. */
  eyeStatus?: EvziEyeStatus;
  /** AI copy; override per response later. */
  aiMessage?: Partial<{ title: string; description: string }>;
  initial: UserIntent;
  /** Origin or full URL shown in the “Connected site” line. */
  connectedOrigin: string;
  decoded?: DecodedAction;
  /** When set, overrides decoded-derived amount rows (e.g. polished demo data). */
  amountPreview?: { from: AmountRow; to: AmountRow };
  onConfirm: (intent: UserIntent) => void;
  onClose?: () => void;
  onTalkToEvzi?: () => void;
  className?: string;
}

export function ConfirmIntentScreen({
  eyeStatus = "blue",
  aiMessage,
  initial,
  connectedOrigin,
  decoded,
  amountPreview,
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

  const rows = useMemo(() => {
    const d = amountPreview ?? amountsFromDecoded(decoded);
    if (d.from.amount !== "—" && d.to.amount !== "—") return d;
    return {
      from: { amount: "0,0002", symbol: "ETH" },
      to: { amount: "14,01", symbol: "USD" },
    };
  }, [amountPreview, decoded]);

  const [siteOk, setSiteOk] = useState<"yes" | "off">("yes");
  const [kind, setKind] = useState<UserIntent["kind"]>(initial.kind);
  const [fromAmount, setFromAmount] = useState(rows.from.amount);
  const [toAmount, setToAmount] = useState(rows.to.amount);
  const [notes, setNotes] = useState("");

  const siteLine = `Connected site ${connectedOrigin}`;

  function buildIntent(): UserIntent {
    const core = `${kindLabel(kind)} · ${fromAmount} ${rows.from.symbol} → ${toAmount} ${rows.to.symbol}`;
    const parts = [core];
    if (notes.trim()) parts.push(notes.trim());
    return {
      ...initial,
      kind,
      summary: parts.join(" — "),
      confidence: siteOk === "yes" ? 1 : 0.65,
    };
  }

  function handlePrimary() {
    onConfirm(buildIntent());
  }

  return (
    <section
      className={cn(
        "evzi-popup-surface shadow-popup flex max-h-[min(85vh,640px)] w-full max-w-[420px] flex-col overflow-hidden",
        className
      )}
    >
      <header className="flex shrink-0 items-center justify-between px-6 py-4">
        <EvziEyeLogo status={eyeStatus} />
        {onClose ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground/70" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <span className="h-8 w-8" aria-hidden />
        )}
      </header>

      <EvziStatusStripe status={eyeStatus} className="shrink-0" />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-6 py-6">
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-bold leading-8 tracking-tight text-foreground">{mergedAi.title}</h1>
            <p className="text-sm leading-5 text-neutral-800">{mergedAi.description}</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-6 px-6 py-6 pb-4">
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
          </div>

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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-normal text-neutral-800">From</Label>
              <div className="flex h-9 overflow-hidden rounded-md border border-input bg-background shadow-sm">
                <Input
                  value={fromAmount}
                  onChange={(e) => setFromAmount(e.target.value)}
                  className="h-9 flex-1 rounded-none border-0 shadow-none focus-visible:ring-0"
                  aria-label="From amount"
                />
                <div className="flex w-[3rem] shrink-0 items-center justify-end border-l border-border bg-muted/40 pr-3 text-sm text-muted-foreground">
                  {rows.from.symbol}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-normal text-neutral-800">To</Label>
              <div className="flex h-9 overflow-hidden rounded-md border border-input bg-background shadow-sm">
                <Input
                  value={toAmount}
                  onChange={(e) => setToAmount(e.target.value)}
                  className="h-9 flex-1 rounded-none border-0 shadow-none focus-visible:ring-0"
                  aria-label="To amount"
                />
                <div className="flex w-[3rem] shrink-0 items-center justify-end border-l border-border bg-muted/40 pr-3 text-sm text-muted-foreground">
                  {rows.to.symbol}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Textarea
              placeholder="Anything you want to add..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[4.5rem] resize-y text-sm shadow-sm"
            />
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-6 py-4">
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
    </section>
  );
}
