const keywords = new Set([
  'class',
  'const',
  'else',
  'for',
  'if',
  'let',
  'nil',
  'put',
  'return',
  'switch',
  'var',
  'while',
]);

const operators1 = new Set([
  '+',
  '-',
  '*',
  '/',
  '^',
  '=',
  '<',
  '>',
  '?',
  ':',
]);

const operators2 = new Set([
  '++',
  '--',
  '^=',
  '<',
  '<=',
  '>=',
  '<-',
  '->'
]);

type Pair = { name: string; type: string };
type Expression =
  | { type: 'Assignment'; name: string; value: Expression }
  | { type: 'BinaryExpression'; operator: string; left: Expression; right: Expression }
  | { type: 'FunctionCall'; name: string; arguments: Argument[] }
  | { type: 'FunctionDefinition'; signature: Pair; parameters: Pair[]; body: Block }
  | { type: 'BooleanLiteral'; value: boolean }
  | { type: 'NumberLiteral'; value: number }
  | { type: 'TextLiteral'; value: string }
  | { type: 'Identifier'; name: string };
type Argument = Expression;
type Block = { type: 'Block'; body: Expression[] };
type RuntimeValue = boolean | number | string | null | RuntimeFunction;
type RuntimeFunction = (...args: RuntimeValue[]) => RuntimeValue;
type Environment = { bindings: Map<string, RuntimeValue>; parent?: Environment };

/**
 * Builds an abstract syntax tree (AST) from the provided tokens.
 * @param tokens array of strings
 * @returns AST
 */
export function buildAST(tokens: string[]): { type: 'Program'; body: Expression[] } {
  // boolean ::= 'true' | 'false'
  // number ::= integer | float
  // integer ::= '-'? digit+
  // float ::= '-'? digit+ '.' digit+
  // digit ::= '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  // text ::= '"' character* '"'
  // identifier ::= letter (letter | digit | '_')*
  // pair ::= identifier ':' type
  // parameter ::= pair
  // expression ::= assign | fncall | fndef | argument (operator argument)*
  // assign ::= identifier '<-' expression
  // fncall ::= identifier argument*
  // fndef ::= pair parameter* '->' block
  // block ::= '{' expression* '}' | expression
  let position = 0;
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  const scopes: Map<string, number | null>[] = [new Map()];

  // Reports invalid syntax at the current token position.
  function fail(message: string): never {
    throw new SyntaxError(`${message} at token ${position}: ${tokens[position] ?? 'end of input'}`);
  }

  // Finds a declared function's arity while respecting parameter shadowing.
  function getArity(name: string): number | undefined {
    for (let index = scopes.length - 1; index >= 0; index--) {
      if (scopes[index].has(name)) return scopes[index].get(name) ?? undefined;
    }
    return undefined;
  }

  // Parses a literal, name reference, nested call, or function definition argument.
  function readArgument(): Argument {
    const token = tokens[position];
    if (token === undefined) fail('Expected an argument');
    if (token === 'true' || token === 'false') {
      position++;
      return { type: 'BooleanLiteral', value: token === 'true' };
    }
    if (/^-?\d+(?:\.\d+)?$/.test(token)) {
      position++;
      return { type: 'NumberLiteral', value: Number(token) };
    }
    if (/^"[^"\\]*(?:\\.[^"\\]*)*"$/.test(token)) {
      position++;
      return { type: 'TextLiteral', value: token.slice(1, -1) };
    }
    if (startsPair()) return readExpression();
    if (isIdentifier(token)) {
      if (getArity(token) !== undefined) return readCall();
      position++;
      return { type: 'Identifier', name: token };
    }
    return fail('Expected an argument');
  }

  // Parses arithmetic with multiplication precedence and right-associative powers.
  function readBinaryExpression(minimumPrecedence = 0): Expression {
    let left = readArgument();
    while (position < tokens.length) {
      const operator = tokens[position];
      const rank = precedence[operator];
      if (rank === undefined || rank < minimumPrecedence) break;
      position++;
      const right = readBinaryExpression(operator === '^' ? rank : rank + 1);
      left = { type: 'BinaryExpression', operator, left, right };
    }
    return left;
  }

  // Parses a brace-delimited body or a single implicit body expression.
  function readBlock(): Block {
    if (tokens[position] !== '{') {
      return { type: 'Block', body: [readExpression()] };
    }
    position++;
    const body: Expression[] = [];
    while (position < tokens.length && tokens[position] !== '}') {
      body.push(readExpression());
    }
    if (tokens[position] !== '}') fail('Expected "}"');
    position++;
    return { type: 'Block', body };
  }

  // Reads declared calls with their exact arity and other calls up to a boundary.
  function readCall(): Expression {
    const name = tokens[position++];
    const arity = getArity(name);
    const args: Argument[] = [];
    while (arity === undefined || args.length < arity) {
      if (position >= tokens.length || tokens[position] === '}' ||
          (isIdentifier(tokens[position]) && tokens[position + 1] === '<-')) {
        if (arity !== undefined) fail(`Expected ${arity} arguments for "${name}"`);
        break;
      }
      args.push(readBinaryExpression());
    }
    return { type: 'FunctionCall', name, arguments: args };
  }

  // Parses an assignment, function call, or typed function definition.
  function readExpression(): Expression {
    if (startsPair()) {
      const signature = readPair();
      const parameters: Pair[] = [];
      while (startsPair()) parameters.push(readPair());
      if (tokens[position] !== '->') fail('Expected "->"');
      position++;
      scopes[scopes.length - 1].set(signature.name, parameters.length);
      scopes.push(new Map(parameters.map(parameter => [parameter.name, null])));
      try {
        return { type: 'FunctionDefinition', signature, parameters, body: readBlock() };
      } finally {
        scopes.pop();
      }
    }
    const name = tokens[position];
    if ((name !== undefined && precedence[tokens[position + 1]] !== undefined) ||
        !isIdentifier(name ?? '') || name === 'true' || name === 'false') {
      return readBinaryExpression();
    }
    if (tokens[position + 1] === '<-') {
      position += 2;
      return { type: 'Assignment', name, value: readExpression() };
    }
    return readCall();
  }

  // Reads a name/type pair in either supported token representation.
  function readPair(): Pair {
    const token = tokens[position];
    if (isPair(token)) {
      position++;
      const [name, type] = token.split(':');
      return { name, type };
    }
    const name = tokens[position++];
    if (tokens[position++] !== ':') fail('Expected ":"');
    const type = tokens[position];
    if (!isIdentifier(type ?? '')) fail('Expected a type identifier');
    position++;
    return { name, type };
  }

  // Detects either a compact or whitespace-separated name/type pair.
  function startsPair(): boolean {
    return isPair(tokens[position] ?? '') ||
      (isIdentifier(tokens[position] ?? '') && tokens[position + 1] === ':');
  }

  const body: Expression[] = [];
  while (position < tokens.length) body.push(readExpression());
  return { type: 'Program', body };
}

// Executes a program in a fresh lexical environment and returns its final value.
export function executeAST(ast: { type: 'Program'; body: Expression[] }): RuntimeValue {
  const environment: Environment = { bindings: new Map() };

  // Evaluates an expression, resolving names and calls in its lexical environment.
  function executeExpression(expression: Expression, scope: Environment): RuntimeValue {
    switch (expression.type) {
      case 'BooleanLiteral':
      case 'NumberLiteral':
      case 'TextLiteral':
        return expression.value;
      case 'Identifier':
        return lookup(expression.name, scope);
      case 'Assignment': {
        const value = executeExpression(expression.value, scope);
        scope.bindings.set(expression.name, value);
        return value;
      }
      case 'BinaryExpression': {
        const left = executeExpression(expression.left, scope);
        const right = executeExpression(expression.right, scope);
        if (typeof left !== 'number' || typeof right !== 'number') {
          throw new TypeError(`Operator "${expression.operator}" requires numeric operands`);
        }
        switch (expression.operator) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/': return left / right;
          case '^': return left ** right;
          default: throw new Error(`Unsupported operator "${expression.operator}"`);
        }
      }
      case 'FunctionCall': {
        const fn = lookup(expression.name, scope);
        if (typeof fn !== 'function') {
          throw new TypeError(`"${expression.name}" is not a function`);
        }
        const args: RuntimeValue[] = [];
        for (const argument of expression.arguments) {
          args.push(executeExpression(argument, scope));
        }
        return fn(...args);
      }
      case 'FunctionDefinition': {
        const definition = expression;
        // Invokes the defined function with fresh parameters and its captured scope.
        function invoke(...args: RuntimeValue[]): RuntimeValue {
          if (args.length !== definition.parameters.length) {
            throw new TypeError(
              `Expected ${definition.parameters.length} arguments for "${definition.signature.name}", received ${args.length}`,
            );
          }
          const local: Environment = { bindings: new Map(), parent: scope };
          for (let index = 0; index < args.length; index++) {
            local.bindings.set(definition.parameters[index].name, args[index]);
          }
          let result: RuntimeValue = null;
          for (const item of definition.body.body) result = executeExpression(item, local);
          return result;
        }
        scope.bindings.set(expression.signature.name, invoke);
        return invoke;
      }
    }
  }

  // Resolves the nearest binding or reports an undefined name.
  function lookup(name: string, scope: Environment): RuntimeValue {
    if (scope.bindings.has(name)) return scope.bindings.get(name)!;
    if (scope.parent) return lookup(name, scope.parent);
    throw new ReferenceError(`Undefined identifier "${name}"`);
  }

  // Prints evaluated arguments and returns the language's empty value.
  function put(...args: RuntimeValue[]): RuntimeValue {
    console.log(...args);
    return null;
  }

  environment.bindings.set('put', put);
  let result: RuntimeValue = null;
  for (const expression of ast.body) result = executeExpression(expression, environment);
  return result;
}

// Checks whether a token starts with a letter and
// contains only letters, digits, or underscores.
function isIdentifier(token: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(token);
}

// Checks whether a token is an integer or
// decimal with an optional minus sign.
function isNumber(token: string): boolean {
  if (token === '0') return true;
  // ^ and $ match the entire token; [-]? allows an optional leading minus.
  // \d+(?:\.\d*)? matches digits with an optional decimal point and fraction
  // (42, 3.14, 5.); |\.\d+ also allows decimals without an integer part (.5).
  // (?:...) groups alternatives without capturing them.
  // + and exponents are excluded.
  return /^[-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token);
}

// Checks whether a token contains two identifiers separated by a colon.
// The first is a name and the second is a type (e.g., "x:f").
function isPair(token: string): boolean {
  const parts = token.split(':');
  if (parts.length !== 2) return false;
  return isIdentifier(parts[0]) && isIdentifier(parts[1]);
}

// Checks whether the buffer is a supported lexical token.
function isToken(buffer: string): boolean {
  if (buffer.length == 1 && operators1.has(buffer)) return true;
  if (buffer.length == 2 && operators2.has(buffer)) return true;
  return keywords.has(buffer) ||
    isNumber(buffer) ||
    isIdentifier(buffer) ||
    isPair(buffer);
}

// Reads the input file specified on the command line.
async function main(): Promise<void> {
  const filePath = Bun.argv[2];
  if (!filePath) {
    console.error('Usage: bun run parser.ts <file-path>');
    process.exitCode = 1;
    return;
  }

  try {
    const stream = Bun.file(filePath).stream().pipeThrough(new TextDecoderStream());
    await parse(stream);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Reads whitespace-delimited tokens from a stream and logs recognized tokens.
export async function parse(stream: ReadableStream<string>) {
  let buffer = '';
  const tokens = [];

    for await (const chunk of stream) {
      for (const char of chunk) {
        if (char === ' ' || char === '\n' || char === '\t') {
          if (isToken(buffer)) {
            tokens.push(buffer);
            buffer = '';
          } else if (buffer.length > 0) {
            throw new Error(`invalid token "${buffer}"`);
          }
        } else {
          buffer += char;
        }
      }
    }
    console.log('parser.ts: tokens =', tokens);
    const ast = buildAST(tokens);
    console.log('parser.ts: AST =', JSON.stringify(ast, null, 2));
    executeAST(ast);
}

if (import.meta.main) main();
