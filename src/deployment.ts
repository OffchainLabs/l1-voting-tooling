import type { Address, PublicClient } from "viem";
import { getContract } from "viem";
import { l1ArbitrumGovernorAbi, l2StateMirrorAbi, votingTokenMirrorAbi } from "./contracts/abis.js";

/** L1 voting system addresses, resolved on-chain from the governor. */
export interface Deployment {
  governor: Address;
  votingTokenMirror: Address;
  stateMirror: Address;
  l1DelegateMapping: Address;
  /** The DelegateMapping on L2, read from the mirror's immutables. */
  l2DelegateMapping: Address;
}

export async function resolveDeployment(l1: PublicClient, governor: Address): Promise<Deployment> {
  const votingTokenMirror = await getContract({ address: governor, abi: l1ArbitrumGovernorAbi, client: l1 }).read.token();
  const tokenMirror = getContract({ address: votingTokenMirror, abi: votingTokenMirrorAbi, client: l1 });
  const [stateMirror, l1DelegateMapping] = await Promise.all([
    tokenMirror.read.stateMirror(),
    tokenMirror.read.l1DelegateMapping(),
  ]);
  const stateMirrorContract = getContract({ address: stateMirror, abi: l2StateMirrorAbi, client: l1 });
  const l2DelegateMapping = await stateMirrorContract.read.l2DelegateMappingAddress();
  return { governor, votingTokenMirror, stateMirror, l1DelegateMapping, l2DelegateMapping };
}
