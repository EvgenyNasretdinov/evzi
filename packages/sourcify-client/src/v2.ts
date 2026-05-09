export interface ProxyInfo {
  isProxy: boolean;
  proxyType?: string;
  implementationAddress?: string;
  resolutionError?: string;
}

export interface DeploymentInfo {
  blockNumber?: number;
  transactionHash?: string;
  deployer?: string;
}

export interface FunctionSignature {
  signature: string;
  selector4: string;
}

export interface UserDoc {
  notice?: string;
  methods?: Record<string, { notice?: string }>;
}

export interface VerifiedContractV2 {
  verified: boolean;
  matchType?: "exact_match" | "match";
  contractName?: string;
  abi: any[];
  proxy?: ProxyInfo;
  deployment?: DeploymentInfo;
  signatures?: { function: FunctionSignature[]; event: FunctionSignature[]; error: FunctionSignature[] };
  userdoc?: UserDoc;
  /** Set when this VerifiedContract IS the implementation behind a proxy. NOT populated in T1 — T2 adds recursion. */
  implementation?: VerifiedContractV2;
}

const FIELDS = ["abi", "compilation", "deployment", "proxyResolution", "signatures", "userdoc"].join(",");

interface RawSignature {
  signature?: string;
  signatureHash4?: string;
}

interface RawProxyResolution {
  isProxy?: boolean;
  proxyType?: string | null;
  implementations?: Array<{ address?: string; name?: string }>;
  proxyResolutionError?: { customCode?: string; message?: string; errorId?: string };
}

interface RawDeployment {
  blockNumber?: string | number;
  transactionHash?: string;
  deployer?: string;
}

interface RawSourcifyV2Response {
  match?: "exact_match" | "match";
  abi?: any[];
  compilation?: { contractName?: string };
  deployment?: RawDeployment;
  proxyResolution?: RawProxyResolution;
  signatures?: { function?: RawSignature[]; event?: RawSignature[]; error?: RawSignature[] };
  userdoc?: UserDoc;
}

function mapSignatures(arr: RawSignature[] | undefined): FunctionSignature[] {
  if (!arr) return [];
  const out: FunctionSignature[] = [];
  for (const s of arr) {
    if (typeof s.signature === "string" && typeof s.signatureHash4 === "string") {
      out.push({ signature: s.signature, selector4: s.signatureHash4 });
    }
  }
  return out;
}

function mapProxy(raw: RawProxyResolution | undefined): ProxyInfo | undefined {
  if (!raw) return undefined;
  const info: ProxyInfo = { isProxy: Boolean(raw.isProxy) };
  if (typeof raw.proxyType === "string") info.proxyType = raw.proxyType;
  const firstImpl = raw.implementations?.[0]?.address;
  if (typeof firstImpl === "string") info.implementationAddress = firstImpl.toLowerCase();
  if (raw.proxyResolutionError?.message) info.resolutionError = raw.proxyResolutionError.message;
  return info;
}

function mapDeployment(raw: RawDeployment | undefined): DeploymentInfo | undefined {
  if (!raw) return undefined;
  const info: DeploymentInfo = {};
  if (raw.blockNumber !== undefined && raw.blockNumber !== null) {
    const n = typeof raw.blockNumber === "string" ? Number(raw.blockNumber) : raw.blockNumber;
    if (Number.isFinite(n)) info.blockNumber = n;
  }
  if (typeof raw.transactionHash === "string") info.transactionHash = raw.transactionHash;
  if (typeof raw.deployer === "string") info.deployer = raw.deployer.toLowerCase();
  return info;
}

export async function fetchVerifiedContractV2(args: {
  chainId: number;
  address: string;
  baseUrl?: string;
}): Promise<VerifiedContractV2> {
  return fetchVerifiedContractV2Internal({ ...args, recurse: true });
}

async function fetchVerifiedContractV2Internal(args: {
  chainId: number;
  address: string;
  baseUrl?: string;
  recurse: boolean;
}): Promise<VerifiedContractV2> {
  const baseUrl = args.baseUrl ?? "https://sourcify.dev/server";
  const addr = args.address.toLowerCase();
  const url = `${baseUrl}/v2/contract/${args.chainId}/${addr}?fields=${FIELDS}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { verified: false, abi: [] };
  }
  if (res.status === 404) return { verified: false, abi: [] };
  if (!res.ok) return { verified: false, abi: [] };

  let body: RawSourcifyV2Response;
  try {
    body = (await res.json()) as RawSourcifyV2Response;
  } catch {
    return { verified: false, abi: [] };
  }

  const result: VerifiedContractV2 = {
    verified: true,
    abi: body.abi ?? [],
  };
  if (body.match) result.matchType = body.match;
  if (body.compilation?.contractName) result.contractName = body.compilation.contractName;

  const proxy = mapProxy(body.proxyResolution);
  if (proxy) result.proxy = proxy;

  const deployment = mapDeployment(body.deployment);
  if (deployment) result.deployment = deployment;

  if (body.signatures) {
    result.signatures = {
      function: mapSignatures(body.signatures.function),
      event: mapSignatures(body.signatures.event),
      error: mapSignatures(body.signatures.error),
    };
  }

  if (body.userdoc) result.userdoc = body.userdoc;

  if (args.recurse && proxy?.isProxy && proxy.implementationAddress) {
    result.implementation = await fetchVerifiedContractV2Internal({
      chainId: args.chainId,
      address: proxy.implementationAddress,
      baseUrl,
      recurse: false,
    });
  }

  return result;
}
