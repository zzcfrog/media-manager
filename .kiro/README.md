# Kiro 规格

本目录保存项目的需求、设计、任务与交付证据。规格描述计划；实际行为以代码和已执行的测试为准。

- 当前规格：[智能分类与标签树维护](specs/smart-classification/requirements.md)，Requirements-First，需求评审草案。
- 退出工作流时保留规格与评审记录；完成状态只能由实际验证和交付报告支持。
- 会话运行状态由 workflow 控制器管理，保存在本机 `.workflow-sessions/`，不纳入版本库。
- 不手写 `tasks.meta.json` 或伪造由 Kiro 管理的 `.config.kiro`。
