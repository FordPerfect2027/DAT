import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { createReadOnlyHttp } from "../src/read-only-http.js";
import { SepoliaVerificationError, verifySepoliaDeployment } from "../src/sepolia-deployment-verifier.js";

function load(path, maximum) {
  if (statSync(path).size > maximum) throw Error("LOCAL_INPUT_ERROR");
  const bytes = readFileSync(path);
  if (bytes.length > maximum) throw Error("LOCAL_INPUT_ERROR");
  return JSON.parse(bytes.toString("utf8"));
}
let deployment, artifact;
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--artifact" || !args[1])) {
  process.stderr.write("Usage: node scripts/verify-base-sepolia.js [--artifact COMPILED_ARTIFACT_JSON]\n");
  process.exit(2);
}
try {
  deployment = load(new URL("../deployments/base-sepolia.json", import.meta.url), 64 * 1024);
  const artifactPath = args.length ? resolve(args[1]) : new URL("../deployments/reference/DATCore-base-sepolia.json", import.meta.url);
  artifact = load(artifactPath, 2 * 1024 * 1024);
} catch {
  process.stderr.write("Read-only Sepolia verification failed: LOCAL_INPUT_ERROR\n");
  process.exit(2);
}
try {
  const client = createPublicClient({ chain: baseSepolia,
    transport: createReadOnlyHttp(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org") });
  const report = await verifySepoliaDeployment(client, deployment, artifact);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  const code = error instanceof SepoliaVerificationError ? error.code : "RPC_ERROR";
  process.stderr.write("Read-only Sepolia verification failed: " + code + "\n");
  process.exitCode = 1;
}
