import type { Hex, HttpTransport, PublicClient, WalletClient } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export interface Keys {
  /** Sends checkpoint, proof, claim-sig, and lock txs; needs no privileges or delegation. */
  hotL1?: Hex;
  /** Signs EIP-712 ClaimL1Address messages as the L2 delegate; never sends txs. */
  l2Delegate?: Hex;
  /** Claims the L2 delegate, proposes, and votes as the L1 delegate. */
  l1Delegate?: Hex;
}

type Wallet = WalletClient<HttpTransport, undefined, PrivateKeyAccount>;

export interface Clients {
  l1: PublicClient;
  l2: PublicClient;
  hotWallet?: Wallet;
  l2DelegateAccount?: PrivateKeyAccount;
  l1DelegateWallet?: Wallet;
}

export function createClients(l1RpcUrl: string, l2RpcUrl: string, keys: Keys = {}): Clients {
  const wallet = (key?: Hex) =>
    key
      ? createWalletClient({ account: privateKeyToAccount(key), transport: http(l1RpcUrl) })
      : undefined;
  return {
    l1: createPublicClient({ transport: http(l1RpcUrl) }),
    l2: createPublicClient({ transport: http(l2RpcUrl) }),
    hotWallet: wallet(keys.hotL1),
    l2DelegateAccount: keys.l2Delegate ? privateKeyToAccount(keys.l2Delegate) : undefined,
    l1DelegateWallet: wallet(keys.l1Delegate),
  };
}

export function hotWallet(clients: Clients): Wallet {
  if (!clients.hotWallet) {
    throw new Error("HOT_L1_PRIVATE_KEY required");
  }
  return clients.hotWallet;
}

export function l1DelegateWallet(clients: Clients): Wallet {
  if (!clients.l1DelegateWallet) {
    throw new Error("L1_DELEGATE_PRIVATE_KEY required");
  }
  return clients.l1DelegateWallet;
}
