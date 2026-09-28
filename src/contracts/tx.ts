import { setTimeout } from "node:timers/promises";
import type { Hex, PublicClient, TransactionReceipt } from "viem";

/** propose and lockProposalSnapshot require a block before block.number, and RPCs estimate gas
 *  at the head, so a checkpoint mined in the head block fails estimation until the next block. */
export async function waitPastBlock(l1: PublicClient, block: bigint) {
  while ((await l1.getBlockNumber({ cacheTime: 0 })) <= block) {
    await setTimeout(1000);
  }
}

/** Wait for a sent tx and throw if it reverted. */
export async function waitForSuccess(l1: PublicClient, hash: Hex): Promise<TransactionReceipt> {
  const receipt = await l1.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`tx ${receipt.transactionHash} reverted`);
  }
  return receipt;
}
