import { useState } from "react";
import { PopupView } from "@/popup/PopupView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { scenarioToHost, type PreviewScenario } from "./mockState";

const SCENARIOS: { id: PreviewScenario; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "awaiting_confirm", label: "Confirm intent" },
  { id: "judging_sim", label: "Loading · simulating" },
  { id: "judging_llm", label: "Loading · agent" },
  { id: "error", label: "Error · retry" },
  { id: "verdict_safe", label: "Verdict · safe" },
  { id: "verdict_caution", label: "Verdict · caution" },
  { id: "verdict_danger", label: "Verdict · danger" },
];

export function PreviewApp() {
  const [scenario, setScenario] = useState<PreviewScenario>("idle");
  const { id, state } = scenarioToHost(scenario);

  return (
    <div className="min-h-screen bg-muted/50">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">UI preview</CardTitle>
            <CardDescription>Hot reload — same shell as the extension popup (`PopupView`).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {SCENARIOS.map((s) => (
              <Button key={s.id} variant={scenario === s.id ? "default" : "outline"} size="sm" onClick={() => setScenario(s.id)}>
                {s.label}
              </Button>
            ))}
          </CardContent>
        </Card>
        <div className="flex justify-center">
          <PopupView
            id={id}
            state={state}
            judgeInfo={{ provider: "openai", model: "gpt-5.2" }}
            onIntentConfirm={(requestId, intent) => console.log("[preview] intent confirmed", requestId, intent)}
            onReject={(requestId) => console.log("[preview] reject", requestId)}
            onApprove={(requestId) => console.log("[preview] approve", requestId)}
          />
        </div>
      </div>
    </div>
  );
}
