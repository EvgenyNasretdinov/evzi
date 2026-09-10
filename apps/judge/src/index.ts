import { Hono } from "hono";
import { cors } from "hono/cors";
import { mountJudge } from "./judge";
import { mountVerify } from "./verify";
import { mountAgent } from "./agent";
import openapi from "../openapi.json";

export interface Env {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;        // default claude-sonnet-4-6
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;           // default gpt-5.5
  OPENAI_INFER_MODEL?: string;     // override for /infer-intent (default gpt-5-mini)
  /** "openai" | "anthropic" — overrides which provider is preferred when both keys are set. */
  LLM_PROVIDER?: string;
  JUDGE_API_KEY: string;
  STUB_VERDICT?: string;
  /** Graph Network gateway key — authenticates subgraph queries. */
  GRAPH_API_KEY?: string;
  /** thegraph.market JWT — authenticates the Token API. Distinct from the above. */
  GRAPH_TOKEN_API_JWT?: string;
  /** Durable cache for slow upstreams; see wrangler.toml. */
  EVZI_CACHE?: KVNamespace;
}

/** Adapt Workers KV to the shape packages/onchain-context expects. */
function kvStore(kv: KVNamespace | undefined) {
  if (!kv) return undefined;
  return {
    get: (key: string) => kv.get(key),
    put: (key: string, value: string, ttlSeconds: number) =>
      kv.put(key, value, { expirationTtl: Math.max(60, ttlSeconds) }),
  };
}

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "x-api-key"] }));
app.get("/", (c) => c.text("intent-check judge ok"));

// Served so an agent gateway can fetch the spec by URL rather than being
// handed a pasted copy that drifts from the deployment.
app.get("/openapi.json", (c) => c.json(openapi));

// Mount once at module load. The handler reads env per-request via the
// function form of options. If both keys are set, the OpenAI path wins by
// default; set LLM_PROVIDER=anthropic in .dev.vars to force the Anthropic
// path while keeping the OpenAI key (e.g. for /infer-intent).
mountJudge(app, (c) => ({
  stubVerdict: c.env.STUB_VERDICT === "1",
  anthropicApiKey: c.env.ANTHROPIC_API_KEY,
  anthropicModel: c.env.ANTHROPIC_MODEL,
  openaiApiKey: c.env.OPENAI_API_KEY,
  openaiModel: c.env.OPENAI_MODEL,
  openaiInferModel: c.env.OPENAI_INFER_MODEL,
  preferredProvider: c.env.LLM_PROVIDER === "anthropic" ? "anthropic"
    : c.env.LLM_PROVIDER === "openai" ? "openai"
    : undefined,
  apiKey: c.env.JUDGE_API_KEY,
  graphApiKey: c.env.GRAPH_API_KEY,
  tokenApiJwt: c.env.GRAPH_TOKEN_API_JWT,
  store: kvStore(c.env.EVZI_CACHE),
}));

// Agent-facing deterministic verifier. Shares the judge's api key but consults
// no LLM, so its answers are reproducible — which is what makes it usable as a
// tool other agents can call.
mountVerify(app, (c) => ({
  apiKey: c.env.JUDGE_API_KEY,
  graphApiKey: c.env.GRAPH_API_KEY,
  tokenApiJwt: c.env.GRAPH_TOKEN_API_JWT,
  store: kvStore(c.env.EVZI_CACHE),
}));

// The demo's proposer. Deterministic by design: the interesting behaviour in
// this system belongs to the verifier, not the agent being verified.
mountAgent(app, (c) => ({ apiKey: c.env.JUDGE_API_KEY }));

export default app;
