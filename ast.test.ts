import { expect, test } from 'bun:test';
import { buildAST } from './ast';
import { tokenizer } from './tokenizer';

// Verifies compact and separated declarations preserve the name, type, and initializer.
test('parses typed variable declarations', () => {
  for (const prefix of [['score:i'], ['score', ':', 'i']]) {
    expect(buildAST([...prefix, '<-', '3']).body).toEqual([{
      type: 'Assignment', name: 'score', declaredType: 'i',
      value: { type: 'NumberLiteral', value: 3 },
    }]);
    expect(() => buildAST([...prefix, '<-'])).toThrow(SyntaxError);
    expect(buildAST(['put', '1', ...prefix, '<-', '3']).body).toHaveLength(2);
  }
  expect(() => buildAST(['score:i', '<-', '3', 'score', '+', '2'])).not.toThrow();
  expect(() => buildAST(['score:t', '<-', '3', 'score', '+', '2'])).toThrow(TypeError);
});

// Verifies all arithmetic operators reject nonnumeric literals and parameter types on either side.
test('rejects nonnumeric arithmetic operands', () => {
  for (const operator of ['+', '-', '*', '/', '**', '^']) {
    for (const literal of ['true', 'false', '"text"']) {
      expect(() => buildAST([literal, operator, '1'])).toThrow(TypeError);
      expect(() => buildAST(['1', operator, literal])).toThrow(TypeError);
    }
    for (const type of ['b', 't', 'unknown']) {
      expect(() => buildAST(['f:i', `x:${type}`, '->', 'x', operator, '1'])).toThrow(TypeError);
      expect(() => buildAST(['f:i', `x:${type}`, '->', '1', operator, 'x'])).toThrow(TypeError);
    }
    for (const type of ['i', 'f']) {
      expect(() => buildAST(['f:i', `x:${type}`, '->', 'x', operator, '1.5'])).not.toThrow();
    }
  }
});

// Verifies assignments infer operand types and parameters shadow outer bindings.
test('resolves arithmetic identifier types in lexical scopes', () => {
  expect(() => buildAST(['x', '+', '1'])).toThrow(TypeError);
  expect(() => buildAST(['x', '<-', 'true', 'x', '+', '1'])).toThrow(TypeError);
  expect(() => buildAST(['x', '<-', '1', 'x', '+', '2'])).not.toThrow();
  expect(() => buildAST(['x', '<-', '1', 'f:i', 'x:t', '->', 'x', '+', '2'])).toThrow(TypeError);
  expect(() => buildAST(['x', '<-', 'true', 'f:i', 'x:f', '->', 'x', '+', '2'])).not.toThrow();
});

// Verifies double-star powers have higher precedence and associate to the right.
test('parses double-star exponentiation', () => {
  expect(buildAST(['2', '*', '3', '**', '4', '**', '5']).body[0]).toMatchObject({
    type: 'BinaryExpression', operator: '*',
    right: {
      type: 'BinaryExpression', operator: '**',
      right: { type: 'BinaryExpression', operator: '**' },
    },
  });
});

// Verifies tokenization and parsing of the demo's function, declaration, and call.
test('parses demo.lim without block delimiters', async () => {
  const stream = Bun.file(new URL('./demo.lim', import.meta.url)).stream().pipeThrough(new TextDecoderStream());
  expect(buildAST(await tokenizer(stream))).toEqual({
    type: 'Program',
    body: [
      {
        type: 'FunctionDefinition',
        signature: { name: 'add', type: 'i' },
        parameters: [{ name: 'n1', type: 'i' }, { name: 'n2', type: 'i' }],
        body: {
          type: 'Block',
          body: [{
            type: 'BinaryExpression', operator: '+',
            left: { type: 'Identifier', name: 'n1' },
            right: { type: 'Identifier', name: 'n2' },
          }],
        },
      },
      {
        type: 'Assignment', name: 'score', declaredType: 'i',
        value: { type: 'NumberLiteral', value: 3 },
      },
      {
        type: 'FunctionCall', name: 'put',
        arguments: [
          {
            type: 'FunctionCall', name: 'add',
            arguments: [
              { type: 'NumberLiteral', value: 2 },
              { type: 'Identifier', name: 'score' },
            ],
          },
        ],
      },
    ],
  });
});

// Verifies declared arities delimit nested calls and separate top-level calls.
test('uses declared parameter counts for nested calls', () => {
  const definitions = ['add:i', 'a:i', 'b:i', '->', 'a', '+', 'b'];
  const ast = buildAST([...definitions, 'add', 'add', '1', '2', '3', 'add', '4', '5']);
  expect(ast.body).toHaveLength(3);
  expect(ast.body[1]).toEqual({
    type: 'FunctionCall', name: 'add',
    arguments: [
      {
        type: 'FunctionCall', name: 'add',
        arguments: [
          { type: 'NumberLiteral', value: 1 },
          { type: 'NumberLiteral', value: 2 },
        ],
      },
      { type: 'NumberLiteral', value: 3 },
    ],
  });
  expect(() => buildAST([...definitions, 'put', 'add', '2'])).toThrow(
    'Expected 2 arguments for "add"',
  );
});

// Verifies zero-parameter calls remain calls when passed as arguments.
test('parses zero-parameter calls as arguments', () => {
  expect(buildAST(['value:i', '->', '1', 'put', 'value']).body[1]).toEqual({
    type: 'FunctionCall', name: 'put',
    arguments: [{ type: 'FunctionCall', name: 'value', arguments: [] }],
  });
});

// Verifies arithmetic precedence and rejects incomplete implicit bodies.
test('parses implicit bodies with arithmetic precedence', () => {
  expect(buildAST(['f:i', '->', '2', '+', '3', '*', '4']).body[0]).toMatchObject({
    body: {
      body: [{
        type: 'BinaryExpression', operator: '+',
        right: { type: 'BinaryExpression', operator: '*' },
      }],
    },
  });
  expect(() => buildAST(['f:i', '->'])).toThrow(SyntaxError);
  expect(() => buildAST(['f:i', '->', 'x', '+'])).toThrow(SyntaxError);
});

// Verifies typed definitions, parameters, assignments, and literal arguments.
test('builds a typed function with a nested assignment', () => {
  expect(buildAST([
    'add', ':', 'i', 'n:i', '->', '{',
    'result', '<-', 'put', 'n', '-2', '3.14', 'true', 'false', '"hello world"',
    '}',
  ])).toEqual({
    type: 'Program',
    body: [{
      type: 'FunctionDefinition',
      signature: { name: 'add', type: 'i' },
      parameters: [{ name: 'n', type: 'i' }],
      body: {
        type: 'Block',
        body: [{
          type: 'Assignment', name: 'result',
          value: {
            type: 'FunctionCall', name: 'put',
            arguments: [
              { type: 'Identifier', name: 'n' },
              { type: 'NumberLiteral', value: -2 },
              { type: 'NumberLiteral', value: 3.14 },
              { type: 'BooleanLiteral', value: true },
              { type: 'BooleanLiteral', value: false },
              { type: 'TextLiteral', value: 'hello world' },
            ],
          },
        }],
      },
    }],
  });
});

// Verifies empty bodies and successive assignments without mutating input.
test('supports empty programs and multiple assignments', () => {
  expect(buildAST([])).toEqual({ type: 'Program', body: [] });
  const tokens = ['a', '<-', 'first', 'b', '<-', 'second'];
  const original = [...tokens];
  expect(buildAST(tokens).body).toHaveLength(2);
  expect(tokens).toEqual(original);
  expect(buildAST(['empty:i', '->', '{', '}']).body[0]).toMatchObject({
    body: { type: 'Block', body: [] },
  });
});

// Verifies that incomplete and unsupported syntax produces useful errors.
test('rejects malformed syntax', () => {
  for (const tokens of [
    ['x', '<-'], ['f:i', '{', '}'], ['f:i', '->', '{'],
    ['f', ':', '1', '->', '{', '}'], ['put', '.5'], ['put', '5.'], ['}'],
  ]) {
    expect(() => buildAST(tokens)).toThrow(SyntaxError);
  }
});
