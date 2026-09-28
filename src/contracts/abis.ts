import { parseAbi } from "viem";

// todo: import these

export const l2StateMirrorAbi = parseAbi([
  "struct GlobalState { bytes32[2] bytes32Vals; uint64[2] u64Vals; }",
  "struct AssertionState { GlobalState globalState; uint8 machineStatus; bytes32 endHistoryRoot; }",
  "function checkpointAssertion()",
  "function proveL2BlockHeader(bytes32 assertionHash, bytes32 parentAssertionHash, AssertionState afterState, bytes32 inboxAcc, bytes blockHeaderRlpBytes)",
  "function proveTokenStorageRoot(bytes32 assertionHash, bytes[] accountProof)",
  "function proveDelegateMappingStorageRoot(bytes32 assertionHash, bytes[] accountProof)",
  "function proveTotalDelegation(bytes32 assertionHash, bytes[] checkpointLenStorageProof, bytes[] lastCheckpointStorageProof)",
  "function proveVotes(bytes32 assertionHash, address account, bytes[] checkpointLenStorageProof, bytes[] lastCheckpointStorageProof)",
  "function proveL1Address(bytes32 assertionHash, address l2Delegate, bytes[] storageProof)",
  "function claimL1AddressBySig(bytes32 assertionHash, address l2Delegate, address l1Address, bytes signature)",
  "function rollup() view returns (address)",
  "function l2TokenAddress() view returns (address)",
  "function l2DelegateCheckpointsSlot() view returns (uint256)",
  "function l2TokenTotalDelegationSlot() view returns (uint256)",
  "function l2DelegateMappingAddress() view returns (address)",
  "function l2DelegateMappingL1AddressSlot() view returns (uint256)",
  "function snapshotOf(bytes32 assertionHash) view returns (bool exists, bytes32 l2StateRoot, uint256 l2BlockNumber, bytes32 l2TokenStorageRoot, bytes32 l2DelegateMappingStorageRoot, uint256 totalDelegation)",
  "function getAssertionHashAt(uint256 blockNumber) view returns (bytes32)",
  "function getTotalDelegationAt(uint256 blockNumber) view returns (uint256)",
  "function getVotesAt(address l2Account, uint256 blockNumber) view returns (uint256)",
  "function getL1AddressAt(address l2Delegate, uint256 blockNumber) view returns (address)",
  "event AssertionCheckpointed(bytes32 indexed assertionHash)",
  "error VotesNotProven()",
  "error L1AddressNotProven()",
]);

export const rollupAbi = parseAbi([
  "struct GlobalState { bytes32[2] bytes32Vals; uint64[2] u64Vals; }",
  "struct AssertionState { GlobalState globalState; uint8 machineStatus; bytes32 endHistoryRoot; }",
  "struct ConfigData { bytes32 wasmModuleRoot; uint256 requiredStake; address challengeManager; uint64 confirmPeriodBlocks; uint64 nextInboxPosition; }",
  "struct BeforeStateData { bytes32 prevPrevAssertionHash; bytes32 sequencerBatchAcc; ConfigData configData; }",
  "struct AssertionInputs { BeforeStateData beforeStateData; AssertionState beforeState; AssertionState afterState; }",
  "event AssertionCreated(bytes32 indexed assertionHash, bytes32 indexed parentAssertionHash, AssertionInputs assertion, bytes32 afterInboxBatchAcc, uint256 inboxMaxCount, bytes32 wasmModuleRoot, uint256 requiredStake, address challengeManager, uint64 confirmPeriodBlocks)",
]);

export const delegateMappingAbi = parseAbi([
  "function claimed(address account) view returns (address)",
  "function claim(address account)",
]);

export const votingTokenMirrorAbi = parseAbi([
  "function getPastVotes(address account, uint256 blockNumber) view returns (uint256)",
  "function stateMirror() view returns (address)",
  "function l1DelegateMapping() view returns (address)",
]);

export const l1ArbitrumGovernorAbi = parseAbi([
  "function propose(address[] targets, uint256[] values, bytes[] calldatas, string description, uint256 thresholdBlock) returns (uint256)",
  "function castVote(uint256 proposalId, uint8 support) returns (uint256)",
  "function lockProposalSnapshot(uint256 proposalId, uint256 blockNumber)",
  "function state(uint256 proposalId) view returns (uint8)",
  "function proposalSnapshot(uint256 proposalId) view returns (uint256)",
  "function proposalSnapshotLocked(uint256 proposalId) view returns (bool)",
  "function proposalThreshold() view returns (uint256)",
  "function maxProposalBlockLookback() view returns (uint256)",
  "function hasVoted(uint256 proposalId, address account) view returns (bool)",
  "function EXCLUDE_ADDRESS() view returns (address)",
  "function token() view returns (address)",
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)",
]);
