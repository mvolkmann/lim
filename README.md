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
it with `rustc --edition=2021`. Output uses native Rust functions, variables,
array literals, and `println!`, with no embedded runtime. Local variables use
Rust's type inference and text literals stay borrowed. Single-expression
functions stay on one line. Function signatures use `i64`, `f64`, `bool`,
`String`, and `Vec<T>`, with conversions only where needed for ownership or types.
Division uses floating-point arithmetic. ASCII text length becomes `.len()`;
other text counts UTF-16 code units. Functions that capture variables become closures.

Rust generation requires homogeneous arrays and concrete types for empty arrays.
It rejects mixed arrays, function values, and rebinding captured variables.
Native integer arithmetic and Rust's print formatting apply to generated code.

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
