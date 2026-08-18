import { randomBytes } from "node:crypto";

// Must be set before the module reads it.
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { encrypt, decrypt, isEncryptionConfigured, maskSecret } = await import(
  "../src/lib/crypto"
);

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail ?? "");
  }
}

console.log("\nApp-specific password encryption:");

const password = "abcdefghijklmnop"; // shape of a real Apple app password
const encrypted = encrypt(password);

check("configured", isEncryptionConfigured());
check("round-trips", decrypt(encrypted) === password);
check("ciphertext is not the plaintext", !encrypted.ciphertext.includes(password));
check("iv is 12 bytes", Buffer.from(encrypted.iv, "base64").length === 12);
check("auth tag is 16 bytes", Buffer.from(encrypted.authTag, "base64").length === 16);

const second = encrypt(password);
check(
  "same input encrypts differently (fresh IV each time)",
  second.ciphertext !== encrypted.ciphertext,
);

// Tampering must fail loudly rather than yield garbage that gets sent to Apple.
const tamperedBytes = Buffer.from(encrypted.ciphertext, "base64");
tamperedBytes[0] ^= 0xff;
let rejected = false;
try {
  decrypt({ ...encrypted, ciphertext: tamperedBytes.toString("base64") });
} catch {
  rejected = true;
}
check("tampered ciphertext is rejected", rejected);

// A different key must not decrypt.
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
let wrongKeyRejected = false;
try {
  decrypt(encrypted);
} catch {
  wrongKeyRejected = true;
}
check("wrong key is rejected", wrongKeyRejected);

check("masking keeps only the last 4", maskSecret(password).endsWith("mnop"));
check("masking hides the rest", !maskSecret(password).includes("abcdefghijkl"));

// A malformed key must be caught at load, not silently truncated.
process.env.APP_ENCRYPTION_KEY = "too-short";
let badKeyRejected = false;
try {
  encrypt("x");
} catch {
  badKeyRejected = true;
}
check("undersized key is rejected", badKeyRejected);
check("isEncryptionConfigured reports false for a bad key", !isEncryptionConfigured());

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
