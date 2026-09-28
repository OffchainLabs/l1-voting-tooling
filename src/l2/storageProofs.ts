import type { Address, Hex, PublicClient } from "viem";
import { toHex } from "viem";
import { arraySlot } from "./slots.js";

/** eth_getProof storage proof for a single slot at a block. Throws if the slot is zero:
 *  the mirror's OP trie verifies inclusion only, so a zero slot is unprovable. */
export async function getStorageProof(
  l2: PublicClient,
  address: Address,
  slot: bigint,
  blockNumber: bigint,
): Promise<Hex[]> {
  const proof = await l2.getProof({
    address,
    storageKeys: [toHex(slot, { size: 32 })],
    blockNumber,
  });
  const entry = proof.storageProof[0];
  if (entry.value === 0n) {
    throw new Error(`slot ${toHex(slot)} of ${address} is zero at block ${blockNumber}; unprovable`);
  }
  return entry.proof;
}

/** Storage proofs of the checkpoints array length slot and its last element's slot (see
 *  L2StateMirror._proveLastItemInCheckpointsArray). Throws if the last checkpoint's value is zero:
 *  the mirror's getters treat a zero value as unproven. */
export async function getCheckpointProofs(
  l2: PublicClient,
  address: Address,
  checkpointArrSlot: bigint,
  blockNumber: bigint,
) {
  const lenHex = await l2.getStorageAt({
    address,
    slot: toHex(checkpointArrSlot, { size: 32 }),
    blockNumber,
  });
  const length = BigInt(lenHex ?? 0n);
  if (length === 0n) {
    throw new Error(`checkpoints array at slot ${toHex(checkpointArrSlot)} of ${address} is empty at block ${blockNumber}`);
  }
  const lastSlot = arraySlot(checkpointArrSlot, length - 1n);
  const proof = await l2.getProof({
    address,
    storageKeys: [toHex(checkpointArrSlot, { size: 32 }), toHex(lastSlot, { size: 32 })],
    blockNumber,
  });
  // fromBlock is the low 32 bits, the value the high 224
  if (proof.storageProof[1].value >> 32n === 0n) {
    throw new Error(`last checkpoint at slot ${toHex(lastSlot)} of ${address} has value 0 at block ${blockNumber}`);
  }
  return {
    lengthProof: proof.storageProof[0].proof,
    lastCheckpointProof: proof.storageProof[1].proof,
  };
}
