import type { Expression } from './ast';

type Binding = { name: string; type: string; parameters?: string[]; closure?: boolean; borrowedText?: boolean; asciiText?: boolean; arrayLength?: number; integerCast?: boolean };
type Scope = Map<string, Binding>;
type RustExpression = { code: string; type: string; borrowedText?: boolean; asciiText?: boolean; arrayLength?: number; integerCast?: boolean };

// Translates a LIM AST directly into native Rust functions, variables, and expressions.
export function generateRust(ast: { type: 'Program'; body: Expression[] }): string {
  const scope: Scope = new Map();
  const functions: string[] = [];
  const statements: string[] = [];
  const capturedBindings = new Set<Binding>();

  // Converts numeric expressions and rejects incompatible native types.
  function coerce(value: RustExpression, expected?: string): RustExpression {
    if (value.integerCast && (expected === 'i' || expected === 'f')) return { code: `(${value.code}) as ${rustType(expected)}`, type: expected };
    if (!expected || expected === 'a' || value.type === expected) return value;
    if (['i', 'f'].includes(value.type) && ['i', 'f'].includes(expected)) {
      return { code: `(${value.code}) as ${rustType(expected)}`, type: expected };
    }
    throw new TypeError(`Cannot generate Rust: expected ${expected}, received ${value.type}`);
  }

  // Emits a function body with its last expression returned implicitly.
  function emitBlock(body: Expression[], local: Scope, resultType: string): string {
    const lines: string[] = [];
    for (let index = 0; index < body.length; index++) {
      const expression = body[index];
      const last = index === body.length - 1;
      if (expression.type === 'Assignment' || expression.type === 'FunctionDefinition') {
        lines.push(emitStatement(expression, local));
        if (last) {
          if (expression.type === 'FunctionDefinition') throw new TypeError('Returning functions is not supported by native Rust generation');
          lines.push(emitExpression({ type: 'Identifier', name: expression.name }, local, resultType, true).code);
        }
      } else {
        let code = emitExpression(expression, local, last ? resultType : undefined, last).code;
        if (expression.type === 'BinaryExpression' && expression.operator !== '^' && code.startsWith('(') && code.endsWith(')')) code = code.slice(1, -1);
        lines.push(`${code}${last ? '' : ';'}`);
      }
    }
    return lines.join('\n');
  }

  // Emits native expressions, using expected types for literals and call arguments.
  function emitExpression(expression: Expression, local: Scope, expected?: string, owned = false): RustExpression {
    let value: RustExpression;
    switch (expression.type) {
      case 'ArrayLiteral': {
        const elementType = expected?.endsWith('[]') ? expected.slice(0, -2) : undefined;
        const elements: RustExpression[] = [];
        for (const element of expression.elements) elements.push(emitExpression(element, local, elementType, true));
        let inferred = elementType ?? elements[0]?.type;
        for (const element of elements) if (['i', 'f'].includes(inferred ?? '') && element.type === 'f') inferred = 'f';
        if (!inferred) throw new TypeError('Empty arrays need a concrete array type for Rust generation');
        const codes: string[] = [];
        for (const element of elements) codes.push(coerce(element, inferred).code);
        const vector = owned && expected?.endsWith('[]');
        value = { code: `${vector ? 'vec!' : ''}[${codes.join(', ')}]`, type: `${inferred}[]`,
          arrayLength: vector ? undefined : elements.length };
        break;
      }
      case 'BinaryExpression': {
        if (!['+', '-', '*', '/', '^'].includes(expression.operator)) throw new Error(`Unsupported operator "${expression.operator}"`);
        let left = emitExpression(expression.left, local);
        let right = emitExpression(expression.right, local);
        if (!['i', 'f'].includes(left.type) || !['i', 'f'].includes(right.type)) throw new TypeError('Rust arithmetic requires numbers');
        const type = expression.operator === '/' || expression.operator === '^' || left.type === 'f' || right.type === 'f' ? 'f' : 'i';
        left = coerce(left, type);
        right = coerce(right, type);
        value = { code: expression.operator === '^' ? `(${left.code} as f64).powf(${right.code})` : `(${left.code} ${expression.operator} ${right.code})`, type };
        break;
      }
      case 'BooleanLiteral': value = { code: String(expression.value), type: 'b' }; break;
      case 'FunctionCall': {
        if (expression.name === 'put' && !local.has('put')) {
          const formats: string[] = [];
          const args: string[] = [];
          for (const argument of expression.arguments) {
            const item = emitExpression(argument, local);
            formats.push(item.type.endsWith('[]') ? '{:?}' : '{}');
            args.push(item.type === 'nil' ? `{ ${item.code}; "null" }` : item.code);
          }
          value = { code: `println!(${quoteRustString(formats.join(' '))}${args.length ? `, ${args.join(', ')}` : ''})`, type: 'nil' };
          break;
        }
        const binding = lookup(expression.name, local);
        if (!binding.parameters) throw new TypeError(`"${expression.name}" is not a function`);
        if (binding.parameters.length !== expression.arguments.length) throw new TypeError(`Incorrect argument count for "${expression.name}"`);
        const args: string[] = [];
        for (let index = 0; index < expression.arguments.length; index++) args.push(emitExpression(expression.arguments[index], local, binding.parameters[index], true).code);
        value = { code: `${binding.name}(${args.join(', ')})`, type: binding.type };
        break;
      }
      case 'Identifier': {
        const binding = lookup(expression.name, local);
        if (binding.parameters) throw new TypeError('Function values are not supported by native Rust generation');
        const conversion = owned && binding.type === 't' ? binding.borrowedText ? '.to_string()' : '.clone()'
          : owned && binding.type.endsWith('[]') ? binding.arrayLength !== undefined ? '.to_vec()' : '.clone()' : '';
        value = { code: `${binding.name}${conversion}`, type: binding.type,
          borrowedText: !owned && binding.borrowedText, asciiText: binding.asciiText,
          arrayLength: owned ? undefined : binding.arrayLength, integerCast: binding.integerCast };
        break;
      }
      case 'MethodCall': {
        const receiver = emitExpression(expression.receiver, local);
        if (expression.name === 'sum') {
          if (receiver.type !== 'i[]' && receiver.type !== 'f[]') throw new TypeError('sum requires a numeric array');
          const type = receiver.type.slice(0, -2);
          value = { code: `${receiver.code}.iter().sum::<${rustType(type)}>()`, type };
        } else {
          if (receiver.type !== 't') throw new TypeError(`Text method "${expression.name}" requires text`);
          switch (expression.name) {
            case 'length': value = { code: `${receiver.code}${receiver.asciiText ? '.len()' : '.encode_utf16().count()'}`, type: 'i', integerCast: true }; break;
            case 'lowercase': value = { code: `${receiver.code}.to_lowercase()`, type: 't' }; break;
            case 'uppercase': value = { code: `${receiver.code}.to_uppercase()`, type: 't' }; break;
            default: throw new Error(`Unsupported method "${expression.name}"`);
          }
        }
        break;
      }
      case 'NumberLiteral': {
        const number = expression.value;
        const type = expected === 'f' || !Number.isInteger(number) || Object.is(number, -0) ? 'f' : 'i';
        if (type === 'i' && (number < -(2 ** 63) || number >= 2 ** 63)) throw new TypeError('Integer literal is outside the native Rust i64 range');
        const code = Number.isNaN(number) ? 'f64::NAN' : number === Infinity ? 'f64::INFINITY'
          : number === -Infinity ? 'f64::NEG_INFINITY' : Object.is(number, -0) ? '-0.0'
          : type === 'f' && Number.isInteger(number) ? `${number}.0` : String(number);
        value = { code, type };
        break;
      }
      case 'TextLiteral': value = { code: `${quoteRustString(expression.value)}${owned ? '.to_string()' : ''}`, type: 't',
        borrowedText: !owned, asciiText: /^[\x00-\x7f]*$/.test(expression.value) }; break;
      case 'Assignment':
      case 'FunctionDefinition': throw new TypeError('Declarations inside value expressions are not supported by native Rust generation');
    }
    return coerce(value, expected);
  }

  // Emits a regular function, or a local closure when it captures surrounding bindings.
  function emitFunction(expression: Extract<Expression, { type: 'FunctionDefinition' }>, local: Scope): string {
    if (local.get(expression.signature.name)?.parameters) throw new TypeError('Rebinding functions is not supported by native Rust generation');
    const captures = findCaptures(expression, local);
    for (const binding of captures) capturedBindings.add(binding);
    const body = expression.body.body;
    const last = body[body.length - 1];
    const resultType = !last || (last.type === 'FunctionCall' && last.name === 'put' && !local.has('put')) ? 'nil' : expression.signature.type;
    const binding: Binding = { name: rustName(expression.signature.name), type: resultType, parameters: [], closure: captures.size > 0 };
    const parameters: string[] = [];
    const inner = new Map(local);
    local.set(expression.signature.name, binding);
    inner.set(expression.signature.name, binding);
    for (const parameter of expression.parameters) {
      parameters.push(`${rustName(parameter.name)}: ${rustType(parameter.type)}`);
      binding.parameters!.push(parameter.type);
      inner.set(parameter.name, { name: rustName(parameter.name), type: parameter.type });
    }
    const contents = emitBlock(body, inner, resultType);
    const suffix = resultType === 'nil' ? '' : ` -> ${rustType(resultType)}`;
    if (body.length === 1 && !contents.includes('\n')) {
      return binding.closure ? `let ${binding.name} = |${parameters.join(', ')}|${suffix} { ${contents} };`
        : `fn ${binding.name}(${parameters.join(', ')})${suffix} { ${contents} }`;
    }
    if (binding.closure) return `let ${binding.name} = |${parameters.join(', ')}|${suffix} {\n${indentRust(contents)}\n};`;
    return `fn ${binding.name}(${parameters.join(', ')})${suffix} {\n${indentRust(contents)}\n}`;
  }

  // Emits a native declaration or standalone Rust expression.
  function emitStatement(expression: Expression, local: Scope): string {
    if (expression.type === 'FunctionDefinition') return emitFunction(expression, local);
    if (expression.type === 'Assignment') {
      const previous = local.get(expression.name);
      if (previous && capturedBindings.has(previous)) throw new TypeError(`Cannot rebind captured variable "${expression.name}" in native Rust`);
      const value = emitExpression(expression.value, local, expression.declaredType);
      const binding = { ...value, name: rustName(expression.name) };
      local.set(expression.name, binding);
      const annotation = value.arrayLength === 0 ? `: [${rustType(value.type.slice(0, -2))}; 0]` : '';
      return `let ${binding.name}${annotation} = ${value.code};`;
    }
    return `${emitExpression(expression, local).code};`;
  }

  // Finds references to surrounding variables or closures in a function body.
  function findCaptures(expression: Extract<Expression, { type: 'FunctionDefinition' }>, local: Scope): Set<Binding> {
    const captures = new Set<Binding>();
    const names = new Set([expression.signature.name]);
    for (const parameter of expression.parameters) names.add(parameter.name);

    // Traverses expressions while tracking parameters and locally declared names.
    function visit(item: Expression, bound: Set<string>): void {
      switch (item.type) {
        case 'Identifier':
        case 'FunctionCall': {
          const binding = local.get(item.name);
          if (!bound.has(item.name) && binding && (!binding.parameters || binding.closure)) captures.add(binding);
          if (item.type === 'FunctionCall') for (const argument of item.arguments) visit(argument, bound);
          break;
        }
        case 'Assignment': visit(item.value, bound); bound.add(item.name); break;
        case 'ArrayLiteral': for (const element of item.elements) visit(element, bound); break;
        case 'BinaryExpression': visit(item.left, bound); visit(item.right, bound); break;
        case 'MethodCall': visit(item.receiver, bound); break;
        case 'FunctionDefinition': {
          bound.add(item.signature.name);
          const nested = new Set(bound);
          for (const parameter of item.parameters) nested.add(parameter.name);
          for (const child of item.body.body) visit(child, nested);
          break;
        }
      }
    }

    for (const item of expression.body.body) visit(item, names);
    return captures;
  }

  // Resolves a declared binding or rejects an undefined name.
  function lookup(name: string, local: Scope): Binding {
    const binding = local.get(name);
    if (!binding) throw new ReferenceError(`Undefined identifier "${name}"`);
    return binding;
  }

  for (const expression of ast.body) {
    const code = emitStatement(expression, scope);
    if (expression.type === 'FunctionDefinition' && !scope.get(expression.signature.name)?.closure) functions.push(code);
    else statements.push(code);
  }
  return [...functions, `fn main() {\n${indentRust(statements.join('\n'))}\n}`, ''].join('\n\n');
}

// Indents every nonempty line of a Rust block by four spaces.
function indentRust(source: string): string {
  const lines: string[] = [];
  for (const line of source.split('\n')) if (line) lines.push(`    ${line}`);
  return lines.join('\n');
}

// Escapes a Rust string literal without interpreting LIM's literal contents.
function quoteRustString(value: string): string {
  let result = '"';
  for (const character of value) {
    switch (character) {
      case '"': result += '\\"'; break;
      case '\\': result += '\\\\'; break;
      case '\n': result += '\\n'; break;
      case '\r': result += '\\r'; break;
      case '\t': result += '\\t'; break;
      default: {
        const code = character.codePointAt(0)!;
        if (code >= 0xd800 && code <= 0xdfff) throw new Error('Rust strings cannot represent an unpaired UTF-16 surrogate');
        result += code < 32 || code === 127 ? `\\u{${code.toString(16)}}` : character;
      }
    }
  }
  return `${result}"`;
}

// Escapes Rust keywords while keeping ordinary LIM names unchanged.
function rustName(name: string): string {
  if (['self', 'Self', 'super', 'crate', 'main'].includes(name) || name.startsWith('__lim_')) return `__lim_${name}`;
  const keywords = new Set('as async await break const continue dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return static struct trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try gen'.split(' '));
  return keywords.has(name) ? `r#${name}` : name;
}

// Maps scalar and homogeneous array types to their native Rust representations.
function rustType(type: string): string {
  if (type.endsWith('[]')) return `Vec<${rustType(type.slice(0, -2))}>`;
  switch (type) {
    case 'b': return 'bool';
    case 'f': return 'f64';
    case 'i': return 'i64';
    case 'nil': return '()';
    case 't': return 'String';
    default: throw new TypeError(`Unsupported native Rust type "${type}"`);
  }
}
