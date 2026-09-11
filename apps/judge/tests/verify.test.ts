import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountVerify } from "../src/verify";
import { freezeIntent } from "@intent-check/intent";
import type { AuthorizedIntent } from "@intent-check/types";

const API_KEY = "test-key";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x1111111111111111111111111111111111111111";
const DRAINER = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
const MAX_HEX = "f".repeat(64);

/** Real ERC-20 approve calldata, so the decoder does actual work. */
const approveCalldata = (spender: string, amountHex: string) =>
  `0x095ea7b3${spender.replace(/^0x/, "").toLowerCase().padStart(64, "0")}${amountHex}`;

const amount = (n: bigint) => n.toString(16).padStart(64, "0");

async function authorization(): Promise<AuthorizedIntent> {
  return freezeIntent({
    id: "01J8",
    raw: "Swap at most 500 USDC to ETH on Base, no unlimited approvals",
    goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.9 },
    constraints: {
      chainIds: [8453],
      maxSpend: [{ chainId: 8453, token: USDC, amount: "500000000" }],
      allowedRecipients: [],
      allowUnlimitedApproval: false,
    },
    createdAt: 1_757_500_000_000,
  });
}

function app() {
  const a = new Hono();
  mountVerify(a, () => ({ apiKey: API_KEY }));
  return a;
}

async function verify(body: unknown, key: string = API_KEY) {
  const res = await app().request("/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("judge — POST /verify", () => {
  it("rejects an unlimited approval the authorization forbade", async () => {
    const { status, body } = await verify({
      authorization: await authorization(),
      calls: [
        { chainId: 8453, from: WALLET, to: USDC, data: approveCalldata(DRAINER, MAX_HEX) },
      ],
    });
    expect(status).toBe(200);
    expect(body.policy).toBe("REJECT");
    expect(body.calls[0].findings.map((f: any) => f.code)).toContain(
      "INTENT_UNLIMITED_APPROVAL_FORBIDDEN",
    );
  });

  it("allows a compliant approval", async () => {
    const { body } = await verify({
      authorization: await authorization(),
      calls: [
        {
          chainId: 8453,
          from: WALLET,
          to: USDC,
          data: approveCalldata(WALLET, amount(500_000_000n)),
        },
      ],
    });
    // Unsigned: the constraints are satisfied, but nothing proves the
    // authorization came from the wallet rather than from the agent, so it
    // needs a human rather than sailing through.
    expect(body.policy).toBe("REQUIRE_APPROVAL");
    expect(body.findings.map((f: any) => f.code)).toContain("INTENT_UNSIGNED");
    expect(body.calls[0].findings).toEqual([]);
  });

  it("decodes the calldata rather than trusting the caller", async () => {
    const { body } = await verify({
      authorization: await authorization(),
      calls: [
        {
          chainId: 8453,
          from: WALLET,
          to: USDC,
          data: approveCalldata(WALLET, amount(500_000_000n)),
        },
      ],
    });
    expect(body.calls[0].decoded).toMatchObject({ kind: "approve", isUnlimited: false });
  });

  it("returns the strictest policy across a multi-call proposal", async () => {
    const { body } = await verify({
      authorization: await authorization(),
      calls: [
        {
          chainId: 8453,
          from: WALLET,
          to: USDC,
          data: approveCalldata(WALLET, amount(500_000_000n)),
        },
        { chainId: 8453, from: WALLET, to: USDC, data: approveCalldata(DRAINER, MAX_HEX) },
      ],
    });
    expect(body.calls[0].policy).toBe("REQUIRE_APPROVAL");
    expect(body.calls[1].policy).toBe("REJECT");
    expect(body.policy).toBe("REJECT");
  });

  it("detects an authorization edited after it was frozen", async () => {
    const frozen = await authorization();
    const tampered: AuthorizedIntent = {
      ...frozen,
      constraints: { ...frozen.constraints, allowUnlimitedApproval: true },
    };
    const { body } = await verify({
      authorization: tampered,
      calls: [
        { chainId: 8453, from: WALLET, to: USDC, data: approveCalldata(DRAINER, MAX_HEX) },
      ],
    });
    expect(body.policy).toBe("REJECT");
    expect(body.findings.map((f: any) => f.code)).toContain("INTENT_TAMPERED");
  });

  it("echoes the authorization hash so a caller can prove which one was used", async () => {
    const auth = await authorization();
    const { body } = await verify({
      authorization: auth,
      calls: [
        {
          chainId: 8453,
          from: WALLET,
          to: USDC,
          data: approveCalldata(WALLET, amount(500_000_000n)),
        },
      ],
    });
    expect(body.authorizationHash).toBe(auth.hash);
  });

  it("rejects a call on a chain the authorization never mentioned", async () => {
    const { body } = await verify({
      authorization: await authorization(),
      calls: [
        {
          chainId: 1,
          from: WALLET,
          to: USDC,
          data: approveCalldata(WALLET, amount(500_000_000n)),
        },
      ],
    });
    expect(body.policy).toBe("REJECT");
    expect(body.calls[0].findings.map((f: any) => f.code)).toContain("INTENT_CHAIN_MISMATCH");
  });

  it("requires the api key", async () => {
    const { status } = await verify(
      { authorization: await authorization(), calls: [] },
      "wrong-key",
    );
    expect(status).toBe(401);
  });

  it("rejects a body with no authorization", async () => {
    const { status, body } = await verify({ calls: [] });
    expect(status).toBe(400);
    expect(body.error).toBe("authorization_required");
  });

  it("rejects a body with no calls", async () => {
    const { status, body } = await verify({ authorization: await authorization() });
    expect(status).toBe(400);
    expect(body.error).toBe("calls_required");
  });
});

describe("judge — signed authorizations", () => {
  const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  async function signedAuthorization() {
    const { privateKeyToAccount } = await import("viem/accounts");
    const { authorizationMessage } = await import("@intent-check/intent");
    const account = privateKeyToAccount(KEY as `0x${string}`);
    const frozen = await authorization();
    const withSigner = { ...frozen, signer: account.address };
    const signature = await account.signMessage({
      message: authorizationMessage(withSigner as any),
    });
    // The address is returned alongside, never inside: any extra field on the
    // object becomes part of what gets re-hashed and would read as tampering.
    return { auth: { ...withSigner, signature }, address: account.address };
  }

  const compliant = (from: string) => ({
    chainId: 8453,
    from,
    to: USDC,
    data: approveCalldata(from, amount(500_000_000n)),
  });

  it("allows a compliant proposal when the authorization is properly signed", async () => {
    const { auth, address } = await signedAuthorization();
    const { body } = await verify({ authorization: auth, calls: [compliant(address)] });
    expect(body.findings).toEqual([]);
    expect(body.policy).toBe("ALLOW");
  });

  it("rejects a signature that does not belong to the declared signer", async () => {
    const { auth } = await signedAuthorization();
    const forged = { ...auth, signer: "0x1111111111111111111111111111111111111111" };
    const { body } = await verify({ authorization: forged, calls: [compliant(forged.signer)] });
    expect(body.findings.map((f: any) => f.code)).toContain("INTENT_SIGNATURE_INVALID");
    expect(body.policy).toBe("REJECT");
  });

  it("rejects an authorization signed by a wallet other than the one spending", async () => {
    const { auth } = await signedAuthorization();
    const { body } = await verify({
      authorization: auth,
      calls: [compliant("0x2222222222222222222222222222222222222222")],
    });
    expect(body.findings.map((f: any) => f.code)).toContain("INTENT_SIGNER_MISMATCH");
    expect(body.policy).toBe("REJECT");
  });

  it("still catches a constraint edit even when the old signature is carried along", async () => {
    const { auth, address } = await signedAuthorization();
    const tampered = {
      ...auth,
      constraints: { ...auth.constraints, allowUnlimitedApproval: true },
    };
    const { body } = await verify({ authorization: tampered, calls: [compliant(address)] });
    const codes = body.findings.map((f: any) => f.code);
    expect(codes).toContain("INTENT_TAMPERED");
    expect(body.policy).toBe("REJECT");
  });
});

describe("judge — OpenAPI spec", () => {
  it("describes the routes the gateway will proxy", async () => {
    const spec = (await import("../openapi.json")).default as any;
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/verify", "/agent/plan"]),
    );
  });

  it("declares the api-key header the service actually enforces", async () => {
    const spec = (await import("../openapi.json")).default as any;
    expect(spec.components.securitySchemes.ApiKeyAuth).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-api-key",
    });
  });

  it("marks authorization and calls as required on /verify", async () => {
    const spec = (await import("../openapi.json")).default as any;
    expect(spec.components.schemas.VerifyRequest.required).toEqual(["authorization", "calls"]);
  });
});
