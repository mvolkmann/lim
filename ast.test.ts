import { expect, test } from 'bun:test';
import { buildAST } from './ast';
import { tokenizer } from './tokenizer';

// Verifies compact and spaced array declarations consume their type suffix and check elements.
test('parses typed array declarations', async () => {
  for (const [type, literal] of [['i', '[1 2]'], ['f', '[1 2.5]'], ['t', '["one" "two"]']]) {
    for (const declaration of [`values:${type}[]`, `values : ${type} [ ]`]) {
      const source = `put 1 ${declaration} <- ${literal}\nempty:${type}[] <- []`;
      const tokens = await tokenizer(new Blob([source]).stream().pipeThrough(new TextDecoderStream()));
      expect(buildAST(tokens).body).toMatchObject([
        { type: 'FunctionCall', name: 'put', arguments: [{ type: 'NumberLiteral', value: 1 }] },
        { type: 'Assignment', name: 'values', declaredType: `${type}[]`, value: { type: 'ArrayLiteral' } },
        { type: 'Assignment', name: 'empty', declaredType: `${type}[]`, value: { type: 'ArrayLiteral', elements: [] } },
      ]);
    }
    expect(buildAST([`values:${type}[]`, '<-', '[', ']']).body[0]).toMatchObject({ declaredType: `${type}[]` });
  }
});

// Verifies typed literals reject incorrect element types and scalar initializers.
test('rejects invalid typed array initializers', () => {
  for (const [type, element] of [
    ['i[]', '2.5'], ['i[]', '"text"'], ['f[]', 'true'], ['t[]', '1'], ['t[]', 'missing'],
  ]) {
    expect(() => buildAST([`values:${type}`, '<-', '[', element, ']'])).toThrow(TypeError);
  }
  expect(() => buildAST(['values:i[]', '<-', '[', '[', '1', ']', ']'])).toThrow(TypeError);
  expect(() => buildAST(['values:i[]', '<-', '1'])).toThrow(TypeError);
  expect(() => buildAST(['word:t', '<-', '"hello"', 'values:i[]', '<-', '[', 'word', ']'])).toThrow(TypeError);
});

// Verifies sum receiver and result types, inference, and parameter shadowing.
test('checks numeric array sum types', () => {
  expect(() => buildAST(['values:i[]', '<-', '[', '1', ']', 'total:i', '<-', 'values', '.', 'sum'])).not.toThrow();
  expect(() => buildAST(['values:f[]', '<-', '[', '1', ']', 'total:f', '<-', 'values', '.', 'sum'])).not.toThrow();
  expect(() => buildAST(['values:f[]', '<-', '[', '1', ']', 'total:i', '<-', 'values', '.', 'sum'])).toThrow(TypeError);
  expect(() => buildAST(['total:f', '<-', '[', '1', '2.5', ']', '.', 'sum'])).not.toThrow();
  expect(() => buildAST(['total:i', '<-', '[', '1', '2', ']', '.', 'sum'])).not.toThrow();
  for (const receiver of [['1'], ['"text"'], ['[', '"text"', ']'], ['[', '1', 'true', ']'], ['[', ']']]) {
    expect(() => buildAST([...receiver, '.', 'sum'])).toThrow('requires a receiver of type "i[]" or "f[]"');
  }
  expect(() => buildAST(['values:t[]', '<-', '[', '"text"', ']', 'values', '.', 'sum'])).toThrow(TypeError);
  expect(() => buildAST(['values:i[]', '<-', '[', '1', ']', 'f:i', 'values:t[]', '->', 'values', '.', 'sum'])).toThrow(TypeError);
  expect(() => buildAST(['[', '1', ']', '.', 'uppercase'])).toThrow(TypeError);
});

// Verifies line boundaries work inside blocks and do not hide missing call arguments.
test('parses line-separated calls in blocks', () => {
  expect(buildAST([
    'f:i', '->', '\n', '{', '\n', 'put', '1', '\n', 'put', '2', '\n', '}', '\n', 'f',
  ]).body[0]).toMatchObject({ body: { body: [
    { type: 'FunctionCall', name: 'put', arguments: [{ type: 'NumberLiteral', value: 1 }] },
    { type: 'FunctionCall', name: 'put', arguments: [{ type: 'NumberLiteral', value: 2 }] },
  ] } });
  expect(() => buildAST([
    'add:i', 'a:i', 'b:i', '->', 'a', '+', 'b', '\n', 'put', 'add', '1', '\n', 'put', '2',
  ])).toThrow('Expected 2 arguments for "add"');
});

// Verifies declarations reject initializers with a different type before further expressions are parsed.
test('checks typed assignment initializer types', () => {
  for (const prefix of [['score:t'], ['score', ':', 't']]) {
    expect(() => buildAST([...prefix, '<-', '3'])).toThrow(
      'Variable "score" declared as type "t" cannot be initialized with type "i"',
    );
    expect(() => buildAST([...prefix, '<-', 'true'])).toThrow(TypeError);
    expect(() => buildAST([...prefix, '<-', '"hello"'])).not.toThrow();
  }
  expect(() => buildAST(['score:i', '<-', '3.5'])).toThrow(TypeError);
  expect(() => buildAST(['score:b', '<-', 'true'])).not.toThrow();
  expect(() => buildAST(['score:f', '<-', '3.5'])).not.toThrow();
  expect(() => buildAST(['score:t', '<-', '1', '+', '2'])).toThrow(TypeError);
  expect(() => buildAST(['value:i', '->', '3', 'score:t', '<-', 'value'])).toThrow(TypeError);
  expect(() => buildAST(['value:t', '->', '"hello"', 'score:t', '<-', 'value'])).not.toThrow();
  expect(() => buildAST(['f:i', 'x:i', '->', '{', 'score:t', '<-', 'x', '}'])).toThrow(TypeError);
});

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

// Verifies tokenization and parsing of a function, declaration, and call without block delimiters.
test('parses a typed assignment between a function and a call', async () => {
  const stream = new Blob(['add:i n1:i n2:i -> n1 + n2\n# comment\nscore:i <- 3\nput add 2 score'])
    .stream().pipeThrough(new TextDecoderStream());
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
// Verifies nested arrays, multiline elements, and malformed bracket syntax.
test('parses array literals and rejects malformed arrays', () => {
  expect(buildAST(['[', '1', '\n', '[', 'true', '"text"', ']', '[', ']', ']']).body).toEqual([{
    type: 'ArrayLiteral', elements: [
      { type: 'NumberLiteral', value: 1 },
      { type: 'ArrayLiteral', elements: [
        { type: 'BooleanLiteral', value: true },
        { type: 'TextLiteral', value: 'text' },
      ] },
      { type: 'ArrayLiteral', elements: [] },
    ],
  }]);
  for (const tokens of [['['], ['[', '1'], ['[', '[', ']'], [']'], ['[', '1', ',', '2', ']']]) {
    expect(() => buildAST(tokens)).toThrow(SyntaxError);
  }
  expect(() => buildAST(['[', '1', ']', '+', '2'])).toThrow(TypeError);
  expect(() => buildAST(['values:i', '<-', '[', ']'])).toThrow(TypeError);
  expect(() => buildAST(['f:i', 'x:i', '->', 'x', '+', '1', '[', 'f', ']'])).toThrow('Expected 1 arguments');
});
