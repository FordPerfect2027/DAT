import test from "node:test";
import assert from "node:assert/strict";
import { runSepoliaCli } from "./support/sepolia-cli-fixture.mjs";

test("Sepolia CLI does not turn negative-probe transport errors into PASS", async () => {
  const result = await runSepoliaCli("rpc-error-negative");
  assert.equal(result.code, 1, "Transport failures were counted as successful rejection probes");
  assert.equal(result.stdout, "");
  assert(!result.stderr.includes("test-only-secret"));
});

test("Sepolia CLI emits the exact checkpoint through real viem HTTP", async () => {
  const result = await runSepoliaCli();
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, "PASS"); assert.equal(report.checkpointBlockNumber, "12");
  assert.equal(report.observationScope, "recorded-post-deployment-checkpoint");
  for (const call of result.calls.filter(c => ["eth_call", "eth_getCode"].includes(c.method))) assert.deepEqual(call.params[1], { blockHash: report.checkpointBlockHash, requireCanonical: true });
});

test("Sepolia CLI redacts endpoint and provider details on early RPC failure", async () => {
  const result = await runSepoliaCli("early-rpc-error");
  assert.equal(result.code, 1); assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Read-only Sepolia verification failed: RPC_ERROR\n");
  assert.equal(result.calls.length, 1);
});

test("Sepolia CLI supports an explicit matching artifact with a space in its path", async () => {
  const result = await runSepoliaCli("success", undefined, { useArtifactArgument: true });
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).result, "PASS");
});

test("Sepolia CLI refuses unknown arguments before RPC", async () => {
  const result = await runSepoliaCli("success", undefined, { args: ["--unknown", "test-only-secret"] });
  assert.equal(result.code, 2); assert.equal(result.stdout, ""); assert.equal(result.calls.length, 0);
  assert(!result.stderr.includes("test-only-secret"));
});

test("Sepolia CLI enforces the real deadline after response headers", async t => {
  const result = await runSepoliaCli("stalled-body");
  assert.equal(result.code, 1); assert.equal(result.stdout, ""); assert.equal(result.calls.length, 1);
  assert.equal(result.stderr, "Read-only Sepolia verification failed: RPC_ERROR\n");
  assert(result.bodyElapsedMs < 15000);
  t.diagnostic("Body observed to process exit: " + Math.round(result.bodyElapsedMs) + " ms");
});
