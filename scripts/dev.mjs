// Runs the API and the web app together for local development (works on Windows, macOS, Linux).
//   npm run dev
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['run', 'dev', '--workspace', 'apps/api'], '\x1b[36m'],
  ['web', ['run', 'dev', '--workspace', 'apps/web'], '\x1b[35m'],
].map(([name, args, color]) => {
  const p = spawn('npm', args, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) => out.write(d.toString().replace(/^(?=.)/gm, prefix)));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    procs.forEach((x) => x !== p && x.kill());
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill()));
