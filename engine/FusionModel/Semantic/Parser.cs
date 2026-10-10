using System.Globalization;
using System.Text;

namespace FusionModel.Semantic
{
    /// <summary>A syntax or binding error with the position in the expression.</summary>
    public sealed class MeasureException : Exception
    {
        public int Position { get; }
        public MeasureException(string message, int position = -1) : base(position >= 0 ? message + " (at " + (position + 1) + ")" : message) { Position = position; }
    }

    // ── syntax tree ───────────────────────────────────────────────────
    public abstract class Node { public int Pos; }
    public sealed class NumberNode : Node { public double Value; }
    public sealed class StringNode : Node { public string Value; }
    public sealed class BoolNode : Node { public bool Value; }
    /// <summary>Table[Column] or 'Table'[Column].</summary>
    public sealed class ColumnNode : Node { public string Table; public string Column; }
    /// <summary>[Name] alone: a measure, or a column of the table being iterated.</summary>
    public sealed class BracketNode : Node { public string Name; }
    /// <summary>A table name used as a table (Sales, 'gl.lines').</summary>
    public sealed class TableNode : Node { public string Name; }
    public sealed class CallNode : Node { public string Name; public List<Node> Args = new(); }
    public sealed class BinaryNode : Node { public string Op; public Node Left, Right; }
    public sealed class UnaryNode : Node { public string Op; public Node Operand; }
    public sealed class ListNode : Node { public List<Node> Items = new(); }            // { 1, 2, 3 }
    public sealed class VarNode : Node { public string Name; }
    public sealed class VarBlockNode : Node { public List<(string Name, Node Expr)> Vars = new(); public Node Return; }
    /// <summary>Keywords used as arguments (DESC, ASC, YEAR, MONTH …).</summary>
    public sealed class KeywordNode : Node { public string Word; }

    internal enum T { Num, Str, Ident, Quoted, Bracket, Op, LParen, RParen, LBrace, RBrace, Comma, End }

    internal readonly struct Tok
    {
        public readonly T Kind; public readonly string Text; public readonly int Pos;
        public Tok(T k, string t, int p) { Kind = k; Text = t; Pos = p; }
        public override string ToString() => Kind + ":" + Text;
    }

    /// <summary>
    /// Parser for the DAX-compatible measure language. Precedence (low → high): || · && · comparisons and IN · & ·
    /// + − · × ÷ · ^ · unary − / NOT. Comments: //, --, /* */.
    /// </summary>
    public sealed class Parser
    {
        private readonly List<Tok> _t;
        private int _i;
        private readonly HashSet<string> _vars = new(StringComparer.OrdinalIgnoreCase);

        private static readonly HashSet<string> Keywords = new(StringComparer.OrdinalIgnoreCase)
        { "DESC", "ASC", "YEAR", "QUARTER", "MONTH", "DAY", "SKIP", "DENSE", "BOTH", "ONEWAY", "NONE" };

        private Parser(string text) { _t = Lex(text); }

        public static Node Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) throw new MeasureException("The expression is empty.");
            var p = new Parser(text);
            var n = p.Expr();
            if (p.Peek.Kind != T.End) throw new MeasureException("Unexpected '" + p.Peek.Text + "'", p.Peek.Pos);
            return n;
        }

        private Tok Peek => _t[_i];
        private Tok Next() => _t[_i++];
        private bool IsOp(string op) => Peek.Kind == T.Op && Peek.Text == op;
        private bool IsWord(string w) => Peek.Kind == T.Ident && string.Equals(Peek.Text, w, StringComparison.OrdinalIgnoreCase);

        private Tok Expect(T kind, string what)
        {
            if (Peek.Kind != kind) throw new MeasureException("Expected " + what + (Peek.Kind == T.End ? " but the expression ended" : " but found '" + Peek.Text + "'"), Peek.Pos);
            return Next();
        }

        private Node Expr()
        {
            if (IsWord("VAR")) return VarBlock();
            return Or();
        }

        private Node VarBlock()
        {
            var block = new VarBlockNode { Pos = Peek.Pos };
            while (IsWord("VAR"))
            {
                Next();
                var name = Expect(T.Ident, "a variable name");
                if (!(Peek.Kind == T.Op && Peek.Text == "=")) throw new MeasureException("Expected '=' after VAR " + name.Text, Peek.Pos);
                Next();
                var e = Expr();
                _vars.Add(name.Text);
                block.Vars.Add((name.Text, e));
            }
            if (!IsWord("RETURN")) throw new MeasureException("Expected RETURN", Peek.Pos);
            Next();
            block.Return = Expr();
            return block;
        }

        private Node Or()
        {
            var l = And();
            while (IsOp("||")) { var op = Next(); l = new BinaryNode { Op = "||", Left = l, Right = And(), Pos = op.Pos }; }
            return l;
        }

        private Node And()
        {
            var l = Not();
            while (IsOp("&&")) { var op = Next(); l = new BinaryNode { Op = "&&", Left = l, Right = Not(), Pos = op.Pos }; }
            return l;
        }

        /// <summary>NOT binds looser than comparisons: NOT T[c] IN {…} = NOT (T[c] IN {…}). NOT(…) with parentheses is the function.</summary>
        private Node Not()
        {
            if (IsWord("NOT") && !(_i + 1 < _t.Count && _t[_i + 1].Kind == T.LParen) &&
                !(_i + 1 < _t.Count && _t[_i + 1].Kind == T.Ident && string.Equals(_t[_i + 1].Text, "IN", StringComparison.OrdinalIgnoreCase)))
            {
                var op = Next();
                return new UnaryNode { Op = "NOT", Operand = Not(), Pos = op.Pos };
            }
            return Compare();
        }

        private static readonly string[] CompareOps = { "=", "==", "<>", "<", ">", "<=", ">=" };

        private Node Compare()
        {
            var l = Concat();
            while (true)
            {
                if (Peek.Kind == T.Op && CompareOps.Contains(Peek.Text)) { var op = Next(); l = new BinaryNode { Op = op.Text == "==" ? "=" : op.Text, Left = l, Right = Concat(), Pos = op.Pos }; }
                else if (IsWord("IN")) { var op = Next(); l = new BinaryNode { Op = "IN", Left = l, Right = Concat(), Pos = op.Pos }; }
                else if (IsWord("NOT") && _i + 1 < _t.Count && _t[_i + 1].Kind == T.Ident && string.Equals(_t[_i + 1].Text, "IN", StringComparison.OrdinalIgnoreCase))
                {
                    var op = Next(); Next();
                    l = new UnaryNode { Op = "NOT", Operand = new BinaryNode { Op = "IN", Left = l, Right = Concat(), Pos = op.Pos }, Pos = op.Pos };
                }
                else return l;
            }
        }

        private Node Concat()
        {
            var l = Additive();
            while (IsOp("&")) { var op = Next(); l = new BinaryNode { Op = "&", Left = l, Right = Additive(), Pos = op.Pos }; }
            return l;
        }

        private Node Additive()
        {
            var l = Multiplicative();
            while (IsOp("+") || IsOp("-")) { var op = Next(); l = new BinaryNode { Op = op.Text, Left = l, Right = Multiplicative(), Pos = op.Pos }; }
            return l;
        }

        private Node Multiplicative()
        {
            var l = Power();
            while (IsOp("*") || IsOp("/")) { var op = Next(); l = new BinaryNode { Op = op.Text, Left = l, Right = Power(), Pos = op.Pos }; }
            return l;
        }

        private Node Power()
        {
            var l = Unary();
            while (IsOp("^")) { var op = Next(); l = new BinaryNode { Op = "^", Left = l, Right = Unary(), Pos = op.Pos }; }
            return l;
        }

        private Node Unary()
        {
            if (IsOp("-")) { var op = Next(); return new UnaryNode { Op = "-", Operand = Unary(), Pos = op.Pos }; }
            if (IsOp("+")) { Next(); return Unary(); }
            return Primary();
        }

        private Node Primary()
        {
            var tok = Peek;
            switch (tok.Kind)
            {
                case T.Num:
                    Next();
                    return new NumberNode { Value = double.Parse(tok.Text, CultureInfo.InvariantCulture), Pos = tok.Pos };
                case T.Str:
                    Next();
                    return new StringNode { Value = tok.Text, Pos = tok.Pos };
                case T.LParen:
                    {
                        Next();
                        var e = Expr();
                        Expect(T.RParen, "')'");
                        return e;
                    }
                case T.LBrace:
                    {
                        Next();
                        var list = new ListNode { Pos = tok.Pos };
                        if (Peek.Kind != T.RBrace)
                            do { list.Items.Add(Expr()); } while (Peek.Kind == T.Comma && Next().Kind == T.Comma);
                        Expect(T.RBrace, "'}'");
                        return list;
                    }
                case T.Bracket:
                    Next();
                    return new BracketNode { Name = tok.Text, Pos = tok.Pos };
                case T.Quoted:
                    Next();
                    if (Peek.Kind == T.Bracket) { var c = Next(); return new ColumnNode { Table = tok.Text, Column = c.Text, Pos = tok.Pos }; }
                    return new TableNode { Name = tok.Text, Pos = tok.Pos };
                case T.Ident:
                    {
                        Next();
                        if (Peek.Kind == T.LParen)
                        {
                            Next();
                            var call = new CallNode { Name = tok.Text.ToUpperInvariant(), Pos = tok.Pos };
                            if (Peek.Kind != T.RParen)
                            {
                                while (true)
                                {
                                    // empty arguments are allowed (RANKX(t, e, , DESC))
                                    if (Peek.Kind == T.Comma) { call.Args.Add(null); Next(); continue; }
                                    call.Args.Add(Expr());
                                    if (Peek.Kind == T.Comma) { Next(); if (Peek.Kind == T.RParen) { call.Args.Add(null); break; } continue; }
                                    break;
                                }
                            }
                            Expect(T.RParen, "')' to close " + call.Name + "(");
                            return call;
                        }
                        if (Peek.Kind == T.Bracket) { var c = Next(); return new ColumnNode { Table = tok.Text, Column = c.Text, Pos = tok.Pos }; }
                        string up = tok.Text.ToUpperInvariant();
                        if (up == "TRUE" || up == "FALSE") return new BoolNode { Value = up == "TRUE", Pos = tok.Pos };
                        if (up == "BLANK") return new CallNode { Name = "BLANK", Pos = tok.Pos };
                        if (_vars.Contains(tok.Text)) return new VarNode { Name = tok.Text, Pos = tok.Pos };
                        if (Keywords.Contains(tok.Text)) return new KeywordNode { Word = up, Pos = tok.Pos };
                        return new TableNode { Name = tok.Text, Pos = tok.Pos };
                    }
                default:
                    throw new MeasureException(tok.Kind == T.End ? "The expression ended too early" : "Unexpected '" + tok.Text + "'", tok.Pos);
            }
        }

        // ── lexer ─────────────────────────────────────────────────────
        private static List<Tok> Lex(string s)
        {
            var list = new List<Tok>();
            int i = 0;
            while (i < s.Length)
            {
                char c = s[i];
                if (char.IsWhiteSpace(c)) { i++; continue; }
                if (c == '/' && i + 1 < s.Length && s[i + 1] == '/' || c == '-' && i + 1 < s.Length && s[i + 1] == '-')
                { while (i < s.Length && s[i] != '\n') i++; continue; }
                if (c == '/' && i + 1 < s.Length && s[i + 1] == '*')
                {
                    int end = s.IndexOf("*/", i + 2, StringComparison.Ordinal);
                    if (end < 0) throw new MeasureException("Unclosed /* comment", i);
                    i = end + 2; continue;
                }
                int start = i;
                if (char.IsDigit(c) || c == '.' && i + 1 < s.Length && char.IsDigit(s[i + 1]))
                {
                    while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.')) i++;
                    if (i < s.Length && (s[i] == 'e' || s[i] == 'E')) { i++; if (i < s.Length && (s[i] == '+' || s[i] == '-')) i++; while (i < s.Length && char.IsDigit(s[i])) i++; }
                    list.Add(new Tok(T.Num, s.Substring(start, i - start), start));
                    continue;
                }
                if (c == '"' || c == '\'' || c == '[')
                {
                    char close = c == '[' ? ']' : c;
                    var sb = new StringBuilder();
                    i++;
                    while (true)
                    {
                        if (i >= s.Length) throw new MeasureException("Unclosed " + (c == '"' ? "string" : c == '\'' ? "table name" : "[name]"), start);
                        if (s[i] == close)
                        {
                            if (i + 1 < s.Length && s[i + 1] == close) { sb.Append(close); i += 2; continue; }
                            i++; break;
                        }
                        sb.Append(s[i++]);
                    }
                    list.Add(new Tok(c == '"' ? T.Str : c == '\'' ? T.Quoted : T.Bracket, sb.ToString(), start));
                    continue;
                }
                if (char.IsLetter(c) || c == '_')
                {
                    while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_' || s[i] == '.')) i++;
                    list.Add(new Tok(T.Ident, s.Substring(start, i - start), start));
                    continue;
                }
                string two = i + 1 < s.Length ? s.Substring(i, 2) : null;
                if (two is "&&" or "||" or "<=" or ">=" or "<>" or "==") { list.Add(new Tok(T.Op, two, i)); i += 2; continue; }
                switch (c)
                {
                    case '(': list.Add(new Tok(T.LParen, "(", i)); break;
                    case ')': list.Add(new Tok(T.RParen, ")", i)); break;
                    case '{': list.Add(new Tok(T.LBrace, "{", i)); break;
                    case '}': list.Add(new Tok(T.RBrace, "}", i)); break;
                    case ',': list.Add(new Tok(T.Comma, ",", i)); break;
                    case '+': case '-': case '*': case '/': case '^': case '&': case '=': case '<': case '>':
                        list.Add(new Tok(T.Op, c.ToString(), i)); break;
                    default: throw new MeasureException("Unexpected character '" + c + "'", i);
                }
                i++;
            }
            list.Add(new Tok(T.End, "", s.Length));
            return list;
        }
    }
}
