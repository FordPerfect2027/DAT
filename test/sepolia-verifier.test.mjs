import test from "node:test";
import assert from "node:assert/strict";
import { verifySepoliaDeployment, SepoliaVerificationError } from "../src/sepolia-deployment-verifier.js";
import { sepoliaFixture } from "./support/sepolia-fixture.mjs";

test("recorded checkpoint binds state reads and negative simulations to one canonical hash", async () => {
  const f = sepoliaFixture(), report = await verifySepoliaDeployment(f.client, f.deployment, f.artifact);
  assert.equal(report.result, "PASS"); assert.equal(report.checkpointBlockNumber, "12");
  assert.equal(report.observationScope, "recorded-post-deployment-checkpoint");
  assert.equal(report.transactionSent, false); assert.equal(report.signatureCreated, false); assert.equal(report.currentState, undefined);
  assert.equal(report.negativePaths.permitReplay.errorName, "ERC2612InvalidSigner");
  assert.equal(report.negativePaths.zeroTransfer.errorName, "ERC20InvalidReceiver");
  assert(f.calls.every(c => ["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_call"].includes(c.method)));
  const reads = f.calls.filter(c => ["eth_call", "eth_getCode"].includes(c.method));
  assert.equal(reads.length, 13);
  for (const call of reads) assert.deepEqual(call.params[1], { blockHash: report.checkpointBlockHash, requireCanonical: true });
  assert.equal(f.calls.filter(c => c.method === "eth_getBlockByNumber").length, 6);
  assert.equal(f.calls.filter(c => c.method === "eth_chainId").length, 2);
});

for (const [mode, code] of [
  ["rpc-error-negative", "NEGATIVE_PROBE_RPC_ERROR"], ["permit-rpc-error", "NEGATIVE_PROBE_RPC_ERROR"], ["transfer-rpc-error", "NEGATIVE_PROBE_RPC_ERROR"],
  ["empty-revert", "INVALID_REVERT_DATA"], ["wrong-revert", "UNEXPECTED_REVERT"], ["trailing-revert", "INVALID_REVERT_DATA"], ["negative-success", "NEGATIVE_PROBE_SUCCEEDED"],
  ["expired-permit", "PERMIT_EXPIRED_AT_CHECKPOINT"], ["wrong-permit-target", "PERMIT_TARGET_MISMATCH"],
  ["wrong-receipt-hash", "TRANSACTION_IDENTITY_MISMATCH"], ["wrong-receipt-block", "TRANSACTION_BLOCK_MISMATCH"],
  ["reorg", "BLOCK_CHANGED"], ["chain-change", "NETWORK_CHANGED"], ["wrong-state", "CHECKPOINT_STATE_MISMATCH"],
]) {
  test("Sepolia record refuses " + mode, async () => {
    const f = sepoliaFixture(mode);
    await assert.rejects(verifySepoliaDeployment(f.client, f.deployment, f.artifact), error => error instanceof SepoliaVerificationError && error.code === code);
  });
}

test("unsupported canonical state has no latest or number fallback", async () => {
  const f = sepoliaFixture("unsupported-hash");
  await assert.rejects(verifySepoliaDeployment(f.client, f.deployment, f.artifact));
  const code = f.calls.filter(c => c.method === "eth_getCode"); assert.equal(code.length, 1); assert.equal(code[0].params[1].requireCanonical, true);
  assert(!f.calls.some(c => c.params?.includes("latest")));
});

test("different compiled bytecode fails before network rather than changing recorded hashes", async () => {
  const f = sepoliaFixture(); f.artifact.bytecode = "0x60026000";
  await assert.rejects(verifySepoliaDeployment(f.client, f.deployment, f.artifact), error => error.code === "ARTIFACT_RECORD_MISMATCH");
  assert.equal(f.calls.length, 0);
});

test("malformed record and invalid immutable ranges fail before network", async () => {
  for (const change of [f => { f.deployment.postDeploymentValidation.transactionBlocks.permit = -1; },
    f => { f.deployment.postDeploymentValidation.transactions.permit = f.deployment.deploymentTransaction; },
    f => { f.deployment.postDeploymentValidation.finalState.totalSupply = "9".repeat(79); },
    f => { f.artifact.immutableReferences = { x: [{ start: 0, length: 32 }] }; }]) {
    const f = sepoliaFixture(); change(f);
    await assert.rejects(verifySepoliaDeployment(f.client, f.deployment, f.artifact), error => ["INVALID_RECORD", "INVALID_ARTIFACT"].includes(error.code));
    assert.equal(f.calls.length, 0);
  }
});
