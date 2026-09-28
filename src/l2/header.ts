import type { Hex, PublicClient, RpcBlock } from "viem";
import { toRlp } from "viem";

/** RPC block fields that RLP-encode as minimal big-endian integers. */
const QUANTITY_FIELDS = new Set([
  "difficulty",
  "number",
  "gasLimit",
  "gasUsed",
  "timestamp",
  "baseFeePerGas",
  "blobGasUsed",
  "excessBlobGas",
]);

/** Header fields in yellow-paper order. Fields from baseFeePerGas on are fork-dependent and
 *  included only when the RPC returns them (Arbitrum One headers end at baseFeePerGas). */
const HEADER_FIELDS = [
  "parentHash",
  "sha3Uncles",
  "miner",
  "stateRoot",
  "transactionsRoot",
  "receiptsRoot",
  "logsBloom",
  "difficulty",
  "number",
  "gasLimit",
  "gasUsed",
  "timestamp",
  "extraData",
  "mixHash",
  "nonce",
  "baseFeePerGas",
  "withdrawalsRoot",
  "blobGasUsed",
  "excessBlobGas",
  "parentBeaconBlockRoot",
  "requestsHash",
] as const;

/** Fetch the L2 block and RLP-encode its header so that keccak256(result) == blockHash. */
export async function getRlpEncodedHeader(l2: PublicClient, blockHash: Hex): Promise<Hex> {
  const block: (RpcBlock & { requestsHash?: Hex }) | null = await l2.request({
    method: "eth_getBlockByHash",
    params: [blockHash, false],
  });
  if (!block) {
    throw new Error(`block ${blockHash} not found`);
  }
  const fields: Hex[] = [];
  for (const name of HEADER_FIELDS) {
    const value = block[name];
    if (value == null) {
      continue;
    }
    // toRlp left-pads the odd-length hex left by stripping leading zeros
    fields.push(QUANTITY_FIELDS.has(name) ? (value.replace(/^0x0+/, "0x") as Hex) : value);
  }
  return toRlp(fields);
}
