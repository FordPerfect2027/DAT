import { decodeFunctionData, decodeFunctionResult, decodeErrorResult, encodeFunctionData, encodeErrorResult, encodeDeployData, keccak256, RpcRequestError } from "viem";

const ZERO = "0x" + "00".repeat(20);
const TX_NAMES = ["transfer", "burn", "permit", "transferFrom", "burnFrom"];
const HEX = /^0x(?:[0-9a-f]{2})*$/i, HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
export class SepoliaVerificationError extends Error {
  constructor(code) { super(code); this.name = "SepoliaVerificationError"; this.code = code; }
}
const fail = code => { throw new SepoliaVerificationError(code); };
const check = (condition, code) => { if (!condition) fail(code); };
const equal = (a, b, code) => check(a === b, code);
function address(value, allowZero = false) {
  check(typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value), "INVALID_RECORD");
  check(allowZero || value.toLowerCase() !== ZERO, "INVALID_RECORD"); return value.toLowerCase();
}
function hash(value) { check(typeof value === "string" && HASH.test(value), "INVALID_RPC_RESULT"); return value.toLowerCase(); }
function quantity(value) { check(typeof value === "string" && QUANTITY.test(value), "INVALID_RPC_RESULT"); return BigInt(value); }
function decimal(value) {
  check(typeof value === "string" && /^(?:0|[1-9][0-9]{0,77})$/.test(value), "INVALID_RECORD");
  const number = BigInt(value); check(number < (1n << 256n), "INVALID_RECORD"); return number;
}
function blockNumber(value) { check(Number.isSafeInteger(value) && value >= 0, "INVALID_RECORD"); return value; }
function bytes(value, maximum, code) { check(typeof value === "string" && value.length <= 2 + maximum * 2 && HEX.test(value), code); return value.toLowerCase(); }
function normalize(code, ranges) {
  const value = code.slice(2).toLowerCase().split("");
  for (const { start, length } of ranges) { check(start + length <= value.length / 2, "INVALID_ARTIFACT"); value.fill("0", start * 2, (start + length) * 2); }
  return "0x" + value.join("");
}
function prepare(deployment, artifact) {
  check(deployment?.chainId === 84532 && deployment.contractName === "DATCore", "INVALID_RECORD");
  const contract = address(deployment.contractAddress), deployer = address(deployment.deployer), holder = address(deployment.initialHolder);
  const validation = deployment.postDeploymentValidation, recipient = address(validation?.recipient);
  check(Array.isArray(deployment.constructorArguments) && deployment.constructorArguments.length === 1 && address(deployment.constructorArguments[0]) === holder, "INVALID_RECORD");
  check(validation?.transactions && validation?.transactionBlocks && validation?.finalState, "INVALID_RECORD");
  check(Object.keys(validation.transactions).length === TX_NAMES.length && Object.keys(validation.transactionBlocks).length === TX_NAMES.length, "INVALID_RECORD");
  const deploymentBlock = blockNumber(deployment.deploymentBlock), blocks = new Set([deploymentBlock]);
  const transactionHashes = [hash(deployment.deploymentTransaction)];
  for (const name of TX_NAMES) {
    transactionHashes.push(hash(validation.transactions[name]));
    const number = blockNumber(validation.transactionBlocks[name]); check(number >= deploymentBlock, "INVALID_RECORD"); blocks.add(number);
  }
  check(new Set(transactionHashes).size === transactionHashes.length, "INVALID_RECORD");
  check(deployment.tokenName === "DATCORE" && deployment.symbol === "DAT" && deployment.decimals === 18, "INVALID_RECORD");
  equal(decimal(deployment.initialSupply), 10n ** 27n, "INVALID_RECORD");
  for (const name of ["totalSupply", "deployerBalance", "recipientBalance", "deployerPermitNonce", "remainingSelfAllowance"]) decimal(validation.finalState[name]);
  decimal(validation.amounts?.permit);
  check(Array.isArray(artifact?.abi) && artifact.abi.length > 0 && artifact.abi.length <= 256, "INVALID_ARTIFACT");
  const creation = bytes(artifact.bytecode, 256 * 1024, "INVALID_ARTIFACT"), runtime = bytes(artifact.deployedBytecode, 256 * 1024, "INVALID_ARTIFACT");
  check(creation !== "0x" && runtime !== "0x", "INVALID_ARTIFACT");
  const references = artifact.immutableReferences;
  check(references && typeof references === "object" && !Array.isArray(references), "INVALID_ARTIFACT");
  const ranges = Object.values(references).flat(); check(ranges.length <= 64, "INVALID_ARTIFACT");
  const occupied = new Set();
  for (const entry of ranges) {
    check(entry && Number.isSafeInteger(entry.start) && entry.start >= 0 && entry.length === 32 && entry.start + 32 <= (runtime.length - 2) / 2, "INVALID_ARTIFACT");
    for (let n = entry.start; n < entry.start + 32; n++) { check(!occupied.has(n), "INVALID_ARTIFACT"); occupied.add(n); }
  }
  // A new compiler/dependency build must never silently replace the old expected hash.
  equal(keccak256(creation), hash(deployment.creationBytecodeKeccak256), "ARTIFACT_RECORD_MISMATCH");
  equal(keccak256(normalize(runtime, ranges)), hash(deployment.immutableNormalizedRuntimeBytecodeKeccak256), "ARTIFACT_RECORD_MISMATCH");
  hash(deployment.runtimeBytecodeKeccak256);
  return { contract, deployer, holder, recipient, validation, ranges, blocks: [...blocks].sort((a, b) => a - b), checkpoint: Math.max(...blocks) };
}

/** Recheck the recorded post-deployment checkpoint, not today's mutable balances.
 * The two negative probes are eth_call simulations of already recorded inputs.
 * No signer, private key, wallet connection or transaction submission is used.
 */
export async function verifySepoliaDeployment(client, deployment, artifact) {
  const p = prepare(deployment, artifact), abi = artifact.abi;
  check(client && typeof client.request === "function", "INVALID_CLIENT");
  const request = client.request.bind(client);
  equal(quantity(await request({ method: "eth_chainId" })), 84532n, "WRONG_NETWORK");
  const headers = new Map();
  async function getHeader(number) {
    const value = await request({ method: "eth_getBlockByNumber", params: ["0x" + number.toString(16), false] });
    check(value && quantity(value.number) === BigInt(number), "INVALID_BLOCK");
    return { number, hash: hash(value.hash), timestamp: quantity(value.timestamp) };
  }
  for (const number of p.blocks) headers.set(number, await getHeader(number));
  const checkpoint = headers.get(p.checkpoint), context = { blockHash: checkpoint.hash, requireCanonical: true };
  const runtime = bytes(await request({ method: "eth_getCode", params: [p.contract, context] }), 256 * 1024, "INVALID_RUNTIME_CODE");
  equal(keccak256(runtime), deployment.runtimeBytecodeKeccak256.toLowerCase(), "RUNTIME_RECORD_MISMATCH");
  equal(normalize(runtime, p.ranges), normalize(artifact.deployedBytecode, p.ranges), "RUNTIME_ARTIFACT_MISMATCH");

  function validateLocation(value, expectedHash, number, receipt) {
    check(value && hash(receipt ? value.transactionHash : value.hash) === expectedHash.toLowerCase(), "TRANSACTION_IDENTITY_MISMATCH");
    equal(quantity(value.blockNumber), BigInt(number), "TRANSACTION_BLOCK_MISMATCH");
    equal(hash(value.blockHash), headers.get(number).hash, "TRANSACTION_BLOCK_MISMATCH");
  }
  const deploymentTransaction = await request({ method: "eth_getTransactionByHash", params: [deployment.deploymentTransaction] });
  validateLocation(deploymentTransaction, deployment.deploymentTransaction, deployment.deploymentBlock, false);
  equal(address(deploymentTransaction.from), p.deployer, "DEPLOYMENT_SENDER_MISMATCH");
  equal(deploymentTransaction.to, null, "DEPLOYMENT_TARGET_MISMATCH");
  equal(bytes(deploymentTransaction.input, 512 * 1024, "INVALID_TRANSACTION_INPUT"), encodeDeployData({ abi, bytecode: artifact.bytecode, args: [p.holder] }).toLowerCase(), "DEPLOYMENT_INPUT_MISMATCH");
  const deploymentReceipt = await request({ method: "eth_getTransactionReceipt", params: [deployment.deploymentTransaction] });
  validateLocation(deploymentReceipt, deployment.deploymentTransaction, deployment.deploymentBlock, true);
  equal(deploymentReceipt.status, "0x1", "TRANSACTION_FAILED");
  equal(address(deploymentReceipt.contractAddress), p.contract, "DEPLOYMENT_TARGET_MISMATCH");
  equal(address(deploymentReceipt.from), p.deployer, "DEPLOYMENT_SENDER_MISMATCH");
  equal(deploymentReceipt.to, null, "DEPLOYMENT_TARGET_MISMATCH");

  async function read(functionName, args = []) {
    check(abi.some(item => item.type === "function" && item.name === functionName && ["view", "pure"].includes(item.stateMutability)), "INVALID_READ_ABI");
    const data = await request({ method: "eth_call", params: [{ to: p.contract, data: encodeFunctionData({ abi, functionName, args }) }, context] });
    bytes(data, 4096, "INVALID_STATE_RESPONSE");
    try { return decodeFunctionResult({ abi, functionName, data }); } catch { fail("INVALID_STATE_RESPONSE"); }
  }
  const name = await read("name"), symbol = await read("symbol"), decimals = await read("decimals");
  equal(name, deployment.tokenName, "METADATA_MISMATCH"); equal(symbol, deployment.symbol, "METADATA_MISMATCH"); equal(decimals, 18, "METADATA_MISMATCH");
  equal(await read("INITIAL_SUPPLY_UNITS"), 1000000000n, "SUPPLY_MISMATCH"); equal(await read("INITIAL_SUPPLY"), decimal(deployment.initialSupply), "SUPPLY_MISMATCH");
  const state = { totalSupply: await read("totalSupply"), deployerBalance: await read("balanceOf", [p.deployer]), recipientBalance: await read("balanceOf", [p.recipient]),
    deployerPermitNonce: await read("nonces", [p.deployer]), remainingSelfAllowance: await read("allowance", [p.deployer, p.deployer]) };
  for (const [key, value] of Object.entries(state)) equal(value, decimal(p.validation.finalState[key]), "CHECKPOINT_STATE_MISMATCH");
  check(state.deployerPermitNonce > 0n, "PERMIT_NONCE_NOT_CONSUMED");

  const validationTransactions = {};
  for (const name of TX_NAMES) {
    const txHash = p.validation.transactions[name], number = p.validation.transactionBlocks[name];
    const receipt = await request({ method: "eth_getTransactionReceipt", params: [txHash] });
    validateLocation(receipt, txHash, number, true); equal(receipt.status, "0x1", "TRANSACTION_FAILED");
    equal(address(receipt.to), p.contract, "VALIDATION_TARGET_MISMATCH");
    validationTransactions[name] = { hash: txHash, blockNumber: String(number), blockHash: headers.get(number).hash, status: "success" };
  }
  const permitTransaction = await request({ method: "eth_getTransactionByHash", params: [p.validation.transactions.permit] });
  validateLocation(permitTransaction, p.validation.transactions.permit, p.validation.transactionBlocks.permit, false);
  equal(address(permitTransaction.to), p.contract, "PERMIT_TARGET_MISMATCH"); equal(address(permitTransaction.from), p.deployer, "PERMIT_SENDER_MISMATCH");
  const permitInput = bytes(permitTransaction.input, 4096, "INVALID_PERMIT_INPUT");
  let permit;
  try { permit = decodeFunctionData({ abi, data: permitInput }); } catch { fail("INVALID_PERMIT_INPUT"); }
  equal(permit.functionName, "permit", "INVALID_PERMIT_INPUT");
  check(permit.args?.length === 7, "INVALID_PERMIT_INPUT");
  equal(address(permit.args[0]), p.deployer, "INVALID_PERMIT_INPUT"); equal(address(permit.args[1]), p.deployer, "INVALID_PERMIT_INPUT");
  equal(permit.args[2], decimal(p.validation.amounts.permit), "INVALID_PERMIT_INPUT");
  check(permit.args[3] >= checkpoint.timestamp, "PERMIT_EXPIRED_AT_CHECKPOINT");
  equal(encodeFunctionData({ abi, functionName: "permit", args: permit.args }).toLowerCase(), permitInput, "INVALID_PERMIT_INPUT");

  async function requireRevert(functionName, data, expectedName, matchesArgs) {
    let failure;
    try { await request({ method: "eth_call", params: [{ to: p.contract, from: p.deployer, data }, context] }); }
    catch (error) { failure = error; }
    check(failure, "NEGATIVE_PROBE_SUCCEEDED");
    // Match the structured RPC revert and its ABI payload, never provider prose.
    let rpc = failure;
    for (let depth = 0; depth < 8 && !(rpc instanceof RpcRequestError); depth++) rpc = rpc?.cause;
    check(rpc instanceof RpcRequestError && rpc.code === 3, "NEGATIVE_PROBE_RPC_ERROR");
    const revert = bytes(rpc.data, 4096, "INVALID_REVERT_DATA");
    let decoded;
    try { decoded = decodeErrorResult({ abi, data: revert }); } catch { fail("INVALID_REVERT_DATA"); }
    equal(decoded.errorName, expectedName, "UNEXPECTED_REVERT");
    check(matchesArgs(decoded.args), "UNEXPECTED_REVERT_ARGUMENTS");
    equal(encodeErrorResult({ abi, errorName: decoded.errorName, args: decoded.args }).toLowerCase(), revert, "INVALID_REVERT_DATA");
    return { functionName, errorName: decoded.errorName, confirmedAtBlockHash: checkpoint.hash };
  }
  const permitReplay = await requireRevert("permit", permitInput, "ERC2612InvalidSigner", args => args?.length === 2 && address(args[1]) === p.deployer && address(args[0], true) !== p.deployer);
  const zeroTransfer = await requireRevert("transfer", encodeFunctionData({ abi, functionName: "transfer", args: [ZERO, 1n] }), "ERC20InvalidReceiver", args => args?.length === 1 && address(args[0], true) === ZERO);
  for (const number of p.blocks) {
    const after = await getHeader(number), before = headers.get(number);
    check(after.hash === before.hash && after.timestamp === before.timestamp, "BLOCK_CHANGED");
  }
  equal(quantity(await request({ method: "eth_chainId" })), 84532n, "NETWORK_CHANGED");
  return {
    result: "PASS", network: "Base Sepolia", chainId: 84532, contractAddress: p.contract,
    deploymentTransaction: deployment.deploymentTransaction, metadata: { name, symbol, decimals },
    observationScope: "recorded-post-deployment-checkpoint", checkpointBlockNumber: String(p.checkpoint), checkpointBlockHash: checkpoint.hash,
    canonicalBlockRequired: true, recordedBlocksRechecked: true, chainRechecked: true,
    immutableNormalizedRuntimeBytecodeMatchesArtifact: true, checkpointState: Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.toString()])),
    validationTransactions, negativePaths: { permitReplay, zeroTransfer }, readOnly: true, transactionSent: false, signatureCreated: false, securityAudit: false,
  };
}
