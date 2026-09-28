import type { Address } from "viem";
import { encodeAbiParameters, keccak256 } from "viem";

/** Solidity mapping slot: keccak256(abi.encode(key, mSlot)). Mirrors ProofHelper.mappingSlot. */
export function mappingSlot(mSlot: bigint, key: Address): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, mSlot]),
    ),
  );
}

/** Solidity dynamic array element slot: keccak256(abi.encode(aSlot)) + index. Mirrors ProofHelper.arraySlot. */
export function arraySlot(aSlot: bigint, index: bigint): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [aSlot]))) + index;
}
