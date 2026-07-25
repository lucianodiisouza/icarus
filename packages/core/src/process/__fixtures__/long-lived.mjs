// Test fixture: a long-lived child process for ProcessManager integration tests.
// Flags:
//   --ready-after-ms=N   print "READY" after N ms (default 0)
//   --fork-child         spawn a grandchild (also long-lived); print its pid as "GRANDCHILD <pid>"
//   --ignore-sigterm     swallow SIGTERM so tests can exercise SIGKILL escalation
import { spawn } from 'node:child_process';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const has = (name) => process.argv.includes(`--${name}`);

if (has('ignore-sigterm')) {
  process.on('SIGTERM', () => {
    console.log('IGNORING SIGTERM');
  });
}

if (has('fork-child')) {
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
    stdio: 'ignore',
  });
  console.log(`GRANDCHILD ${grandchild.pid}`);
}

const readyAfter = Number(arg('ready-after-ms', '0'));
setTimeout(() => console.log('READY'), readyAfter);

// Keep the event loop alive and emit periodic output.
setInterval(() => console.log(`tick ${Date.now()}`), 50);
