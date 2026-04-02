# Windows CUA Lab

[English](#english) | [中文](#中文)

> **Teach AI how to operate Windows apps**
>
> **教会 AI 如何操作 Windows 软件**

<a id="english"></a>

## English

Windows CUA Lab is a standalone Windows Computer Use Automation lab for exploring how GPT-5.4 can observe, act on, and verify real Windows desktop software through a bounded broker.

It is designed as an independent runtime and experimentation product. Its role is to help agents learn how to run, replay, debug, and iteratively improve Windows software interactions before those capabilities are embedded into larger systems.

### What this repository provides

- a **Windows-side broker contract** for bounded desktop actions
- a **transition envelope** for step-by-step execution history
- a **replay trace schema** for persisted run artifacts
- a **Paint demo loop** for visible spatial computer-use behavior
- a **Calculator validation path** for deterministic state reading and verification
- a **generic app entry** for one bounded action on user-chosen apps, including first-class `double_click`
- a **reusable export contract** for downstream host systems

### Operating model

The default operator model is:

- **WSL as the control plane**
- **Windows as the execution plane**

In practice, the operator launches Windows-side behavior from WSL through commands such as:

```bash
powershell.exe -NoLogo -NoProfile -Command "..."
```

This keeps the orchestration and iteration loop in WSL while the broker and desktop-facing runtime remain on Windows.

After light adaptation, the same broker/runtime can also be launched from a Windows-native shell. WSL is the default, not the only possible host shell.

### Validation status

- WSL control-plane path: verified
- Windows-native shell path: verified with `preflight:windows` and `demo:any:notepad:real`
- Generic target path (`--target any`): verified on Notepad in both mock and real mode

### Repository layout

- `windows-broker/` — broker contract and Windows runtime notes
- `schemas/` — JSON schemas for transition and replay artifacts
- `docs/reports/` — stage reports and verification notes
- `docs/plans/` — implementation plans
- `apps/runner/` — standalone runner entry
- `scripts/` — local verification helpers
- `skills/` — agent-facing runbooks for running and debugging the lab

### How to use

#### 1. Install dependencies and build

```bash
npm install
npm run build
```

#### 2. Run on your own app (primary path)

Before real mode, run Windows preflight first:

```bash
npm run preflight:windows
```

Run one bounded action on any app by providing target app and task:

```bash
node dist/apps/runner/src/main.js \
  --target any \
  --mode real \
  --target-app notepad.exe \
  --task "In Notepad, perform one safe visible UI action without touching files."
```

Optional startup/activation tuning:

```bash
node dist/apps/runner/src/main.js \
  --target any \
  --mode real \
  --target-app Code.exe \
  --launch-command "Code.exe" \
  --window-title "Visual Studio Code" \
  --task "Perform one safe visible UI action."
```

For local smoke check without Windows execution:

```bash
node dist/apps/runner/src/main.js \
  --target any \
  --mode mock \
  --target-app notepad.exe \
  --task "In Notepad, perform one safe visible UI action." \
  --output artifacts/custom-notepad-smoke
```

The bounded action vocabulary now includes GPT-5.4-computer-use-aligned `double_click` as a first-class action kind. In real mode, that action is executed atomically inside one broker invocation rather than being modeled as two delayed top-level clicks.

#### 3. Inspect replay artifacts

Custom runs default to:

```text
artifacts/custom-<target-app>/
```

Each successful run produces:

- screenshots
- action trace
- verifier trace
- replay trace
- run report

These are the primary inputs for debugging and iterative improvement.

For real generic runs, verification no longer relies on a single immediate after screenshot alone. The runtime always semantically judges the first post-action frame once, and if that first frame is `loading` or `ambiguous`, it enters a bounded settle window that samples later frames. Nearly identical follow-up frames are pixel-gated so they do not always trigger another AI call.

The richer settle artifacts now surface through the existing replay/verifier files rather than a separate schema. In practice, operators should expect `verification.semanticState`, `winningScreenshotRef`, `finalStableScreenshotRef`, and sample-level `aiInvoked` / visual-delta fields in `verifier-trace.jsonl` when the settle window is exercised.

#### 4. Template tests (short)

Paint/Calculator tests are kept as regression templates:

```bash
npm run test:stage2
npm run test:stage3
```

### How agents should use this lab

Use the skill runbook in `skills/windows-cua-lab-operator/SKILL.md` as the default operating procedure.

The intended workflow is:

1. **Run** one bounded action on a target app
2. **Replay** screenshots and traces
3. **Diagnose** whether failure came from perception, action, verification, or runtime setup
4. **Refine** one variable at a time
5. **Export** reusable capability contracts after behavior is stable

Recommended pattern for agent operators:

1. Load `skills/windows-cua-lab-operator/SKILL.md`
2. Start with `npm run preflight:windows` and then the narrowest runnable target
3. Use replay artifacts to classify failures before changing prompts or runtime settings

### Broker endpoint note

The current default real broker endpoint is:

- `http://127.0.0.1:10578`

This default was chosen because `9477` can fall inside Windows excluded TCP port ranges on some hosts. If your environment needs a different port, override it explicitly with:

```bash
WINDOWS_BROKER_ENDPOINT=http://127.0.0.1:<your-port>
```

and rerun:

```bash
npm run preflight:windows
```

### Current stage status

- Stage 1: broker and trace skeleton — complete
- Stage 2: Paint demo loop — complete
- Stage 3: Calculator validation path — complete
- Stage 4: reusable capability export contract — complete

### Reusable export contract

This lab exposes a reusable surface for downstream host systems:

- `schemas/transition-envelope.json` — per-step transition envelope
- `schemas/replay-trace.json` — run-level replay artifact format
- `schemas/reusable-state-summary.json` — hypothesis-friendly state summary
- `docs/reports/stage-4-reusable-capability-export.md` — mapping of exported artifacts versus lab-only runtime details

The contract shape is designed to be reusable, while the lab runtime remains an independent execution product.

<a id="中文"></a>

## 中文

Windows CUA Lab 是一个独立的 Windows Computer Use Automation 实验室，用来探索 GPT-5.4 如何通过受限 broker 观察、执行并验证真实的 Windows 软件操作。

它被设计成一个独立的运行时与实验产品。它的目标不是马上嵌入更大的系统，而是先让 agent 学会如何**运行、回放、调试、迭代优化** Windows 软件上的 computer use 能力。

### 这个仓库提供什么

- 一个用于受限桌面动作的 **Windows-side broker contract**
- 一个用于逐步执行历史的 **transition envelope**
- 一个用于持久化运行产物的 **replay trace schema**
- 一个用于可视化空间动作演示的 **Paint demo 路径**
- 一个用于确定性结果验证的 **Calculator 路径**
- 一个可用于用户自定义应用的 **通用入口**
- 一套可暴露给下游宿主系统的 **可复用导出契约**

### 运行方式

默认运行模式是：

- **WSL 作为控制平面**
- **Windows 作为执行平面**

因此，操作者通常在 WSL 中发起 Windows 侧行为，例如：

```bash
powershell.exe -NoLogo -NoProfile -Command "..."
```

这样可以把调度、迭代和分析保留在 WSL，而 broker 和真正面向桌面的执行运行在 Windows 上。

经过轻量适配后，同样的 broker/runtime 也可以直接在 Windows 原生 shell 下运行。也就是说，WSL 是默认推荐，不是唯一可用入口。

### 验证状态

- WSL 控制平面路径：已验证
- Windows 原生 shell 路径：已通过 `preflight:windows` 与 `demo:any:notepad:real` 验证
- 通用目标路径（`--target any`）：已在 Notepad 的 mock/real 模式验证

### 仓库结构

- `windows-broker/` —— broker 契约与 Windows 运行时说明
- `schemas/` —— transition / replay 相关 JSON schema
- `apps/runner/` —— 独立 runner 入口
- `scripts/` —— 本地验证辅助脚本
- `skills/` —— 给 agent 使用的 runbook / skill 文档

### 如何使用

#### 1. 安装依赖并构建

```bash
npm install
npm run build
```

#### 2. 在你自己的应用上运行（主路径）

建议先做一次 Windows 预检查：

```bash
npm run preflight:windows
```

通过传入目标应用和任务，运行通用单步能力：

```bash
node dist/apps/runner/src/main.js \
  --target any \
  --mode real \
  --target-app notepad.exe \
  --task "在 Notepad 中执行一个安全且可见的单步 UI 操作，不进行文件读写。"
```

如需自定义启动或激活参数，可额外传：

```bash
node dist/apps/runner/src/main.js \
  --target any \
  --mode real \
  --target-app Code.exe \
  --launch-command "Code.exe" \
  --window-title "Visual Studio Code" \
  --task "执行一个安全、可见的单步 UI 操作。"
```

仅做本地冒烟验证（不触发真实 Windows 执行）可用：

```bash
node dist/apps/runner/src/main.js \
  --target any \
  --mode mock \
  --target-app notepad.exe \
  --task "在 Notepad 中执行一个安全且可见的单步 UI 操作。" \
  --output artifacts/custom-notepad-smoke
```

#### 3. 查看回放产物

自定义应用默认输出目录：

```text
artifacts/custom-<target-app>/
```

每次成功运行后都会输出：

- screenshots
- action trace
- verifier trace
- replay trace
- run report

这些文件就是调试和迭代的第一入口。

#### 4. 模板测试（简写）

Paint/Calculator 的测试保留为回归模板：

```bash
npm run test:stage2
npm run test:stage3
```

### AI 如何使用这个实验室

建议 AI/agent 默认使用 `skills/windows-cua-lab-operator/SKILL.md` 作为操作 runbook。

AI/agent 在这个实验室里的推荐工作流是：

1. **运行** 一个目标应用上的受限单步操作
2. **回放** screenshots 和 traces
3. **判断问题** 出在观察、动作、验证还是运行时环境
4. **一次只改一个变量** 继续尝试
5. 当行为稳定后，再**导出可复用能力契约**

推荐执行顺序：

1. 先加载 `skills/windows-cua-lab-operator/SKILL.md`
2. 先跑 `npm run preflight:windows`，再跑最小目标任务
3. 先看 replay artifacts 定位问题，再修改 prompt 或运行参数

### 当前阶段状态

- Stage 1：broker 和 trace skeleton —— 已完成
- Stage 2：Paint demo loop —— 已完成
- Stage 3：Calculator validation path —— 已完成
- Stage 4：reusable capability export contract —— 已完成

### 可复用导出契约

这个实验室对外暴露的可复用能力包括：

- `schemas/transition-envelope.json` —— 单步 transition envelope
- `schemas/replay-trace.json` —— 运行级 replay trace 格式
- `schemas/reusable-state-summary.json` —— hypothesis-friendly state summary
- `docs/reports/stage-4-reusable-capability-export.md` —— 导出产物与实验室内部实现的边界说明

这些契约是为了被其他宿主系统消费，而不是要求其他系统必须运行这个实验室本身。

### 社区

欢迎提交 issue 和 pull request！如果你有新的规则想法或者改进建议，也欢迎提出来。同时感谢 linux.do 社区的讨论和反馈，帮助我们不断完善这个项目。
