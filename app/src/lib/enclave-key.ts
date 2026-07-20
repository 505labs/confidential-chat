import { generateKeyPairSync, sign as edSign, createPublicKey } from "node:crypto";

// The enclave's identity key. Generated ONCE, in memory, when the app process starts
// inside the confidential VM. The private key never leaves the enclave and is never
// written to disk. Its public half gets committed into the SEV-SNP attestation report
// (REPORT_DATA), so a hardware-signed report vouches for THIS key — and because only
// code running in the attested enclave holds the matching private key, a client that
// (a) verifies the report and (b) sees this key sign its challenge knows it is talking
// directly to the attested enclave, with no proxy or MITM in between.
//
// Ed25519: small (32-byte) public key, fast, deterministic signatures.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

// Raw 32-byte Ed25519 public key (the last 32 bytes of the DER SubjectPublicKeyInfo).
const spki = publicKey.export({ type: "spki", format: "der" });
export const enclavePublicKeyRaw: Buffer = spki.subarray(spki.length - 32);
export const enclavePublicKeyHex: string = enclavePublicKeyRaw.toString("hex");

// Sign a message with the enclave private key (Ed25519 → algorithm is null).
export function enclaveSign(message: Buffer): Buffer {
  return edSign(null, message, privateKey);
}

// Re-exported for callers that want to reconstruct the key object from the raw bytes.
export function publicKeyFromRaw(raw32: Buffer) {
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), // Ed25519 SPKI prefix
    raw32,
  ]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}
