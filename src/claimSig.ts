import type { Address, Hex } from "viem";
import { recoverTypedDataAddress } from "viem";
import type { Clients } from "./clients.js";

async function claimTypedData(clients: Clients, mirror: Address, assertionHash: Hex, l1Address: Address) {
  return {
    domain: { name: "L2StateMirror", version: "1", chainId: await clients.l1.getChainId(), verifyingContract: mirror },
    types: {
      ClaimL1Address: [
        { name: "assertionHash", type: "bytes32" },
        { name: "l1Address", type: "address" },
      ],
    },
    primaryType: "ClaimL1Address",
    message: { assertionHash, l1Address },
  } as const;
}

/** EIP-712 signature over ClaimL1Address(bytes32 assertionHash,address l1Address),
 *  signed by the L2 delegate account. */
export async function signClaimL1Address(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
  l1Address: Address,
): Promise<Hex> {
  if (!clients.l2DelegateAccount) {
    throw new Error("L2_DELEGATE_PRIVATE_KEY required to sign");
  }
  return clients.l2DelegateAccount.signTypedData(await claimTypedData(clients, mirror, assertionHash, l1Address));
}

export async function recoverClaimSigner(
  clients: Clients,
  mirror: Address,
  assertionHash: Hex,
  l1Address: Address,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({ ...(await claimTypedData(clients, mirror, assertionHash, l1Address)), signature });
}
