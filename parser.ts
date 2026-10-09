const keywords = new Set([
  'class',
  'const',
  'else',
  'for',
  'if',
  'let',
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

/**
 * Builds an abstract syntax tree (AST) from the provided tokens.
 * @param tokens array of strings
 * @returns AST
 */
function buildAST(tokens: string[]): any {
  // boolean ::= 'true' | 'false'
  // number ::= integer | float
  // integer ::= '-'? digit+
  // float ::= '-'? digit+ '.' digit+
  // digit ::= '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  // text ::= '"' character* '"'
  // identifier ::= letter (letter | digit | '_')*
  // pair ::= identifier ':' type
  // parameter ::= pair
  // expression ::= assign | fncall | fndef
  // assign ::= identifier '<-' expression
  // fncall ::= identifier argument*
  // fndef ::= pair parameter* '->' block
  // block ::= '{' expression* '}'
  return { ast: 'This is a placeholder AST', tokens };
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

function isToken(buffer: string): boolean {
  if (buffer.length == 1 && operators1.has(buffer)) return true;
  if (buffer.length == 2 && operators2.has(buffer)) return true;
  return keywords.has(buffer) ||
    isNumber(buffer) ||
    isIdentifier(buffer) ||
    isPair(buffer);
}

async function main(): Promise<void> {
  const filePath = Bun.argv[2];
  if (!filePath) {
    console.error('Usage: bun run parser.ts <file-path>');
    process.exitCode = 1;
    return;
  }

  try {
    const stream = Bun.file(filePath).stream().pipeThrough(new TextDecoderStream());
    parse(stream);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Reads whitespace-delimited tokens from a stream and logs recognized tokens.
async function parse(stream: ReadableStream<string>) {
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
}

if (import.meta.main) main();
