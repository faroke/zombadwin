// Tiny stand-in for the PZ dedicated server for smoke-testing the lifecycle.
// Prints a banner, echoes commands from stdin, exits cleanly on "quit".
import readline from 'node:readline';

process.stdout.write('Project Zomboid (fake) starting...\n');
setTimeout(() => {
  process.stdout.write('Server is listening on port 16261\n');
}, 200);

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const cmd = line.trim();
  if (cmd === 'quit' || cmd === 'exit') {
    process.stdout.write('Saving world...\n');
    setTimeout(() => {
      process.stdout.write('Server stopped.\n');
      process.exit(0);
    }, 100);
    return;
  }
  process.stdout.write(`[fake-pz] received: ${cmd}\n`);
});

// Heartbeat so we keep emitting some output.
setInterval(() => process.stdout.write(`[fake-pz] tick ${new Date().toISOString()}\n`), 2000);
