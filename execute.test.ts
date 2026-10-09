import { expect, spyOn, test } from 'bun:test';
import { buildAST } from './ast';
import { executeAST } from './execute';
import { tokenizer } from './tokenizer';

// Verifies arithmetic failures report the complete expression in the function body.
test('includes the invalid expression in arithmetic errors', () => {
  expect(() => executeAST(buildAST([
    'add:i', 'n1:i', 'n2:i', '->', 'n1', '+', 'n2',
    'score:t', '<-', '"foo"', 'add', '2', 'score',
  ]))).toThrow('Invalid expression: n1 + n2\nOperator "+" requires numeric operands');
  expect(() => executeAST(buildAST([
    'add:i', 'n1:i', 'n2:i', '->', 'n1', '+', 'n2', '*', '3',
    'add', '"foo"', '2',
  ]))).toThrow('Invalid expression: n1 + (n2 * 3)');
  expect(() => executeAST({
    type: 'Program',
    body: [{
      type: 'BinaryExpression', operator: '+',
      left: { type: 'TextLiteral', value: 'foo' },
      right: { type: 'NumberLiteral', value: 3 },
    }],
  })).toThrow('Invalid expression: "foo" + 3');
});

// Verifies nested calls use typed variables before put prints the result.
test('executes a typed assignment and prints 5', async () => {
  const stream = new Blob(['add:i n1:i n2:i -> n1 + n2\n# comment\nscore:i <- 3\nput add 2 score'])
    .stream().pipeThrough(new TextDecoderStream());
  const tokens = await tokenizer(stream);
  const log = spyOn(console, 'log').mockImplementation(
    // Suppresses output while recording evaluated arguments.
    () => {},
  );
  try {
    expect(executeAST(buildAST(tokens))).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(5);
  } finally {
    log.mockRestore();
  }
});

// Verifies every supported arithmetic operator and primitive value.
test('evaluates arithmetic and literals', () => {
  expect(executeAST(buildAST(['2', '+', '3', '*', '4', '-', '8', '/', '2', '^', '2']))).toBe(12);
  expect(executeAST(buildAST(['true']))).toBe(true);
  expect(executeAST(buildAST(['false']))).toBe(false);
  expect(executeAST(buildAST(['"hello world"']))).toBe('hello world');
  expect(executeAST(buildAST([]))).toBeNull();
});

// Verifies functions capture their definition scope rather than the caller's parameters.
test('uses lexical scope and fresh parameter bindings', () => {
  const tokens = [
    'base', '<-', '10',
    'f:i', 'x:i', '->', 'x', '+', 'base',
    'g:i', 'base:i', '->', 'f', 'base',
    'g', '2', 'g', '3',
  ];
  expect(executeAST(buildAST(tokens))).toBe(13);
});

// Verifies local assignments return the final body value without replacing outer bindings.
test('evaluates assignments and block results', () => {
  expect(executeAST(buildAST([
    'value', '<-', '10',
    'f:i', '->', '{', 'value', '<-', '2', 'value', '+', '1', '}',
    'result', '<-', 'f', 'value', '+', 'result',
  ]))).toBe(13);
  expect(executeAST(buildAST(['empty:i', '->', '{', '}', 'empty']))).toBeNull();
});

// Verifies execution reports undefined names, nonfunctions, and incorrect operand types.
test('reports invalid runtime operations', () => {
  expect(() => executeAST(buildAST(['missing']))).toThrow('Undefined identifier "missing"');
  expect(() => executeAST(buildAST(['x', '<-', '1', 'x']))).toThrow('"x" is not a function');
  expect(() => executeAST(buildAST(['true', '+', '1']))).toThrow('requires numeric operands');
  const ast = buildAST(['f:i', 'x:i', '->', 'x', '+', '1', 'f', '2']);
  const call = ast.body[1];
  if (call.type !== 'FunctionCall') throw new Error('Expected a call');
  call.arguments = [];
  expect(() => executeAST(ast)).toThrow('Expected 1 arguments for "f", received 0');
});

// Verifies each execution gets an independent environment and leaves its AST unchanged.
test('isolates executions and preserves AST nodes', () => {
  const ast = buildAST(['x', '<-', '2', 'x', '+', '3']);
  const original = structuredClone(ast);
  expect(executeAST(ast)).toBe(5);
  expect(executeAST(ast)).toBe(5);
  expect(ast).toEqual(original);
  expect(() => executeAST({
    type: 'Program',
    body: [{
      type: 'BinaryExpression', operator: '+',
      left: { type: 'Identifier', name: 'x' },
      right: { type: 'NumberLiteral', value: 1 },
    }],
  })).toThrow(ReferenceError);
});
