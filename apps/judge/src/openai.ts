import type { JudgeInput, JudgeVerdict } from "@intent-check/types";
import { SYSTEM_PROMPT } from "./prompt";

// JSON Schema for the strict-output mode. Keeps the model's response
// structurally identical to JudgeVerdict so we don't need post-parse repair.
const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tier", "headline", "reasons", "confidence"],
  properties: {
    tier: { type: "string", enum: ["DANGER", "CAUTION", "SAFE"] },
    headline: { type: "string" },
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "text"],
        properties: {
          severity: { type: "string", enum: ["info", "warn", "danger"] },
          text: { type: "string" },
        },
      },
    },
    confidence: { type: "number" },
  },
} as const;

export async function llmJudgeOpenAI(
  input: JudgeInput,
  apiKey: string,
  model: string = "gpt-5.5",
): Promise<JudgeVerdict> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "judge_verdict", strict: true, schema: VERDICT_SCHEMA },
      },
      max_completion_tokens: 600,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openai ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("openai: empty response");

  const parsed = JSON.parse(content) as JudgeVerdict;
  if (parsed.tier !== "SAFE" && parsed.tier !== "CAUTION" && parsed.tier !== "DANGER") {
    throw new Error("openai: invalid tier " + parsed.tier);
  }
  return parsed;
}
