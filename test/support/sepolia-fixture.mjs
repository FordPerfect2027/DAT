import { parseAbi, encodeFunctionData, encodeFunctionResult, decodeFunctionData, encodeErrorResult, encodeDeployData, keccak256, RpcRequestError } from "viem";

export const A = "0x" + "11".repeat(20), B = "0x" + "22".repeat(20), C = "0x" + "33".repeat(20);
const ZERO = "0x" + "00".repeat(20), quantity = n => "0x" + BigInt(n).toString(16);
const hash = n => "0x" + BigInt(n).toString(16).padStart(64, "0");
const SUPPLY = 10n ** 27n, UNIT = 10n ** 18n;
export function sepoliaFixture(mode = "success") {
  const abi = parseAbi([
    "constructor(address initialHolder)",
    "function name() view returns (string)", "function symbol() view returns (string)",
    "function decimals() view returns (uint8)", "function INITIAL_SUPPLY_UNITS() view returns (uint256)",
    "function INITIAL_SUPPLY() view returns (uint256)", "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)", "function nonces(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
    "function transfer(address to,uint256 amount) returns (bool)",
    "error ERC2612InvalidSigner(address signer,address owner)",
    "error ERC2612ExpiredSignature(uint256 deadline)",
    "error ERC20InvalidReceiver(address receiver)",
  ]);
  const artifact = { abi, bytecode: "0x60016000", deployedBytecode: "0x60006000", immutableReferences: {} };
  const txNames = ["transfer", "burn", "permit", "transferFrom", "burnFrom"];
  const transactions = Object.fromEntries(txNames.map((name, i) => [name, hash(i + 101)]));
  const transactionBlocks = Object.fromEntries(txNames.map((name, i) => [name, i < 3 ? 11 : 12]));
  const deployment = {
    network: "Base Sepolia", chainId: 84532, contractName: "DATCore", tokenName: "DATCORE", symbol: "DAT", decimals: 18,
    initialSupply: SUPPLY.toString(), contractAddress: C, deployer: A, initialHolder: A, constructorArguments: [A],
    deploymentBlock: 10, deploymentTransaction: hash(100),
    creationBytecodeKeccak256: keccak256(artifact.bytecode), runtimeBytecodeKeccak256: keccak256(artifact.deployedBytecode),
    immutableNormalizedRuntimeBytecodeKeccak256: keccak256(artifact.deployedBytecode),
    postDeploymentValidation: { recipient: B, transactions, transactionBlocks, amounts: { permit: (2n * UNIT).toString() },
      finalState: { totalSupply: (SUPPLY - 2n * UNIT).toString(), deployerBalance: (SUPPLY - 4n * UNIT).toString(), recipientBalance: (2n * UNIT).toString(), deployerPermitNonce: "1", remainingSelfAllowance: "0" } },
  };
  const permitArgs = [A, A, 2n * UNIT, mode === "expired-permit" ? 1000n : 2000n, 27, hash(44), hash(55)];
  const permitInput = encodeFunctionData({ abi, functionName: "permit", args: permitArgs });
  const calls = [], headers = new Map(); let chains = 0;
  function header(n) {
    headers.set(n, (headers.get(n) ?? 0) + 1);
    return { number: quantity(n), hash: mode === "reorg" && headers.get(n) > 1 ? hash(999) : hash(n), timestamp: quantity(1000 + n), transactions: [] };
  }
  function transaction(id) {
    const name = txNames.find(name => transactions[name] === id), block = name ? transactionBlocks[name] : 10;
    return { hash: id, blockHash: hash(block), blockNumber: quantity(block), transactionIndex: "0x0", from: A,
      to: name ? C : null, input: name === "permit" ? permitInput : name ? "0x" : encodeDeployData({ abi, bytecode: artifact.bytecode, args: [A] }),
      nonce: "0x0", value: "0x0", gas: "0x100000", gasPrice: "0x1", chainId: "0x14a34", type: "0x0", r: hash(1), s: hash(2), v: "0x1b" };
  }
  function reply(query) {
    calls.push(query);
    const { method, params = [] } = query;
    const fault = (code = -32005, data) => ({ error: { code, message: "test-only-secret-provider-detail", ...(data === undefined ? {} : { data }) } });
    if (mode === "early-rpc-error") return fault();
    if (method === "eth_chainId") return { result: ++chains > 1 && mode === "chain-change" ? "0x2105" : "0x14a34" };
    if (method === "eth_getBlockByNumber") return { result: header(params[0] === "latest" ? 12 : Number(BigInt(params[0]))) };
    if (method === "eth_getTransactionByHash") {
      const value = transaction(params[0]);
      if (mode === "wrong-permit-target" && params[0] === transactions.permit) value.to = B;
      return { result: value };
    }
    if (method === "eth_getTransactionReceipt") {
      const value = transaction(params[0]);
      return { result: { transactionHash: mode === "wrong-receipt-hash" ? hash(998) : value.hash, blockHash: mode === "wrong-receipt-block" ? hash(997) : value.blockHash,
        blockNumber: value.blockNumber, transactionIndex: "0x0", from: value.from, to: value.to, status: "0x1", contractAddress: value.to === null ? C : null,
        cumulativeGasUsed: "0x100", gasUsed: "0x100", effectiveGasPrice: "0x1", logs: [], logsBloom: "0x" + "00".repeat(256), type: "0x0" } };
    }
    if (method === "eth_getCode") return mode === "unsupported-hash" && typeof params[1] === "object" ? fault(-32602) : { result: artifact.deployedBytecode };
    if (method === "eth_call") {
      const { functionName, args = [] } = decodeFunctionData({ abi, data: params[0].data });
      if (functionName === "permit" || functionName === "transfer") {
        if (mode === "rpc-error-negative" || mode === functionName + "-rpc-error") return fault();
        if (mode === "empty-revert") return fault(3);
        if (mode === "negative-success") return { result: "0x" };
        const errorName = mode === "wrong-revert" ? "ERC2612ExpiredSignature" : functionName === "permit" ? "ERC2612InvalidSigner" : "ERC20InvalidReceiver";
        const errorArgs = errorName === "ERC2612ExpiredSignature" ? [2000n] : errorName === "ERC2612InvalidSigner" ? [B, A] : [ZERO];
        let data = encodeErrorResult({ abi, errorName, args: errorArgs });
        if (mode === "trailing-revert") data += "00";
        return fault(3, data);
      }
      const state = deployment.postDeploymentValidation.finalState;
      const values = { name: "DATCORE", symbol: "DAT", decimals: 18, INITIAL_SUPPLY_UNITS: 1000000000n, INITIAL_SUPPLY: SUPPLY,
        totalSupply: BigInt(state.totalSupply), balanceOf: BigInt(args[0]?.toLowerCase() === A ? state.deployerBalance : state.recipientBalance), nonces: 1n, allowance: 0n };
      if (mode === "wrong-state" && functionName === "totalSupply") values.totalSupply++;
      return { result: encodeFunctionResult({ abi, functionName, result: values[functionName] }) };
    }
    throw Error("Unexpected fixture method: " + method);
  }
  const client = { async request(query) { const response = reply(query); if (response.error) throw new RpcRequestError({ body: query, error: response.error, url: "https://fixture.invalid" }); return response.result; } };
  return { artifact, deployment, calls, reply, client };
}
