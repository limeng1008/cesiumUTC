# 三维电离层参数场 · 第一阶段交付说明

## 1. 已实现内容

正式入口 `/ionosphere`，菜单“三维电离层”。继续复用 vue-fastapi-admin、现有登录页、深蓝布局、鉴权和审计；没有重建模板或加入卫星、时间维度、预警。

- WGS84 地球外 80–1000 km 的真实 GPU Volume；不是 Entity、点云或多层球壳。
- 电子密度 Ne（m⁻³）、默认 log10 和可切换 linear、三种共享科学 LUT。
- 高度裁剪、Ne 范围过滤、全局透明度、低值/满值阈值、三档射线步长。
- 空间点击探针、指定坐标查询，默认三线性插值，可选最近邻。
- 同一三维场的指定高度切片，独立显隐、与体叠加或单独显示。
- 两档网格、加载和错误提示、资源释放、开发诊断。
- 等值面、纬向/经向/路径剖面保留禁用入口并标明“暂未开发”。

## 2. 关键文件与职责

| 路径（相对仓库根目录） | 职责 |
| --- | --- |
| `web/src/views/ionosphere/volume/index.vue` | 正式页面与已有主题融合 |
| `web/src/components/ionosphere/VolumeControlPanel.vue` | 控件与合法数值提交 |
| `web/src/components/ionosphere/VolumeProbePanel.vue` | 采样、网格、限制和诊断 |
| `web/src/models/ionosphere/IonosphereVolume.ts` | 无 Cesium 依赖的规则场、设置契约 |
| `web/src/models/ionosphere/validation.ts` | metadata/二进制/极值验证 |
| `web/src/store/ionosphere/volume.ts` | Pinia 状态、80 ms 配置合并 |
| `web/src/services/ionosphere/ionosphereApi.ts` | 复用 token 的 JSON + binary fetch |
| `web/src/cesium/ionosphere/IonosphereVolumeController.ts` | 请求取消、版本保护、渲染器协调 |
| `web/src/cesium/ionosphere/renderer/IonosphereVolumeRenderer.ts` | 可替换的渲染抽象接口 |
| `web/src/cesium/ionosphere/renderer/CesiumVoxelRenderer.ts` | 实验 Voxel API 适配、着色器和生命周期 |
| `web/src/cesium/ionosphere/provider/IonosphereVoxelProvider.ts` | 单 tile、Float32 通道、经度 halo |
| `web/src/cesium/ionosphere/shader/transferFunction.ts` | 独立颜色/alpha、CPU/GPU 同一 LUT |
| `web/src/cesium/ionosphere/interaction/IonospherePicking.ts` | WGS84 射线坐标和可见代表点 |
| `web/src/cesium/ionosphere/renderer/HeightSlice.ts` | 同源数据切片及纹理上传 |
| `web/src/utils/ionosphere/interpolation.ts` | 周期经度、网格索引、三线性插值 |
| `app/services/ionosphere.py` | 确定性 Mock 及缓存 |
| `app/api/v1/ionosphere/__init__.py` | FastAPI metadata/二进制路由 |

## 3. 数据结构

核心数据是 `Float32Array`，X=经度（最快），Y=纬度，Z=高度：

```text
index = z * latitude.count * longitude.count + y * longitude.count + x
```

统一使用 cell-center：min/max 是单元边界，`step=(max-min)/count`，采样点为 `min+(index+0.5)*step`。不混用端点节点网格；标准高度步长为 28.75 km，精细为 14.375 km。经度 [-180,180]，纬度 [-90,90]，高度 [80,1000] km。

metadata 明确 `sampling=cell-center`、`altitudeUnit=km`、`order=zyx`、`dtype=float32`、`byteOrder=little`、实际 min/max、byteLength、SHA256 id。校验维数、step、长度、NaN/Infinity 和实际极值，最多接收 200 万格。

## 4. GPU 渲染

当前 Cesium 1.133.0 已支持 `VoxelPrimitive + VoxelShapeType.ELLIPSOID + CustomShader`，未升级 Cesium。WGS84 radii 构造 shapeTransform；经纬度边界转弧度，高度转米。

Provider 向 GPU 提供 Ne 和有效性两个 Float32 通道，经度首尾各复制一个 halo 单元供跨 ±180° 线性插值。原始科研数组仍由独立模型拥有。GPU 先插值 Ne，再归一化，再映射共享的 Viridis / Scientific Turbo-like / 蓝青绿黄红 LUT；alpha 独立 smoothstep，并按 500 km 参考路径的消光公式积分，避免质量/网格切换改变透明度含义。开启原生深度测试阻止背面体数据穿透地球。

质量映射：性能 step=2/SSE=8，标准 1/4，高质量 0.5/1。当前只有一个 tile，**没有多层 LOD**，SSE 已设置但实际质量差别主要来自 raymarch step。

## 5. 确定性 Mock

后端生成连续垂直 E 区小峰、F1 肩部、F2 主峰及峰后衰减；主峰约 250–350 km，随纬度改变，叠加纬向结构与缓慢、周期性的经向扰动。不调用随机数。它用于算法和可视化验证，**不是实测、IRI 或可直接科研解释的物理模型**。两档生成结果以不可变缓存复用。

## 6. Picking

优先调用官方 `scene.pickVoxel`，解码含 halo 的索引。在相机射线与可见高度域的相交区间内离散取样，优先选择官方命中单元内的最大 alpha 样点；官方低透明度漏选或其样点不可见时，回退到该射线可见区间内最大 alpha 的样点。地球遮挡截断搜索范围，高度与 Ne 过滤同样约束结果。

返回经纬度、WGS84 geodetic 高度、源网格索引、插值 Ne。**这是一条透明视线上的代表点，不是唯一体表面，也不是直接读取 GPU 合成颜色。** 最多 8192 个区间，本项目两档网格默认不超过四分之一高度层间距；极薄过滤带仍可能漏选。切片则以指定 geodetic 高度求交，Newton 修正椭球初始近似。

## 7. 插值

八邻居三线性插值独立于 Cesium。经度周期 wrap；纬度和高度的半格边缘采用最近中心延拓；范围外为 null；正权重邻居包含 noData 时结果为 null。最近邻仅为显式可选模式。切片对相同三维数组插值，不重新生成 Mock。

## 8. API

```text
GET /api/v1/ionosphere/volume/metadata?resolution=standard|fine
GET /api/v1/ionosphere/volume?resolution=standard|fine
```

均沿用 `token` header 鉴权；metadata 使用原框架 Success.data JSON，体数据是 `application/octet-stream` 的 little-endian Float32。`X-Volume-Id` 和 ETag 与 metadata.id 一致。二进制不经过 JSON axios 拦截器；原审计中间件对二进制仅记录类型/长度，避免吞掉或 JSON 序列化 bytes。

## 9. 性能记录

2026-09-06，本机 Apple M4 Pro，ANGLE Metal，Chromium WebGL2，1500×1000。每档 110 次鼠标拖动，输入间隔 16 ms；以下为页面最近活动渲染窗口，**受自动化节奏影响，不是硬件极限测试**。

| 网格 | 体素数 | API bytes | warm API+解码 | 性能/标准/高质量 fps | 双通道纹理数据下限 |
| --- | ---: | ---: | ---: | --- | ---: |
| 72×36×32 | 82,944 | 331,776 | 26 ms | 30.0 / 33.0 / 29.9 | 0.65 MiB |
| 144×72×64 | 663,552 | 2,654,208 | 22 ms | 30.0 / 30.0 / 30.1 | 5.13 MiB |

CPU 提交约 0.2–1.1 ms，不等于 GPU 绘制时长。较早冷生成实测约 46/366 ms，浏览器 fine 首次 API+解码约 386 ms；上表为缓存热加载，**不含首次 Cesium 运行库加载与 GPU 就绪时间**。浏览器不提供总显存数据，纹理下限不含 atlas、framebuffer、底图等开销。静止按需渲染的低 fps 不应作为交互性能。

## 10. 验证

复跑命令：

```sh
cd web
pnpm type-check
pnpm lint
pnpm test
pnpm build
# 仓库根目录
.venv/bin/python -m unittest discover -s tests -p 'test_ionosphere*.py' -v
.venv/bin/ruff check app
```

前端 21 项（数学、契约、LUT、Provider、真实 Cesium 擦边/遮挡拾取、设置保护、资源同步）；后端 10 项（确定性、物理轮廓、索引、API、token、版本一致性）。type-check 对本轮核心 TS 严格检查，不代表历史所有 Vue/JS 已迁移 TypeScript。lint 0 errors / 8 旧 warnings。

实际浏览器证据保存于 `output/playwright/`（不提交截图目录）。300 km 切片采样 6.26×10¹¹，450 km 同视线采样 3.58×10¹¹；0.01 透明度仍可点击；F 区点击高度 399.99 km；透明度 0 与 Ne 全部超范围的地球 canvas PNG SHA1 完全相同，均无探针命中。

最终构建与异常/生命周期浏览器验收结果见本文件末尾的收尾记录。

## 11. 限制

- Voxel 为 Cesium 实验性 API；仅实际验证当前 Chromium/WebGL2/Apple GPU，不保证所有浏览器和集显。
- Cesium ELLIPSOID 的等高面求交使用扩展椭球近似，不能通过屏幕像素量测精密高度。数值查询采用自己的 WGS84/网格模型。
- 切片以 0.5° 三角几何近似等高面、360×180 纹理表示，视觉存在弦高/像素插值误差；定量值以原始网格采样为准。
- 单 tile 无真实多级 LOD；探针为有限步长代表点，极薄数据可能漏选。
- 着色器/渲染错误提示后建议重新加载页面，Cesium 默认 render loop 在 GPU 错误后可能停止。
- 构建仍有既有 UnoCSS 弃用提示、混合静态/动态导入与大包警告。
- 资源准备脚本将旧生成 Cesium 资源保存在 `web/node_modules/.cache/cesium-backup-*`，可恢复，但多次准备会增加缓存占用。未删除用户数据。

## 12. 下一阶段

仅建议：真实 NetCDF/HDF5/IRI 等数据在后端统一为本契约；基于独立三维数组的等值面（Marching Cubes）；经向、纬向及路径剖面分析。

## 最终收尾记录（2026-09-06）

- `pnpm type-check`、`pnpm test`（21/21）、`pnpm build` 均 exit 0；`pnpm lint` exit 0（8 条既有警告）。后端 unittest 10/10、全 app Ruff 通过。
- Playwright 注入 metadata HTTP 503、空 metadata、只有 3 bytes 的体数据，分别显示对应可读错误；清除拦截后正常加载，测试期间未捕获未处理 pageerror。正常页面 console error 为 0；故障注入时预期的 HTTP/network error 不算正常运行错误。
- 三次路由往返：离开后 Cesium canvas=0，返回 canvas=1，无错误提示。另在 metadata 请求悬挂时离开，客户端实际产生 `net::ERR_ABORTED`，离开 canvas=0，再进入 canvas=1，无过期响应覆盖。
- 空高度/Ne 输入恢复合法值；最低高度输入 1000 被约束为 999–1000 km，未进入零厚度/非有限 GPU 配置。
- 实际查看正面、极区、侧向、近景；两档网格三种质量连续拖动已测。log/linear、三色带、300/450 km 切片、Ne 全过滤、opacity 0 和 0.01 已回归。
- 临时技术验证 `web/public/voxel-check.html` 已移除，正式运行不依赖该测试页。前后端服务 HTTP 200。
