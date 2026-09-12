import type { Hono, Context } from "hono";
import type {
  AgentPolicy,
  AuthorizedIntent,
  DecodedAction,
  Finding,
  OnchainContext,
} from "@intent-check/types";
import { decode } from "@intent-check/decoder";
import { recoverMessageAddress } from "viem";
import { checkIntegrity, derivePolicy, extractSpend, verifyAgainstIntent } from "@intent-check/intent";
import { fetchOnchainContext, graphFindings, type DurableStore } from "@intent-check/onchain-context";
import { isKnownProtocol } from "@intent-check/protocol-registry";

export interface VerifyOptions {
  apiKey?: string;
  graphApiKey?: string;
  tokenApiJwt?: string;
  store?: DurableStore;
  /** Seam for tests, so the Graph-derived findings can be exercised offline. */
  fetchOnchain?: typeof fetchOnchainContext;
}

export type VerifyOptionsLike = VerifyOptions | ((c: Context) => VerifyOptions);

/** One proposed on-chain action, as an agent would submit it. */
interface ProposedCall {
  chainId: number;
  from: string;
  to: string;
  data: string;
  value?: string;
}

interface CallResult {
  index: number;
  decoded: DecodedAction;
  findings: Finding[];
  policy: AgentPolicy;
}

const STRICTNESS: Record<AgentPolicy, number> = {
  ALLOW: 0,
  REQUIRE_APPROVAL: 1,
  REJECT: 2,
};

/** Symbols worth impersonating — the same set the findings layer trusts. */
const BLUE_CHIPS = ["USDC", "USDT", "DAI", "WETH", "WBTC"];

/**
 * What this token is claimed to be, as opposed to what the market says it is.
 *
 * The claim cannot come from The Graph: a counterfeit is precisely a token The
 * Graph never indexed, so it carries no symbol there — which left
 * GRAPH_TOKEN_IMPERSONATION unreachable on the agent path, where there is no
 * dApp-supplied metadata to fall back on either. The claim belongs to the
 * authorization: it is the one place a person asserted a symbol, and they
 * signed it.
 */
function claimedSymbolFor(
  authorization: AuthorizedIntent,
  onchain: OnchainContext,
): string | undefined {
  if (onchain.token?.symbol) return onchain.token.symbol;
  const said = `${authorization.raw} ${authorization.goal?.summary ?? ""}`.toUpperCase();
  return BLUE_CHIPS.find((symbol) => said.includes(symbol));
}

/** The proposal as a whole is only as permissive as its least permissive call. */
function strictest(policies: AgentPolicy[]): AgentPolicy {
  return policies.reduce<AgentPolicy>(
    (worst, p) => (STRICTNESS[p] > STRICTNESS[worst] ? p : worst),
    "ALLOW",
  );
}

function isValidCall(c: unknown): c is ProposedCall {
  const v = c as ProposedCall;
  return (
    typeof v?.chainId === "number" &&
    typeof v?.to === "string" &&
    typeof v?.data === "string" &&
    typeof v?.from === "string"
  );
}

/**
 * The agent-facing verifier.
 *
 * Stateless and deterministic: no LLM is consulted, so the same proposal always
 * yields the same policy. That is what makes it usable as a tool another agent
 * can rely on — and what makes an A/B comparison meaningful.
 */
export function mountVerify(app: Hono<any>, optsLike: VerifyOptionsLike) {
  const resolve = (c: Context): VerifyOptions =>
    typeof optsLike === "function" ? optsLike(c) : optsLike;

  app.post("/verify", async (c) => {
    const opts = resolve(c);
    if (!opts.apiKey) return c.json({ error: "judge_api_key_unconfigured" }, 500);
    if (c.req.header("x-api-key") !== opts.apiKey) return c.json({ error: "unauthorized" }, 401);

    let body: { authorization?: AuthorizedIntent; calls?: unknown[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const authorization = body.authorization;
    if (!authorization?.hash) return c.json({ error: "authorization_required" }, 400);

    const calls = body.calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      return c.json({ error: "calls_required" }, 400);
    }
    if (!calls.every(isValidCall)) return c.json({ error: "invalid_call" }, 400);

    // Checked once: an authorization is either intact or it is not, and a
    // tampered one poisons every call made under it.
    const authFindings = await checkIntegrity(authorization, {
      recoverSigner: (message, signature) =>
        recoverMessageAddress({ message, signature: signature as `0x${string}` }),
    });

    // The authorization must be signed by the wallet whose funds it governs.
    // Without this an attacker could sign a permissive authorization with a
    // throwaway key and point it at someone else's wallet.
    const spender = (calls[0] as ProposedCall).from.toLowerCase();
    if (authorization.signer && authorization.signer.toLowerCase() !== spender) {
      authFindings.push({
        code: "INTENT_SIGNER_MISMATCH",
        severity: "danger",
        text: `This authorization was signed by ${authorization.signer.slice(0, 10)}…, but the transaction spends from ${spender.slice(0, 10)}….`,
      });
    }

    let mergedOnchain: OnchainContext | undefined;

    const results: CallResult[] = [];
    for (const [index, call] of calls.entries()) {
      const decoded = await decode({
        chainId: call.chainId,
        to: call.to,
        data: call.data,
        value: call.value ?? "0",
        from: call.from,
      });

      // The token under approval is what we want market evidence about.
      const { movements } = extractSpend(decoded, call.chainId);
      const primary = movements[0];

      const onchain = await (opts.fetchOnchain ?? fetchOnchainContext)({
        chainId: call.chainId,
        token: primary?.token,
        wallet: call.from,
        graphApiKey: opts.graphApiKey,
        tokenApiJwt: opts.tokenApiJwt,
        keepAlive: (p) => c.executionCtx?.waitUntil?.(p),
        store: opts.store,
      });
      mergedOnchain = onchain;

      const findings: Finding[] = [
        ...verifyAgainstIntent(authorization, decoded, {
          chainId: call.chainId,
          wallet: call.from,
          onchain,
          isKnownSpender: (a) => isKnownProtocol(call.chainId, a),
        }),
        ...graphFindings(onchain, {
          claimedSymbol: claimedSymbolFor(authorization, onchain),
          isUnlimitedApproval: primary?.isUnlimited,
          approvedToken: primary?.token,
        }),
      ];

      results.push({
        index,
        decoded,
        findings,
        policy: derivePolicy([...authFindings, ...findings], "SAFE", { onchain }),
      });
    }

    return c.json({
      policy: strictest(results.map((r) => r.policy)),
      authorizationHash: authorization.hash,
      findings: authFindings,
      calls: results,
      onchain: mergedOnchain,
    });
  });
}
