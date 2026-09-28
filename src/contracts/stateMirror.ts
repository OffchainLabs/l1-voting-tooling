import type { Address, Hex, PublicClient } from "viem";
import { getContract, parseEventLogs } from "viem";
import { hotWallet, type Clients } from "../clients.js";
import { l2StateMirrorAbi } from "./abis.js";
import { waitForSuccess } from "./tx.js";

/** An assertion checkpointed in the mirror and the L1 block it is committed to. */
export interface Checkpoint {
  assertionHash: Hex;
  l1Block: bigint;
}

export async function getSnapshotStatus(
  l1: PublicClient,
  mirror: Address,
  assertionHash: Hex,
) {
  const [exists, l2StateRoot, l2BlockNumber, l2TokenStorageRoot, l2DelegateMappingStorageRoot, totalDelegation] =
    await getContract({ address: mirror, abi: l2StateMirrorAbi, client: l1 }).read.snapshotOf([assertionHash]);
  return {
    exists,
    l2StateRoot,
    l2BlockNumber,
    l2TokenStorageRoot,
    l2DelegateMappingStorageRoot,
    totalDelegation,
  };
}

/** Commit the rollup's latest confirmed assertion to the current L1 block. */
export async function submitCheckpointAssertion(
  clients: Clients,
  mirror: Address,
): Promise<{ txHash: Hex; checkpoint: Checkpoint }> {
  const hash = await hotWallet(clients).writeContract({
    address: mirror,
    abi: l2StateMirrorAbi,
    functionName: "checkpointAssertion",
    args: [],
    chain: null,
  });
  const receipt = await waitForSuccess(clients.l1, hash);
  const [event] = parseEventLogs({
    abi: l2StateMirrorAbi,
    eventName: "AssertionCheckpointed",
    logs: receipt.logs,
  });
  return {
    txHash: receipt.transactionHash,
    checkpoint: { assertionHash: event.args.assertionHash, l1Block: receipt.blockNumber },
  };
}
