/** 正则解析阶段抛出的错误：携带位置，方便前端在输入区精确标出 */
export class RegexError extends Error {
  constructor(
    message: string,
    public position: number,
    public endPosition: number = position + 1,
  ) {
    super(message);
    this.name = 'RegexError';
  }
}
