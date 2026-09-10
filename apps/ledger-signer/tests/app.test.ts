import { describe, it, expect } from "vitest";
import { createApp, type SigningDevice } from "../src/app";
import { describe as describeError } from "../src/device";
import type { AuthorizedIntent } from "@intent-check/types";

const auth = { hash: "f".repeat(64), constraints: {} } as unknown as AuthorizedIntent;
const tx = {
  chainId: 8453, from: "0x1", to: "0x2", data: "0x095ea7b3",
  nonce: 0, gas: "21000", maxFeePerGas: "1", maxPriorityFeePerGas: "1",
};

function deviceSpy(overrides: Partial<SigningDevice> = {}) {
  const calls = { sign: 0 };
  const device: SigningDevice = {
    status: async () => ({ connected: true, model: "nanoS" }),
    sign: async () => {
      calls.sign += 1;
      return { r: "0xr", s: "0xs", v: 27 };
    },
    ...overrides,
  };
  return { device, calls };
}

const verifierReturning = (body: unknown, ok = true): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;

function app(fetchImpl: typeof fetch, device: SigningDevice) {
  return createApp({
    device, judgeUrl: "http://judge", judgeKey: "k",
    derivationPath: "44'/60'/0'/0/0", fetchImpl,
  });
}

const sign = async (a: ReturnType<typeof app>, body: unknown) => {
  const res = await a.request("/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe("ledger-signer — the policy gate", () => {
  it("signs when the verifier allows", async () => {
    const { device, calls } = deviceSpy();
    const { status, body } = await sign(
      app(verifierReturning({ policy: "ALLOW", calls: [{ findings: [] }] }), device),
      { authorization: auth, tx },
    );
    expect(status).toBe(200);
    expect(body.signature.v).toBe(27);
    expect(calls.sign).toBe(1);
  });

  it("signs when the verifier wants human approval — the tap IS that approval", async () => {
    const { device, calls } = deviceSpy();
    const { status } = await sign(
      app(verifierReturning({ policy: "REQUIRE_APPROVAL", calls: [{ findings: [] }] }), device),
      { authorization: auth, tx },
    );
    expect(status).toBe(200);
    expect(calls.sign).toBe(1);
  });

  it("never touches the device when the verifier rejects", async () => {
    const { device, calls } = deviceSpy();
    const { status, body } = await sign(
      app(
        verifierReturning({
          policy: "REJECT",
          calls: [{ findings: [{ code: "INTENT_AMOUNT_EXCEEDED", severity: "danger", text: "over" }] }],
        }),
        device,
      ),
      { authorization: auth, tx },
    );
    expect(status).toBe(403);
    expect(body.error).toBe("rejected_by_policy");
    expect(body.findings[0].code).toBe("INTENT_AMOUNT_EXCEEDED");
    expect(calls.sign).toBe(0);
  });

  it("fails closed when the verifier is unreachable", async () => {
    const { device, calls } = deviceSpy();
    const { status, body } = await sign(
      app(verifierReturning({ error: "boom" }, false), device),
      { authorization: auth, tx },
    );
    expect(status).toBe(502);
    expect(body.error).toBe("verifier_unavailable");
    expect(calls.sign).toBe(0);
  });

  it("rejects a request with no authorization", async () => {
    const { device, calls } = deviceSpy();
    const { status } = await sign(app(verifierReturning({ policy: "ALLOW" }), device), { tx });
    expect(status).toBe(400);
    expect(calls.sign).toBe(0);
  });

  it("rejects a request with no transaction", async () => {
    const { device } = deviceSpy();
    const { status } = await sign(app(verifierReturning({ policy: "ALLOW" }), device), {
      authorization: auth,
    });
    expect(status).toBe(400);
  });

  it("reports a signing failure without pretending it succeeded", async () => {
    const { device } = deviceSpy({
      sign: async () => {
        throw new Error("user rejected on device");
      },
    });
    const { status, body } = await sign(
      app(verifierReturning({ policy: "ALLOW", calls: [{ findings: [] }] }), device),
      { authorization: auth, tx },
    );
    expect(status).toBe(502);
    expect(body.message).toMatch(/user rejected/);
  });
});

describe("ledger-signer — /status", () => {
  it("reports the derivation path alongside device state", async () => {
    const { device } = deviceSpy();
    const res = await app(verifierReturning({}), device).request("/status");
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ connected: true, model: "nanoS", path: "44'/60'/0'/0/0" });
  });
});

describe("ledger-signer — error formatting", () => {
  it("renders a DMK tagged error instead of [object Object]", () => {
    expect(describeError({ _tag: "NoAccessibleDeviceError", err: "No selected device" }))
      .toBe("NoAccessibleDeviceError: No selected device");
  });

  it("passes through a normal Error", () => {
    expect(describeError(new Error("cable unplugged"))).toBe("cable unplugged");
  });
});
