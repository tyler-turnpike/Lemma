import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import { BridgeError } from "./errors.js";

const WalletFile = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  createdAt: z.string(),
  network: z.literal("arbitrum-sepolia"),
});

export type BurnerWallet = {
  address: Address;
  /** Never logged or returned; only used to build the local signer. */
  privateKey: Hex;
  file: string;
  /** True when this call created the file. */
  created: boolean;
};

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readWallet(file: string): BurnerWallet {
  let parsed: z.infer<typeof WalletFile>;
  try {
    parsed = WalletFile.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // Never echo the file contents; never overwrite it (it may hold funds).
    throw new BridgeError("config", `burner wallet file ${file} is unreadable or malformed; fix or move it, or set BUYER_PRIVATE_KEY`);
  }
  const account = privateKeyToAccount(parsed.privateKey as Hex);
  if (account.address.toLowerCase() !== parsed.address.toLowerCase()) {
    throw new BridgeError("config", `burner wallet file ${file} has an address that does not match its key`);
  }
  return { address: account.address, privateKey: parsed.privateKey as Hex, file, created: false };
}

/**
 * Loads `<dir>/wallet.json`, or creates it with a fresh testnet key (dir 0700, file 0600,
 * exclusive create). A concurrent creator wins the race and its wallet is re-read.
 */
export function loadOrCreateBurnerWallet(dir: string, now: () => Date = () => new Date()): BurnerWallet {
  const file = join(dir, "wallet.json");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const body = `${JSON.stringify({ address, privateKey, createdAt: now().toISOString(), network: "arbitrum-sepolia" }, null, 2)}\n`;
  let fd: number;
  try {
    fd = openSync(file, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Existing wallet, or another process is writing it right now: give it a moment.
    for (let attempt = 0; ; attempt++) {
      try {
        return readWallet(file);
      } catch (readError) {
        if (attempt >= 10) throw readError;
        sleepSync(50);
      }
    }
  }
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { address, privateKey, file, created: true };
}
