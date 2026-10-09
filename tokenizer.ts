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

// Checks whether a token starts with a letter and
// contains only letters, digits, or underscores.
export function isIdentifier(token: string): boolean {
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
export function isPair(token: string): boolean {
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

// Reads whitespace-delimited tokens from a stream and returns recognized tokens.
export async function tokenizer(stream: ReadableStream<string>) {
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

  return tokens;
}

