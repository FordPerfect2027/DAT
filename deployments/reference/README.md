# DAT recorded Sepolia reference

`DATCore-base-sepolia.json` contains the ABI, creation bytecode, runtime template
and immutable references reproduced with solc 0.8.34+commit.80d5c536 and the locked
OpenZeppelin Contracts 5.6.1 sources. Both are MIT-licensed components; the project
license is in the repository root and the upstream contract license is at
https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/LICENSE.

The existing Hardhat standard-JSON build input was copied to an isolated compile.
Only `project/contracts/DATCore.sol` line endings changed from CRLF to LF. All
dependency source text, compiler options, remappings and the compiler were retained.
No project source or prior generated artifact was overwritten by that reproduction.

This reproduces the unchanged deployment record exactly:

- Source SHA-256: `685a1ae60d561c5a5edeee2ff6cc6c2500c88bd54e110f3e295cc5d025de19e6`
- Creation Keccak-256: `0x360eb0d90955f2a5d059d400229520cbc24a72c8d461fd8725b12309b99b3294`
- Normalized runtime Keccak-256: `0x6567224d1e46c8e80d345970cf59ed9dcd8949ff00cb873884e9a0decf377e64`

The verifier checks these hashes before RPC and compares deployed code and
constructor input at the recorded chain checkpoint. Its explicit `--artifact`
option applies the same checks to another file. Including this reference makes
the read-only check independent of a fresh contract compilation and does not
turn it into a security audit or proof of current balances.

[The verifier correction and public recheck](../../docs/SEPOLIA_VERIFIER_2026-11-02.md)
describe the evidence. The later [source portability correction](../../docs/SOURCE_PORTABILITY_2026-11-02.md)
also reproduces this reference through the ordinary build. The combined
Wallet evidence collection retains the exact compiler-input hash, reconstruction
method, diagnostics, failed baseline, passing regressions and public RPC receipt.
