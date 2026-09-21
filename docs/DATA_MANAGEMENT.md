# 数据管理第一版

## 使用

入口：http://127.0.0.1:3100/data-management 。登录后从左侧“数据管理”进入。

1. 选择 SAMI3 NetCDF 文件，点击“上传并解析”。支持 `.nc`、`.nc4` 和无扩展名的 `content`，实际校验文件内容。
2. 等待解析完成，检查原始网格、单位、经纬度及高度范围、可用时刻。
3. 选择一个 UTC 时刻，点击“将此时刻入库”。后台转换后显示“已入库”；失败任务提供错误提示和重试。
4. 点击任务的“打开三维”。页面通过 `importId` 固定读取这个时刻，刷新不会退回旧 CLI 快照。“山东范围”可应用四层科研切片，也可在地图上绘制研究区域。

文件传输进度是真实上传进度；转换只显示阶段，不宣称精确转换百分比。预览校验结构、坐标、单位和首时刻，其他时刻在各自导入时校验。

## 存储与数据库

采用“大文件落盘，管理元信息入数据库”，不把所有体网格逐点塞进 SQLite。

- `IonosphereDataset`：UUID、所属用户、原文件名、大小、SHA256、预览、解析状态和错误。
- `IonosphereImport`：所属数据集、时刻索引/时间、任务状态/阶段、错误；数据集与时刻索引唯一。
- 原文件副本：`data/ionosphere/datasets/{datasetId}/source.nc`。
- 独立任务产物：`data/ionosphere/datasets/{datasetId}/imports/{importId}/`，含标准/精细分辨率和校验元数据。
- 同一数据集同一时刻重复提交返回已有任务，失败时可重试；重复上传文件本身不按 SHA 去重。
- 不覆盖旧 `data/ionosphere/sami3/current.json`，原 CLI 入口仍可使用。

本地数据库只新增两表及索引。升级前备份：`/tmp/cesiumut-db-backup.pbSs0M/db.sqlite3`（临时目录备份，不替代长期备份策略）。迁移：`migrations/models/1_20260908180918_update.py`。

## API

前缀 `/api/v1/ionosphere`，沿用项目 token 鉴权；JSON 成功响应为 `{code:200,data:...}`。

| 方法与路径 | 用途 |
| --- | --- |
| POST `/datasets/upload?filename=...` | 原始文件请求体，`application/octet-stream`，非 multipart |
| GET `/datasets?page=1&pageSize=20` | 分页列表 |
| GET `/datasets/{id}` | 预览、所有时刻、入库任务 |
| POST `/datasets/{id}/inspect` | 失败解析重试 |
| POST `/datasets/{id}/imports` | 请求体 `{"timeIndex":72}` |
| GET `/volume/metadata?source=sami3&importId=...` | 指定已入库任务元数据 |
| GET `/volume?source=sami3&importId=...&volumeId=...` | 相同任务及内容版本的 Float32 数据 |

普通用户仅访问自己的数据，管理员可访问全部，停用用户拒绝。前端离开管理页清空缓存并取消在途请求，防止换账号后显示旧详情；后端独立执行归属校验。

## 限制和运行

后端从项目根目录运行 `.venv/bin/python run.py`，前端在 `web` 运行 `pnpm dev --host 127.0.0.1 --port 3100`。

第一版面向本地单 API 进程：独立工作进程串行执行 NetCDF 解析，任务队列软上限 16。重启时把遗留解析/排队/处理中任务标记为失败，允许手动重试；已完成任务保留。

单文件上限 1 GiB，最多 4096 时刻、单时刻 800 万格，每个空间轴至少 2 点；先检查形状再读取数组。上传审计不读取二进制请求体，超限/中断只清理本次未完成文件。

当前支持 `dene0(nt,nlat,nlon,nalt)` 及 `time/lon/lat/alt` 的 SAMI3 格式、全球周期经度，转换高度沿用 90–1000 km 与原数据交集。原始 90–2200 km 预览不表示全部高度都进入当前渲染网格。Ne 统一为 m⁻³，使用真实数据及统一色标，不人为添加红色核心。

尚无通用 NetCDF 变量映射、自动全时序批量入库、删除、跨用户共享、磁盘配额、独立持久任务队列、工作进程崩溃自动重建。不要将此版作为公网生产上传服务直接开放。

## 实测与验证（2026-09-09）

- 页面上传 `/Volumes/应用磁盘/ChromeDownLoad/content`，497,680,368 字节；原输入未修改，新增一份受管理副本。
- 原始网格 60×72×100，144 时刻，cm⁻³ → m⁻³。
- 数据集 `8515b63d-9e82-4a4d-9620-db2593b1586b`，时刻 #72：`2019-04-25T12:00:00Z`。
- 导入任务 `7157199a-7c06-4216-94ef-c5d98c30ad27` 已完成；三维标准网格 72×36×32，刷新保持时刻。手动切换数据源清除 importId。
- 山东切片点击：118.353°E、34.428°N、400.00 km，Ne = 2.33×10¹¹ m⁻³。偏蓝来自该时刻真实相对值。
- 管理页 776×863 无横向溢出，入库按钮可滚动访问；页面控制台 0 errors / 0 warnings。
- 后端 24 项测试、Ruff 通过；前端 75 项测试、类型检查、生产构建通过；ESLint 0 errors / 9 warnings（包含管理页 class 排序提示）。
- 独立审查发现空维度可绕过乘积限额，已用真实 header-only NetCDF 失败回归复现并修复；审查任务后续因用量限制未给出完整最终报告，未宣称全面审查通过。

截图：`output/playwright/data-management-final.png`、`output/playwright/dataset-volume-final.png`。
