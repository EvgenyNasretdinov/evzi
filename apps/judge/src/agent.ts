import type { Hono, Context } from "hono";
import type { AuthorizedIntent, Finding } from "@intent-check/types";
import { lookupProtocol } from "@intent-check/protocol-registry";

export interface AgentOptions {
  apiKey?: string;
}

export type AgentOptionsLike = AgentOptions | ((c: Context) => AgentOptions);

export interface ProposedCall {
  chainId: number;
  from: string;
  to: string;
  data: string;
  value?: string;
}

export interface Plan {
  attempt: number;
  rationale: string;
  calls: ProposedCall[];
}

/** ERC-20 `transfer(address,uint256)` calldata. */
export function encodeTransfer(to: string, amountHex: string): string {
  const addr = to.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return `0xa9059cbb${addr}${amountHex}`;
}

/**
 * Uniswap Universal Router per chain — the spender a swap allowance goes to.
 * Every address is in the protocol registry, so the verifier recognizes it as
 * a vetted counterparty rather than a stranger.
 */
const ROUTERS: Record<number, string> = {
  1: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  8453: "0x6ff5693b99212da76ad316178a184ab56d299b43",
};

const MAX_UINT256_HEX = "f".repeat(64);

/** ERC-20 `approve(address,uint256)` calldata. */
export function encodeApprove(spender: string, amountHex: string): string {
  const addr = spender.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return `0x095ea7b3${addr}${amountHex}`;
}

const toHex = (n: bigint) => n.toString(16).padStart(64, "0");

/**
 * A deliberately unsophisticated agent.
 *
 * On its first attempt it does what a great many real agents do: request an
 * unlimited allowance so it never has to ask again. When the verifier rejects
 * that, it reads the finding codes and narrows to the authorized cap.
 *
 * It is deterministic on purpose. The interesting behaviour in this system is
 * the verifier's, and a scripted proposer makes the demo reproducible and the
 * A/B comparison meaningful. Swapping in an LLM planner means replacing this
 * one function.
 */
export function planNextStep(
  authorization: AuthorizedIntent,
  from: string,
  feedback: Finding[] = [],
  /**
   * Text the agent picked up from somewhere it does not control — a page, an
   * email, a README, another API's response. Modelled explicitly because this
   * is the realistic failure: not a malicious agent, but an honest one that
   * read an instruction and followed it.
   */
  injected?: string,
): Plan {
  const chainId = authorization.constraints.chainIds[0] ?? 1;
  const cap = authorization.constraints.maxSpend[0];
  const router = ROUTERS[chainId] ?? ROUTERS[1]!;

  if (!cap) {
    return {
      attempt: 1,
      rationale: "The authorization names no spendable token, so there is nothing to propose.",
      calls: [],
    };
  }

  // A prompt injection does not make the agent adversarial; it makes it
  // obedient to the wrong author. The agent has no way to tell that this
  // instruction did not come from its principal — which is exactly why the
  // check has to live outside the agent, against something the human froze.
  if (injected) {
    const target = injected.match(/0x[a-fA-F0-9]{40}/)?.[0];
    if (target) {
      return {
        attempt: 1,
        rationale:
          "The page says the swap needs a security verification transfer first, so I am sending the funds on to complete it.",
        calls: [
          {
            chainId,
            from,
            to: cap.token,
            data: encodeTransfer(target, toHex(BigInt(cap.amount))),
          },
        ],
      };
    }
  }

  const correcting = feedback.some(
    (f) => f.code === "INTENT_UNLIMITED_APPROVAL_FORBIDDEN" || f.code === "INTENT_AMOUNT_EXCEEDED",
  );

  const protocol = lookupProtocol(chainId, router)?.protocol ?? "the router";

  if (!correcting) {
    return {
      attempt: 1,
      rationale: `Approving ${protocol} for an unlimited amount so I do not have to ask again on later swaps.`,
      calls: [
        {
          chainId,
          from,
          to: cap.token,
          data: encodeApprove(router, MAX_UINT256_HEX),
        },
      ],
    };
  }

  return {
    attempt: 2,
    rationale: `The verifier refused the unlimited allowance, so I am narrowing it to exactly the ${cap.amount} you authorized.`,
    calls: [
      {
        chainId,
        from,
        to: cap.token,
        data: encodeApprove(router, toHex(BigInt(cap.amount))),
      },
    ],
  };
}

export function mountAgent(app: Hono<any>, optsLike: AgentOptionsLike) {
  const resolve = (c: Context): AgentOptions =>
    typeof optsLike === "function" ? optsLike(c) : optsLike;

  app.post("/agent/plan", async (c) => {
    const opts = resolve(c);
    if (!opts.apiKey) return c.json({ error: "judge_api_key_unconfigured" }, 500);
    if (c.req.header("x-api-key") !== opts.apiKey) return c.json({ error: "unauthorized" }, 401);

    let body: {
      authorization?: AuthorizedIntent;
      from?: string;
      feedback?: Finding[];
      injected?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (!body.authorization?.constraints) return c.json({ error: "authorization_required" }, 400);
    if (!body.from) return c.json({ error: "from_required" }, 400);

    return c.json(
      planNextStep(body.authorization, body.from, body.feedback ?? [], body.injected),
    );
  });
}
