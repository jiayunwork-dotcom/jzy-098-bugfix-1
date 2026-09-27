import type { BuildData } from '../../shared/types';
import { parseRegex } from './parser/parser';
import { thompsonConstruct } from './automata/thompson';
import { subsetConstruct } from './automata/subset';
import { hopcroftMinimize } from './automata/hopcroft';
import { simulateDFA, simulateNFA } from './automata/simulator';
import type { SimResponse } from '../../shared/types';
import { RegexError } from './parser/errors';

/** 字符区域数量的教学上限，防止病态正则把前端撑爆 */
const MAX_SIGNATURE_SIZE = 4000;

/** 完整流水线：正则 → AST → NFA → DFA → 最小化 DFA */
export function buildPipeline(pattern: string): BuildData {
  const ast = parseRegex(pattern);
  const { nfa, steps: thompsonSteps } = thompsonConstruct(ast);

  const subset = subsetConstruct(nfa);
  if (subset.sigRanges.length > MAX_SIGNATURE_SIZE) {
    throw new RegexError(
      `该正则的字符集合产生了 ${subset.sigRanges.length} 个不同字符区域，超过教学上限 ${MAX_SIGNATURE_SIZE}，请简化字符类`,
      0,
      pattern.length,
    );
  }

  const { minDfa, steps: hopcroftSteps } = hopcroftMinimize(subset.dfa);

  return {
    pattern,
    nfa,
    thompsonSteps,
    dfa: subset.dfa,
    subsetSteps: subset.steps,
    minDfa,
    hopcroftSteps,
  };
}

/** 在三台机器上模拟同一条输入，并锁定“结论一致”这条正确性主线 */
export function simulateAll(data: BuildData, input: string): SimResponse {
  const nfa = simulateNFA(data.nfa, input);
  const dfa = simulateDFA(data.dfa, input, 'dfa');
  const min = simulateDFA(data.minDfa, input, 'min');
  const agree = nfa.accepted === dfa.accepted && dfa.accepted === min.accepted;
  return {
    ok: true,
    pattern: data.pattern,
    input,
    nfa,
    dfa,
    min,
    agree,
  };
}
