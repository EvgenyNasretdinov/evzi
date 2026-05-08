import Anthropic from "@anthropic-ai/sdk";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";
import { SYSTEM_PROMPT } from "./prompt";

export async function llmJudge(input: JudgeInput, apiKey: string): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey });
  const userPayload = JSON.stringify(input);

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } } as any],
    messages: [{ role: "user", content: userPayload }],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  // The model is instructed to output JSON only. Extract the first {...} block defensively.
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const blob = text.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(blob) as JudgeVerdict;
  if (parsed.tier !== "SAFE" && parsed.tier !== "CAUTION" && parsed.tier !== "DANGER") {
    throw new Error("invalid tier from LLM: " + parsed.tier);
  }
  return parsed;
}
