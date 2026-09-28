import type { Address, Hex } from "viem";
import { BaseError, ContractFunctionRevertedError, getContract, isAddressEqual, zeroAddress, zeroHash } from "viem";
import { recoverClaimSigner, signClaimL1Address } from "./claimSig.js";
import { hotWallet, l1DelegateWallet, type Clients } from "./clients.js";
import { delegateMappingAbi, l1ArbitrumGovernorAbi, l2StateMirrorAbi } from "./contracts/abis.js";
import { getSnapshotStatus, submitCheckpointAssertion, type Checkpoint } from "./contracts/stateMirror.js";
import { waitForSuccess, waitPastBlock } from "./contracts/tx.js";
import type { Deployment } from "./deployment.js";
import * as prove from "./prove.js";

/** Reuse the newest checkpoint at or after minBlock, or submit a fresh one. */
export async function ensureCheckpoint(
  clients: Clients,
  deployment: Deployment,
  minBlock: bigint,
): Promise<Checkpoint> {
  const logs = await clients.l1.getContractEvents({
    address: deployment.stateMirror,
    abi: l2StateMirrorAbi,
    eventName: "AssertionCheckpointed",
    strict: true,
    fromBlock: minBlock < 0n ? 0n : minBlock,
    toBlock: "latest",
  });
  const last = logs.at(-1);
  if (last) {
    const cp = { assertionHash: last.args.assertionHash, l1Block: last.blockNumber };
    console.log(`[checkpoint] reusing assertion ${cp.assertionHash} checkpointed at block ${cp.l1Block}`);
    return cp;
  }
  const { txHash, checkpoint: cp } = await submitCheckpointAssertion(clients, deployment.stateMirror);
  console.log(`[checkpoint] checkpointed assertion ${cp.assertionHash} at block ${cp.l1Block} in tx ${txHash}`);
  return cp;
}

/** The call's result, or null if it reverts with the named custom error. */
async function nullIfReverts<T>(call: Promise<T>, errorName: string): Promise<T | null> {
  try {
    return await call;
  } catch (err) {
    const revert = err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName === errorName) {
      return null;
    }
    throw err;
  }
}

/** Skip if done, else do. A failed write is ignored if a reread shows the work done anyway,
 *  e.g. another account did the same thing first. */
async function doOnce(
  label: string,
  isDone: () => Promise<boolean>,
  doIt: () => Promise<Hex>,
): Promise<Hex | null> {
  if (await isDone()) {
    console.log(`[${label}] already done`);
    return null;
  }
  try {
    const tx = await doIt();
    console.log(`[${label}] done in tx ${tx}`);
    return tx;
  } catch (err) {
    if (!(await isDone())) {
      throw err;
    }
    console.log(`[${label}] done by another account first`);
    return null;
  }
}

export async function ensureHeader(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
): Promise<Hex | null> {
  return doOnce(
    "header",
    async () => (await getSnapshotStatus(clients.l1, deployment.stateMirror, cp.assertionHash)).l2BlockNumber !== 0n,
    () => prove.proveL2BlockHeader(clients, deployment.stateMirror, cp.assertionHash),
  );
}

export async function ensureTokenRoot(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
): Promise<Hex | null> {
  return doOnce(
    "token root",
    async () => (await getSnapshotStatus(clients.l1, deployment.stateMirror, cp.assertionHash)).l2TokenStorageRoot !== zeroHash,
    () => prove.proveTokenStorageRoot(clients, deployment.stateMirror, cp.assertionHash),
  );
}

async function ensureDelegateMappingRoot(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
): Promise<Hex | null> {
  return doOnce(
    "delegate mapping root",
    async () => (await getSnapshotStatus(clients.l1, deployment.stateMirror, cp.assertionHash)).l2DelegateMappingStorageRoot !== zeroHash,
    () => prove.proveDelegateMappingStorageRoot(clients, deployment.stateMirror, cp.assertionHash),
  );
}

export async function ensureTotalDelegation(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
): Promise<Hex | null> {
  return doOnce(
    "total delegation",
    async () => (await getSnapshotStatus(clients.l1, deployment.stateMirror, cp.assertionHash)).totalDelegation !== 0n,
    () => prove.proveTotalDelegation(clients, deployment.stateMirror, cp.assertionHash),
  );
}

export async function ensureVotes(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
  l2Account: Address,
): Promise<Hex | null> {
  const stateMirrorContract = getContract({ address: deployment.stateMirror, abi: l2StateMirrorAbi, client: clients.l1 });
  return doOnce(
    `votes for ${l2Account}`,
    async () => (await nullIfReverts(stateMirrorContract.read.getVotesAt([l2Account, cp.l1Block]), "VotesNotProven")) !== null,
    () => prove.proveVotes(clients, deployment.stateMirror, cp.assertionHash, l2Account),
  );
}

/** Register the delegate's L1 address for this snapshot: by provided signature, by signing with
 *  the L2 delegate key, or by proving the delegate's on-chain L2 DelegateMapping claim. */
export async function ensureL1Address(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
  l2Delegate: Address,
  l1Delegate: Address,
  claimSig?: Hex,
): Promise<Hex | null> {
  return doOnce(
    `l1 address for ${l2Delegate}`,
    () => isL1AddressRegistered(clients, deployment, cp, l2Delegate, l1Delegate),
    () => registerL1Address(clients, deployment, cp, l2Delegate, l1Delegate, claimSig),
  );
}

/** Throws if an L1 address other than l1Delegate is registered. */
async function isL1AddressRegistered(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
  l2Delegate: Address,
  l1Delegate: Address,
): Promise<boolean> {
  const stateMirrorContract = getContract({ address: deployment.stateMirror, abi: l2StateMirrorAbi, client: clients.l1 });
  const registered = await nullIfReverts(stateMirrorContract.read.getL1AddressAt([l2Delegate, cp.l1Block]), "L1AddressNotProven");
  if (registered && !isAddressEqual(registered, l1Delegate)) {
    throw new Error(
      `L1 address ${registered} already registered for ${l2Delegate} at assertion ${cp.assertionHash}; cannot register ${l1Delegate}`,
    );
  }
  return registered !== null;
}

async function registerL1Address(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
  l2Delegate: Address,
  l1Delegate: Address,
  claimSig?: Hex,
): Promise<Hex> {
  if (claimSig) {
    const signer = await recoverClaimSigner(clients, deployment.stateMirror, cp.assertionHash, l1Delegate, claimSig);
    if (!isAddressEqual(signer, l2Delegate)) {
      throw new Error(
        `claim signature recovers ${signer}, not ${l2Delegate}; it must sign over assertion ${cp.assertionHash} and L1 address ${l1Delegate}`,
      );
    }
  }
  if (claimSig || clients.l2DelegateAccount) {
    const signature =
      claimSig ??
      (await signClaimL1Address(clients, deployment.stateMirror, cp.assertionHash, l1Delegate));
    console.log("[l1 address] claiming by signature");
    const hash = await hotWallet(clients).writeContract({
      address: deployment.stateMirror,
      abi: l2StateMirrorAbi,
      functionName: "claimL1AddressBySig",
      args: [cp.assertionHash, l2Delegate, l1Delegate, signature],
      chain: null,
    });
    return (await waitForSuccess(clients.l1, hash)).transactionHash;
  }

  const status = await getSnapshotStatus(clients.l1, deployment.stateMirror, cp.assertionHash);
  const l2Mapping = getContract({ address: deployment.l2DelegateMapping, abi: delegateMappingAbi, client: clients.l2 });
  const claimed = await l2Mapping.read.claimed([l2Delegate], { blockNumber: status.l2BlockNumber });
  if (claimed === zeroAddress) {
    throw new Error(
      `${l2Delegate} has no claim in the L2 DelegateMapping at the snapshot; claim on L2, or provide --claim-sig / L2_DELEGATE_PRIVATE_KEY (sign over assertion ${cp.assertionHash})`,
    );
  }
  if (!isAddressEqual(claimed, l1Delegate)) {
    throw new Error(`${l2Delegate} claims ${claimed} in the L2 DelegateMapping, not ${l1Delegate}`);
  }
  await ensureDelegateMappingRoot(clients, deployment, cp);
  console.log("[l1 address] proving from L2 DelegateMapping claim");
  return prove.proveL1Address(clients, deployment.stateMirror, cp.assertionHash, l2Delegate);
}

/** lockProposalSnapshot to the checkpoint's block. */
export async function ensureLocked(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
  proposalId: bigint,
): Promise<Hex | null> {
  return doOnce(
    `lock to block ${cp.l1Block}`,
    () => isLockedTo(clients, deployment, cp, proposalId),
    async () => {
      await waitPastBlock(clients.l1, cp.l1Block);
      const hash = await hotWallet(clients).writeContract({
        address: deployment.governor,
        abi: l1ArbitrumGovernorAbi,
        functionName: "lockProposalSnapshot",
        args: [proposalId, cp.l1Block],
        chain: null,
      });
      return (await waitForSuccess(clients.l1, hash)).transactionHash;
    },
  );
}

/** Throws if the snapshot is locked to a block other than the checkpoint's. */
async function isLockedTo(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
  proposalId: bigint,
): Promise<boolean> {
  const governor = getContract({ address: deployment.governor, abi: l1ArbitrumGovernorAbi, client: clients.l1 });
  if (!(await governor.read.proposalSnapshotLocked([proposalId]))) {
    return false;
  }
  const snapshot = await governor.read.proposalSnapshot([proposalId]);
  if (snapshot !== cp.l1Block) {
    throw new Error(
      `proposal ${proposalId} snapshot is locked to block ${snapshot}, not ${cp.l1Block}; use prove-and-vote`,
    );
  }
  return true;
}

/** DelegateMapping.claim on L1: the L1 delegate claims the L2 delegate. */
export async function ensureL1Claim(
  clients: Clients,
  deployment: Deployment,
  l2Delegate: Address,
  l1Delegate: Address,
): Promise<Hex | null> {
  const l1Mapping = getContract({ address: deployment.l1DelegateMapping, abi: delegateMappingAbi, client: clients.l1 });
  if (isAddressEqual(await l1Mapping.read.claimed([l1Delegate]), l2Delegate)) {
    console.log(`[l1 claim] ${l1Delegate} already claims ${l2Delegate}`);
    return null;
  }
  const hash = await l1DelegateWallet(clients).writeContract({
    address: deployment.l1DelegateMapping,
    abi: delegateMappingAbi,
    functionName: "claim",
    args: [l2Delegate],
    chain: null,
  });
  const receipt = await waitForSuccess(clients.l1, hash);
  console.log(`[l1 claim] ${l1Delegate} claimed ${l2Delegate} in tx ${receipt.transactionHash}`);
  return receipt.transactionHash;
}
