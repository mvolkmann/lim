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

// Checks whether a token is a complete quoted text literal with optional escapes.
function isText(token: string): boolean {
  return /^"[^"\\]*(?:\\.[^"\\]*)*"$/.test(token);
}

// Checks whether the buffer is a supported lexical token.
function isToken(buffer: string): boolean {
  return (buffer.length == 1 && operators1.has(buffer)) ||
    (buffer.length == 2 && operators2.has(buffer)) ||
    keywords.has(buffer) ||
    isNumber(buffer) ||
    isText(buffer) ||
    isIdentifier(buffer) ||
    isTypedIdentifier(buffer);
}

// Checks whether a token contains two identifiers separated by a colon.
// The first is a name and the second is a type (e.g., "radius:f").
export function isTypedIdentifier(token: string): boolean {
  const parts = token.split(':');
  if (parts.length !== 2) return false;
  return isIdentifier(parts[0]) && isIdentifier(parts[1]);
}

// Reads whitespace-delimited tokens from a stream, ignoring # comments through end of line.
export async function tokenizer(stream: ReadableStream<string>) {
  let buffer = '';
  let inComment = false;
  let inText = false;
  let escaped = false;
  const tokens: string[] = [];

  // Validates and emits the buffered token before a delimiter or end of input.
  function flushToken(): void {
    if (buffer.length === 0) return;
    if (!isToken(buffer)) throw new Error(`invalid token "${buffer}"`);
    tokens.push(buffer);
    buffer = '';
  }

  for await (const chunk of stream) {
    for (const char of chunk) {
      if (inText) {
        buffer += char;
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inText = false;
        }
        continue;
      }
      if (inComment) {
        if (char === '\n' || char === '\r') inComment = false;
        continue;
      }
      if (char === '"' && buffer.length === 0) {
        buffer += char;
        inText = true;
      } else if (char === '#') {
        flushToken();
        inComment = true;
      } else if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
        flushToken();
      } else {
        buffer += char;
      }
    }
  }

  if (inText) throw new Error('Unterminated text literal');
  flushToken();

  return tokens;
}

