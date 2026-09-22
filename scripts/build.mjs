// Builds src/ → dist/ by converting each TypeScript file on its own (no type checking), which needs
// ~80 MB instead of the ~400 MB a full `tsc` needs — small enough for a 512 MB server.
// Type checking still happens before every release on the PC: `npm run check` (tsc --noEmit).
//   node scripts/build.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

const SRC = 'src';
const OUT = 'dist';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.d.ts') ? [p] : [];
  });
}

const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  esModuleInterop: true,
  isolatedModules: true,
  sourceMap: true,
};

rmSync(OUT, { recursive: true, force: true });
let count = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\.ts$/, '.js');
  const target = join(OUT, rel);
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: options,
    fileName: file,
    reportDiagnostics: true,
  });
  const errors = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    for (const d of errors) console.error(`${file}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    process.exit(1);
  }
  mkdirSync(dirname(target), { recursive: true });
  const name = rel.split(/[\\/]/).pop();
  writeFileSync(target, out.outputText.replace(/\/\/# sourceMappingURL=.*$/m, `//# sourceMappingURL=${name}.map`));
  if (out.sourceMapText) writeFileSync(`${target}.map`, out.sourceMapText);
  count++;
}
console.log(`Built ${count} files into ${OUT}/`);
