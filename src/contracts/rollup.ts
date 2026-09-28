import type { Address, Hex, PublicClient } from "viem";
import { rollupAbi } from "./abis.js";

/** Log scans widen backwards from the chain tip in LOOKBACK_STEP block windows up to LOOKBACK_MAX. */
const LOOKBACK_STEP = 100_000n;
const LOOKBACK_MAX = 500_000n;

/** Recover the RollupLib.assertionHash preimage from the rollup's AssertionCreated log. */
export async function getAssertionPreimage(
  l1: PublicClient,
  rollup: Address,
  assertionHash: Hex,
) {
  const tip = await l1.getBlockNumber();
  for (let span = LOOKBACK_STEP; span <= LOOKBACK_MAX; span += LOOKBACK_STEP) {
    const logs = await l1.getContractEvents({
      address: rollup,
      abi: rollupAbi,
      eventName: "AssertionCreated",
      args: { assertionHash },
      strict: true,
      fromBlock: tip > span ? tip - span : 0n,
      toBlock: tip,
    });
    if (logs.length > 0) {
      const args = logs[logs.length - 1].args;
      return {
        parentAssertionHash: args.parentAssertionHash,
        afterState: args.assertion.afterState,
        inboxAcc: args.afterInboxBatchAcc,
      };
    }
    if (tip <= span) {
      break;
    }
  }
  throw new Error(`no AssertionCreated log found for ${assertionHash} on rollup ${rollup}`);
}
