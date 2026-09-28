import type { Address, Hex } from "viem";
import { getContract } from "viem";
import { hotWallet, type Clients } from "./clients.js";
import { l2StateMirrorAbi } from "./contracts/abis.js";
import { getAssertionPreimage } from "./contracts/rollup.js";
import { getSnapshotStatus } from "./contracts/stateMirror.js";
import { waitForSuccess } from "./contracts/tx.js";
import { getRlpEncodedHeader } from "./l2/header.js";
import { mappingSlot } from "./l2/slots.js";
import { getCheckpointProofs, getStorageProof } from "./l2/storageProofs.js";

/** The snapshot's L2 block number; requires the header to be proven first. */
async function provenL2BlockNumber(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
): Promise<bigint> {
  const status = await getSnapshotStatus(clients.l1, mirror, assertionHash);
  if (!status.exists) {
    throw new Error(`assertion ${assertionHash} is not checkpointed`);
  }
  if (status.l2BlockNumber === 0n) {
    throw new Error(`L2 block header not proven for ${assertionHash}; run prove header first`);
  }
  return status.l2BlockNumber;
}

export async function proveL2BlockHeader(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
): Promise<Hex> {
  const stateMirrorContract = getContract({ address: mirror, abi: l2StateMirrorAbi, client: { public: clients.l1, wallet: hotWallet(clients) } });
  const rollup = await stateMirrorContract.read.rollup();
  const preimage = await getAssertionPreimage(clients.l1, rollup, assertionHash);
  const l2BlockHash = preimage.afterState.globalState.bytes32Vals[0];
  const headerRlp = await getRlpEncodedHeader(clients.l2, l2BlockHash);
  const hash = await stateMirrorContract.write.proveL2BlockHeader(
    [assertionHash, preimage.parentAssertionHash, preimage.afterState, preimage.inboxAcc, headerRlp],
    { chain: null },
  );
  return (await waitForSuccess(clients.l1, hash)).transactionHash;
}

export async function proveTokenStorageRoot(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
): Promise<Hex> {
  const stateMirrorContract = getContract({ address: mirror, abi: l2StateMirrorAbi, client: { public: clients.l1, wallet: hotWallet(clients) } });
  const blockNumber = await provenL2BlockNumber(clients, mirror, assertionHash);
  const l2TokenAddress = await stateMirrorContract.read.l2TokenAddress();
  const { accountProof } = await clients.l2.getProof({ address: l2TokenAddress, storageKeys: [], blockNumber });
  const hash = await stateMirrorContract.write.proveTokenStorageRoot([assertionHash, accountProof], { chain: null });
  return (await waitForSuccess(clients.l1, hash)).transactionHash;
}

export async function proveDelegateMappingStorageRoot(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
): Promise<Hex> {
  const stateMirrorContract = getContract({ address: mirror, abi: l2StateMirrorAbi, client: { public: clients.l1, wallet: hotWallet(clients) } });
  const blockNumber = await provenL2BlockNumber(clients, mirror, assertionHash);
  const l2DelegateMappingAddress = await stateMirrorContract.read.l2DelegateMappingAddress();
  const { accountProof } = await clients.l2.getProof({ address: l2DelegateMappingAddress, storageKeys: [], blockNumber });
  const hash = await stateMirrorContract.write.proveDelegateMappingStorageRoot([assertionHash, accountProof], { chain: null });
  return (await waitForSuccess(clients.l1, hash)).transactionHash;
}

export async function proveTotalDelegation(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
): Promise<Hex> {
  const stateMirrorContract = getContract({ address: mirror, abi: l2StateMirrorAbi, client: { public: clients.l1, wallet: hotWallet(clients) } });
  const blockNumber = await provenL2BlockNumber(clients, mirror, assertionHash);
  const [l2TokenAddress, l2TokenTotalDelegationSlot] = await Promise.all([
    stateMirrorContract.read.l2TokenAddress(),
    stateMirrorContract.read.l2TokenTotalDelegationSlot(),
  ]);
  const proofs = await getCheckpointProofs(clients.l2, l2TokenAddress, l2TokenTotalDelegationSlot, blockNumber);
  const hash = await stateMirrorContract.write.proveTotalDelegation(
    [assertionHash, proofs.lengthProof, proofs.lastCheckpointProof],
    { chain: null },
  );
  return (await waitForSuccess(clients.l1, hash)).transactionHash;
}

export async function proveVotes(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
  l2Account: Address,
): Promise<Hex> {
  const stateMirrorContract = getContract({ address: mirror, abi: l2StateMirrorAbi, client: { public: clients.l1, wallet: hotWallet(clients) } });
  const blockNumber = await provenL2BlockNumber(clients, mirror, assertionHash);
  const [l2TokenAddress, l2DelegateCheckpointsSlot] = await Promise.all([
    stateMirrorContract.read.l2TokenAddress(),
    stateMirrorContract.read.l2DelegateCheckpointsSlot(),
  ]);
  const checkpointArrSlot = mappingSlot(l2DelegateCheckpointsSlot, l2Account);
  const proofs = await getCheckpointProofs(clients.l2, l2TokenAddress, checkpointArrSlot, blockNumber);
  const hash = await stateMirrorContract.write.proveVotes(
    [assertionHash, l2Account, proofs.lengthProof, proofs.lastCheckpointProof],
    { chain: null },
  );
  return (await waitForSuccess(clients.l1, hash)).transactionHash;
}

export async function proveL1Address(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
  l2Delegate: Address,
): Promise<Hex> {
  const stateMirrorContract = getContract({ address: mirror, abi: l2StateMirrorAbi, client: { public: clients.l1, wallet: hotWallet(clients) } });
  const blockNumber = await provenL2BlockNumber(clients, mirror, assertionHash);
  const [l2DelegateMappingAddress, l2DelegateMappingL1AddressSlot] = await Promise.all([
    stateMirrorContract.read.l2DelegateMappingAddress(),
    stateMirrorContract.read.l2DelegateMappingL1AddressSlot(),
  ]);
  const slot = mappingSlot(l2DelegateMappingL1AddressSlot, l2Delegate);
  const storageProof = await getStorageProof(clients.l2, l2DelegateMappingAddress, slot, blockNumber);
  const hash = await stateMirrorContract.write.proveL1Address([assertionHash, l2Delegate, storageProof], { chain: null });
  return (await waitForSuccess(clients.l1, hash)).transactionHash;
}
