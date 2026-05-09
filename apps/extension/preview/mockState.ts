import type { DecodedAction, JudgeInput, JudgeVerdict, UserIntent } from "@intent-check/types";
import type { PopupState } from "../src/popup/PopupView";

const MOCK_ID = "preview-request";

const baseIntent: UserIntent = {
  kind: "swap",
  summary: "Swap 1 ETH for USDC on Uniswap",
  confidence: 0.9,
};

const baseDecoded: DecodedAction = {
  kind: "unknown",
  selector: "0xdeadbeef",
  functionName: "swapExactTokensForTokens",
};

const baseJudgeInput = (overrides?: Partial<JudgeInput>): JudgeInput => ({
  intent: baseIntent,
  decoded: baseDecoded,
  sim: {
    success: true,
    assetChanges: [
      {
        type: "transfer",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        token: { chainId: 1, address: "0xETH", symbol: "ETH", amount: "1000000000000000000" },
      },
    ],
    balanceChanges: [],
    gasUsed: "150000",
    logs: [],
  },
  contract: {
    address: "0x3333333333333333333333333333333333333333",
    chainId: 1,
    verified: true,
    isProxy: false,
    contractName: "UniswapV2Router",
  },
  origin: {
    url: "https://app.uniswap.org/swap",
    origin: "https://app.uniswap.org",
    pageTitle: "Uniswap Interface",
  },
  findings: [],
  request: {
    method: "eth_sendTransaction",
    params: [{ from: "0xabc", to: "0x3333333333333333333333333333333333333333", data: "0x" }],
  },
  ...overrides,
});

export type PreviewScenario =
  | "idle"
  | "awaiting_confirm"
  | "judging_sim"
  | "judging_llm"
  | "error"
  | "verdict_safe"
  | "verdict_caution"
  | "verdict_danger";

export function scenarioToHost(scenario: PreviewScenario): { id: string | null; state: PopupState | null } {
  if (scenario === "idle") return { id: null, state: null };

  if (scenario === "awaiting_confirm") {
    return {
      id: MOCK_ID,
      state: {
        phase: "awaiting_confirm",
        baseDraft: {
          decoded: baseDecoded,
          intent: baseIntent,
          pageSnapshot: { title: "Uniswap" },
          origin: "https://app.uniswap.org",
        },
      },
    };
  }

  if (scenario === "judging_sim" || scenario === "judging_llm") {
    return {
      id: MOCK_ID,
      state: {
        phase: "judging",
        origin: "https://app.uniswap.org",
        intent: baseIntent,
        decoded: baseDecoded,
        contract: {
          address: "0x3333333333333333333333333333333333333333",
          chainId: 1,
          verified: true,
          isProxy: false,
          contractName: "UniswapV2Router",
        },
        step: scenario === "judging_sim" ? "fetching_simulation" : "calling_judge",
        enteredAt: Date.now(),
      },
    };
  }

  if (scenario === "error") {
    return {
      id: MOCK_ID,
      state: {
        phase: "error",
        origin: "https://app.uniswap.org",
        message: "judge timeout after 30s",
        retryDraft: { intent: baseIntent },
      },
    };
  }

  const verdicts: Record<Exclude<PreviewScenario, "idle" | "awaiting_confirm" | "judging_sim" | "judging_llm" | "error">, JudgeVerdict> = {
    verdict_safe: {
      tier: "SAFE",
      headline: "Looks consistent with a normal swap.",
      reasons: [
        { severity: "info", text: "Router contract is verified on Sourcify." },
        { severity: "info", text: "Simulation succeeded with expected token movements." },
      ],
      confidence: 0.85,
    },
    verdict_caution: {
      tier: "CAUTION",
      headline: "Proceed only if you trust this site.",
      reasons: [
        { severity: "warn", text: "High slippage or unusual path — double-check amounts." },
        { severity: "info", text: "Origin matches a known DEX domain." },
      ],
      confidence: 0.6,
    },
    verdict_danger: {
      tier: "DANGER",
      headline: "This request looks high risk.",
      reasons: [
        { severity: "danger", text: "Unlimited token approval detected." },
        { severity: "warn", text: "Spender is not a known protocol router." },
      ],
      confidence: 0.9,
    },
  };

  const key = scenario as keyof typeof verdicts;
  return {
    id: MOCK_ID,
    state: {
      phase: "verdict_ready",
      verdict: verdicts[key],
      judgeInput: baseJudgeInput(),
      origin: "https://app.uniswap.org",
      pageSnapshot: { title: "Uniswap" },
    },
  };
}
