import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { ChatRequest, ChatReply } from "../src/chat";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";

const verdict: JudgeVerdict = {
  tier: "CAUTION",
  headline: "Sourcify cannot confirm this contract.",
  reasons: [{ severity: "warn", text: "Contract not verified on Sourcify" }],
  confidence: 0.6,
};

const judgeInput: JudgeInput = {
  intent: { kind: "swap", summary: "swap 100 USDC for ETH on Uniswap", confidence: 0.9 },
  decoded: {
    kind: "swap",
    tokenIn: { chainId: 8453, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "100000000" },
    tokenOut: { chainId: 8453, address: "0x4200000000000000000000000000000000000006", amount: "0" },
    minAmountOut: "0",
    recipient: "0x0",
    router: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
    protocol: "Uniswap",
  },
  contract: { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", chainId: 8453, verified: false, isProxy: false },
  origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
  findings: [{ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "contract is not verified" }],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x0" }] },
};

describe("/chat endpoint", () => {
  it("rejects requests without the api key", async () => {
    const app = new Hono();
    mountJudge(app, { apiKey: "k", chatOverride: async () => ({ reply: "ok" }) });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects empty messages array", async () => {
    const app = new Hono();
    mountJudge(app, { apiKey: "k", chatOverride: async () => ({ reply: "ok" }) });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_messages");
  });

  it("returns 500 when no LLM provider is configured", async () => {
    const app = new Hono();
    mountJudge(app, { apiKey: "k" });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_llm_key");
  });

  it("passes the conversation through to the override (general mode)", async () => {
    const app = new Hono();
    let received: ChatRequest | undefined;
    mountJudge(app, {
      apiKey: "k",
      chatOverride: async (req): Promise<ChatReply> => {
        received = req;
        return { reply: "Approval = giving a contract permission to spend your tokens." };
      },
    });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify({ messages: [{ role: "user", content: "what is approval" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChatReply;
    expect(body.reply).toContain("Approval");
    expect(received?.context).toBeUndefined();
    expect(received?.messages[0]?.content).toBe("what is approval");
  });

  it("forwards judgeInput + verdict context for verdict-aware chat", async () => {
    const app = new Hono();
    let received: ChatRequest | undefined;
    mountJudge(app, {
      apiKey: "k",
      chatOverride: async (req): Promise<ChatReply> => {
        received = req;
        return { reply: `verdict was ${req.context?.verdict?.tier}` };
      },
    });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "why caution?" }],
        context: { verdict, judgeInput, origin: "https://app.uniswap.org" },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChatReply;
    expect(body.reply).toBe("verdict was CAUTION");
    expect(received?.context?.verdict?.tier).toBe("CAUTION");
    expect(received?.context?.judgeInput?.decoded.kind).toBe("swap");
    expect(received?.context?.origin).toBe("https://app.uniswap.org");
  });

  it("returns 502 when the chat provider throws", async () => {
    const app = new Hono();
    mountJudge(app, {
      apiKey: "k",
      chatOverride: async () => { throw new Error("upstream timeout"); },
    });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("chat_failed");
    expect(body.message).toContain("upstream timeout");
  });
});
