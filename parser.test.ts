import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { parse } from './parser';

// Creates a text stream from the supplied chunks.
function createStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    // Enqueues each chunk and closes the stream.
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

// Groups tests for parsing streamed tokens.
describe('parse', () => {
  const log = spyOn(console, 'log').mockImplementation(
    // Suppresses token output during tests.
    () => {},
  );

  // Restores console output after the suite finishes.
  afterAll(() => {
    log.mockRestore();
  });

  // Clears recorded output between tests.
  afterEach(() => {
    log.mockClear();
  });

  // Verifies keywords and both operator lengths with supported delimiters.
  test('recognizes keywords and operators separated by whitespace', async () => {
    await parse(createStream(['const +\n++\treturn <- ']));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('parser.ts: tokens =', [
      'const', '+', '++', 'return', '<-',
    ]);
  });

  // Verifies that token buffers persist across stream chunks.
  test('recognizes tokens split across chunks', async () => {
    await parse(createStream(['ret', 'urn ', '<', '=\t']));

    expect(log).toHaveBeenCalledWith('parser.ts: tokens =', ['return', '<=']);
  });

  // Verifies that unsupported tokens reject parsing without logging results.
  test('rejects an invalid token', async () => {
    await expect(parse(createStream(['unknown ']))).rejects.toThrow(
      'invalid token unknown',
    );

    expect(log).not.toHaveBeenCalled();
  });
});
