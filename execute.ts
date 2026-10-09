import type { Expression } from './ast';

type RuntimeValue = boolean | number | string | null | RuntimeFunction;
type RuntimeFunction = (...args: RuntimeValue[]) => RuntimeValue;
type Environment = { bindings: Map<string, RuntimeValue>; parent?: Environment };

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
          throw new TypeError(
            `Invalid expression: ${formatExpression(expression)}\nOperator "${expression.operator}" requires numeric operands`,
          );
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

// Renders an entire expression, preserving nested arithmetic structure for error messages.
function formatExpression(expression: Expression): string {
  switch (expression.type) {
    case 'Assignment':
      return `${expression.name}${expression.declaredType ? `:${expression.declaredType}` : ''} <- ${formatExpression(expression.value)}`;
    case 'BinaryExpression': {
      const left = formatExpression(expression.left);
      const right = formatExpression(expression.right);
      return `${expression.left.type === 'BinaryExpression' ? `(${left})` : left} ${expression.operator} ${expression.right.type === 'BinaryExpression' ? `(${right})` : right}`;
    }
    case 'BooleanLiteral':
    case 'NumberLiteral': return String(expression.value);
    case 'TextLiteral': return JSON.stringify(expression.value);
    case 'Identifier': return expression.name;
    case 'FunctionCall':
      return [expression.name, ...expression.arguments.map(formatExpression)].join(' ');
    case 'FunctionDefinition':
      return `${expression.signature.name}:${expression.signature.type} ${expression.parameters.map(parameter => `${parameter.name}:${parameter.type}`).join(' ')} -> { ${expression.body.body.map(formatExpression).join(' ')} }`;
  }
}

