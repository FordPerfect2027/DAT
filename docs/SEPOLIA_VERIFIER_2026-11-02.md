# Recorded Sepolia checkpoint verification — November 2, 2026

The old verifier counted every exception from each negative simulation as a
successful rejection. A loopback fixture reproduced a real command printing
`PASS` with both negative-path booleans true while the provider returned only
transport/rate-limit errors for those probes. That result did not establish an
EVM rejection. This finding does not establish what happened during the original
September validation; it means that an old successful rerun alone is insufficient.

## Corrected checks

`src/sepolia-deployment-verifier.js` now checks the recorded post-deployment
checkpoint, selected from the transaction block numbers already in the unchanged
deployment record. It does not compare those historical balances with `latest`
or label them as current balances. The output names the checkpoint number/hash
and uses `checkpointState` instead of the former `currentState` field.

Code, metadata, balances, nonce, allowance and the two negative simulations all
use the same block hash with `requireCanonical: true`. Deployment and validation
receipts must identify the requested transaction and recorded block/hash. The
deployment input must match the artifact plus the recorded constructor argument.
The permit transaction must target the recorded contract, sender, owner, spender
and amount. Every recorded block and the network are checked again before PASS.

A negative probe must return JSON-RPC error code 3 with an exactly decodable ABI
revert payload. Permit replay requires `ERC2612InvalidSigner` with the expected
owner and a different recovered signer. A zero-address transfer requires
`ERC20InvalidReceiver` for the zero address. Generic errors, missing/trailing
data, a different rejection reason, an expired permit at the checkpoint or a
successful simulation all prevent PASS. Unsupported provider error conventions
remain inconclusive failures; text matching or weaker state selectors are not
used as fallbacks.

The two simulations are `eth_call` requests containing historical/test inputs.
They create no signature and submit no transaction. This is a provider-observed
verification, not independent consensus, a security audit or mainnet approval.

## Matching artifacts and changed command behavior

The installed current DAT build does **not** match the creation and normalized
runtime hashes in `deployments/base-sepolia.json`. If that developer artifact is
selected explicitly, the verifier reports `ARTIFACT_RECORD_MISMATCH` before
contacting a provider. The expected hashes are
unchanged. The historical source/tooling commit IDs in that record are not present
in this local repository's object database; that does not establish their remote
availability. A separate compilation using the existing standard-JSON input and
compiler, changing only DATCore.sol from CRLF to LF, reproduces both recorded
bytecode hashes exactly. Its source SHA-256 also matches the original record.

`npm run verify:base-sepolia` no longer compiles implicitly. Verification must not
overwrite an earlier artifact with a newer build and then call it the reference.
The reproduced, recorded-hash-checked artifact is included as
`deployments/reference/DATCore-base-sepolia.json` and used by default. Its bytes
are protected against checkout newline conversion. An alternative artifact must
pass the same checks:

```text
npm run verify:base-sepolia -- --artifact "C:\path\to\matching\DATCore.json"
```

`BASE_SEPOLIA_RPC_URL` keeps its existing meaning. A provider must support the
recorded historical state and canonical block-hash selectors. Every request uses
the shared 12-second body deadline with no automatic retry. Unknown arguments,
missing/malformed/oversized local JSON and transport failures exit unsuccessfully
without printing provider bodies or authenticated endpoint URLs.

The deployment record, Solidity contracts, deployment script, dependencies and
lockfile are unchanged. The CLI output change and removal of implicit compilation
are intentional compatibility changes for reviewers using the old command.

## Public historical recheck

Using the reproduced artifact, the corrected verifier passed against the public
Base Sepolia endpoint on November 2. It verified checkpoint 46,922,886, hash
`0x0c5a5320dd2539b09e36e44944fbb562cfad3b36d85402c29412313f4ba4363b`,
the deployment and five recorded successful receipts, exact checkpoint state,
compiled/runtime code, and both exact ABI rejection reasons. The recorded blocks
and chain were rechecked before reporting PASS. This uses public reads and
`eth_call` only; no signature was created or transaction submitted.

The explorer's deployed bytecode also matches the recorded runtime hash, and its
creation input matches the reproduced artifact plus constructor argument. Its
displayed source text has a different hash and the explorer still reports partial,
not full, source verification. That source-text difference is not silently treated
as an exact source match. The compiler input, record hashes and public RPC result
provide separate evidence for this reproduction.

The ordinary developer build still uses CRLF source bytes in this checkout and
therefore produces different metadata hashes. Fixing source newline portability
across the token builds remains separate work; the pinned reference avoids replacing
the historical verification target with that newer output. This result does not
complete real-wallet acceptance, independent review or a mainnet release decision.

## Reproduce the local regression

The complete read-only run passed 251 TAP entries with zero failures on Node
24.19.0. After selecting the included reference as the default path, all 24
dedicated verifier cases passed again. These overlap earlier cases and are not
new features or a completion percentage. Existing dependencies were reused;
Solidity, deployment records and lockfiles did not change in this correction.

```text
node --test --test-reporter=tap --test-concurrency=1 test/*.test.mjs
```

The dedicated tests use fictional records and bytecode, direct RPC fixtures, and
real child processes with viem HTTP to test-owned loopback servers. They cover a
positive checkpoint, canonical parameters, the false-PASS regression, receipt and
state mismatches, changed blocks/network, strict revert reasons, a path containing
spaces, argument rejection, diagnostic redaction and the real 12-second body
deadline. They do not validate the actual September deployment or its artifact.
