// Generated from LIM. Numbers use f64 to preserve the interpreter's arithmetic.
#![allow(dead_code, unused_must_use, unused_variables, unused_assignments)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

#[derive(Clone)]
enum Value {
    Array(Vec<Value>),
    Boolean(bool),
    Function(Rc<dyn Fn(Vec<Value>) -> Value>),
    Nil,
    Number(f64),
    Text(String),
}

type Scope = Rc<RefCell<Environment>>;

struct Environment {
    bindings: HashMap<String, Value>,
    parent: Option<Scope>,
}

// Stores a binding in the current scope and returns the assigned value.
fn assign(scope: &Scope, name: &str, value: Value) -> Value {
    scope.borrow_mut().bindings.insert(name.to_string(), value.clone());
    value
}

// Performs floating-point arithmetic, including division and exponentiation.
fn binary(operator: &str, left: Value, right: Value) -> Value {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => Value::Number(match operator {
            "+" => left + right,
            "-" => left - right,
            "*" => left * right,
            "/" => left / right,
            "^" => left.powf(right),
            _ => panic!("Unsupported operator {}", operator),
        }),
        _ => panic!("Operator {} requires numeric operands", operator),
    }
}

// Invokes a function after evaluating its arguments from left to right.
fn call(function: Value, arguments: Vec<Value>) -> Value {
    match function {
        Value::Function(function) => function(arguments),
        _ => panic!("Value is not a function"),
    }
}

// Formats values for put, quoting text when it occurs inside an array.
fn display(value: &Value, nested: bool) -> String {
    match value {
        Value::Array(values) => {
            let parts: Vec<String> = values.iter().map(|value| display(value, true)).collect();
            if parts.is_empty() { "[]".to_string() }
            else { format!("[ {} ]", parts.join(", ")) }
        }
        Value::Boolean(value) => value.to_string(),
        Value::Function(_) => "[Function]".to_string(),
        Value::Nil => "null".to_string(),
        Value::Number(value) if value.is_nan() => "NaN".to_string(),
        Value::Number(value) if *value == f64::INFINITY => "Infinity".to_string(),
        Value::Number(value) if *value == f64::NEG_INFINITY => "-Infinity".to_string(),
        Value::Number(value) => value.to_string(),
        Value::Text(value) if nested => format!("{:?}", value),
        Value::Text(value) => value.clone(),
    }
}

// Resolves the nearest lexical binding, including bindings added after a function definition.
fn lookup(scope: &Scope, name: &str) -> Value {
    let environment = scope.borrow();
    if let Some(value) = environment.bindings.get(name) { return value.clone(); }
    match &environment.parent {
        Some(parent) => lookup(parent, name),
        None => panic!("Undefined identifier {}", name),
    }
}

// Dispatches the built-in text and numeric array methods.
fn method(receiver: Value, name: &str) -> Value {
    match (name, receiver) {
        ("length", Value::Text(text)) => Value::Number(text.encode_utf16().count() as f64),
        ("lowercase", Value::Text(text)) => Value::Text(text.to_lowercase()),
        ("uppercase", Value::Text(text)) => Value::Text(text.to_uppercase()),
        ("sum", Value::Array(values)) => {
            let mut total = 0.0;
            for value in values {
                match value {
                    Value::Number(number) => total += number,
                    _ => panic!("Array method sum requires numeric elements"),
                }
            }
            Value::Number(total)
        }
        ("sum", _) => panic!("Array method sum requires a numeric array"),
        ("length" | "lowercase" | "uppercase", _) => panic!("Text method {} requires text", name),
        _ => panic!("Unknown method {}", name),
    }
}

// Creates a scope whose optional parent is shared with captured functions.
fn new_scope(parent: Option<Scope>) -> Scope {
    Rc::new(RefCell::new(Environment { bindings: HashMap::new(), parent }))
}

// Prints all arguments on one line and returns the empty value.
fn put(arguments: Vec<Value>) -> Value {
    let parts: Vec<String> = arguments.iter().map(|value| display(value, false)).collect();
    println!("{}", parts.join(" "));
    Value::Nil
}

fn main() {
let scope = new_scope(None);
assign(&scope, "put", Value::Function(Rc::new(put)));
    {
    let captured = Rc::clone(&scope);
    let function = Value::Function(Rc::new(move |args: Vec<Value>| {
    assert_eq!(args.len(), 2, "Incorrect argument count for {}", "sum");
    let scope = new_scope(Some(Rc::clone(&captured)));
    assign(&scope, "n1", args[0].clone());
    assign(&scope, "n2", args[1].clone());
    binary("+", lookup(&scope, "n1"), lookup(&scope, "n2"))
    }));
    assign(&scope, "sum", function)
    };
    {
    let captured = Rc::clone(&scope);
    let function = Value::Function(Rc::new(move |args: Vec<Value>| {
    assert_eq!(args.len(), 2, "Incorrect argument count for {}", "product");
    let scope = new_scope(Some(Rc::clone(&captured)));
    assign(&scope, "n1", args[0].clone());
    assign(&scope, "n2", args[1].clone());
    binary("*", lookup(&scope, "n1"), lookup(&scope, "n2"))
    }));
    assign(&scope, "product", function)
    };
    assign(&scope, "pi", Value::Number(3.14_f64));
    call(lookup(&scope, "put"), vec![call(lookup(&scope, "product"), vec![Value::Number(2_f64), lookup(&scope, "pi")])]);
    assign(&scope, "word", Value::Text("foo".to_string()));
    call(lookup(&scope, "put"), vec![method(lookup(&scope, "word"), "length")]);
    call(lookup(&scope, "put"), vec![method(lookup(&scope, "word"), "uppercase")]);
    assign(&scope, "numbers", Value::Array(vec![Value::Number(1_f64), Value::Number(2_f64), Value::Number(3_f64)]));
    call(lookup(&scope, "put"), vec![method(lookup(&scope, "numbers"), "sum")]);
}
