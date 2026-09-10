# Evzi hardware signer

Signs a transaction on a Ledger — but only after Evzi's verifier agrees the
transaction matches the human's frozen authorization.

The daemon **calls `/verify` itself** rather than trusting whoever called it. A
compromised extension or a rogue agent cannot obtain a signature for something
the authorization forbids: on `REJECT` the device is never asked, and an
unreachable verifier also refuses rather than signing blind.

## Why a daemon and not WebHID in the popup

An MV3 popup is destroyed the moment it loses focus, and confirming on a Nano S
takes several seconds of button presses during which focus moves away. The
daemon survives that; the popup does not.

## Running it

```bash
export JUDGE_URL=https://intent-check-judge.evzi.workers.dev
export JUDGE_API_KEY=...            # the production key
pnpm --filter @intent-check/ledger-signer start
```

Then `GET /status` and `POST /sign` on `127.0.0.1:8788`.

## Diagnosing the device

Three failure modes look identical from the API, so there are two scripts:

```bash
pnpm --filter @intent-check/ledger-signer probe      # is a device reachable at all?
pnpm --filter @intent-check/ledger-signer whichapp   # is the Ethereum app open?
```

A Nano S reports `CONNECTED` whether it is on the dashboard or running an app,
and the session state does not name the current app. So *"no app installed"*,
*"app not open"* and *"device locked"* all surface as the same
`UnknownDeviceExchangeError` on the first Ethereum command. `whichapp` calls
`getAddress`, which is the cheapest way to tell "the app is there and talking"
from all three.

Checklist when it will not connect, in the order that actually catches things:

1. **The OS must see it first.** `ioreg -p IOUSB -l | grep -i ledger` should
   show `USB Vendor Name = "Ledger"`. If it does not, this is not a software
   problem — try a different cable (charge-only cables are the usual culprit)
   and plug straight into the machine rather than through a hub chain.
2. **Ledger Live must be closed.** It takes an exclusive USB claim; nothing else
   can talk to the device while it runs.
3. **The Ethereum app must be installed and open** — the screen should read
   "Ethereum", not "Dashboard". Install it from Ledger Live's Manager, then quit
   Ledger Live.

## Nano S limits

320 KB of memory and security-only updates since 2026: no Key Ring app and no
advanced clear-signing. Plain transaction signing through the Ethereum app is
what this supports, which is why Evzi explains the transaction in the popup
before the device is ever asked.
