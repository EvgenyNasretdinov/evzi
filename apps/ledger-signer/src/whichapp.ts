/**
 * Diagnostic: is the Ethereum app actually open?
 *
 * A Nano S answers on USB and reports CONNECTED whether it is sitting on the
 * dashboard or running an app, and the session state does not report which app
 * is open. So every Ethereum command fails the same way — with
 * UnknownDeviceExchangeError — whether the app is missing, closed, or the
 * device is locked. getAddress is the cheapest call that distinguishes "the app
 * is there and talking" from all of those.
 *
 * Run: pnpm --filter @intent-check/ledger-signer exec tsx src/whichapp.ts
 */
import { DeviceManagementKitBuilder, DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { nodeHidTransportFactory } from "@ledgerhq/device-transport-kit-node-hid";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { firstValueFrom, filter, timeout, lastValueFrom } from "rxjs";
import { describe } from "./device";

const dmk = new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
try {
  const device = await firstValueFrom(dmk.startDiscovering({}).pipe(filter(Boolean), timeout(8000)));
  const sessionId = await dmk.connect({ device });
  const state = await firstValueFrom(dmk.getDeviceSessionState({ sessionId }));
  console.log("deviceStatus:", state.deviceStatus);
  console.log("state keys:", Object.keys(state).join(", "));
  console.log("currentApp:", JSON.stringify((state as Record<string, unknown>).currentApp));

  const signer = new SignerEthBuilder({ dmk, sessionId }).build();
  const { observable } = signer.getAddress("44'/60'/0'/0/0", { checkOnDevice: false });
  const final = await lastValueFrom(
    observable.pipe(
      filter((s) => s.status === DeviceActionStatus.Completed || s.status === DeviceActionStatus.Error),
      timeout(30000),
    ),
  );
  if (final.status === DeviceActionStatus.Error) {
    console.log("getAddress FAILED:", describe(final.error));
    console.log("→ the Ethereum app is almost certainly not open on the device.");
  } else {
    console.log("getAddress OK:", JSON.stringify(final.output));
  }
  await dmk.disconnect({ sessionId });
} catch (e) {
  console.log("error:", describe(e));
} finally {
  dmk.close();
}
