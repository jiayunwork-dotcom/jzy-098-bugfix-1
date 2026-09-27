export interface RegexExample {
  id: string;
  name: string;
  pattern: string;
  /** 推荐测试串：前两个应被接受，第三个应被拒绝 */
  acceptSamples: string[];
  rejectSample: string;
  note: string;
}

/** 内置教学示例：一点即填入输入区 */
export const EXAMPLES: RegexExample[] = [
  {
    id: 'identifier',
    name: '标识符',
    pattern: '[a-zA-Z_][a-zA-Z0-9_]*',
    acceptSamples: ['user_name', '_tmp1', 'X'],
    rejectSample: '1st_place',
    note: '字母或下划线开头，后跟任意多个字母、数字或下划线',
  },
  {
    id: 'number',
    name: '带小数的数字',
    pattern: '(0|[1-9][0-9]*)(\\.[0-9]+)?',
    acceptSamples: ['42', '3.14', '0.001'],
    rejectSample: '07.5',
    note: '整数部分不允许前导 0，小数部分整体可选',
  },
  {
    id: 'string',
    name: '字符串字面量',
    pattern: '"([^"\\\\]|\\\\.)*"',
    acceptSamples: ['"hello"', '"a\\"b\\n"', '""'],
    rejectSample: '"unterminated',
    note: '双引号包裹，内部允许 \\" 等转义序列',
  },
  {
    id: 'phone',
    name: '简化手机号',
    pattern: '(\\+?86)?1[3-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]',
    acceptSamples: ['13800138000', '+8613912345678', '8615000000000'],
    rejectSample: '12345',
    note: '可选国家码 + 11 位手机号（第二位数为 3-9）；用显式重复代替 {9}，方便看清连接与闭包的区别',
  },
  {
    id: 'aorb',
    name: '入门：(a|b)*abb',
    pattern: '(a|b)*abb',
    acceptSamples: ['abb', 'aabb', 'bbabb'],
    rejectSample: 'aba',
    note: '龙书经典例子：所有以 abb 结尾的 a/b 串',
  },
];
