# Agent 复杂页面数据提取方案

## 1. 现状分析

当前 agent 的主入口在 [src/main/agent/browser-agent-service.ts](../src/main/agent/browser-agent-service.ts)，它把可用工具直接绑定到 `automationService.listTools()` 返回的结果上。

现有问题不在于“底层没有抽取能力”，而在于“agent 没拿到正确的抽象层”。

- `browser-agent-service` 的系统提示只强调先用 `browser_ax_snapshot` / `browser_ax_query` 看页面，再做交互。
- `automation-mcp.listTools()` 目前只暴露 `PublicToolRegistry`，也就是一套偏底层的公开工具。
- 这套公开工具里没有真正面向 agent 的“页面理解 / 结构化提取”工具，只有会话、AX、点击、输入、事件订阅等能力。
- 库内部其实已经实现了更高层的 agent 语义工具，包括 `page.snapshot`、`page.extract`、`page.interact`、`context.describe`、`locate.find`、`extract.records`、`semantic.capture_page_snapshot`、`execute.perform_action`。
- 内部还已经有结构化记录提取能力 `extractStructuredRecords()`，支持 `region/form` 作用域、`sourceRole`、`recordSchema` 校验和结果验证。

结论：现在 agent 在复杂页面上“不知道如何提取数据”，核心原因是工具面和调度策略错误，不是底层引擎缺失。

## 2. 根因拆解

### 2.1 工具面错误

agent 当前能看到的是：

- `browser_session_open`
- `browser_ax_snapshot`
- `browser_ax_query`
- `browser_element_click`
- `browser_element_input`
- `browser_element_select`
- `browser_events_*`

agent 当前看不到的是：

- `page.snapshot`
- `page.extract`
- `page.interact`
- `context.describe`
- `locate.find`
- `extract.records`

这意味着 model 只能从 AX 树里“猜”哪里是数据区域，再自己决定要不要点击或输入，但它没有一个明确的“先理解页面结构，再选区域，再抽记录”的工作流。

### 2.2 缺少任务驱动的抽取协议

当前 prompt 更像“网页操作代理”，不是“数据提取代理”。

缺失的关键步骤：

- 明确本次要抽的实体和字段。
- 先判断数据源是 `table`、`list`、`card_group`、`article` 还是表单结果区。
- 先缩小作用域，再抽取，而不是直接对全页理解。
- 抽完之后验证是否达到了记录数、字段完整率和去重要求。
- 失败后自动切换到下一个候选区域或 fallback 模式。

### 2.3 缺少闭环验证

复杂页面的典型问题不是“找不到按钮”，而是：

- 数据区域很多，主列表和侧边栏都像列表。
- 页面是虚拟列表，AX 树和真实数据块不完全一致。
- 卡片结构是重复块，但没有稳定表格语义。
- 数据需要翻页、滚动、展开更多。
- 页面内容变了，但 agent 没有把“抽取结果是否足够”作为成功标准。

当前实现里已经有 `recordSchema`、`minRecords`、`records_visible` 这类能力，但没有成为 agent 默认流程的一部分。

## 3. 目标设计

目标不是让 LLM 直接从复杂 DOM 中自由发挥，而是把它变成一个“声明需求的 planner”，由代码完成可重复的抽取执行。

### 3.1 三层架构

#### 第一层：页面理解层

职责：

- 把页面压缩成语义区域、信息块、能力块。
- 输出“哪个区域最像目标数据源”。
- 给出 drilldown 建议，而不是暴露整棵 AX/DOM。

优先工具：

- `page.open`
- `page.snapshot`
- `context.describe`

输出应包含：

- `summary`
- `regions`
- `information`
- `capabilities`
- `suggestedActions`
- `drilldowns`

#### 第二层：抽取规划层

职责：

- 根据用户任务生成 `ExtractionIntent`。
- 选择候选区域和模式。
- 为抽取过程提供验证标准。

建议新增概念：

```ts
interface ExtractionIntent {
  goal: string;
  entityName: string;
  fields: Array<{
    key: string;
    description?: string;
    required: boolean;
  }>;
  preferredMode: "records" | "text" | "images" | "auto";
  minRecords?: number;
  maxRecords?: number;
  dedupeKey?: string[];
  stopWhen?: "first_valid" | "coverage_ok" | "no_more_new_records";
}
```

LLM 只负责生成 `goal / fields / minRecords / stopWhen` 这类高层意图，不负责写整段 DOM 抓取逻辑。

#### 第三层：抽取执行层

职责：

- 依据候选区域依次尝试抽取。
- 对结果做 schema 校验、覆盖率计算、去重、分页合并。
- 自动判断是否继续翻页/滚动/切换候选区域。

优先工具：

- `page.extract`
- `extract.records`
- `page.interact`
- `locate.find`
- `act.step`

fallback：

- 当语义抽取失败时，才进入受限脚本抽取。
- 脚本抽取必须先绑定到选中的 region/form，而不是直接对全页执行自由脚本。

## 4. 推荐落地方案

### 方案 A：最小改造，最快见效

目标：先让 agent 能用上已有的高层语义能力。

改动：

- 新增 `listAgentTools()`，不要让 agent 直接共享 `PublicToolRegistry`。
- 给 agent 暴露高层工具：
  - `page.open`
  - `page.snapshot`
  - `page.extract`
  - `page.interact`
  - `context.describe`
  - `locate.find`
  - `extract.records`
- 低层工具保留少量兜底：
  - `browser_session_open`
  - `browser_events_*`
  - `browser_dialog_handle`

同时修改 agent system prompt，强制抽取任务遵循固定流程：

1. 先 `page.open` 或附着当前页面。
2. 再 `page.snapshot(task=用户目标)` 或 `context.describe`。
3. 选最可能的数据块。
4. 用 `page.extract` / `extract.records` 抽取。
5. 用 `recordSchema + minRecords` 验证。
6. 如果失败，按 `drilldowns` 换候选区域。
7. 如果还是失败，再进入脚本 fallback。

优点：

- 复用现有实现最多。
- 风险最低。
- 不需要先改底层提取引擎。

缺点：

- 仍然要求 LLM 学会一套多步流程。
- 复杂分页和去重逻辑还是偏依赖模型判断。

### 方案 B：新增专用高层工具 `agent_extract_data`

目标：把复杂数据提取从多轮 tool orchestration 收敛成一个高层工具。

建议接口：

```ts
interface AgentExtractDataInput {
  page: PageRef;
  task: string;
  recordSchema?: Record<string, unknown>;
  minRecords?: number;
  maxRecords?: number;
  allowPagination?: boolean;
  allowScroll?: boolean;
}
```

内部流程：

1. `page.snapshot(task)`
2. 从 `information` 和 `regions` 中选 top-k 候选区域
3. 逐个执行 `page.extract(mode=records)`
4. 校验 `recordSchema`
5. 计算字段覆盖率、重复率、稳定性
6. 如果不足，尝试 `drilldown`
7. 如有分页/加载更多能力，调用 `page.interact`
8. 合并去重
9. 返回最终结果和 provenance

返回结果建议包含：

- `records`
- `recordCount`
- `schemaValid`
- `fieldCoverage`
- `dedupeStats`
- `source`
- `attempts`
- `completed`

优点：

- 对 LLM 最友好。
- 能显著降低复杂页面失败率。
- 便于加 deterministic 策略和埋点。

缺点：

- 需要写一层 orchestrator。
- 调试面会从“tool 调用链”变成“黑盒工具内部流程”。

### 方案 C：最优长期方案

目标：在方案 B 基础上加入“提取 recipe 学习”。

结合现有 learning 模块，新增：

```ts
interface ExtractionRecipe {
  domain: string;
  urlPattern?: string;
  pageSignature: string;
  regionHints: string[];
  sourceRole: "table" | "list" | "panel" | "main" | "form";
  recordSchema?: Record<string, unknown>;
  fieldMappings: Array<{
    key: string;
    hint: string;
  }>;
}
```

当一次提取成功后：

- 记录页面签名、命中的 region、sourceRole、schema、字段映射。
- 下次同域名同结构页面，优先复用 recipe。
- 如果 recipe 连续失败，再降级回通用探索。

这个阶段能显著提升重复网站流程的稳定性。

## 5. 建议的具体实现顺序

### Phase 1：修正 agent 工具面

- 在 `AutomationMcpService` 中新增 agent 专用工具注册表。
- `BrowserAgentService` 改为消费 agent tool surface，而不是 public tool surface。
- 把 `page.snapshot / page.extract / page.interact / context.describe / locate.find / extract.records` 暴露给 agent。
- 更新 system prompt，明确“抽取型任务必须先 snapshot，再 extract，再 validate”。

### Phase 2：加抽取闭环

- 定义 `ExtractionIntent`。
- 定义抽取成功标准：
  - `recordCount >= minRecords`
  - required 字段覆盖率 >= 阈值
  - 重复率低于阈值
- 把失败原因结构化：
  - `wrong_region`
  - `schema_mismatch`
  - `too_few_records`
  - `page_not_fully_loaded`
  - `requires_pagination`

### Phase 3：做自动翻页 / 滚动合并

- 从 `capabilities` 中识别 `pagination`、`button`、`scroll`。
- 执行“抽取 -> 翻页/滚动 -> 再抽取 -> 合并去重”的循环。
- 终止条件：
  - 连续两轮无新增记录
  - 到达 `maxRecords`
  - 没有下一页能力
  - 触发安全页数上限

### Phase 4：提取 recipe 学习

- 成功结果写入 learning store。
- 搜索命中后优先使用 recipe。
- recipe 失败时自动回退通用探索。

## 6. 关键设计原则

- 不让 LLM 直接面对整页原始 DOM/AX 做自由抽取。
- 优先暴露“页面语义抽象”，不是“底层浏览器原语”。
- 抽取必须有验证，不是拿到一份 JSON 就算成功。
- fallback 可以有，但必须是最后手段。
- 复杂页面处理要以“候选区域 + 迭代验证”为主，不是单次猜中。
- agent 工具面和 external/public tool 面必须分离。

## 7. 我认为最值得立刻做的事

如果只做一件事，我建议先做：

- `agent tool surface` 与 `public tool surface` 分离。

原因：

- 这是当前设计的根问题。
- 代码里高层语义能力已经存在，复用成本低。
- 一旦 agent 能看到 `page.snapshot` 和 `page.extract`，复杂页面抽取成功率会马上提升。

如果再做第二件事，我建议：

- 新增 `agent_extract_data` 高层工具，把“理解页面 -> 选区 -> 提取 -> 校验 -> 翻页”收敛成一个 deterministic orchestration。

## 8. 验收标准

- 在列表页、表格页、卡片页、搜索结果页上，agent 能先识别主数据区域，再输出结构化记录。
- 抽取结果能附带 `source block/region`、`snapshotId`、`schemaValid`、`recordCount`。
- 页面上存在多个列表时，agent 能通过 task 选择正确列表，而不是抽到侧边栏推荐内容。
- 数据需要翻页或滚动时，agent 能继续补采并去重。
- 同站点重复任务第二次执行时，成功率和速度明显提升。

## 9. 总结

现在的问题，本质上不是模型太弱，而是系统把 agent 放在了错误的抽象层。

当前代码库已经具备：

- 语义页面快照
- 信息块 / 能力块建模
- 结构化记录提取
- 结果校验
- 交互后观察

真正缺的是：

- 把这些能力暴露给 agent
- 给 agent 一个固定的数据提取协议
- 用 deterministic orchestration 把复杂页面提取收敛成可验证的闭环

先修工具面，再补抽取闭环，是这件事的最短路径。
