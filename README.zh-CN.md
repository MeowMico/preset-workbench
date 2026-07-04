# Preset Workbench

Preset Workbench 是一个 SillyTavern 预设工作台，用来编辑 Chat Completion 预设里的 prompt 条目、role、位置，并为预设保存本地版本历史。

## 功能

- 读取 SillyTavern 原生 preset 文件。
- 可视化编辑 `prompts` 与 `prompt_order`：启用状态、排序、role、插入位置、深度、顺序、触发器和正文。
- 保存前自动创建 `Before workbench save` 快照，保存后创建带备注的版本。
- 支持给版本标注模型、角色卡、备注。
- 支持选择历史版本并回滚；回滚前会自动创建 `Before restore` 快照。
- 提供 diff 视图，对比当前文件或上一版本。
- 提供生成请求控制台，捕获浏览器发出的生成请求 JSON，显示最终的 `messages` 或 `prompt` 格式。

## 安装

把 `preset-workbench-main` 放进 SillyTavern 的第三方扩展目录，或用扩展安装器安装这个目录对应的仓库路径。安装后从扩展菜单打开 `Preset Workbench`。

服务端历史记录保存在：

```text
backups/preset-workbench/<apiId>/<presetName>/
```

## 说明

当前版本重点适配 Chat Completion/OpenAI 预设。其它 SillyTavern 预设分组可以列出、保存、快照和回滚，但可视化编辑器主要针对包含 `prompts` / `prompt_order` 的预设结构。

控制台只记录当前浏览器页面发起的生成请求；已经发出的历史请求不会 retroactively 补录。
