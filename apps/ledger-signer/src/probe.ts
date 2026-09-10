/**
 * Is a Ledger actually reachable from this machine?
 *
 * Run before anything else: `pnpm --filter @intent-check/ledger-signer probe`.
 * Prints what the Device Management Kit can see, so a hardware problem is
 * diagnosed on its own rather than through a failing signature.
 */
import { DeviceManagementKitBuilder, ConsoleLogger } from "@ledgerhq/device-management-kit";
import { nodeHidTransportFactory } from "@ledgerhq/device-transport-kit-node-hid";
import { firstValueFrom, filter, timeout } from "rxjs";
import { describe } from "./device";

const DISCOVERY_TIMEOUT_MS = 8000;

async function main() {
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(nodeHidTransportFactory)
    .addLogger(new ConsoleLogger())
    .build();

  console.log("scanning for a Ledger over USB HID…");

  try {
    const device = await firstValueFrom(
      dmk.startDiscovering({}).pipe(
        filter((d) => Boolean(d)),
        timeout(DISCOVERY_TIMEOUT_MS),
      ),
    );

    console.log("\nfound:");
    console.log("  id:     ", device.id);
    console.log("  model:  ", device.deviceModel?.model ?? "unknown");
    console.log("  name:   ", device.deviceModel?.name ?? "unknown");

    const sessionId = await dmk.connect({ device });
    const state = await firstValueFrom(dmk.getDeviceSessionState({ sessionId }));
    console.log("  status: ", state.deviceStatus);
    console.log(
      "  app:    ",
      "currentApp" in state ? JSON.stringify(state.currentApp) : "(not reported)",
    );

    await dmk.disconnect({ sessionId });
    console.log("\nOK — the device is reachable. Open the Ethereum app before signing.");
  } catch (e) {
    console.error("\nno device: " + describe(e));
    console.error(
      "\nChecklist: cable plugged in and not charge-only, device unlocked with its PIN,\n" +
        "Ledger Live closed (it holds an exclusive USB claim), Ethereum app opened.",
    );
    process.exitCode = 1;
  } finally {
    dmk.close();
  }
}

main();
