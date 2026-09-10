/**
 * Evzi hardware signer — a local daemon that signs on a Ledger, but only after
 * Evzi's verifier agrees the transaction matches the human's authorization.
 *
 * Why a daemon rather than WebHID inside the extension popup: an MV3 popup is
 * destroyed as soon as it loses focus, and confirming on a Nano S takes several
 * seconds of button presses during which focus moves away. The daemon survives
 * that; the popup does not.
 *
 * Nano S: 320 KB, security-only updates since 2026 — no Key Ring app and no
 * advanced clear-signing. Plain transaction signing via the Ethereum app.
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { LedgerDevice } from "./device";

const PORT = Number(process.env.LEDGER_SIGNER_PORT ?? 8788);
const JUDGE_URL = process.env.JUDGE_URL ?? "http://127.0.0.1:8787";
const JUDGE_KEY = process.env.JUDGE_API_KEY ?? "local-dev-key";
/** BIP-44 account 0 — the address Ledger Live shows first. */
const DERIVATION_PATH = process.env.LEDGER_PATH ?? "44'/60'/0'/0/0";

const app = createApp({
  device: new LedgerDevice(),
  judgeUrl: JUDGE_URL,
  judgeKey: JUDGE_KEY,
  derivationPath: DERIVATION_PATH,
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Evzi hardware signer on http://127.0.0.1:${info.port}`);
  console.log(`  verifier: ${JUDGE_URL}`);
  console.log(`  path:     ${DERIVATION_PATH}`);
  console.log(`\nOpen the Ethereum app on the device. Close Ledger Live first.`);
});
