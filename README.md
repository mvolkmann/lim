# Less Is More (LIM) Parser

This project implements a parser for the LIM programming language.

Arrays use `[` and `]`, with elements separated by spaces or newlines rather
than commas. They can be empty, nested, or contain mixed value types,
references, arithmetic expressions, and function calls. Array variables can
use the type `a` or omit the type to infer it.

```lim
values:a <- [1 2 3]
put values
put ["hello" true [] [4 5]]
put [
  1
  2 + 3
]
```

Use `i[]`, `f[]`, or `t[]` to declare arrays of integers, numbers, or text.
Literal initializers are checked against the element type; `f[]` also accepts
integer elements. Empty literals are valid for all three array types.
Homogeneous literals infer their array type when the declaration omits it.
The zero-argument `.sum` method returns an integer for `i[]`, a float for
`f[]`, and zero for an empty numeric array.

```lim
counts:i[] <- [1 2 3]
measurements:f[] <- [1 2.5 3.5]
names:t[] <- ["Ada" "Grace"]
put counts.sum
put measurements.sum
put [4 5 6].sum
```

Each `put` statement ends at the end of its line and can print multiple values
on that line. Trailing comments also end at the line boundary.

Text values (`t`) support built-in `Text` instance methods using dot syntax.
These methods take no arguments: `length` returns an integer (the number of
UTF-16 code units), while `uppercase` and `lowercase` return text.

```lim
word:t <- "Hello"
put word.length
put word.uppercase
put word.lowercase
put "Hello".uppercase.lowercase
```

`generateRust` in `rust.ts` accepts the same program AST as `executeAST` and
returns a standalone Rust source string. Write it to a `.rs` file and compile
it with `rustc --edition=2021`. The generated program includes a small runtime
using Rust's standard library for lexical closures, mixed arrays, text methods,
and `put`. Numbers use `f64` to preserve the interpreter's arithmetic, including
fractional division. Arrays and functions use readable Rust-side print formatting.

```ts
import { buildAST } from './ast';
import { generateRust } from './rust';
import { tokenizer } from './tokenizer';

const stream = Bun.file('demo.lim').stream().pipeThrough(new TextDecoderStream());
const ast = buildAST(await tokenizer(stream));
await Bun.write('demo.rs', generateRust(ast));
```

Rust compilation tests run when `rustc` is available on `PATH`, through `RUSTC`,
or in a local rustup toolchain.
