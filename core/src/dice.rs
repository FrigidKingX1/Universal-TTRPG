use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::fmt;

/// A parsed token produced by the lexer.
#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Int(i64),
    Dice { count: i64, sides: i64, keep: Option<Keep> },
    Ref(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum KeepMode {
    Highest,
    Lowest,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Keep {
    mode: KeepMode,
    n: i64,
}

/// Error type for dice expression parsing and evaluation.
#[derive(Debug)]
pub enum DiceError {
    Parse(String),
    Resolve(String),
}

impl fmt::Display for DiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DiceError::Parse(msg) => write!(f, "dice parse error: {msg}"),
            DiceError::Resolve(msg) => write!(f, "dice resolve error: {msg}"),
        }
    }
}

impl std::error::Error for DiceError {}

/// Result of evaluating a dice expression, with a human-readable breakdown.
#[derive(Debug, Clone, PartialEq)]
pub struct RollResult {
    pub total: i64,
    pub detail: String,
    /// Raw individual d20/dN rolls (pre-keep), for auditing.
    pub raw_rolls: Vec<i64>,
    /// Dice that actually counted after keep-highest/keep-lowest filtering —
    /// crit/fumble detection must inspect these, not `raw_rolls`.
    pub kept_rolls: Vec<i64>,
}

/// Maximum number of dice allowed in a single expression to prevent memory exhaustion.
const MAX_DICE_COUNT: i64 = 1000;

/// Deterministic dice engine. Seeded RNG makes rolls reproducible in tests.
#[derive(Debug)]
pub struct DiceEngine {
    rng: ChaCha8Rng,
    /// Scratch buffer collecting raw die rolls for the current evaluation.
    raw_rolls: Vec<i64>,
    /// Scratch buffer collecting post-keep die rolls.
    kept_rolls: Vec<i64>,
}

impl Default for DiceEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl DiceEngine {
    pub fn new() -> Self {
        Self { rng: ChaCha8Rng::from_entropy(), raw_rolls: Vec::new(), kept_rolls: Vec::new() }
    }

    pub fn with_seed(seed: u64) -> Self {
        Self { rng: ChaCha8Rng::seed_from_u64(seed), raw_rolls: Vec::new(), kept_rolls: Vec::new() }
    }

    /// Evaluate an expression containing no `@ref` references.
    pub fn evaluate(&mut self, expr: &str) -> Result<RollResult, DiceError> {
        self.evaluate_with(expr, &|_| None)
    }

    /// Evaluate an expression, resolving `@path` references via `resolve`.
    pub fn evaluate_with(
        &mut self,
        expr: &str,
        resolve: &dyn Fn(&str) -> Option<i64>,
    ) -> Result<RollResult, DiceError> {
        let tokens = lex(expr)?;
        let mut parser = Parser::new(tokens);
        let ast = parser.parse()?;
        let mut detail = String::new();
        self.raw_rolls.clear();
        self.kept_rolls.clear();
        let value = self.eval_node(&parser.tokens, &mut detail, &ast, resolve)?;
        detail.push_str(" = ");
        detail.push_str(&value.to_string());
        Ok(RollResult {
            total: value,
            detail,
            raw_rolls: std::mem::take(&mut self.raw_rolls),
            kept_rolls: std::mem::take(&mut self.kept_rolls),
        })
    }

    fn eval_node(
        &mut self,
        tokens: &[Tok],
        detail: &mut String,
        node: &Ast,
        resolve: &dyn Fn(&str) -> Option<i64>,
    ) -> Result<i64, DiceError> {
        match node {
            Ast::Lit(tok_pos) => match &tokens[*tok_pos] {
                Tok::Int(v) => {
                    detail.push_str(&v.to_string());
                    Ok(*v)
                }
                other => Err(DiceError::Parse(format!("expected literal, found {:?}", other))),
            },
            Ast::Ref(tok_pos) => {
                let path = match &tokens[*tok_pos] {
                    Tok::Ref(p) => p.clone(),
                    other => {
                        return Err(DiceError::Parse(format!(
                            "expected reference, found {:?}",
                            other
                        )))
                    }
                };
                match resolve(&path) {
                    Some(v) => {
                        detail.push('@');
                        detail.push_str(&path);
                        detail.push('[');
                        detail.push_str(&v.to_string());
                        detail.push(']');
                        Ok(v)
                    }
                    None => Err(DiceError::Resolve(format!("unresolved reference `@{path}`"))),
                }
            }
            Ast::Dice(tok_pos) => {
                let (count, sides, keep) = match &tokens[*tok_pos] {
                    Tok::Dice { count, sides, keep } => (*count, *sides, *keep),
                    other => {
                        return Err(DiceError::Parse(format!("expected dice, found {:?}", other)))
                    }
                };
                self.roll_die(count, sides, keep, detail)
            }
            Ast::BinOp { op_pos, left, right } => {
                let left_v = self.eval_node(tokens, detail, left, resolve)?;
                match &tokens[*op_pos] {
                    Tok::Plus | Tok::Minus | Tok::Star | Tok::Slash => {}
                    other => {
                        return Err(DiceError::Parse(format!(
                            "expected operator, found {:?}",
                            other
                        )))
                    }
                }
                detail.push(' ');
                detail.push_str(match &tokens[*op_pos] {
                    Tok::Plus => "+",
                    Tok::Minus => "-",
                    Tok::Star => "x",
                    Tok::Slash => "/",
                    _ => unreachable!(),
                });
                detail.push(' ');
                let right_v = self.eval_node(tokens, detail, right, resolve)?;
                match tokens[*op_pos] {
                    Tok::Plus => Ok(left_v + right_v),
                    Tok::Minus => Ok(left_v - right_v),
                    Tok::Star => Ok(left_v * right_v),
                    Tok::Slash => {
                        if right_v == 0 {
                            Err(DiceError::Parse("division by zero".to_string()))
                        } else {
                            Ok(left_v / right_v)
                        }
                    }
                    _ => unreachable!(),
                }
            }
            Ast::Neg { inner } => {
                detail.push('-');
                Ok(-self.eval_node(tokens, detail, inner, resolve)?)
            }
        }
    }

    fn roll_die(
        &mut self,
        count: i64,
        sides: i64,
        keep: Option<Keep>,
        detail: &mut String,
    ) -> Result<i64, DiceError> {
        if count < 0 || sides <= 0 {
            return Err(DiceError::Parse(format!("invalid dice: {count}d{sides}")));
        }
        if count > MAX_DICE_COUNT {
            return Err(DiceError::Parse(format!("too many dice: {count} (max {MAX_DICE_COUNT})")));
        }
        let mut rolls: Vec<i64> = (0..count).map(|_| self.rng.gen_range(1..=sides)).collect();
        self.raw_rolls.extend_from_slice(&rolls);

        detail.push_str(&format!("{count}d{sides}"));
        if let Some(k) = keep {
            rolls.sort_unstable();
            let take: Vec<i64> = match k.mode {
                KeepMode::Highest => rolls.iter().rev().take(k.n as usize).cloned().collect(),
                KeepMode::Lowest => rolls.iter().take(k.n as usize).cloned().collect(),
            };
            // Kept dice only — crit/fumble detection must not fire on dice
            // that advantage/disadvantage discarded.
            self.kept_rolls.extend_from_slice(&take);
            let total: i64 = take.iter().sum();
            detail.push_str(&format!(
                "{}[{}]",
                if k.mode == KeepMode::Highest { "kh" } else { "kl" },
                take.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(", ")
            ));
            Ok(total)
        } else {
            self.kept_rolls.extend_from_slice(&rolls);
            let total: i64 = rolls.iter().sum();
            detail.push('[');
            detail.push_str(&rolls.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(", "));
            detail.push(']');
            Ok(total)
        }
    }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

fn lex(input: &str) -> Result<Vec<Tok>, DiceError> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    let n = chars.len();

    while i < n {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        match c {
            '+' => {
                tokens.push(Tok::Plus);
                i += 1;
            }
            '-' => {
                tokens.push(Tok::Minus);
                i += 1;
            }
            '*' => {
                tokens.push(Tok::Star);
                i += 1;
            }
            '/' => {
                tokens.push(Tok::Slash);
                i += 1;
            }
            '(' => {
                tokens.push(Tok::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(Tok::RParen);
                i += 1;
            }
            '@' => {
                i += 1;
                let start = i;
                while i < n && is_ref_char(chars[i]) {
                    i += 1;
                }
                if i == start {
                    return Err(DiceError::Parse("empty `@` reference".to_string()));
                }
                tokens.push(Tok::Ref(chars[start..i].iter().collect()));
            }
            'd' | 'D' => {
                // Bare die like `d20`.
                i += 1;
                let (sides, next) = parse_int(&chars, i)?;
                i = next;
                let (keep, next) = parse_keep(&chars, i)?;
                i = next;
                tokens.push(Tok::Dice { count: 1, sides, keep });
            }
            c if c.is_ascii_digit() => {
                let (int, next) = parse_int(&chars, i)?;
                i = next;
                // Dice only when 'd' immediately follows the integer.
                if i < n && (chars[i] == 'd' || chars[i] == 'D') {
                    i += 1;
                    let (sides, next) = parse_int(&chars, i)?;
                    i = next;
                    let (keep, next) = parse_keep(&chars, i)?;
                    i = next;
                    tokens.push(Tok::Dice { count: int, sides, keep });
                } else {
                    tokens.push(Tok::Int(int));
                }
            }
            other => {
                return Err(DiceError::Parse(format!(
                    "unexpected character `{other}` in `{input}`"
                )))
            }
        }
    }
    Ok(tokens)
}

fn is_ref_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-'
}

fn parse_int(chars: &[char], start: usize) -> Result<(i64, usize), DiceError> {
    let mut i = start;
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == start {
        return Err(DiceError::Parse("expected integer".to_string()));
    }
    let s: String = chars[start..i].iter().collect();
    s.parse::<i64>()
        .map(|v| (v, i))
        .map_err(|_| DiceError::Parse(format!("integer overflow in `{s}`")))
}

/// Parse an optional `kh<n>` / `kl<n>` keep suffix.
fn parse_keep(chars: &[char], start: usize) -> Result<(Option<Keep>, usize), DiceError> {
    let mut i = start;
    if i + 1 < chars.len() && chars[i] == 'k' && (chars[i + 1] == 'h' || chars[i + 1] == 'l') {
        let mode = if chars[i + 1] == 'h' { KeepMode::Highest } else { KeepMode::Lowest };
        i += 2;
        let (n, next) = parse_int(chars, i)?;
        if n <= 0 {
            return Err(DiceError::Parse("keep count must be positive".to_string()));
        }
        i = next;
        return Ok((Some(Keep { mode, n }), i));
    }
    Ok((None, i))
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Ast {
    /// Index into the token slice.
    Lit(usize),
    Ref(usize),
    Dice(usize),
    BinOp {
        op_pos: usize,
        left: Box<Ast>,
        right: Box<Ast>,
    },
    Neg {
        inner: Box<Ast>,
    },
}

struct Parser {
    tokens: Vec<Tok>,
    pos: usize,
}

impl Parser {
    fn new(tokens: Vec<Tok>) -> Self {
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.pos)
    }

    fn is_at_end(&self) -> bool {
        self.pos >= self.tokens.len()
    }

    fn advance(&mut self) -> Option<Tok> {
        let t = self.tokens.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    /// Parses the full expression, returning the AST root.
    fn parse(&mut self) -> Result<Ast, DiceError> {
        let root = self.expr()?;
        if !self.is_at_end() {
            return Err(DiceError::Parse(format!(
                "unexpected trailing token(s) after {:?}",
                self.peek()
            )));
        }
        Ok(root)
    }

    fn expr(&mut self) -> Result<Ast, DiceError> {
        let mut left = self.term()?;
        while matches!(self.peek(), Some(Tok::Plus) | Some(Tok::Minus)) {
            let op_pos = self.pos;
            self.advance();
            let right = self.term()?;
            left = Ast::BinOp { op_pos, left: Box::new(left), right: Box::new(right) };
        }
        Ok(left)
    }

    fn term(&mut self) -> Result<Ast, DiceError> {
        let mut left = self.unary()?;
        while matches!(self.peek(), Some(Tok::Star) | Some(Tok::Slash)) {
            let op_pos = self.pos;
            self.advance();
            let right = self.unary()?;
            left = Ast::BinOp { op_pos, left: Box::new(left), right: Box::new(right) };
        }
        Ok(left)
    }

    fn unary(&mut self) -> Result<Ast, DiceError> {
        if matches!(self.peek(), Some(Tok::Minus)) {
            self.advance();
            let inner = self.unary()?;
            return Ok(Ast::Neg { inner: Box::new(inner) });
        }
        self.primary()
    }

    fn primary(&mut self) -> Result<Ast, DiceError> {
        match self.advance() {
            Some(Tok::Int(_)) => Ok(Ast::Lit(self.pos - 1)),
            Some(Tok::Dice { .. }) => Ok(Ast::Dice(self.pos - 1)),
            Some(Tok::Ref(_)) => Ok(Ast::Ref(self.pos - 1)),
            Some(Tok::LParen) => {
                let inner = self.expr()?;
                match self.advance() {
                    Some(Tok::RParen) => Ok(inner),
                    _ => Err(DiceError::Parse("expected `)`".to_string())),
                }
            }
            other => Err(DiceError::Parse(format!("unexpected token {:?}", other))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_integer_expression() {
        let mut d = DiceEngine::with_seed(1);
        let r = d.evaluate("2 + 3 * 4").unwrap();
        assert_eq!(r.total, 14);
    }

    #[test]
    fn parens_and_unary() {
        let mut d = DiceEngine::with_seed(1);
        assert_eq!(d.evaluate("(2 + 3) * 4").unwrap().total, 20);
        assert_eq!(d.evaluate("-5 + 2").unwrap().total, -3);
    }

    #[test]
    fn single_die_range() {
        let mut d = DiceEngine::with_seed(42);
        for _ in 0..100 {
            let r = d.evaluate("1d6").unwrap();
            assert!((1..=6).contains(&r.total));
        }
    }

    #[test]
    fn sum_of_dice() {
        let mut d = DiceEngine::with_seed(7);
        for _ in 0..100 {
            let r = d.evaluate("2d4").unwrap();
            assert!((2..=8).contains(&r.total));
        }
    }

    #[test]
    fn advantage_keep_highest() {
        let mut d = DiceEngine::with_seed(9);
        for _ in 0..200 {
            let r = d.evaluate("2d20kh1").unwrap();
            assert!((1..=20).contains(&r.total));
        }
        // With seeded RNG, verify determinism.
        let mut d1 = DiceEngine::with_seed(99);
        let mut d2 = DiceEngine::with_seed(99);
        assert_eq!(d1.evaluate("2d20kh1").unwrap(), d2.evaluate("2d20kh1").unwrap());
    }

    #[test]
    fn drop_lowest_keeps_three_of_four() {
        let mut d = DiceEngine::with_seed(5);
        for _ in 0..100 {
            let r = d.evaluate("4d6kl3").unwrap();
            assert!((3..=18).contains(&r.total));
        }
    }

    #[test]
    fn refs_resolve() {
        let mut d = DiceEngine::with_seed(1);
        let r = d
            .evaluate_with("1d20 + @attributes.STR.derived_modifier", &|path| match path {
                "attributes.STR.derived_modifier" => Some(3),
                _ => None,
            })
            .unwrap();
        assert!((4..=23).contains(&r.total));
    }

    #[test]
    fn unresolved_ref_errors() {
        let mut d = DiceEngine::with_seed(1);
        let err = d.evaluate("@missing").unwrap_err();
        assert!(matches!(err, DiceError::Resolve(_)));
    }

    #[test]
    fn malformed_expression_errors() {
        let mut d = DiceEngine::with_seed(1);
        assert!(matches!(d.evaluate("1d20 +"), Err(DiceError::Parse(_))));
        assert!(matches!(d.evaluate("(1 + 2"), Err(DiceError::Parse(_))));
        assert!(matches!(d.evaluate("x"), Err(DiceError::Parse(_))));
    }

    #[test]
    fn division_by_zero_errors() {
        let mut d = DiceEngine::with_seed(1);
        let err = d.evaluate("10 / 0").unwrap_err();
        assert!(matches!(err, DiceError::Parse(ref msg) if msg.contains("division by zero")));
    }

    #[test]
    fn dice_count_cap() {
        let mut d = DiceEngine::with_seed(1);
        let err = d.evaluate("2000d6").unwrap_err();
        assert!(matches!(err, DiceError::Parse(ref msg) if msg.contains("too many dice")));
    }

    #[test]
    fn zero_dice_is_valid() {
        let mut d = DiceEngine::with_seed(1);
        let r = d.evaluate("0d6 + 5").unwrap();
        assert_eq!(r.total, 5);
    }

    #[test]
    fn loot_formula_quantity_rolls() {
        let mut d = DiceEngine::with_seed(42);
        let r = d.evaluate("2d4").unwrap();
        assert!(r.total >= 2 && r.total <= 8);
    }

    #[test]
    fn loot_single_item_quantity() {
        let mut d = DiceEngine::with_seed(1);
        let r = d.evaluate("1").unwrap();
        assert_eq!(r.total, 1);
    }
}
