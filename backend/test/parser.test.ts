import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRegex } from '../src/parser/parser';
import { RegexError } from '../src/parser/errors';

function expectError(pattern: string, fragment: string) {
  try {
    parseRegex(pattern);
    assert.fail(`应当解析失败：${pattern}`);
  } catch (e) {
    assert.ok(e instanceof RegexError, `期望 RegexError，实际 ${(e as Error).name}`);
    assert.ok(
      (e as RegexError).message.includes(fragment),
      `错误信息应包含“${fragment}”，实际“${(e as RegexError).message}”`,
    );
    assert.ok((e as RegexError).position >= 0, '错误必须带位置');
  }
}

test('空表达式被拒绝并带位置', () => {
  expectError('', '为空');
});

test('括号不配对：缺右括号', () => {
  expectError('(ab', '括号');
});

test('括号不配对：多余右括号', () => {
  expectError('ab)', '右括号');
});

test('选择运算符缺左/右操作数', () => {
  expectError('a|', '缺少操作数');
  expectError('|a', '缺少操作数');
  expectError('a||b', '缺少操作数');
});

test('闭包/可选运算符前面缺操作数', () => {
  expectError('*', '缺少操作数');
  expectError('a**b', '缺少操作数');
  expectError('?', '缺少操作数');
  expectError('a+?', '缺少操作数');
});

test('不支持的 {n} 量词给出清晰报错（不崩）', () => {
  expectError('a{2}', '重复次数量词');
});

test('字符类不闭合 / 为空 / 区间反向', () => {
  expectError('[a-z', ']');
  expectError('[]', '为空');
  expectError('[z-a]', '反向');
});

test('合法的复杂表达式可以解析，且节点带源码位置', () => {
  const ast = parseRegex('(a|b)*c?d+[0-9]+');
  assert.ok(ast.span.start === 0);
  assert.ok(ast.span.end > 0);
});

test('转义元字符按普通字符处理', () => {
  const ast = parseRegex('\\(\\)\\*\\+\\?\\|\\\\');
  assert.equal(ast.kind, 'concat');
});
