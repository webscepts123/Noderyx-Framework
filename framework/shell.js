import { spawn } from "node:child_process";

// npm and npx are .cmd shims on Windows. Spawning them without a shell fails
// with EINVAL on current Node releases, so every package-manager call has to
// come through here rather than reaching for child_process directly.
const WINDOWS_SHIMS = /^(npm|npx|yarn|pnpm)$/;

// cmd.exe reads a double-quoted token literally, so quoting an argument keeps
// its spaces and metacharacters out of the shell's hands.
export function quoteForCmd(value) {
  return `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

// Builds the single command string handed to cmd.exe. Passing one pre-quoted
// string, rather than shell:true plus an args array, avoids Node's DEP0190
// warning. The executable itself stays unquoted unless it has to be quoted:
// wrapping a bare .cmd name makes cmd.exe resolve %~dp0 inside the shim against
// the cwd instead of the shim's own directory, and npm then cannot find
// npm-cli.js.
export function windowsCommand(executable, executableArgs = []) {
  const binary = WINDOWS_SHIMS.test(executable) ? `${executable}.cmd` : executable;
  const head = /\s/.test(binary) ? quoteForCmd(binary) : binary;
  return [head, ...executableArgs.map(quoteForCmd)].join(" ");
}

export function run(executable, executableArgs = [], options = {}) {
  // Only the .cmd shims need cmd.exe. Anything else — node above all, which
  // lives under "C:\Program Files" on a default install — is spawned directly,
  // so no path or argument has to survive a trip through shell quoting.
  const shell = process.platform === "win32" && WINDOWS_SHIMS.test(executable);
  const command = shell ? windowsCommand(executable, executableArgs) : executable;
  const args = shell ? [] : executableArgs;

  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: "inherit", shell, ...options });
    child.on("error", (error) => fail(new Error(`${executable} could not start: ${error.message}`)));
    child.on("exit", (code) => {
      if (code === 0) return done(0);
      fail(new Error(`${executable} ${executableArgs.join(" ")} exited with code ${code}`));
    });
  });
}
