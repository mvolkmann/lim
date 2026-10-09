import { isIdentifier, isTypedIdentifier } from './tokenizer';

type TypedIdentifier = { name: string; type: string };

export type Expression =
  | { type: 'ArrayLiteral'; elements: Expression[] }
  | { type: 'Assignment'; name: string; declaredType?: string; value: Expression }
  | { type: 'BinaryExpression'; operator: string; left: Expression; right: Expression }
  | { type: 'FunctionCall'; name: string; arguments: Argument[] }
  | { type: 'MethodCall'; receiver: Expression; name: string }
  | { type: 'FunctionDefinition'; signature: TypedIdentifier; parameters: TypedIdentifier[]; body: Block }
  | { type: 'BooleanLiteral'; value: boolean }
  | { type: 'NumberLiteral'; value: number }
  | { type: 'TextLiteral'; value: string }
  | { type: 'Identifier'; name: string };

type Argument = Expression;

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
  // array ::= '[' (argument (operator argument)*)* ']'
  // identifier ::= letter (letter | digit | '_')*
  // pair ::= identifier ':' type
  // parameter ::= pair
  // expression ::= assign | fncall | fndef | argument (operator argument)*
  // assign ::= (identifier | pair) '<-' expression
  // fncall ::= identifier argument*
  // fndef ::= pair parameter* '->' block
  // block ::= '{' expression* '}' | expression
  let position = 0;
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '**': 3, '^': 3 };
  const scopes: Map<string, number | null>[] = [new Map()];
  const typeScopes: Map<string, string | undefined>[] = [new Map()];

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

  // Resolves an expression's declared or inferred value type in the current scope.
  function getType(expression: Expression): string | undefined {
    switch (expression.type) {
      case 'ArrayLiteral': {
        if (expression.elements.length === 0) return 'a';
        let elementType = getType(expression.elements[0]);
        for (const element of expression.elements) {
          const type = getType(element);
          if ((elementType === 'i' || elementType === 'f') && (type === 'i' || type === 'f')) {
            if (type === 'f') elementType = 'f';
          } else if (type !== elementType) {
            return 'a';
          }
        }
        return elementType === 'i' || elementType === 'f' || elementType === 't' ? `${elementType}[]` : 'a';
      }
      case 'BooleanLiteral': return 'b';
      case 'NumberLiteral': return Number.isInteger(expression.value) ? 'i' : 'f';
      case 'TextLiteral': return 't';
      case 'MethodCall':
        if (expression.name === 'sum') return getType(expression.receiver) === 'i[]' ? 'i' : 'f';
        return expression.name === 'length' ? 'i' : 't';
      case 'Identifier':
      case 'FunctionCall':
        for (let index = typeScopes.length - 1; index >= 0; index--) {
          if (typeScopes[index].has(expression.name)) return typeScopes[index].get(expression.name);
        }
        return undefined;
      case 'Assignment': return expression.declaredType ?? getType(expression.value);
      case 'BinaryExpression':
        return getType(expression.left) === 'f' || getType(expression.right) === 'f' ? 'f' : 'i';
      case 'FunctionDefinition': return undefined;
    }
  }

  // Parses a value followed by zero-argument Text or numeric array methods.
  function readArgument(): Argument {
    let receiver = readPrimaryArgument();
    while (tokens[position] === '.') {
      position++;
      const name = tokens[position];
      if (!isIdentifier(name ?? '')) fail('Expected a method name');
      if (name === 'sum') {
        if (getType(receiver) !== 'i[]' && getType(receiver) !== 'f[]') {
          throw new TypeError('Array method "sum" requires a receiver of type "i[]" or "f[]"');
        }
      } else {
        if (!['length', 'uppercase', 'lowercase'].includes(name)) fail(`Unknown Text method "${name}"`);
        if (getType(receiver) !== 't') {
          throw new TypeError(`Text method "${name}" requires a receiver of type "t"`);
        }
      }
      position++;
      receiver = { type: 'MethodCall', receiver, name };
    }
    return receiver;
  }

  // Parses a bracket-delimited array, allowing line breaks between elements.
  function readArray(): Expression {
    position++;
    const elements: Expression[] = [];
    skipNewlines();
    while (position < tokens.length && tokens[position] !== ']') {
      elements.push(readBinaryExpression());
      skipNewlines();
    }
    if (tokens[position] !== ']') fail('Expected "]"');
    position++;
    return { type: 'ArrayLiteral', elements };
  }

  // Validates an initializer and records the variable's declared or inferred type.
  function readAssignment(name: string, declaredType?: string): Expression {
    position++;
    const value = readExpression();
    const valueType = getType(value);
    let compatible = declaredType === undefined || valueType === declaredType ||
      (declaredType === 'a' && (value.type === 'ArrayLiteral' || valueType?.endsWith('[]')));
    if (declaredType !== undefined && ['i[]', 'f[]', 't[]'].includes(declaredType) && value.type === 'ArrayLiteral') {
      compatible = true;
      const elementType = declaredType.slice(0, -2);
      for (const element of value.elements) {
        const type = getType(element);
        if (type !== elementType && !(elementType === 'f' && type === 'i')) {
          throw new TypeError(`Array "${name}" of type "${declaredType}" cannot contain an element of type "${type ?? 'unknown'}"`);
        }
      }
    }
    if (!compatible) {
      throw new TypeError(
        `Variable "${name}" declared as type "${declaredType}" cannot be initialized with type "${valueType ?? 'unknown'}"`,
      );
    }
    scopes[scopes.length - 1].set(name, null);
    typeScopes[typeScopes.length - 1].set(name, declaredType ?? valueType);
    return declaredType === undefined
      ? { type: 'Assignment', name, value }
      : { type: 'Assignment', name, declaredType, value };
  }

  // Parses arithmetic with multiplication precedence and right-associative powers.
  function readBinaryExpression(minimumPrecedence = 0): Expression {
    let left = readArgument();
    while (position < tokens.length) {
      const operator = tokens[position];
      const rank = precedence[operator];
      if (rank === undefined || rank < minimumPrecedence) break;
      position++;
      const right = readBinaryExpression(operator === '^' || operator === '**' ? rank : rank + 1);
      validateNumericOperand(left, operator);
      validateNumericOperand(right, operator);
      left = { type: 'BinaryExpression', operator, left, right };
    }
    return left;
  }

  // Parses a brace-delimited body or a single implicit body expression.
  function readBlock(): Block {
    skipNewlines();
    if (tokens[position] !== '{') {
      return { type: 'Block', body: [readExpression()] };
    }
    position++;
    const body: Expression[] = [];
    while (position < tokens.length && tokens[position] !== '}') {
      if (tokens[position] === '\n') {
        skipNewlines();
        continue;
      }
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
      if (position >= tokens.length || tokens[position] === '\n' || tokens[position] === '}' || tokens[position] === ']' || startsAssignment()) {
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
      if (tokens[position] === '<-') return readAssignment(signature.name, signature.type);
      const parameters: TypedIdentifier[] = [];
      while (startsTypedIdentifier()) parameters.push(readTypedIdentifier());
      if (tokens[position] !== '->') fail('Expected "->"');
      position++;
      scopes[scopes.length - 1].set(signature.name, parameters.length);
      typeScopes[typeScopes.length - 1].set(signature.name, signature.type);
      scopes.push(new Map(parameters.map(parameter => [parameter.name, null])));
      typeScopes.push(new Map(parameters.map(parameter => [parameter.name, parameter.type])));
      try {
        return { type: 'FunctionDefinition', signature, parameters, body: readBlock() };
      } finally {
        scopes.pop();
        typeScopes.pop();
      }
    }
    const name = tokens[position];
    if (tokens[position + 1] === '.' || (name !== undefined && precedence[tokens[position + 1]] !== undefined) ||
        !isIdentifier(name ?? '') || name === 'true' || name === 'false') {
      return readBinaryExpression();
    }
    if (tokens[position + 1] === '<-') {
      position++;
      return readAssignment(name);
    }
    return readCall();
  }

  // Parses a literal, name reference, nested call, or function definition argument.
  function readPrimaryArgument(): Argument {
    const token = tokens[position];
    if (token === undefined) fail('Expected an argument');
    if (token === '[') return readArray();
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

  // Reads a name/type pair in either supported token representation.
  function readTypedIdentifier(): TypedIdentifier {
    const token = tokens[position];
    let name: string;
    let type: string;
    if (isTypedIdentifier(token)) {
      position++;
      [name, type] = token.split(':');
    } else {
      name = tokens[position++];
      if (tokens[position++] !== ':') fail('Expected ":"');
      type = tokens[position];
      if (!isIdentifier(type ?? '')) fail('Expected a type identifier');
      position++;
    }
    if (tokens[position] === '[' && tokens[position + 1] === ']') {
      type += '[]';
      position += 2;
    }
    if (type.endsWith('[]') && !['i[]', 'f[]', 't[]'].includes(type)) fail(`Unsupported array type "${type}"`);
    return { name, type };
  }

  // Advances past blank lines between program or block statements.
  function skipNewlines(): void {
    while (tokens[position] === '\n') position++;
  }

  // Detects an untyped or typed assignment at the current token position.
  function startsAssignment(): boolean {
    const token = tokens[position] ?? '';
    if (isIdentifier(token) && tokens[position + 1] === '<-') return true;
    if (!startsTypedIdentifier()) return false;
    let end = position + (isTypedIdentifier(token) ? 1 : 3);
    if (tokens[end] === '[' && tokens[end + 1] === ']') end += 2;
    return tokens[end] === '<-';
  }

  // Detects either a compact or whitespace-separated name/type pair.
  function startsTypedIdentifier(): boolean {
    return isTypedIdentifier(tokens[position] ?? '') ||
      (isIdentifier(tokens[position] ?? '') && tokens[position + 1] === ':');
  }

  // Rejects literal and identifier operands whose types are not numeric.
  function validateNumericOperand(expression: Expression, operator: string): void {
    if (expression.type !== 'ArrayLiteral' && expression.type !== 'BooleanLiteral' && expression.type !== 'NumberLiteral' &&
        expression.type !== 'TextLiteral' && expression.type !== 'Identifier') return;
    const type = getType(expression);
    if (type !== 'i' && type !== 'f') {
      throw new TypeError(`Operator "${operator}" requires numeric operands of type "i" or "f"`);
    }
  }

  const body: Expression[] = [];
  while (position < tokens.length) {
    skipNewlines();
    if (position < tokens.length) body.push(readExpression());
  }
  return { type: 'Program', body };
}

