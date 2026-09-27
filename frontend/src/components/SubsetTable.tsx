import React from 'react';

export interface SubsetRow {
  stateId: number;
  subset: number[];
  accept: boolean;
  dead?: boolean;
  /** 高亮：刚注册 / 当前处理中 */
  isNew?: boolean;
  isCurrent?: boolean;
}

interface SubsetTableProps {
  rows: SubsetRow[];
  /** 子集数量膨胀时表身滚动，表头保持可见 */
  maxHeight?: number;
}

/** 子集对照表：每个 DFA 状态对应哪一组 NFA 状态 */
export const SubsetTable: React.FC<SubsetTableProps> = ({ rows, maxHeight = 240 }) => {
  return (
    <div className="subset-table-wrap" style={{ maxHeight }}>
      <table className="subset-table">
        <thead>
          <tr>
            <th>DFA 状态</th>
            <th>= ε-闭包后的 NFA 状态集合</th>
            <th>接受？</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.stateId}
              className={[
                r.isNew ? 'row-new' : '',
                r.isCurrent ? 'row-current' : '',
              ].join(' ')}
            >
              <td className="cell-state">
                <strong>q{r.stateId}</strong>
                {r.dead && <span className="dead-tag">死</span>}
              </td>
              <td className="cell-subset">
                {r.subset.length === 0 ? (
                  <span className="empty-set">∅</span>
                ) : (
                  <span className="subset-list">
                    {'{ '}
                    {r.subset.map((s) => `n${s}`).join(', ')}
                    {' }'}
                  </span>
                )}
                <span className="subset-size">{r.subset.length} 个</span>
              </td>
              <td className="cell-accept">
                {r.accept ? <span className="yes">● 接受</span> : <span className="no">○</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
