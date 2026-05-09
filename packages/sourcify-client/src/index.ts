export * from "./v2";

export interface VerifiedContract {
  verified: boolean;
  contractName?: string;
  abi: any[];
  matchType?: "perfect" | "partial";
}

export async function fetchVerifiedContract(args: { chainId: number; address: string; baseUrl?: string }): Promise<VerifiedContract> {
  const baseUrl = args.baseUrl ?? "https://sourcify.dev/server";
  const url = `${baseUrl}/files/any/${args.chainId}/${args.address.toLowerCase()}`;
  const res = await fetch(url);
  if (res.status === 404) return { verified: false, abi: [] };
  if (!res.ok) return { verified: false, abi: [] };
  const body = await res.json() as { status: "perfect" | "partial"; files: { name: string; content: string }[] };

  const meta = body.files.find((f) => f.name === "metadata.json");
  if (!meta) return { verified: true, abi: [], matchType: body.status };
  const parsed = JSON.parse(meta.content) as { output?: { abi?: any[] }; settings?: { compilationTarget?: Record<string, string> } };

  const target = parsed.settings?.compilationTarget;
  const contractName = target ? Object.values(target)[0] : undefined;

  return { verified: true, abi: parsed.output?.abi ?? [], matchType: body.status, contractName };
}
