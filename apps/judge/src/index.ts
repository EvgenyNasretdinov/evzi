import { Hono } from "hono";
import { cors } from "hono/cors";
import { mountJudge } from "./judge";

export interface Env {
  ANTHROPIC_API_KEY: string;
  JUDGE_API_KEY: string;
  STUB_VERDICT?: string;
}

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "x-api-key"] }));
app.get("/", (c) => c.text("intent-check judge ok"));

// Mount once at module load. The handler reads env per-request via the
// function form of options.
mountJudge(app, (c) => ({
  stubVerdict: c.env.STUB_VERDICT === "1",
  anthropicApiKey: c.env.ANTHROPIC_API_KEY,
  apiKey: c.env.JUDGE_API_KEY,
}));

export default app;
