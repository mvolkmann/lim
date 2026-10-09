import { isIdentifier, isTypedIdentifier } from './tokenizer';

type TypedIdentifier = { name: string; type: string };
export type Expression =
  | { type: 'Assignment'; name: string; value: Expression }
  | { type: 'BinaryExpression'; operator: string; left: Expression; right: Expression }
  | { type: 'FunctionCall'; name: string; arguments: Argument[] }
  | { type: 'FunctionDefinition'; signature: TypedIdentifier; parameters: TypedIdentifier[]; body: Block }
  | { type: 'BooleanLiteral'; value: boolean }
  | { type: 'NumberLiteral'; value: number }
  | { type: 'TextLiteral'; value: string }
  | { type: 'Identifier'; name: string };
export type Argument = Expression;
type Block = { type: 'Block'; body: Expression[] };

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
    if (startsTypedIdentifier()) return readExpression();
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
    if (startsTypedIdentifier()) {
      const signature = readTypedIdentifier();
      const parameters: TypedIdentifier[] = [];
      while (startsTypedIdentifier()) parameters.push(readTypedIdentifier());
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
  function readTypedIdentifier(): TypedIdentifier {
    const token = tokens[position];
    if (isTypedIdentifier(token)) {
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
  function startsTypedIdentifier(): boolean {
    return isTypedIdentifier(tokens[position] ?? '') ||
      (isIdentifier(tokens[position] ?? '') && tokens[position + 1] === ':');
  }

  const body: Expression[] = [];
  while (position < tokens.length) body.push(readExpression());
  return { type: 'Program', body };
}

