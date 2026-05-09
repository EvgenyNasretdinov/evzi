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

/**
 * Field schema per intent kind. Drives which inputs the confirm screen
 * renders so non-swap intents don't show a meaningless From/To grid.
 *
 * Each field has a key, label, and optional default value or unit suffix.
 * The schema returns 0-2 fields; anything richer (NFT collection lookups,
 * bridge chain selection) lives in M3+.
 */
type IntentField = { key: string; label: string; value: string; unit?: string; placeholder?: string };

function shortAddr(a?: string) {
  if (!a) return "";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function fieldsForKind(kind: UserIntent["kind"], decoded: DecodedAction | undefined, swapRows: { from: AmountRow; to: AmountRow }): IntentField[] {
  switch (kind) {
    case "swap":
      return [
        { key: "from", label: "From",  value: swapRows.from.amount, unit: swapRows.from.symbol },
        { key: "to",   label: "To",    value: swapRows.to.amount,   unit: swapRows.to.symbol },
      ];
    case "approve":
      if (decoded?.kind === "approve") {
        return [
          { key: "token",   label: "Token",   value: shortAddr(decoded.token), placeholder: "Token address" },
          { key: "spender", label: "Spender", value: shortAddr(decoded.spender), placeholder: "Who can spend it" },
          { key: "amount",  label: "Amount",  value: decoded.isUnlimited ? "unlimited" : decoded.amount, placeholder: "Allowance" },
        ];
      }
      return [
        { key: "token",   label: "Token",   value: "", placeholder: "Token address or symbol" },
        { key: "spender", label: "Spender", value: "", placeholder: "Who can spend it" },
        { key: "amount",  label: "Amount",  value: "", placeholder: "Allowance (or 'unlimited')" },
      ];
    case "transfer":
      if (decoded?.kind === "transfer") {
        return [
          { key: "token",     label: "Token",     value: shortAddr(decoded.token), placeholder: "Token" },
          { key: "amount",    label: "Amount",    value: decoded.amount, placeholder: "Amount" },
          { key: "recipient", label: "Recipient", value: shortAddr(decoded.to), placeholder: "Recipient address" },
        ];
      }
      return [
        { key: "token",     label: "Token",     value: "", placeholder: "Token" },
        { key: "amount",    label: "Amount",    value: "", placeholder: "Amount" },
        { key: "recipient", label: "Recipient", value: "", placeholder: "Recipient address" },
      ];
    case "mint":
      return [
        { key: "collection", label: "Collection", value: "", placeholder: "NFT collection name" },
        { key: "count",      label: "Count",      value: "1" },
        { key: "price",      label: "Price",      value: "", placeholder: "Per-mint price" },
      ];
    case "bridge":
      return [
        { key: "token",   label: "Token",  value: "", placeholder: "Token to bridge" },
        { key: "amount",  label: "Amount", value: "" },
        { key: "toChain", label: "To chain", value: "", placeholder: "e.g. Optimism" },
      ];
    case "deposit":
      return [
        { key: "token",  label: "Token",   value: "", placeholder: "Asset to deposit" },
        { key: "amount", label: "Amount",  value: "" },
      ];
    case "sign":
    case "other":
    default:
      return []; // fall back to summary-only editing
  }
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

  const swapRows = useMemo(() => {
    const d = amountPreview ?? amountsFromDecoded(decoded);
    if (d.from.amount !== "—" && d.to.amount !== "—") return d;
    return {
      from: { amount: "0", symbol: "—" },
      to: { amount: "0", symbol: "—" },
    };
  }, [amountPreview, decoded]);

  const [siteOk, setSiteOk] = useState<"yes" | "off">("yes");
  const [kind, setKind] = useState<UserIntent["kind"]>(initial.kind);
  // Editable summary — pre-filled from the LLM's inferred summary. For non-swap
  // intents (sign, other) this is the primary input. For swap/approve etc. it's
  // a freeform "anything else?" override that takes precedence over the field grid.
  const [summary, setSummary] = useState(initial.summary);
  const [notes, setNotes] = useState("");

  // Per-kind field grid. Re-derived when the user changes the kind dropdown so
  // the inputs match what's relevant. We track current values in a single map
  // keyed by field.key — no useState-per-field gymnastics.
  const baseFields = useMemo(() => fieldsForKind(kind, decoded, swapRows), [kind, decoded, swapRows]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(baseFields.map((f) => [f.key, f.value]))
  );

  // When kind changes, reseed the field map for the new kind. Preserve any
  // previously-edited values whose keys exist in both schemas.
  useMemo(() => {
    setFieldValues((prev) => {
      const next: Record<string, string> = {};
      for (const f of baseFields) next[f.key] = prev[f.key] ?? f.value;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const siteLine = `Connected site ${connectedOrigin}`;

  function buildIntent(): UserIntent {
    // Compose a summary from the kind + currently-visible fields, joined into
    // a one-liner the judge can reason about. The user's edited summary is
    // appended as freeform context if they changed it from the seed.
    const fieldStr = baseFields
      .map((f) => {
        const v = (fieldValues[f.key] ?? "").trim();
        if (!v) return null;
        return f.unit ? `${v} ${f.unit}` : v;
      })
      .filter((s): s is string => Boolean(s))
      .join(" → ");
    const core = fieldStr.length > 0 ? `${kindLabel(kind)} · ${fieldStr}` : kindLabel(kind);
    const parts = [core];
    if (summary.trim() && summary.trim() !== initial.summary.trim()) parts.push(summary.trim());
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

          {/* Editable inferred summary — primary input regardless of kind. */}
          <div className="space-y-2">
            <Label className="text-sm font-normal text-neutral-800">What you want to do</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="min-h-[3.5rem] resize-y text-sm shadow-sm"
              placeholder="Describe in your own words…"
              aria-label="Intent summary"
            />
          </div>

          {/* Kind-specific helper fields. Empty when kind=sign/other. */}
          {baseFields.length > 0 && (
            <div className={cn(
              "grid gap-3",
              baseFields.length === 1 ? "grid-cols-1"
              : baseFields.length === 2 ? "grid-cols-2"
              : "grid-cols-1 sm:grid-cols-3"
            )}>
              {baseFields.map((f) => (
                <div key={f.key} className="space-y-2">
                  <Label className="text-sm font-normal text-neutral-800">{f.label}</Label>
                  <div className="flex h-9 overflow-hidden rounded-md border border-input bg-background shadow-sm">
                    <Input
                      value={fieldValues[f.key] ?? ""}
                      onChange={(e) => setFieldValues((p) => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="h-9 flex-1 rounded-none border-0 shadow-none focus-visible:ring-0"
                      aria-label={f.label}
                    />
                    {f.unit && (
                      <div className="flex max-w-[5rem] shrink-0 items-center justify-end border-l border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                        <span className="truncate">{f.unit}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-normal text-neutral-800">Notes (optional)</Label>
            <Textarea
              placeholder="Anything else the agent should know..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[3rem] resize-y text-sm shadow-sm"
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
