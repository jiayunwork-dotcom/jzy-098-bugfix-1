import type { CharRange } from '../../../shared/types';
import { RegexError } from './errors';

/** 抽象语法树。每个节点带源码位置，Thompson 构造时用于高亮对应正则片段 */

export interface Span {
  start: number;
  end: number;
}

interface BaseNode {
  span: Span;
}

export interface CharNode extends BaseNode {
  kind: 'char';
  code: number;
}

export interface ClassNode extends BaseNode {
  kind: 'class';
  ranges: CharRange[];
  negated: boolean;
  /** 便于说明文字展示，例如 [a-z] / [^"] */
  preview: string;
}

export interface ConcatNode extends BaseNode {
  kind: 'concat';
  children: ASTNode[];
}

export interface AltNode extends BaseNode {
  kind: 'alt';
  children: ASTNode[];
}

export interface UnaryNode extends BaseNode {
  kind: 'star' | 'plus' | 'opt';
  child: ASTNode;
}

export type ASTNode =
  | CharNode
  | ClassNode
  | ConcatNode
  | AltNode
  | UnaryNode;

/* ---------------- 字符集合辅助 ---------------- */

const SHORTHANDS: Record<string, CharRange[] | undefined> = {
  d: [{ lo: 48, hi: 57 }], // 0-9
  w: [
    { lo: 48, hi: 57 },
    { lo: 65, hi: 90 },
    { lo: 97, hi: 122 },
    { lo: 95, hi: 95 }, // _
  ],
  s: [
    { lo: 9, hi: 10 },
    { lo: 12, hi: 13 },
    { lo: 32, hi: 32 },
  ],
};

const SIMPLE_ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  0: 0,
  f: 12,
  v: 11,
};

/** 合并相交/相邻的码点区间，输出有序、互不相交的区间表 */
export function normalizeRanges(ranges: CharRange[]): CharRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out: CharRange[] = [{ ...sorted[0] }];
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (r.lo <= last.hi + 1) {
      last.hi = Math.max(last.hi, r.hi);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function codeName(code: number): string {
  const ch = String.fromCodePoint(code);
  if (ch === '\n') return '\\n';
  if (ch === '\r') return '\\r';
  if (ch === '\t') return '\\t';
  return ch;
}

/* ---------------- 递归下降解析器 ---------------- */
//
// 文法（教学版，支持连接、选择、闭包/正闭包/可选、括号、字符类与通配符）：
//   alt    := concat ('|' concat)*
//   concat := quant*
//   quant  := atom ('*' | '+' | '?')*
//   atom   := '(' alt ')' | '[' class ']' | '.' | 转义 | 普通字符
//
export class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): ASTNode {
    if (this.src.length === 0) {
      throw new RegexError('正则表达式为空：请输入要构造的模式', 0, 0);
    }
    const node = this.parseAlt();
    if (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === ')') {
        throw new RegexError('存在没有对应左括号的右括号 )', this.pos);
      }
      if (ch === '*' || ch === '+' || ch === '?') {
        const name = ch === '*' ? '闭包 *' : ch === '+' ? '正闭包 +' : '可选 ?';
        throw new RegexError(`${name} 前面缺少操作数`, this.pos);
      }
      throw new RegexError(`无法解析的字符 “${ch}”`, this.pos);
    }
    return node;
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  private parseAlt(): ASTNode {
    const start = this.pos;
    const first = this.parseBranch('|', start);
    const children: ASTNode[] = [first];
    while (this.peek() === '|') {
      const barPos = this.pos;
      this.pos++; // 吃掉 |
      children.push(this.parseBranch('|', barPos));
    }
    if (children.length === 1) return children[0];
    return { kind: 'alt', children, span: { start, end: this.pos } };
  }

  /** 解析选择运算符的一个分支；空分支意味着运算符缺了操作数 */
  private parseBranch(op: string, opPos: number): ASTNode {
    const ch = this.peek();
    if (ch === '*' || ch === '+' || ch === '?') {
      const name = ch === '*' ? '闭包 *' : ch === '+' ? '正闭包 +' : '可选 ?';
      throw new RegexError(`${name} 前面缺少操作数`, this.pos);
    }
    const node = this.parseConcat();
    if (node === null) {
      throw new RegexError(`选择运算符 ${op} 缺少操作数`, opPos);
    }
    return node;
  }

  private parseConcat(): ASTNode | null {
    const start = this.pos;
    const children: ASTNode[] = [];
    while (this.canStartAtom()) {
      children.push(this.parseQuant());
    }
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { kind: 'concat', children, span: { start, end: this.pos } };
  }

  private canStartAtom(): boolean {
    const ch = this.peek();
    if (ch === '' || ch === '|' || ch === ')') return false;
    if (ch === '*' || ch === '+' || ch === '?') return false;
    return true;
  }

  private parseQuant(): ASTNode {
    const start = this.pos;
    let node = this.parseAtom();
    let quantified = false;
    while (this.peek() === '*' || this.peek() === '+' || this.peek() === '?') {
      if (quantified) {
        const ch = this.peek();
        const name = ch === '*' ? '闭包 *' : ch === '+' ? '正闭包 +' : '可选 ?';
        throw new RegexError(
          `${name} 前面缺少操作数（不允许连续叠加 * + ?；本教学版也不支持非贪婪后缀）`,
          this.pos,
        );
      }
      const op = this.peek();
      this.pos++;
      const kind = op === '*' ? 'star' : op === '+' ? 'plus' : 'opt';
      node = { kind, child: node, span: { start, end: this.pos } };
      quantified = true;
    }
    return node;
  }

  private parseAtom(): ASTNode {
    const ch = this.peek();
    if (ch === '') {
      throw new RegexError('表达式意外结束：这里应该有一个操作数', this.pos, this.pos);
    }
    if (ch === '(') return this.parseGroup();
    if (ch === '[') return this.parseClass();
    if (ch === '.') {
      const start = this.pos;
      this.pos++;
      // 通配符：除 \n \r 外的任意字符
      return {
        kind: 'class',
        ranges: [
          { lo: 0, hi: 9 },
          { lo: 11, hi: 12 },
          { lo: 14, hi: 0x10ffff },
        ],
        negated: false,
        preview: '.',
        span: { start, end: this.pos },
      };
    }
    if ('*+?)|'.includes(ch)) {
      const name =
        ch === '*' ? '闭包 *'
        : ch === '+' ? '正闭包 +'
        : ch === '?' ? '可选 ?'
        : ch === '|' ? '选择 |'
        : '右括号 )';
      throw new RegexError(`${name} 前面缺少操作数`, this.pos);
    }
    if (ch === '\\') return this.parseEscape();
    if (ch === '{') {
      throw new RegexError(
        '本教学版不支持 {n}/{n,m} 重复次数量词，请把重复显式写出来（如 a{3} 写成 aaa）',
        this.pos,
      );
    }
    if (ch === '}') {
      throw new RegexError('存在没有对应左花括号的 }', this.pos);
    }
    const start = this.pos;
    const code = this.readCodePoint();
    return { kind: 'char', code, span: { start, end: this.pos } };
  }

  private parseGroup(): ASTNode {
    const start = this.pos;
    this.pos++; // 吃掉 (
    if (this.peek() === '') {
      throw new RegexError('括号不配对：缺少对应的右括号 )', start, this.src.length);
    }
    const inner = this.parseAlt();
    if (this.peek() !== ')') {
      throw new RegexError('括号不配对：缺少对应的右括号 )', start, start + 1);
    }
    this.pos++; // 吃掉 )
    // 括号只分组、不改变语义；span 覆盖整组，便于 Thompson 高亮
    return { ...inner, span: { start, end: this.pos } };
  }

  /* ---------------- 转义 ---------------- */

  private parseEscape(): ASTNode {
    const start = this.pos;
    this.pos++; // 吃掉反斜杠
    if (this.pos >= this.src.length) {
      throw new RegexError('转义字符 \\ 后面缺少要转义的字符', this.src.length, this.src.length);
    }
    const e = this.peek();
    const lower = e.toLowerCase();
    if (SHORTHANDS[lower]) {
      this.pos++;
      const base = SHORTHANDS[lower]!;
      return {
        kind: 'class',
        ranges: normalizeRanges(base),
        negated: e !== lower, // \D \W \S 为取补集
        preview: `\\${e}`,
        span: { start, end: this.pos },
      };
    }
    if (e in SIMPLE_ESCAPES) {
      this.pos++;
      return { kind: 'char', code: SIMPLE_ESCAPES[e], span: { start, end: this.pos } };
    }
    if (e === 'x' || e === 'u') {
      const digits = e === 'x' ? 2 : 4;
      const hex = this.src.slice(this.pos + 1, this.pos + 1 + digits);
      if (hex.length < digits || !/^[0-9a-fA-F]+$/.test(hex)) {
        throw new RegexError(
          `\\${e} 后面需要 ${digits} 位十六进制数`,
          this.pos,
          Math.min(this.pos + 1 + digits, this.src.length),
        );
      }
      this.pos += 1 + digits;
      return { kind: 'char', code: parseInt(hex, 16), span: { start, end: this.pos } };
    }
    // 其它一律按“被转义的普通字符”处理：元字符、标点、引号、反斜杠本身
    this.pos++;
    return { kind: 'char', code: e.codePointAt(0)!, span: { start, end: this.pos } };
  }

  /* ---------------- 字符类 [...] ---------------- */

  private parseClass(): ASTNode {
    const start = this.pos;
    this.pos++; // 吃掉 [
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.pos++;
    }
    const members: CharRange[] = [];
    let sawMember = false;
    while (true) {
      if (this.peek() === '') {
        throw new RegexError('字符类不闭合：缺少对应的 ]', start, this.src.length);
      }
      if (this.peek() === ']') {
        if (!sawMember) {
          throw new RegexError('字符类 [] 为空：至少需要包含一个字符', start, this.pos + 1);
        }
        this.pos++;
        break;
      }
      sawMember = true;
      const lo = this.readClassCodePoint();
      // 仅当 '-' 后面还跟着一个成员（不是 ] 也不是结尾）时才当作区间符
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== '') {
        this.pos++; // 吃掉 -
        const hi = this.readClassCodePoint();
        if (lo > hi) {
          throw new RegexError(
            `字符类区间反向：${codeName(lo)}-${codeName(hi)}，起点码点不能大于终点`,
            start,
            this.pos,
          );
        }
        members.push({ lo, hi });
      } else {
        members.push({ lo, hi: lo });
      }
    }
    const preview = this.src.slice(start, this.pos);
    return {
      kind: 'class',
      ranges: normalizeRanges(members),
      negated,
      preview,
      span: { start, end: this.pos },
    };
  }

  /**
   * 字符类中的成员读取：
   *  - \d \w \s（含大写取反）展开成区间，直接并入收集器；
   *  - 其它转义/普通字符返回单个码点作为区间端点。
   * 通过返回值区分“单码点”与“多区间简写”。
   */
  private readClassCodePoint(): number {
    if (this.peek() !== '\\') {
      return this.readCodePoint();
    }
    this.pos++; // 吃掉 \
    const e = this.peek();
    if (e === '') throw new RegexError('字符类中的转义不完整', this.src.length, this.src.length);
    const lower = e.toLowerCase();
    if (SHORTHANDS[lower]) {
      throw new RegexError(
        '字符类内暂不支持 \\d \\w \\s 简写，请直接写出区间（如 [0-9]）',
        this.pos - 1,
        this.pos + 1,
      );
    }
    if (e in SIMPLE_ESCAPES) {
      this.pos++;
      return SIMPLE_ESCAPES[e];
    }
    this.pos++;
    return e.codePointAt(0)!;
  }

  private readCodePoint(): number {
    const cp = this.src.codePointAt(this.pos)!;
    this.pos += cp > 0xffff ? 2 : 1;
    return cp;
  }
}

export function parseRegex(pattern: string): ASTNode {
  return new Parser(pattern).parse();
}
