import { expect, spyOn, test } from 'bun:test';
import { buildAST } from './ast';
import { executeAST } from './execute';
import { tokenizer } from './tokenizer';

// Verifies typed numeric arrays sum literals, expressions, references, and empty arrays.
test('executes typed array sum methods', async () => {
  const source = [
    'base:i <- 2',
    'counts:i[] <- [base 3 + 4 -1]',
    'measurements:f[] <- [1 2.5\n3.5]',
    'names:t[] <- ["Ada" "Grace"]',
    'empty:i[] <- []',
    'emptyFloat:f[] <- []',
    'total:i <- counts.sum',
    'floatTotal:f <- measurements.sum',
    'inferred <- [4 5]',
    'sumValues:i values:i[] -> values.sum',
    'numbers:i[] -> [8 9]',
    'put total floatTotal empty.sum emptyFloat.sum inferred.sum sumValues [2 3] numbers.sum names',
  ].join('\n');
  const tokens = await tokenizer(new Blob([source]).stream().pipeThrough(new TextDecoderStream()));
  const log = spyOn(console, 'log').mockImplementation(
    // Records output without printing during the test.
    () => {},
  );
  try {
    executeAST(buildAST(tokens));
    expect(log.mock.calls).toEqual([[8, 7, 0, 0, 9, 5, 17, ['Ada', 'Grace']]]);
  } finally {
    log.mockRestore();
  }
  expect(executeAST(buildAST(['[', '1', '2', ']', '.', 'sum', '+', '3']))).toBe(6);
});

// Verifies runtime sum rejects invalid receivers even when supplied through function arguments or a raw AST.
test('rejects invalid runtime sum receivers', () => {
  expect(() => executeAST(buildAST([
    'total:i', 'values:i[]', '->', 'values', '.', 'sum', 'total', '[', '"bad"', ']',
  ]))).toThrow('requires numeric elements');
  expect(() => executeAST({ type: 'Program', body: [{
    type: 'MethodCall', name: 'sum', receiver: { type: 'NumberLiteral', value: 1 },
  }] })).toThrow('requires a receiver of type "i[]" or "f[]"');
});

// Verifies each put stops at its line ending, including comments and empty calls.
test('ends put statements at line boundaries', async () => {
  const log = spyOn(console, 'log').mockImplementation(
    // Records each separate print without emitting test output.
    () => {},
  );
  try {
    for (const newline of ['\n', '\r\n', '\r']) {
      log.mockClear();
      const source = [
        'product:f a:f b:f -> a * b',
        'pi:f <- 3.14',
        'put product 2 pi',
        'word:t <- "foo"',
        'put word.length # trailing comment',
        '# full-line comment',
        '',
        'put word.uppercase',
        'put',
        'put "last" 2',
        '',
      ].join(newline);
      const tokens = await tokenizer(new Blob([source]).stream().pipeThrough(new TextDecoderStream()));
      executeAST(buildAST(tokens));
      expect(log.mock.calls).toEqual([[6.28], [3], ['FOO'], [], ['last', 2]]);
    }
  } finally {
    log.mockRestore();
  }
});

// Verifies Text methods on typed variables, inferred text, literals, and parameters.
test('executes built-in Text instance methods', async () => {
  const source = 'word:t <- "Hello World" size:i <- word.length upper:t <- word.uppercase lower:t <- upper.lowercase put size upper lower "MiXeD".uppercase.lowercase';
  const tokens = await tokenizer(new Blob([source]).stream().pipeThrough(new TextDecoderStream()));
  const log = spyOn(console, 'log').mockImplementation(
    // Records output without printing during the test.
    () => {},
  );
  try {
    executeAST(buildAST(tokens));
    expect(log).toHaveBeenCalledWith(11, 'HELLO WORLD', 'hello world', 'mixed');
  } finally {
    log.mockRestore();
  }
  expect(executeAST(buildAST(['word', '<-', '"hello"', 'word', '.', 'uppercase']))).toBe('HELLO');
  expect(executeAST(buildAST(['size:i', 'value:t', '->', 'value', '.', 'length', 'size', '"hello"']))).toBe(5);
  expect(executeAST(buildAST(['""', '.', 'length', '+', '2']))).toBe(2);
});

// Verifies method names, receiver types, and method result types are checked.
test('rejects invalid Text method calls', () => {
  expect(() => buildAST(['"hello"', '.', 'missing'])).toThrow('Unknown Text method "missing"');
  expect(() => buildAST(['true', '.', 'length'])).toThrow('requires a receiver of type "t"');
  expect(() => buildAST(['"hello"', '.', 'length', '.', 'uppercase'])).toThrow('requires a receiver of type "t"');
  expect(() => buildAST(['size:t', '<-', '"hello"', '.', 'length'])).toThrow('cannot be initialized with type "i"');
  expect(() => buildAST(['"hello"', '.'])).toThrow('Expected a method name');
  expect(() => executeAST({ type: 'Program', body: [{
    type: 'MethodCall', name: 'length', receiver: { type: 'NumberLiteral', value: 3 },
  }] })).toThrow('requires a receiver of type "t"');
});

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
// Verifies arrays evaluate references, expressions, calls, and nested values through the full pipeline.
test('executes arrays of values', async () => {
  const source = 'add:i x:i y:i -> x + y\nvalue:i <- 4\nvalues:a <- [value 2 + 3 add 6 7\n# comment\ntrue "hello".uppercase [] [8 9]]\nput values\nput []\nput [1\n2] 3\nput "done"';
  const tokens = await tokenizer(new Blob([source]).stream().pipeThrough(new TextDecoderStream()));
  const ast = buildAST(tokens);
  const log = spyOn(console, 'log').mockImplementation(
    // Records array output without printing during the test.
    () => {},
  );
  try {
    executeAST(ast);
    expect(log.mock.calls).toEqual([
      [[4, 5, 13, true, 'HELLO', [], [8, 9]]], [[]], [[1, 2], 3], ['done'],
    ]);
  } finally {
    log.mockRestore();
  }
  expect(executeAST(buildAST(['[', '1', '[', '2', ']', ']']))).toEqual([1, [2]]);
  expect(executeAST(buildAST(['identity:a', 'value:a', '->', '[', 'value', ']', 'identity', '[', '1', ']']))).toEqual([[1]]);
});
