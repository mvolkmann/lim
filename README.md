# Less Is More (LIM) Parser

This project implements a parser for the LIM programming language.

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
