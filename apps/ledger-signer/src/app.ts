import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AgentPolicy, AuthorizedIntent } from "@intent-check/types";
import type { SignableTx, Signature } from "./device";

/** What the daemon needs from a device. Narrow on purpose, so it can be faked in tests. */
export interface SigningDevice {
  status(): Promise<{ connected: boolean; model?: string; detail?: string }>;
  sign(derivationPath: string, tx: SignableTx): Promise<Signature>;
}

export interface AppDeps {
  device: SigningDevice;
  judgeUrl: string;
  judgeKey: string;
  derivationPath: string;
  fetchImpl?: typeof fetch;
}

export interface SignRequest {
  authorization: AuthorizedIntent;
  tx: SignableTx;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const doFetch = deps.fetchImpl ?? fetch;

  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type"] }));

  app.get("/status", async (c) => {
    const status = await deps.device.status();
    return c.json({ ...status, path: deps.derivationPath });
  });

  /**
   * Ask Evzi whether this transaction is allowed under the authorization.
   *
   * The daemon asks for itself rather than trusting its caller: a compromised
   * extension or a rogue agent should not be able to obtain a signature for
   * something the human's authorization forbids. Failing closed is deliberate —
   * an unreachable verifier means refuse, never sign blind.
   */
  async function policyFor(body: SignRequest) {
    const res = await doFetch(`${deps.judgeUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": deps.judgeKey },
      body: JSON.stringify({
        authorization: body.authorization,
        calls: [
          {
            chainId: body.tx.chainId,
            from: body.tx.from,
            to: body.tx.to,
            data: body.tx.data ?? "0x",
            value: body.tx.value,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`verifier returned ${res.status}`);
    const v = (await res.json()) as any;
    return {
      policy: v.policy as AgentPolicy,
      findings: [...(v.findings ?? []), ...(v.calls?.[0]?.findings ?? [])],
    };
  }

  app.post("/sign", async (c) => {
    let body: SignRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!body.authorization?.hash) return c.json({ error: "authorization_required" }, 400);
    if (!body.tx?.to || !body.tx?.chainId) return c.json({ error: "tx_required" }, 400);

    let verdict: { policy: AgentPolicy; findings: unknown[] };
    try {
      verdict = await policyFor(body);
    } catch (e) {
      return c.json(
        { error: "verifier_unavailable", message: String((e as Error).message ?? e) },
        502,
      );
    }

    if (verdict.policy === "REJECT") {
      return c.json(
        {
          error: "rejected_by_policy",
          policy: verdict.policy,
          findings: verdict.findings,
          message: "Evzi refused this transaction; the device was never asked.",
        },
        403,
      );
    }

    try {
      const signature = await deps.device.sign(deps.derivationPath, body.tx);
      return c.json({ policy: verdict.policy, findings: verdict.findings, signature });
    } catch (e) {
      return c.json({ error: "signing_failed", message: String((e as Error).message ?? e) }, 502);
    }
  });

  return app;
}
