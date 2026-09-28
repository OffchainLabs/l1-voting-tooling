# l1-voting-proving

CLI and library for generating and submitting proofs to the `L2StateMirror` contract, part of the Arbitrum L1 voting system.

`L2StateMirror` lives on L1 and accepts Merkle-Patricia storage proofs of L2 governance state (ARB token voting power and `DelegateMapping` entries) against confirmed rollup assertions. This tool builds those proofs from L2 state and submits them.

## Keys

The CLI reads signing keys from env vars:

- `HOT_L1_PRIVATE_KEY`: sends checkpoint, proof, claim-sig, and lock txs; needs no privileges or delegation
- `L2_DELEGATE_PRIVATE_KEY`: signs `ClaimL1Address` messages as the L2 delegate
- `L1_DELEGATE_PRIVATE_KEY`: claims the L2 delegate, proposes, and votes
