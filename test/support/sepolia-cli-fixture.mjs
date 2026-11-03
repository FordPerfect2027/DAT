import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, rmSync, lstatSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { sepoliaFixture } from "./sepolia-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)), testRoot = join(root, "test");
export async function runSepoliaCli(mode = "success", sourceOverride, options = {}) {
  const fixture = sepoliaFixture(mode), temporary = mkdtempSync(join(testRoot, ".sepolia-cli-"));
  let child, watchdog, bodyStarted;
  const server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    const query = JSON.parse(body), reply = fixture.reply(query);
    response.writeHead(200, { "content-type": "application/json" });
    if (mode === "stalled-body") {
      response.write('{"result":"test-only-secret'); bodyStarted = performance.now();
      watchdog = setTimeout(() => child.kill(), 15000); return;
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: query.id, ...reply }));
  });
  try {
    for (const folder of ["scripts", "src", "deployments/reference"]) mkdirSync(join(temporary, folder), { recursive: true });
    writeFileSync(join(temporary, "package.json"), '{"type":"module"}\n');
    for (const name of readdirSync(join(root, "src")).filter(name => name.endsWith(".js"))) copyFileSync(join(root, "src", name), join(temporary, "src", name));
    writeFileSync(join(temporary, "scripts/verify-base-sepolia.js"), sourceOverride ?? readFileSync(join(root, "scripts/verify-base-sepolia.js")));
    writeFileSync(join(temporary, "deployments/base-sepolia.json"), JSON.stringify(fixture.deployment));
    const artifactPath = join(temporary, options.useArtifactArgument ? "reference artifact.json" : "deployments/reference/DATCore-base-sepolia.json");
    writeFileSync(artifactPath, JSON.stringify(fixture.artifact));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, BASE_SEPOLIA_RPC_URL: "http://127.0.0.1:" + server.address().port + "/?apiKey=test-only-secret-url" };
    const args = options.useArtifactArgument ? ["--artifact", artifactPath] : options.args ?? [];
    const result = await new Promise((resolve, reject) => { child = execFile(process.execPath, [join(temporary, "scripts/verify-base-sepolia.js"), ...args],
      { env, windowsHide: true, timeout: 45000, maxBuffer: 65536 }, (error, stdout, stderr) => {
        if (error && (error.killed || typeof error.code !== "number")) reject(error);
        else resolve({ code: error?.code ?? 0, stdout, stderr, calls: fixture.calls, bodyElapsedMs: bodyStarted === undefined ? null : performance.now() - bodyStarted });
      }); });
    return result;
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    // Only remove the directory this invocation created beneath this test folder.
    if (dirname(resolve(temporary)) !== resolve(testRoot) || !basename(temporary).startsWith(".sepolia-cli-") || lstatSync(temporary).isSymbolicLink()) throw Error("Unexpected fixture cleanup path");
    rmSync(temporary, { recursive: true, force: true });
  }
}
