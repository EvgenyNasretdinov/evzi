import type { SimResult, AssetChange } from "@intent-check/types";

export interface SimulateArgs {
  accessKey: string;
  accountSlug: string;
  projectSlug: string;
  network_id: string;
  from: string;
  to: string;
  input: string;
  value: string;
  baseUrl?: string;
  /** Abort the request after this many ms. Default 12_000. */
  timeoutMs?: number;
}

interface RawAssetChange {
  type: string;
  from: string;
  to: string;
  raw_amount: string;
  token_info?: { contract_address: string; symbol?: string; decimals?: number };
}

export async function simulate(args: SimulateArgs): Promise<SimResult> {
  const baseUrl = args.baseUrl ?? "https://api.tenderly.co";
  const url = `${baseUrl}/api/v1/account/${args.accountSlug}/project/${args.projectSlug}/simulate`;
  const ac = new AbortController();
  const timeoutMs = args.timeoutMs ?? 12_000;
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "X-Access-Key": args.accessKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        network_id: args.network_id, from: args.from, to: args.to, input: args.input, value: args.value,
        save: false, simulation_type: "quick",
      }),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const reason = (e as Error).name === "AbortError" ? `tenderly timeout after ${timeoutMs / 1000}s` : `tenderly ${(e as Error).message}`;
    return { success: false, failureReason: reason, assetChanges: [], balanceChanges: [], gasUsed: "0", logs: [] };
  }
  clearTimeout(timer);
  if (!res.ok) {
    return { success: false, failureReason: `tenderly ${res.status}`, assetChanges: [], balanceChanges: [], gasUsed: "0", logs: [] };
  }
  const body = await res.json() as { transaction: { status: boolean; gas_used: number; transaction_info: { asset_changes?: RawAssetChange[]; balance_changes?: { address: string; delta: string }[]; logs?: any[] } } };
  const tx = body.transaction;
  const info = tx.transaction_info;

  const assetChanges: AssetChange[] = (info.asset_changes ?? []).map((c): AssetChange => ({
    type: c.type === "Mint" ? "mint" : c.type === "Burn" ? "burn" : "transfer",
    from: c.from, to: c.to,
    token: {
      chainId: parseInt(args.network_id, 10),
      address: c.token_info?.contract_address ?? args.to,
      symbol: c.token_info?.symbol,
      decimals: c.token_info?.decimals,
      amount: c.raw_amount,
    },
  }));

  return {
    success: tx.status,
    assetChanges,
    balanceChanges: (info.balance_changes ?? []).map((b) => ({ address: b.address, delta: b.delta })),
    gasUsed: String(tx.gas_used),
    logs: [],
  };
}
