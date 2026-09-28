import type { Address, Hex } from "viem";
import { getContract, isAddressEqual, parseEventLogs } from "viem";
import { l1DelegateWallet, type Clients } from "./clients.js";
import { l1ArbitrumGovernorAbi, l2StateMirrorAbi, votingTokenMirrorAbi } from "./contracts/abis.js";
import type { Checkpoint } from "./contracts/stateMirror.js";
import { waitForSuccess, waitPastBlock } from "./contracts/tx.js";
import type { Deployment } from "./deployment.js";
import * as ensure from "./ensure.js";

/** OZ ProposalState enum values by index. */
const PROPOSAL_STATES = [
  "Pending",
  "Active",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Queued",
  "Expired",
  "Executed",
] as const;

export interface ProposalActions {
  targets: Address[];
  values: bigint[];
  calldatas: Hex[];
  description: string;
}

export interface DelegateOptions {
  l2Delegate?: Address;
  claimSig?: Hex;
}

function resolveL2Delegate(clients: Clients, l2Delegate?: Address): Address {
  const fromKey = clients.l2DelegateAccount?.address;
  if (l2Delegate && fromKey && !isAddressEqual(l2Delegate, fromKey)) {
    throw new Error(`--l2-delegate ${l2Delegate} does not match L2_DELEGATE_PRIVATE_KEY address ${fromKey}`);
  }
  const resolved = l2Delegate ?? fromKey;
  if (!resolved) {
    throw new Error("provide --l2-delegate or L2_DELEGATE_PRIVATE_KEY");
  }
  return resolved;
}

async function requireActive(clients: Clients, deployment: Deployment, proposalId: bigint) {
  const governor = getContract({ address: deployment.governor, abi: l1ArbitrumGovernorAbi, client: clients.l1 });
  const state = PROPOSAL_STATES[await governor.read.state([proposalId])];
  if (state === "Pending") {
    const snapshot = await governor.read.proposalSnapshot([proposalId]);
    throw new Error(`proposal ${proposalId} is pending; voting starts after block ${snapshot}`);
  }
  if (state !== "Active") {
    throw new Error(`proposal ${proposalId} is ${state}, not Active`);
  }
}

/** Steps 4-6: prove the delegate's votes and L1 address, then claim on L1. Step numbers follow
 *  "L1 Voting User Flow" in ArbitrumFoundation/governance docs/l1-voting.md. */
async function ensureDelegateReady(
  clients: Clients,
  deployment: Deployment,
  cp: Checkpoint,
  l2Delegate: Address,
  l1Delegate: Address,
  claimSig?: Hex,
) {
  await ensure.ensureVotes(clients, deployment, cp, l2Delegate);
  await ensure.ensureL1Address(clients, deployment, cp, l2Delegate, l1Delegate, claimSig);
  await ensure.ensureL1Claim(clients, deployment, l2Delegate, l1Delegate);
}

/** Full proving flow (steps 1-6), then propose with the checkpoint block as threshold block. */
export async function proveAndPropose(
  clients: Clients,
  deployment: Deployment,
  actions: ProposalActions,
  opts: DelegateOptions,
): Promise<bigint> {
  const wallet = l1DelegateWallet(clients);
  const l1Delegate = wallet.account.address;
  const l2Delegate = resolveL2Delegate(clients, opts.l2Delegate);
  const governor = getContract({ address: deployment.governor, abi: l1ArbitrumGovernorAbi, client: { public: clients.l1, wallet } });
  const lookback = await governor.read.maxProposalBlockLookback();
  const head = await clients.l1.getBlockNumber();

  // reuse a checkpoint only if at least half the lookback window remains
  const cp = await ensure.ensureCheckpoint(clients, deployment, head - lookback / 2n);
  await ensure.ensureHeader(clients, deployment, cp);
  await ensure.ensureTokenRoot(clients, deployment, cp);
  await ensureDelegateReady(clients, deployment, cp, l2Delegate, l1Delegate, opts.claimSig);

  const tokenMirror = getContract({ address: deployment.votingTokenMirror, abi: votingTokenMirrorAbi, client: clients.l1 });
  const votes = await tokenMirror.read.getPastVotes([l1Delegate, cp.l1Block]);
  const threshold = await governor.read.proposalThreshold();
  if (votes < threshold) {
    throw new Error(`voting power ${votes} is below the proposal threshold ${threshold}`);
  }
  await waitPastBlock(clients.l1, cp.l1Block);
  if ((await clients.l1.getBlockNumber()) - cp.l1Block >= lookback) {
    throw new Error(`checkpoint block ${cp.l1Block} aged past the ${lookback} block lookback; rerun`);
  }

  const hash = await governor.write.propose(
    [actions.targets, actions.values, actions.calldatas, actions.description, cp.l1Block],
    { chain: null },
  );
  const receipt = await waitForSuccess(clients.l1, hash);
  const [created] = parseEventLogs({ abi: l1ArbitrumGovernorAbi, eventName: "ProposalCreated", logs: receipt.logs });
  console.log(`[propose] proposal ${created.args.proposalId} created in tx ${receipt.transactionHash}`);
  return created.args.proposalId;
}

/** Steps 1-6, quorum proofs, lockProposalSnapshot, then vote. Requires the snapshot to be unlocked. */
export async function proveAndFirstVote(
  clients: Clients,
  deployment: Deployment,
  proposalId: bigint,
  support: number,
  opts: DelegateOptions,
): Promise<Hex> {
  const wallet = l1DelegateWallet(clients);
  const l1Delegate = wallet.account.address;
  const l2Delegate = resolveL2Delegate(clients, opts.l2Delegate);
  const governor = getContract({ address: deployment.governor, abi: l1ArbitrumGovernorAbi, client: { public: clients.l1, wallet } });
  if (await governor.read.proposalSnapshotLocked([proposalId])) {
    throw new Error(`proposal ${proposalId} snapshot is already locked; use prove-and-vote`);
  }
  await requireActive(clients, deployment, proposalId);

  const snapshot = await governor.read.proposalSnapshot([proposalId]);
  const cp = await ensure.ensureCheckpoint(clients, deployment, snapshot);
  await ensure.ensureHeader(clients, deployment, cp);
  await ensure.ensureTokenRoot(clients, deployment, cp);
  await ensureDelegateReady(clients, deployment, cp, l2Delegate, l1Delegate, opts.claimSig);

  // lockProposalSnapshot calls quorum(), which needs total delegation and exclude votes proven
  await ensure.ensureTotalDelegation(clients, deployment, cp);
  const excludeAddress = await governor.read.EXCLUDE_ADDRESS();
  await ensure.ensureVotes(clients, deployment, cp, excludeAddress);
  await ensure.ensureLocked(clients, deployment, cp, proposalId);
  const hash = await governor.write.castVote([proposalId, support], { chain: null });
  const receipt = await waitForSuccess(clients.l1, hash);
  console.log(`[vote] cast in tx ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/** Steps 4-6 against the locked snapshot, then vote. Requires the snapshot to be locked. */
export async function proveAndVote(
  clients: Clients,
  deployment: Deployment,
  proposalId: bigint,
  support: number,
  opts: DelegateOptions,
): Promise<Hex> {
  const wallet = l1DelegateWallet(clients);
  const l1Delegate = wallet.account.address;
  const l2Delegate = resolveL2Delegate(clients, opts.l2Delegate);
  const governor = getContract({ address: deployment.governor, abi: l1ArbitrumGovernorAbi, client: { public: clients.l1, wallet } });
  if (!(await governor.read.proposalSnapshotLocked([proposalId]))) {
    throw new Error(`proposal ${proposalId} snapshot is not locked; use prove-and-first-vote`);
  }
  await requireActive(clients, deployment, proposalId);
  if (await governor.read.hasVoted([proposalId, l1Delegate])) {
    throw new Error(`${l1Delegate} already voted on proposal ${proposalId}`);
  }

  const snapshot = await governor.read.proposalSnapshot([proposalId]);
  const stateMirrorContract = getContract({ address: deployment.stateMirror, abi: l2StateMirrorAbi, client: clients.l1 });
  const cp: Checkpoint = { l1Block: snapshot, assertionHash: await stateMirrorContract.read.getAssertionHashAt([snapshot]) };
  console.log(`[snapshot] locked at block ${cp.l1Block}, assertion ${cp.assertionHash}`);
  await ensureDelegateReady(clients, deployment, cp, l2Delegate, l1Delegate, opts.claimSig);
  const hash = await governor.write.castVote([proposalId, support], { chain: null });
  const receipt = await waitForSuccess(clients.l1, hash);
  console.log(`[vote] cast in tx ${receipt.transactionHash}`);
  return receipt.transactionHash;
}
