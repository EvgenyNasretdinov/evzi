import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Copy, MessageCircle, X } from "lucide-react";
import type { VerdictChecklistRow } from "@/popup/verdict/verdictContent";
import { EvziEyeLogo, EvziStatusStripe, type EvziEyeStatus } from "./EvziEyeLogo";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function RowIcon({ row }: { row: VerdictChecklistRow }) {
  if (row.severity === "pass") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4ACDAA]" aria-hidden />;
  }
  if (row.severity === "caution") {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-[#FFCD69]" aria-hidden />;
  }
  return <CircleAlert className="h-4 w-4 shrink-0 text-[#F77579]" aria-hidden />;
}

export interface VerdictScreenProps {
  eyeStatus: EvziEyeStatus;
  title: string;
  description: string;
  checklist: VerdictChecklistRow[];
  primaryLabel: string;
  secondaryLabel: string;
  rawDataText: string;
  /** Optional footer line shown at the very bottom (e.g. "Judge: openai · gpt-5.4"). */
  footerLabel?: string;
  onPrimary: () => void;
  onSecondary: () => void;
  /** When undefined, the "Talk to Evzi" button is hidden entirely. */
  onTalkToEvzi?: () => void;
  onClose?: () => void;
  className?: string;
}

export function VerdictScreen({
  eyeStatus,
  title,
  description,
  checklist,
  primaryLabel,
  secondaryLabel,
  rawDataText,
  footerLabel,
  onPrimary,
  onSecondary,
  onTalkToEvzi,
  onClose,
  className,
}: VerdictScreenProps) {
  const [rawOpen, setRawOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  function handleCopyRaw() {
    void navigator.clipboard.writeText(rawDataText);
    setCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => {
      setCopied(false);
      copyResetRef.current = null;
    }, 2000);
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
        {/* Screen 1: Evzi message + Talk to Evzi */}
        <div className="flex flex-col gap-6 px-6 py-6">
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-bold leading-8 tracking-tight text-foreground">{title}</h1>
            <p className="whitespace-pre-line text-sm leading-5 text-neutral-800">{description}</p>
          </div>
          {onTalkToEvzi && (
            <Button
              type="button"
              variant="outline"
              className="h-8 w-fit gap-1.5 rounded-md border-border px-2.5 text-sm font-medium shadow-sm"
              onClick={onTalkToEvzi}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              Talk to Evzi.
            </Button>
          )}
        </div>

        <Separator />

        {/* Screens 2–3: one bordered block, dividers between rows + full-width action column */}
        <div className="flex flex-col gap-6 px-6 py-6">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {checklist.map((row, i) => (
              <li key={i} className="flex gap-3 px-3 py-3">
                <span className="inline-flex shrink-0 pt-px" aria-hidden>
                  <RowIcon row={row} />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[14px] font-medium leading-5 text-foreground">{row.title}</p>
                  {row.description.trim().length > 0 && (
                    <p className="text-[14px] font-normal leading-5 text-neutral-600">
                      {row.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="flex w-full flex-col gap-2">
            <Button
              type="button"
              className="h-9 w-full rounded-md bg-[#171717] text-sm font-medium text-[#fafafa] shadow-sm hover:bg-[#171717]/90"
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
            <Button type="button" variant="outline" className="h-9 w-full rounded-md border-border text-sm font-medium shadow-sm" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Screens 4–5: Raw data — hug-content toggle + copy; no outer section border */}
        <div className="px-6 py-4">
          <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 w-fit max-w-[min(100%,280px)] shrink-0 items-center rounded-md border border-border bg-background px-3 text-left text-[14px] font-medium leading-none text-foreground shadow-sm hover:bg-muted/30"
                  >
                    <span className="shrink-0">Raw data</span>
                    <span className="mx-3 h-4 w-px shrink-0 bg-border" aria-hidden />
                    {rawOpen ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
                    )}
                  </button>
                </CollapsibleTrigger>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-md border-border bg-background shadow-sm"
                  aria-label={copied ? "Copied" : "Copy raw data"}
                  onClick={(e) => {
                    e.preventDefault();
                    handleCopyRaw();
                  }}
                >
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                </Button>
              </div>
              <CollapsibleContent className="overflow-hidden">
                <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3 font-mono text-[14px] font-normal leading-normal text-foreground">
                  {rawDataText}
                </pre>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>

        {footerLabel && (
          <p className="border-t bg-muted/20 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            {footerLabel}
          </p>
        )}
      </div>
    </section>
  );
}
