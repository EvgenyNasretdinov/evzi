import { useEffect, useState } from "react";
import { PopupView } from "@/popup/PopupView";
import { ConfirmIntentScreen } from "@/popup/components/ConfirmIntentScreen";
import type { EvziEyeStatus } from "@/popup/components/EvziEyeLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { scenarioToHost, type PreviewScenario } from "./mockState";
import type { UserIntent } from "@intent-check/types";

const SCENARIO_IDS: PreviewScenario[] = ["idle", "awaiting_confirm", "verdict_safe", "verdict_caution", "verdict_danger"];

function readScenarioFromLocation(): PreviewScenario | null {
  const q = new URLSearchParams(window.location.search).get("scenario");
  if (q && SCENARIO_IDS.includes(q as PreviewScenario)) return q as PreviewScenario;
  const h = window.location.hash.replace(/^#/, "");
  if (h && SCENARIO_IDS.includes(h as PreviewScenario)) return h as PreviewScenario;
  return null;
}

function writeScenarioToLocation(scenario: PreviewScenario) {
  const url = new URL(window.location.href);
  url.searchParams.set("scenario", scenario);
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
}

const SCENARIOS: { id: PreviewScenario; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "awaiting_confirm", label: "Confirm intent" },
  { id: "verdict_safe", label: "Verdict · safe" },
  { id: "verdict_caution", label: "Verdict · caution" },
  { id: "verdict_danger", label: "Verdict · danger" },
];

const MOCK_INTENT: UserIntent = {
  kind: "swap",
  summary: "Sell ETH for USD",
  confidence: 1,
};

const EYE_STATUSES: EvziEyeStatus[] = ["blue", "yellow", "red", "green"];

export function PreviewApp() {
  const [scenario, setScenario] = useState<PreviewScenario>(() => readScenarioFromLocation() ?? "idle");
  const [layoutOnly, setLayoutOnly] = useState(false);
  const [eyeStatus, setEyeStatus] = useState<EvziEyeStatus>("blue");
  const [chatPreviewTrigger, setChatPreviewTrigger] = useState(0);
  const [chatPreviewMode, setChatPreviewMode] = useState<"empty" | "demo">("empty");
  const { id, state } = scenarioToHost(scenario);

  useEffect(() => {
    writeScenarioToLocation(scenario);
  }, [scenario]);

  return (
    <div className="min-h-screen bg-muted/50">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">UI preview</CardTitle>
            <CardDescription>
              Hot reload — extension flows or isolated confirm screen (Figma-aligned). Deep link: add{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">?scenario=verdict_safe</code> (or{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">verdict_caution</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">verdict_danger</code>) to the preview URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex flex-wrap gap-2">
              {SCENARIOS.map((s) => (
                <Button key={s.id} variant={scenario === s.id ? "default" : "outline"} size="sm" onClick={() => setScenario(s.id)}>
                  {s.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="w-full text-xs font-medium text-muted-foreground">Chat (same widget)</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setChatPreviewMode("empty");
                  setChatPreviewTrigger((n) => n + 1);
                }}
              >
                Chat · empty
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setChatPreviewMode("demo");
                  setChatPreviewTrigger((n) => n + 1);
                }}
              >
                Chat · demo thread
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button type="button" variant={layoutOnly ? "default" : "outline"} size="sm" onClick={() => setLayoutOnly((v) => !v)}>
                Confirm screen only
              </Button>
              {layoutOnly && (
                <>
                  <span className="text-xs text-muted-foreground">Eye status</span>
                  {EYE_STATUSES.map((s) => (
                    <Button key={s} type="button" size="sm" variant={eyeStatus === s ? "secondary" : "ghost"} className="capitalize" onClick={() => setEyeStatus(s)}>
                      {s}
                    </Button>
                  ))}
                </>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-center">
          {layoutOnly ? (
            <ConfirmIntentScreen
              eyeStatus={eyeStatus}
              initial={MOCK_INTENT}
              connectedOrigin="https://app.uniswap.org"
              decoded={undefined}
              onConfirm={(intent) => console.log("[preview] confirm", intent)}
              onClose={() => console.log("[preview] close")}
              onTalkToEvzi={() => console.log("[preview] talk to Evzi")}
            />
          ) : (
            <PopupView
              id={id}
              state={state}
              onIntentConfirm={(requestId, intent) => console.log("[preview] intent confirmed", requestId, intent)}
              onReject={(requestId) => console.log("[preview] reject", requestId)}
              onApprove={(requestId) => console.log("[preview] approve", requestId)}
              onTalkToEvzi={() => console.log("[preview] talk to Evzi")}
              chatPreviewTrigger={chatPreviewTrigger}
              chatPreviewMode={chatPreviewMode}
            />
          )}
        </div>
      </div>
    </div>
  );
}
