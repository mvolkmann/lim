import { buildAST } from './ast';
import { executeAST } from './execute';
import { tokenizer } from './tokenizer';

// Reads the input file specified on the command line.
async function main(): Promise<void> {
  const filePath = Bun.argv[2];
  if (!filePath) {
    console.error('Usage: bun run lim.ts <file-path>');
    process.exitCode = 1;
    return;
  }

  try {
    const stream = Bun.file(filePath).stream().pipeThrough(new TextDecoderStream());
    const tokens = await tokenizer(stream);
    const ast = buildAST(tokens);
    console.log('lim.ts: AST =', JSON.stringify(ast, null, 2));
    executeAST(ast);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
