import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
const issues = [];
for (const file of files) {
  const parts = file.split('/');
  const name = parts.at(-1);
  if (parts.some((part, index) => part.startsWith('.env') && !(part === '.env.example' && index === parts.length - 1)) ||
      /(?:^|\/)(?:\.pglite-dev|\.aws|\.ssh|\.next|\.open-next|\.wrangler|\.vercel|node_modules)(?:\/|$)/.test(file) ||
      /\.(?:pem|key|p12|pfx|jks)$/.test(name) || /^(?:id_rsa|id_ed25519)$/.test(name)) {
    issues.push({ file, reason: 'private configuration, credential file or generated artifact is tracked' });
  }
  if (/^(?:apps|packages)\//.test(file) && /\.(?:[cm]?js|tsx?)$/.test(file) && !/\.test\./.test(file)) {
    const source = readFileSync(file, 'utf8');
    if (/(?:NEXT_PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY)\b/.test(source)) {
      issues.push({ file, reason: 'a secret-like environment variable uses a public client prefix' });
    }
  }
}
if (issues.length) {
  console.error(JSON.stringify({ issues }, null, 2));
  process.exitCode = 1;
} else {
  process.stdout.write(`Public-file guard passed: ${files.length} tracked paths checked.\n`);
}
