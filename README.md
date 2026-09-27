# 正则 → NFA → DFA → 最小化 DFA · 构造流水线可视化教学工具

一个把"一条正则到底怎么变成一台能跑的识别机器"完整演出来的 Web 应用：

```
正则表达式 ──Thompson 构造──▶ ε-NFA ──子集构造──▶ DFA ──Hopcroft 最小化──▶ 最小化 DFA
```

三个阶段都能**单步推进 / 拖进度条 / 一键跑完**，并可在任意一台机器上输入测试串，
三台机器对同一测试串的接受结果**必须完全一致**——这条正确性主线由后端算法保证、
由自动化测试锁死、并在页面上明确展示。

- 前端：React 18 + TypeScript + Vite，纯 SVG 自绘状态图（圆圈状态、双圈接受态、
  有向带标签边、`start` 初始标记），支持缩放平移；状态数膨胀时画布滚动容纳。
- 后端：Node.js 20 + TypeScript + Express，承载**全部**构造与判定逻辑：
  正则解析、Thompson 构造、子集构造（含字符同行为分区）、Hopcroft 最小化、三台机器的模拟。
  前端只做展示与交互，不另算一套。

## 支持的正则算子

| 算子 | 写法 | 说明 |
| --- | --- | --- |
| 连接 | `ab` | 直接并列 |
| 选择 | `a\|b` | 多分支 `a\|b\|c` |
| 闭包 | `a*` | 0 次或多次 |
| 正闭包 | `a+` | 1 次或多次 |
| 可选 | `a?` | 0 次或 1 次 |
| 分组 | `(...)` | 括号分组 |
| 字符类 | `[a-z0-9_]`、`[^"]` | 区间、取反 |
| 通配符 | `.` | 除 `\n` `\r` 外任意字符 |
| 简写 | `\d \w \s` 及大写取反 `\D \W \S` | |
| 转义 | `\n \t \r \0 \\ \. \| \( ...` | 元字符转义后按普通字符处理 |

> 教学版刻意**不支持** `{n}` / `{n,m}` 量词，遇到会给出清晰报错，
> 引导学生用显式重复（`aaa`）看清连接与闭包的区别。

非法正则（括号不配对、缺操作数、字符类不闭合/反向等）返回带**字符位置**的错误，
前端在输入框里把出错片段标红并给出原因，页面不崩溃。

## 快速开始（本地开发）

要求 Node.js 20+。

```bash
npm install          # 安装前后端依赖（npm workspaces）
npm run dev          # 同时启动后端(3001) 与 Vite(5173)，改代码自动热更
```

打开 http://localhost:5173 ，Vite 会把 `/api` 代理到后端。

生产构建 / 运行：

```bash
npm run build        # tsc 编译后端到 backend/dist，vite 打包前端到 frontend/dist
npm start            # 起在 http://localhost:3001，同一端口托管页面与接口
PORT=8080 npm start
```

## Docker 一体构建（推荐课堂演示）

容器内一次构建，**同一个端口同时提供页面和接口**：

```bash
docker build -t regex-pipeline .
docker run --rm -p 8080:8080 regex-pipeline
# 或
docker compose up --build
```

浏览器打开 http://localhost:8080 即可，无需额外配置。

## HTTP 接口

| 方法 | 路径 | 入参 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/build` | `{ "pattern": string }` | 返回整条流水线的全部结构化结果（含每一步快照） |
| POST | `/api/simulate` | `{ "pattern": string, "input": string }` | 三台机器各自的逐字符路径与结论，外加 `agree` |
| GET | `/api/examples` | — | 内置示例正则 |
| GET | `/api/health` | — | 健康检查 |

`/api/build` 的返回（`shared/types.ts` 里有完整类型）：

- `nfa` + `thompsonSteps[]`：最终 NFA，以及每个算子片段拼接时的逐步快照、
  对应正则源码区间（前端高亮当前片段）；
- `dfa` + `subsetSteps[]`：最终 DFA，以及每次 ε-闭包 / 新子集注册 / 字符迁移的步骤，
  每步附带随构造增长的**子集对照表**；
- `minDfa` + `hopcroftSteps[]`：最小化 DFA、合并对照表 `mergeMap`，
  以及初始划分 / 每轮块分裂 / 收敛的等价类步骤（块 id 全程稳定，前端用固定颜色跟踪）。

## 目录结构

```
shared/types.ts               前后端共享的结构化数据契约（纯类型）
backend/
  src/
    parser/
      parser.ts               递归下降解析器（AST + 源码位置 + 错误位置）
      errors.ts               带位置的正则错误
    automata/
      thompson.ts             Thompson 构造（含逐步片段快照）
      alphabet.ts             字符同行为分区（signature partition）
      subset.ts               ε-闭包 / move / 子集构造（含逐步事件与子集表）
      hopcroft.ts             Hopcroft 划分细化 + 最小 DFA 组装
      simulator.ts            NFA / DFA / 最小化 DFA 的测试串逐字符模拟
      labels.ts / ranges.ts   标签与码点区间小工具
    pipeline.ts               串联整条流水线 + 三台模拟 + 一致性结论
    examples.ts               内置示例
    index.ts                  Express 入口（API + 生产模式托管前端）
  test/
    parser.test.ts            解析与错误信息测试
    consistency.test.ts       ★ 随机串模糊测试：三台机器判定必须一致
frontend/
  src/
    App.tsx                   页面装配与阶段步进状态
    api.ts                    调后端接口
    components/
      RegexInput.tsx          正则输入区、错误标红、示例
      StateGraph.tsx          通用 SVG 状态图（布局/缩放/高亮/着色）
      StepControls.tsx        逐步 / 滑块 / 跑完 控制条
      SubsetTable.tsx         子集对照表
      NFAPanel.tsx            Thompson 阶段
      DFAPanel.tsx            子集构造阶段（图 + 子集表，死状态边可展开）
      HopcroftPanel.tsx       等价类划分在原 DFA 上的着色演化
      MinDfaPanel.tsx         最小化 DFA 与合并对照表
      TestRunner.tsx          跨三台机器的统一测试串面板
    lib/                      标签格式化、图分层布局
```

## 关键算法的教学口径

1. **Thompson 构造**：每个算子都建"一个入口、一个出口、入口无入边、出口无出边"的片段，
   再机械地嵌套——叶子建带标签的边；连接把出口/入口焊成同一状态；
   `|` 新建入口出口用 ε 并联；`*` 加 ε 回环 + ε 跳过；`?` 是并联一条 ε 跳过；
   `+` 与 `*` 相同但没有跳过边。
2. **子集构造**：状态 = NFA 状态集合。反复做 ε-闭包和沿字符的 move，BFS 去重。
   为了不枚举整个 Unicode，先用所有标签区间端点把字符空间切成"标签行为恒定"的区域，
   每区取一个代表字符参与构造；空集合成为死状态，补全自环得到完整转移表。
3. **Hopcroft 最小化**：初始按"接受 / 非接受"分两块，用"某块 + 某字符"当试金石，
   把读该字符后落入 / 不落入该块的状态拆开，工作集驱动直到不可再分，每块合并为一个状态。

## 测试

```bash
npm test
```

核心测试 `consistency.test.ts` 对 13 个模式 × 7 个字符池 × 200 条随机串（上万条），
断言 NFA、DFA、最小化 DFA 三者接受结论两两一致；同时检查最小化状态数不增、
合并表保留接受性、Hopcroft 块数单调不减且最终等于最小 DFA 状态数、空串语义等。
