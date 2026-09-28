#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, Option } from "commander";
import type { Address, Hex } from "viem";
import { getContract } from "viem";
import * as claimSig from "./claimSig.js";
import { createClients, hotWallet } from "./clients.js";
import { l2StateMirrorAbi } from "./contracts/abis.js";
import { getSnapshotStatus, submitCheckpointAssertion } from "./contracts/stateMirror.js";
import { waitForSuccess } from "./contracts/tx.js";
import { resolveDeployment } from "./deployment.js";
import * as flows from "./flows.js";
import * as prove from "./prove.js";

const program = new Command();

program
  .name("l1-voting-proving")
  .description("Build and submit proofs for the L2StateMirror L1 voting system")
  .version("0.0.1")
  .addOption(new Option("--governor <address>", "L1ArbitrumGovernor address").env("GOVERNOR_ADDRESS"))
  .addOption(new Option("--l1-rpc <url>", "L1 RPC URL").env("L1_RPC_URL"))
  .addOption(new Option("--l2-rpc <url>", "L2 RPC URL").env("L2_RPC_URL"));

async function setup() {
  const { governor, l1Rpc, l2Rpc } = program.opts<{ governor?: Address; l1Rpc?: string; l2Rpc?: string }>();
  if (!l1Rpc || !l2Rpc || !governor) {
    throw new Error("missing --l1-rpc, --l2-rpc, or --governor (or their env vars)");
  }
  const clients = createClients(l1Rpc, l2Rpc, {
    hotL1: process.env.HOT_L1_PRIVATE_KEY as Hex | undefined,
    l2Delegate: process.env.L2_DELEGATE_PRIVATE_KEY as Hex | undefined,
    l1Delegate: process.env.L1_DELEGATE_PRIVATE_KEY as Hex | undefined,
  });
  const deployment = await resolveDeployment(clients.l1, governor);
  return { clients, deployment };
}

/** GovernorCountingSimple.VoteType values by index. */
const SUPPORT = ["AGAINST", "FOR", "ABSTAIN"] as const;

program
  .command("prove-and-propose")
  .description("perform all prerequisite proving steps, then create a proposal")
  .requiredOption("--targets <addresses...>", "proposal target addresses")
  .option("--values <weis...>", "ETH value per target (default: all 0)")
  .requiredOption("--calldatas <hexdata...>", "calldata per target")
  .requiredOption("--description-file <path>", "file containing the proposal description")
  .option("--l2-delegate <address>", "L2 delegate (default: L2_DELEGATE_PRIVATE_KEY address)")
  .option("--claim-sig <hex>", "pre-signed ClaimL1Address signature (see claim-sig sign)")
  .action(async (opts: {
    targets: Address[];
    values?: string[];
    calldatas: Hex[];
    descriptionFile: string;
    l2Delegate?: Address;
    claimSig?: Hex;
  }) => {
    const { clients, deployment } = await setup();
    const { targets, calldatas } = opts;
    const values = (opts.values ?? targets.map(() => "0")).map(BigInt);
    if (values.length !== targets.length || calldatas.length !== targets.length) {
      throw new Error("--targets, --values, and --calldatas must have equal lengths");
    }
    const description = readFileSync(opts.descriptionFile, "utf8");
    await flows.proveAndPropose(
      clients,
      deployment,
      { targets, values, calldatas, description },
      { l2Delegate: opts.l2Delegate, claimSig: opts.claimSig },
    );
  });

for (const [name, description, flow] of [
  [
    "prove-and-first-vote",
    "perform all proving steps including quorum inputs, lock the snapshot, then vote (requires an unlocked snapshot)",
    flows.proveAndFirstVote,
  ],
  [
    "prove-and-vote",
    "prove against a locked snapshot, then vote (requires prove-and-first-vote to have run)",
    flows.proveAndVote,
  ],
] as const) {
  program
    .command(name)
    .description(description)
    .requiredOption("--proposal-id <id>", "proposal id", (v) => BigInt(v))
    .addOption(new Option("--support <choice>", "vote").choices(SUPPORT).makeOptionMandatory())
    .option("--l2-delegate <address>", "L2 delegate (default: L2_DELEGATE_PRIVATE_KEY address)")
    .option("--claim-sig <hex>", "pre-signed ClaimL1Address signature (see claim-sig sign)")
    .action(async (opts: {
      proposalId: bigint;
      support: (typeof SUPPORT)[number];
      l2Delegate?: Address;
      claimSig?: Hex;
    }) => {
      const { clients, deployment } = await setup();
      await flow(clients, deployment, opts.proposalId, SUPPORT.indexOf(opts.support), {
        l2Delegate: opts.l2Delegate,
        claimSig: opts.claimSig,
      });
    });
}

program
  .command("checkpoint")
  .description("commit the rollup's latest confirmed assertion to the current L1 block")
  .action(async () => {
    const { clients, deployment } = await setup();
    console.log(await submitCheckpointAssertion(clients, deployment.stateMirror));
  });

const proveCmd = program
  .command("prove")
  .description("build and submit a proof for a checkpointed assertion");

for (const [name, description, run] of [
  ["header", "prove the L2 block header (state root and block number)", prove.proveL2BlockHeader],
  ["token-root", "prove the L2 ARB token storage root", prove.proveTokenStorageRoot],
  ["delegate-mapping-root", "prove the L2 DelegateMapping storage root", prove.proveDelegateMappingStorageRoot],
  ["total-delegation", "prove the L2 ARB token total delegation", prove.proveTotalDelegation],
] as const) {
  proveCmd
    .command(name)
    .description(description)
    .argument("<assertionHash>")
    .action(async (assertionHash: Hex) => {
      const { clients, deployment } = await setup();
      console.log(await run(clients, deployment.stateMirror, assertionHash));
    });
}

proveCmd
  .command("votes")
  .description("prove an L2 account's voting power")
  .argument("<assertionHash>")
  .argument("<l2Account>")
  .action(async (assertionHash: Hex, l2Account: Address) => {
    const { clients, deployment } = await setup();
    console.log(await prove.proveVotes(clients, deployment.stateMirror, assertionHash, l2Account));
  });

proveCmd
  .command("l1-address")
  .description("prove an L2 delegate's claimed L1 address")
  .argument("<assertionHash>")
  .argument("<l2Delegate>")
  .action(async (assertionHash: Hex, l2Delegate: Address) => {
    const { clients, deployment } = await setup();
    console.log(
      await prove.proveL1Address(clients, deployment.stateMirror, assertionHash, l2Delegate),
    );
  });

const claimSigCmd = program
  .command("claim-sig")
  .description("EIP-712 L1 address claims for EOA delegates");

claimSigCmd
  .command("sign")
  .description("sign a ClaimL1Address message as the delegate")
  .argument("<assertionHash>")
  .argument("<l1Address>")
  .action(async (assertionHash: Hex, l1Address: Address) => {
    const { clients, deployment } = await setup();
    console.log(
      await claimSig.signClaimL1Address(clients, deployment.stateMirror, assertionHash, l1Address),
    );
  });

claimSigCmd
  .command("submit")
  .description("submit a signed ClaimL1Address message")
  .argument("<assertionHash>")
  .argument("<l2Delegate>")
  .argument("<l1Address>")
  .argument("<signature>")
  .action(async (assertionHash: Hex, l2Delegate: Address, l1Address: Address, signature: Hex) => {
    const { clients, deployment } = await setup();
    const hash = await hotWallet(clients).writeContract({
      address: deployment.stateMirror,
      abi: l2StateMirrorAbi,
      functionName: "claimL1AddressBySig",
      args: [assertionHash, l2Delegate, l1Address, signature],
      chain: null,
    });
    console.log((await waitForSuccess(clients.l1, hash)).transactionHash);
  });

program
  .command("status")
  .description("show which proofs have landed for a snapshot")
  .argument("<assertionHash>")
  .action(async (assertionHash: Hex) => {
    const { clients, deployment } = await setup();
    console.log(await getSnapshotStatus(clients.l1, deployment.stateMirror, assertionHash));
  });

const getCmd = program.command("get").description("read proven state from the mirror");

getCmd
  .command("votes")
  .description("voting power proven for an L2 account as of an L1 block")
  .argument("<l2Account>")
  .requiredOption("--block <number>", "L1 block number", (v) => BigInt(v))
  .action(async (l2Account: Address, opts: { block: bigint }) => {
    const { clients, deployment } = await setup();
    const stateMirrorContract = getContract({ address: deployment.stateMirror, abi: l2StateMirrorAbi, client: clients.l1 });
    console.log(await stateMirrorContract.read.getVotesAt([l2Account, opts.block]));
  });

getCmd
  .command("total-delegation")
  .description("total delegation proven as of an L1 block")
  .requiredOption("--block <number>", "L1 block number", (v) => BigInt(v))
  .action(async (opts: { block: bigint }) => {
    const { clients, deployment } = await setup();
    const stateMirrorContract = getContract({ address: deployment.stateMirror, abi: l2StateMirrorAbi, client: clients.l1 });
    console.log(await stateMirrorContract.read.getTotalDelegationAt([opts.block]));
  });

getCmd
  .command("l1-address")
  .description("L1 address proven for an L2 delegate as of an L1 block")
  .argument("<l2Delegate>")
  .requiredOption("--block <number>", "L1 block number", (v) => BigInt(v))
  .action(async (l2Delegate: Address, opts: { block: bigint }) => {
    const { clients, deployment } = await setup();
    const stateMirrorContract = getContract({ address: deployment.stateMirror, abi: l2StateMirrorAbi, client: clients.l1 });
    console.log(await stateMirrorContract.read.getL1AddressAt([l2Delegate, opts.block]));
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
