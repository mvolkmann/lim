import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAST } from './ast';
import { generateRust } from './rust';
import { tokenizer } from './tokenizer';

const rustCompiler = findRustCompiler();

// Compiles and runs a generated program, removing its temporary files afterward.
function compileAndRun(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'lim-rust-'));
  try {
    const input = join(directory, 'main.rs');
    const output = join(directory, 'main');
    writeFileSync(input, source);
    const compilation = spawnSync(rustCompiler!, ['--edition=2021', input, '-o', output], { encoding: 'utf8' });
    if (compilation.error) throw compilation.error;
    expect(compilation.stderr).toBe('');
    expect(compilation.status).toBe(0);
    const execution = spawnSync(output, [], { encoding: 'utf8' });
    if (execution.error) throw execution.error;
    expect(execution.stderr).toBe('');
    expect(execution.status).toBe(0);
    return execution.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Finds rustc on PATH or in an installed rustup toolchain for optional compilation tests.
function findRustCompiler(): string | undefined {
  const compiler = process.env.RUSTC ?? Bun.which('rustc');
  if (compiler && existsSync(compiler)) return compiler;
  const toolchains = join(homedir(), '.rustup', 'toolchains');
  if (!existsSync(toolchains)) return undefined;
  for (const toolchain of readdirSync(toolchains).sort()) {
    const path = join(toolchains, toolchain, 'bin', 'rustc');
    if (existsSync(path)) return path;
  }
  return undefined;
}

// Builds the same AST used by the interpreter from a LIM source string.
async function parseSource(source: string) {
  return buildAST(await tokenizer(new Blob([source]).stream().pipeThrough(new TextDecoderStream())));
}

// Verifies generation is deterministic, leaves the input unchanged, and handles an empty program.
test('generates standalone Rust without mutating the AST', async () => {
  const ast = await parseSource('values:i[] <- [1 2]\nput values.sum');
  const original = structuredClone(ast);
  const rust = generateRust(ast);
  expect(rust).toContain('fn main()');
  expect(rust).toContain('Value::Array(vec![Value::Number(1_f64), Value::Number(2_f64)])');
  expect(rust).toContain('method(lookup(&scope, "values"), "sum")');
  expect(generateRust(ast)).toBe(rust);
  expect(ast).toEqual(original);
  expect(generateRust({ type: 'Program', body: [] })).toContain('fn main()');
});

// Verifies compilation and execution preserve arithmetic, methods, scopes, and array behavior.
test.skipIf(!rustCompiler)('compiles equivalent Rust for LIM programs', async () => {
  const ast = await parseSource([
    'add:i a:i b:i -> a + b',
    'put add add 1 2 3',
    'put 5 / 2 2 ^ 3 ^ 2 2 + 3 * 4',
    'product:f a:f b:f -> a * b',
    'pi:f <- 3.14',
    'put product 2 pi',
    'word:t <- "Hello 😀"',
    'put word.length word.uppercase word.lowercase "MiXeD".uppercase.lowercase',
    'counts:i[] <- [1 2 3]',
    'measurements:f[] <- [1 2.5 3.5]',
    'empty:f[] <- []',
    'put counts.sum measurements.sum empty.sum',
    'names:t[] <- ["Ada" "Grace"]',
    'put names [1 true [] [2 3]]',
    'base:i <- 10',
    'f:i x:i -> x + base',
    'g:i base:i -> f base',
    'put g 2 g 3',
    'base:i <- 20',
    'put f 2',
    'value:i <- 10',
    'local:i -> 0',
    'put local value',
    'sumValues:i values:i[] -> values.sum',
    'put sumValues [4 5]',
    'nothing:i -> 0',
    'put nothing',
    'put true false',
    'put',
    'match:i <- 7',
    'put match',
  ].join('\n'));
  // Block nodes are supported by the AST builder but braces are not yet tokenized from source.
  for (const expression of ast.body) {
    if (expression.type !== 'FunctionDefinition') continue;
    if (expression.signature.name === 'local') {
      expression.body.body = [
        { type: 'Assignment', name: 'value', value: { type: 'NumberLiteral', value: 2 } },
        { type: 'BinaryExpression', operator: '+',
          left: { type: 'Identifier', name: 'value' }, right: { type: 'NumberLiteral', value: 1 } },
      ];
    } else if (expression.signature.name === 'nothing') {
      expression.body.body = [];
    }
  }
  ast.body.push(...buildAST([
    'outer:i', 'x:i', '->', '{', 'inner:i', 'y:i', '->', 'x', '+', 'y', 'inner', '2', '}',
    'put', 'outer', '3',
  ]).body);
  expect(compileAndRun(generateRust(ast))).toBe([
    '6', '2.5 512 14', '6.28', '8 HELLO 😀 hello 😀 mixed', '6 7 0',
    '[ "Ada", "Grace" ] [ 1, true, [], [ 2, 3 ] ]', '12 13', '22', '3 10',
    '9', 'null', 'true false', '', '7', '5', '',
  ].join('\n'));
});

// Verifies Rust string escaping preserves quotes, literal backslashes, Unicode, and control characters.
test.skipIf(!rustCompiler)('compiles escaped text and special numbers', () => {
  const text = '"; panic!("injected"); // \\n\n\t\r\0😀';
  const ast = { type: 'Program' as const, body: [{
    type: 'FunctionCall' as const, name: 'put', arguments: [
      { type: 'TextLiteral' as const, value: text },
      { type: 'NumberLiteral' as const, value: NaN },
      { type: 'NumberLiteral' as const, value: Infinity },
      { type: 'NumberLiteral' as const, value: -Infinity },
    ],
  }] };
  expect(compileAndRun(generateRust(ast))).toBe(`${text} NaN Infinity -Infinity\n`);
});

// Verifies unsupported operations fail during generation instead of silently changing their behavior.
test('rejects unsupported Rust operations', () => {
  expect(() => generateRust({ type: 'Program', body: [{
    type: 'BinaryExpression', operator: '**',
    left: { type: 'NumberLiteral', value: 2 }, right: { type: 'NumberLiteral', value: 3 },
  }] })).toThrow('Unsupported operator');
  expect(() => generateRust({ type: 'Program', body: [{
    type: 'TextLiteral', value: '\ud800',
  }] })).toThrow('unpaired UTF-16 surrogate');
});
