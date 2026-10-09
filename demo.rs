fn sum(n1: i64, n2: i64) -> i64 { n1 + n2 }

fn product(n1: f64, n2: f64) -> f64 { n1 * n2 }

fn main() {
    let pi = 3.14;
    println!("{}", product(2.0, pi));
    let word = "foo";
    println!("{}", word.len());
    println!("{}", word.to_uppercase());
    let numbers = [1, 2, 3];
    println!("{}", numbers.iter().sum::<i64>());
}

