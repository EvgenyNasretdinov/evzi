/**
 * Recover the signer address from the signature the device produced.
 *
 * Getting bytes back from a device proves only that something answered. This
 * checks the signature actually belongs to the key at our derivation path over
 * the exact transaction we asked it to sign.
 */
import { serializeTransaction, recoverTransactionAddress, type TransactionSerializable } from "viem";
import { readFileSync } from "node:fs";

const req = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const res = JSON.parse(readFileSync(process.argv[3]!, "utf8"));
const expected = process.argv[4]!;

const tx: TransactionSerializable = {
  type: "eip1559",
  chainId: req.tx.chainId,
  to: req.tx.to as `0x${string}`,
  data: req.tx.data as `0x${string}`,
  value: BigInt(req.tx.value ?? "0"),
  nonce: req.tx.nonce,
  gas: BigInt(req.tx.gas),
  maxFeePerGas: BigInt(req.tx.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(req.tx.maxPriorityFeePerGas),
};

const signed = serializeTransaction(tx, {
  r: res.signature.r as `0x${string}`,
  s: res.signature.s as `0x${string}`,
  v: BigInt(res.signature.v),
});

const recovered = await recoverTransactionAddress({ serializedTransaction: signed });
console.log("device address :", expected);
console.log("recovered      :", recovered);
console.log("match          :", recovered.toLowerCase() === expected.toLowerCase());
console.log("raw tx         :", signed.slice(0, 60) + "…", `(${(signed.length - 2) / 2} bytes)`);
