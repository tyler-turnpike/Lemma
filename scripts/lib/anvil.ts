/** Anvil fork of Arbitrum Sepolia for rehearsals. Never touches the real network. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { createPublicClient, encodeAbiParameters, http, keccak256, numberToHex, type Address, type PublicClient } from "viem";

import { USDC, usdcBalance } from "./chain.js";

export function foundryBin(name: "anvil" | "forge" | "cast"): string {
  const env = process.env[`${name.toUpperCase()}_BIN`];
  if (env !== undefined && env !== "") return env;
  const local = join("/root/.local/bin", name);
  return existsSync(local) ? local : name;
}

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => res(port));
    });
  });
}

export type Anvil = { url: string; child: ChildProcess; stop(): void };

export async function startAnvilFork(forkUrl: string): Promise<Anvil> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(foundryBin("anvil"), ["--fork-url", forkUrl, "--port", String(port), "--chain-id", "421614", "--silent"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  const client = createPublicClient({ transport: http(url) });
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error(`anvil exited: ${stderr.slice(-500)}`);
    try {
      if ((await client.getChainId()) === 421614) return { url, child, stop: () => void child.kill("SIGTERM") };
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error("anvil did not become ready");
}

const rpc = (pub: PublicClient, method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });

/** Finds the USDC balance mapping slot by probing, then writes balances directly. */
export async function setUsdcBalances(pub: PublicClient, balances: Array<[Address, bigint]>): Promise<number> {
  const first = balances[0];
  if (first === undefined) return -1;
  const keyFor = (who: Address, slot: number) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, BigInt(slot)]));
  let found: number | undefined;
  for (let slot = 0; slot < 20 && found === undefined; slot++) {
    const key = keyFor(first[0], slot);
    const before = await pub.getStorageAt({ address: USDC, slot: key });
    await rpc(pub, "anvil_setStorageAt", [USDC, key, numberToHex(first[1], { size: 32 })]);
    if ((await usdcBalance(pub, first[0])) === first[1]) found = slot;
    else await rpc(pub, "anvil_setStorageAt", [USDC, key, before ?? numberToHex(0n, { size: 32 })]);
  }
  if (found === undefined) throw new Error("could not locate the USDC balance slot");
  for (const [who, amount] of balances.slice(1)) await rpc(pub, "anvil_setStorageAt", [USDC, keyFor(who, found), numberToHex(amount, { size: 32 })]);
  return found;
}

export async function setEthBalance(pub: PublicClient, who: Address, wei: bigint): Promise<void> {
  await rpc(pub, "anvil_setBalance", [who, numberToHex(wei)]);
}

/**
 * Anvil's dev keys are public; on Arbitrum Sepolia those addresses carry EIP-7702 delegation
 * code planted by sweeper bots. Clear it on the fork so they behave as plain EOAs.
 */
export async function clearCode(pub: PublicClient, who: Address): Promise<boolean> {
  const code = await pub.getCode({ address: who });
  if (code === undefined || code === "0x") return false;
  await rpc(pub, "anvil_setCode", [who, "0x"]);
  return true;
}

export async function timeTravel(pub: PublicClient, seconds: number): Promise<void> {
  await rpc(pub, "evm_increaseTime", [numberToHex(seconds)]);
  await rpc(pub, "evm_mine", []);
}

/** Anvil's default mnemonic accounts ("test test ... junk"). Public, test-only keys. */
export const ANVIL_DEV_KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  provider: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  facilitator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  evaluator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  buyer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const;
