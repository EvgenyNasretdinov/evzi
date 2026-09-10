import {
  DeviceManagementKitBuilder,
  DeviceActionStatus,
  type DeviceSessionId,
} from "@ledgerhq/device-management-kit";
import { nodeHidTransportFactory } from "@ledgerhq/device-transport-kit-node-hid";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { serializeTransaction, type TransactionSerializable } from "viem";
import { firstValueFrom, filter, timeout, lastValueFrom } from "rxjs";

const DISCOVERY_TIMEOUT_MS = 8000;
/** A person has to read the screen and press two buttons. Do not rush them. */
const SIGNING_TIMEOUT_MS = 120_000;

export interface SignableTx {
  chainId: number;
  from: string;
  to: string;
  data?: string;
  value?: string;
  nonce: number;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface Signature {
  r: string;
  s: string;
  v: number;
}

/**
 * Owns the connection to the physical device.
 *
 * The session is established lazily and reused: discovery plus connect costs
 * seconds, and a signer that reconnects per request would make the human wait
 * for USB negotiation before every tap.
 */
export class LedgerDevice {
  private dmk = new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
  private sessionId: DeviceSessionId | null = null;

  private async session(): Promise<DeviceSessionId> {
    if (this.sessionId) return this.sessionId;

    const device = await firstValueFrom(
      this.dmk.startDiscovering({}).pipe(
        filter(Boolean),
        timeout(DISCOVERY_TIMEOUT_MS),
      ),
    );
    this.sessionId = await this.dmk.connect({ device });
    return this.sessionId;
  }

  async status(): Promise<{ connected: boolean; model?: string; detail?: string }> {
    try {
      const sessionId = await this.session();
      const state = await firstValueFrom(this.dmk.getDeviceSessionState({ sessionId }));
      return {
        connected: true,
        model: this.dmk.getConnectedDevice({ sessionId }).modelId,
        detail: String(state.deviceStatus),
      };
    } catch (e) {
      // A failed probe invalidates the cached session; the cable may have gone.
      this.sessionId = null;
      return { connected: false, detail: describe(e) };
    }
  }

  /**
   * Sign an EIP-1559 transaction.
   *
   * The device is handed RLP bytes, so the transaction is serialized here
   * rather than passed as fields. A Nano S cannot clear-sign this — it shows
   * the raw fields — which is why Evzi explains the transaction in the popup
   * before the device is ever asked.
   */
  async sign(derivationPath: string, tx: SignableTx): Promise<Signature> {
    const sessionId = await this.session();
    const signer = new SignerEthBuilder({ dmk: this.dmk, sessionId }).build();

    const serializable: TransactionSerializable = {
      type: "eip1559",
      chainId: tx.chainId,
      to: tx.to as `0x${string}`,
      data: (tx.data ?? "0x") as `0x${string}`,
      value: BigInt(tx.value ?? "0"),
      nonce: tx.nonce,
      gas: BigInt(tx.gas),
      maxFeePerGas: BigInt(tx.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
    };

    const raw = serializeTransaction(serializable);
    const bytes = Uint8Array.from(
      (raw.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );

    const { observable } = signer.signTransaction(derivationPath, bytes);

    const final = await lastValueFrom(
      observable.pipe(
        filter(
          (s) =>
            s.status === DeviceActionStatus.Completed || s.status === DeviceActionStatus.Error,
        ),
        timeout(SIGNING_TIMEOUT_MS),
      ),
    );

    if (final.status === DeviceActionStatus.Error) {
      throw new Error(describe(final.error));
    }

    const out = final.output as { r: string; s: string; v: number };
    return { r: out.r, s: out.s, v: out.v };
  }

  close() {
    this.dmk.close();
  }
}

/** DMK errors are tagged objects, not Errors; String() on them yields [object Object]. */
export function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const tag = o._tag ?? o.tag;
    const message = o.message ?? o.err ?? o.errorCode;
    if (tag || message) return [tag, message].filter(Boolean).join(": ");
    try {
      return JSON.stringify(e);
    } catch {
      return "unknown error";
    }
  }
  return String(e);
}
