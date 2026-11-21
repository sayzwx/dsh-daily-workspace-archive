# dsh-monitor · 监控台

DeepSeek Harness（DSH）插件：在左侧面板列表里加一个「监控台」入口（排在「插件」上面），
按模型和按任务查看每个模型的调用量、缓存命中率、tokens 明细与花费。

数据来自本机会话日志，不联网、不上传；装好以后历史会话会在后台自动补录。

## 功能

**概览图表**

- 环形分布图：按 tokens / 调用次数 / 花费看各模型占比（前 4 个模型 + 其他）
- 折线对比图：前 4 个模型按天的用量趋势，可切换指标
- 都跟随右上角的时间范围（今天 / 7 天 / 30 天 / 全部）

**按模型**

- 每个模型一行：来源（provider）、调用次数、tokens、缓存命中率、花费
- 同名模型不同来源分开统计（`provider::model`）
- 点开单个模型：价格说明、每日用量柱图（tokens / 调用 / 花费可切换）、
  tokens 构成环形图、平均每次调用 tokens / 输出 / 花费、首次与最近调用时间、未定价调用数、按任务拆分明细
- 范围筛选：今天 / 7 天 / 30 天 / 全部

**按任务**

- 按项目（工作目录）分组，项目内按任务（会话）列出
- 每个任务展开可看各模型的单独用量与命中率
- 项目展开可看该项目的模型占比环形图与模型汇总，点模型名可跳到模型视图

**计价**

- 官方 DeepSeek 模型（provider 为 `deepseek` / `deepseek-account` 等）按官方价自动计算，
  按每次调用的时间自动切换高峰 / 空闲价，无需填写：

  | 模型 | 高峰（输入 / 输出 / 缓存读） | 空闲（输入 / 输出 / 缓存读） |
  | --- | --- | --- |
  | deepseek-flash | ¥2 / ¥8 / ¥0.04 | ¥1 / ¥4 / ¥0.02 |
  | deepseek-v4-pro | ¥9 / ¥27 / ¥0.30 | ¥4.5 / ¥13.5 / ¥0.15 |

  单位：人民币 / 百万 tokens。高峰为北京时间周一至周五 9:00-12:00、14:00-18:00。
- 第三方 / 自定义模型在「定价」里填输入、输出、缓存读、缓存写四个单价即可；
  没填的模型显示「未定价」，用量照常统计但不计入花费（不会假装是 ¥0）。
- 自定义单价优先于官方价。价格与用量都可以随时改，改完立即生效。

## 安装

```powershell
git clone https://github.com/sayzwx/dsh-daily-workspace-archive.git dsh-monitor
```

然后在 DSH 会话里让 agent 执行（或直接调用 `plugin_manager` 工具）：

```powershell
plugin_manager install_bundle target:<本目录绝对路径>
```

安装后刷新 DSH 窗口，左侧面板列表最上面会出现「监控台」。

## 数据与接口

- 明细：`$DSH_HOME/dsh-monitor/usage.jsonl`，一次模型调用一行
- 索引与价格：`$DSH_HOME/dsh-monitor/meta.json`
- 宿主路由（本机）：
  - `GET /dsh-monitor/data?from=&to=&task=` — 聚合后的模型 / 任务 / 项目用量
  - `GET|POST /dsh-monitor/config` — 价格表
  - `POST /dsh-monitor/rescan` — 重新扫描历史会话

会话日志是唯一事实来源：插件监听 `session/event` 实时记账，启动时用
`sessionPersistence` 补扫已完成的历史会话，按 `session + seq` 去重。

## 说明

- 只读本机会话日志，不修改任何会话内容。
- 花费是本地按价格表算出来的估算值，官方账单请以 DeepSeek 用量页为准（面板底部有直达链接）。

## License

MIT
