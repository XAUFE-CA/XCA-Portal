# 首页入场

Status: adopted

本文描述首页场景、启动输出与终端归位的协作。命令和会话接口见 [终端扩展接口](terminal-extending.md)，导航、主题与共享材质接入见 [站点框架](site-shell.md)。文档职责独立，源码仍由首页组件与终端 presentation 共同承担。

## 源码职责

| 位置 | 职责 |
| --- | --- |
| [HeroSection.vue](../../app/components/home/HeroSection.vue) | 装配会话服务、标题轮播、场景与终端视图 |
| [CaIntroMark.vue](../../app/components/home/CaIntroMark.vue) | 品牌 SVG 与场景绘制的 Vue 适配 |
| [useTerminalPresentation.ts](../../app/features/terminal/presentation/useTerminalPresentation.ts) | 入场阶段、启动输出、暂停、跳过与清理 |
| [intro-geometry.ts](../../app/features/terminal/presentation/intro-geometry.ts) | 场景尺度、安装坐标与道路生长 |
| [intro-journey.ts](../../app/features/terminal/presentation/intro-journey.ts) | 摄像机插值、终端投影与归位轨迹 |
| [intro-mark-mesh.ts](../../app/features/terminal/presentation/intro-mark-mesh.ts)、[intro-mark-renderer.ts](../../app/features/terminal/presentation/intro-mark-renderer.ts) | 网格生成与 WebGL 绘制 |
| [timing.ts](../../app/features/terminal/presentation/timing.ts)、[boot-script.ts](../../app/features/terminal/presentation/boot-script.ts) | 节奏倍率、交接进度与启动日志顺序 |
| [intro-journey.css](../../app/assets/css/intro-journey.css) | 场景布局与路牌样式 |

场景尺度、节奏倍率和投影阈值由上表源码维护，不在文档另设数值表。`useTerminalPresentation` 直接引用 `CaIntroMark` 的组件类型，`HeroSection` 直接装配终端内部接口；当前未提供独立的入场插件接口。

## 启动与会话

每次完整加载首页都会播放入场，客户端路由返回保留会话并跳过自动重播。`xca intro` 重播前复用 `Session.resetWelcome` 恢复初始输出，保留命令历史、身份、目录和外观。重播、跳过和展开共用唯一的真实 TerminalHost，不创建替代终端或第二份会话。

减少动画偏好下自动跳过空间入场，主动重播仍展示可读的启动消息与 ASCII，省略位移和缩放。文字阅读节奏独立于空间动画时长。`public/intro-gate.js` 在首帧前设置首页入场状态，避免正常布局提前闪现；入场状态仅在首页设置。

首页标题从 `app/data/hero-sentences.json` 读取双语轮播内容。终端交互开始后，标题完成当前文字单元再暂停并隐藏光标；点击终端外部恢复，不能仅靠 mouseleave 恢复。

## 场景绘制

`CaIntroMark` 使用 `public/brand/ca-mark.svg` 的三个路径。网格沿原轮廓生成前后盖与连续侧壁，保留 CA 的凹形开口。CA 与道路合成一次 WebGL 绘制并使用同一深度缓冲，侧板与牌面由组件和 CSS 展示。标识填色、厚度增长与摄像机运动同时启动，实体透明度和厚度取自同一填色进度。

摄像机先从 C 左侧观察标识，再回正到 A 的开口前方并进入道路。道路生长距离和显现进度取自当前摄像机位置，不另设运动时序。路牌与支架复用安装坐标和显现函数，牌面朝向道路轴线，标题来自现有双语资源，并标注真实路由或命令。

场景颜色、圆角与时长基础值取自共享 UI 的公开 token，门户维护场景几何和节奏倍率。道路保留透光、柔光与边缘色，不独立实现实时背景模糊。WebGL 不可用或上下文丢失时保留 SVG 标识与终端入场；卸载时释放缓冲、程序、监听与逐帧任务。

## 终端交接

穿梭末段按摄像机距离投影真实终端，再在终端可读后开始日志。归位从当前实际投影出发，位移与缩放保持连续，不在场景结束后另建交接实例。

空间退场由实际输出驱动：`boot.start` 开始日志并保留空间运动；`boot.content` 触发道路退场、页面显现与终端归位；`boot.ready` 等待归位完成后显示最后一行日志。日志完整播放后逐行输出欢迎字符画和文字，再启用正常命令输入。进度条表示阅读进度，不控制场景。

入场使用 WAAPI，这类变换不触发 CSS motion 事件。编排在动画期间调用唯一共享 `glassRenderer.refresh()` 跟踪终端几何；变换延迟期不逐帧刷新。折射边缘仍由共享 Glass Runtime 绘制。

## 中断与验证

视口尺寸改变时结束入场并恢复正常布局。偏好变化、跳过和卸载取消同一组动画、异步任务与绘制；暂停与恢复不创建第二条时间线。

几何与网格单元测试位于终端 presentation；浏览器回归入口为 `tests/e2e/terminal-journey.spec.ts`、`terminal-intro-continuity.spec.ts`、`terminal-motion.spec.ts` 与 `hero-typewriter.spec.ts`。检查方式见 [工程质量契约](engineering-quality.md#分级与执行责任)，实际通过情况保存在带日期的审计记录中。自动化结果不等同最终视觉验收。
