import { describe, expect, test } from 'bun:test';
import { buildAST } from './ast';
import { tokenizer } from './tokenizer';

// Creates a text stream from the supplied chunks.
function createStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    // Enqueues each chunk and closes the stream.
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

// Groups tests for tokenizing streamed input.
describe('tokenizer', () => {
  // Verifies array type suffixes stay distinguishable from literal brackets across chunks.
  test('tokenizes typed array declarations', async () => {
    expect(await tokenizer(createStream(['values:i[', '] <- [1 2]\nwords : t', '[] <- []']))).toEqual([
      'values:i', '[', ']', '<-', '[', '1', '2', ']', '\n', 'words', ':', 't', '[', ']', '<-', '[', ']',
    ]);
  });

  // Verifies brackets delimit tokens across chunks and commas remain invalid.
  test('tokenizes array delimiters', async () => {
    expect(await tokenizer(createStream(['[1 [', '2]\n"[text]"][]']))).toEqual([
      '[', '1', '[', '2', ']', '\n', '"[text]"', ']', '[', ']',
    ]);
    await expect(tokenizer(createStream(['[1, 2]']))).rejects.toThrow('invalid token');
  });

  // Verifies text initializers retain their quotes in tokens and become text AST nodes.
  test('tokenizes text variable declarations', async () => {
    const tokens = await tokenizer(createStream(['score:t <- "foo"']));
    expect(tokens).toEqual(['score:t', '<-', '"foo"']);
    expect(buildAST(tokens).body).toEqual([{
      type: 'Assignment', name: 'score', declaredType: 't',
      value: { type: 'TextLiteral', value: 'foo' },
    }]);
  });

  // Verifies spaces, comment markers, and escaped quotes stay inside text across chunks.
  test('preserves text contents across stream chunks', async () => {
    expect(await tokenizer(createStream([
      'score:t <- "hello # ', 'world"# comment\nput ""',
    ]))).toEqual(['score:t', '<-', '"hello # world"', '\n', 'put', '""']);
    expect(await tokenizer(createStream(['"a\\', '"b"']))).toEqual(['"a\\"b"']);
    expect(await tokenizer(createStream(['"a\\', '\\"']))).toEqual(['"a\\\\"']);
    await expect(tokenizer(createStream(['"unfinished']))).rejects.toThrow('Unterminated text literal');
    await expect(tokenizer(createStream(['"unfinished\\']))).rejects.toThrow('Unterminated text literal');
  });

  // Verifies full-line and trailing comments disappear from tokens and the AST.
  test('ignores end of line comments', async () => {
    const tokens = await tokenizer(createStream([
      '# full-line comment with invalid symbols @\nscore:i <- 3# trailing comment\n',
      '# final comment without a newline',
    ]));
    expect(tokens).toEqual(['score:i', '<-', '3', '\n']);
    expect(buildAST(tokens).body).toEqual([{
      type: 'Assignment', name: 'score', declaredType: 'i',
      value: { type: 'NumberLiteral', value: 3 },
    }]);
    expect(await tokenizer(createStream(['# comment only']))).toEqual([]);
  });

  // Verifies comment state survives stream chunks and resumes after line endings.
  test('ignores comments split across stream chunks', async () => {
    expect(await tokenizer(createStream([
      'score:i <- 3 # com', 'ment @', '\r', '\nput score#', ' another comment',
    ]))).toEqual(['score:i', '<-', '3', '\n', 'put', 'score']);
    expect(await tokenizer(createStream(['1# comment\r2']))).toEqual(['1', '\n', '2']);
    await expect(tokenizer(createStream(['@# comment']))).rejects.toThrow('invalid token "@"');
  });

  // Verifies typed declarations and a final token without trailing whitespace.
  test('tokenizes typed variable declarations', async () => {
    expect(await tokenizer(createStream(['score:', 'i <- ', '3']))).toEqual(['score:i', '<-', '3']);
    expect(await tokenizer(createStream(['score : i <- 3']))).toEqual(['score', ':', 'i', '<-', '3']);
    await expect(tokenizer(createStream(['@']))).rejects.toThrow('invalid token "@"');
  });

  // Verifies keywords and both operator lengths with supported delimiters.
  test('recognizes keywords and operators separated by whitespace', async () => {
    expect(await tokenizer(createStream(['const +\n++\treturn <- ']))).toEqual([
      'const', '+', '\n', '++', 'return', '<-',
    ]);
  });

  // Verifies that token buffers persist across stream chunks.
  test('recognizes tokens split across chunks', async () => {
    expect(await tokenizer(createStream(['ret', 'urn ', '<', '=\t']))).toEqual([
      'return', '<=',
    ]);
  });

  // Verifies that unsupported tokens reject tokenization.
  test('rejects an invalid token', async () => {
    await expect(tokenizer(createStream(['@ ']))).rejects.toThrow('invalid token "@"');
  });
});
