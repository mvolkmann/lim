import { describe, expect, test } from 'bun:test';
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
  // Verifies keywords and both operator lengths with supported delimiters.
  test('recognizes keywords and operators separated by whitespace', async () => {
    expect(await tokenizer(createStream(['const +\n++\treturn <- ']))).toEqual([
      'const', '+', '++', 'return', '<-',
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
