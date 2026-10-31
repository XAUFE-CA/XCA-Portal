# 字体与资产维护

Status: adopted

本文面向维护者，记录字体角色、资产许可、加载与子集生成。字体配置见 [fonts.css](../../app/assets/css/fonts.css)，生成规则见 [build-font-subsets.py](../../scripts/fonts/build-font-subsets.py)，不在项目技术栈或产品介绍中列出维护细节。

## 字体角色

| 角色 | 字体 | 配置 |
| --- | --- | --- |
| 页面标题、正文、站点文字、导航与控件 | `Noto Sans SC Variable` | 公开的 `--neoverse-font-family-sans` |
| 终端、代码与等宽编号 | `Maple Mono NF CN` | 公开的 `code`、`mono` 字体角色 |

无衬线字体复用共享库的 OFL 字体声明，从 jsDelivr 加载 `@fontsource-variable/noto-sans-sc` 的子集与可变字重，失败时回退系统字体。具体版本由共享库的字体声明维护。

终端常规与 Italic 均使用自托管 WOFF2 子集，保留上游等宽度量。子集的内部家族名为 `XCA Code Subset`，不使用许可证中的保留名称。CSS 的 `Maple Mono NF CN` 是既有兼容别名，公共 code/mono 字体角色保持不变。补全提示使用真实 Italic 字形。子集外字符按共享回退栈尝试显示，覆盖范围以生成清单和实际字体为准。

字体不作为会话外观选项，不恢复字体选择器或替换为整包字体。终端的字宽测量见 [终端扩展接口](terminal-extending.md#背景与字体适配)。

## 加载与许可

字体放在 `app/assets/fonts/`，由 Vite 输出到带内容哈希的 `/_nuxt/` 路径。首页通过 `useHead` 预加载常规字重。

Maple Mono NF CN 上游使用 SIL OFL 1.1，许可证随站点发布在 [public/fonts/OFL.txt](../../public/fonts/OFL.txt)。CA 图形标识来自 SVG，与字体资源分开维护。

浏览器标签页图标以 [ca-mark.svg](../../public/brand/ca-mark.svg) 为唯一图稿来源，不修改源文件或维护图标副本。`nuxt.config.ts` 读取 SVG，仅将 favicon 内存副本的 `viewBox` 调整为 `176 178 928 928`，再编码为 Data URL，使 CA 主体占图标画布宽度约 96%。顶栏与首页继续使用原始 SVG。

## 子集生成

生成器使用上游 Maple Mono NF CN 7.900，覆盖应用可渲染字符、GB2312 一级常用字及终端符号，保留上游 1000 upem、600/1200 等宽度量。实际扫描目录与字符范围由生成脚本维护。预先裁剪属于修改版本，命名依据见 [OFL 官方说明](https://openfontlicense.org/webfonts-and-reserved-font-names/)，生成器默认使用非保留内部名称。

将上游 `maple-mono-nf-cn-{regular,italic}.woff` 放入被忽略的 `fonts-source/`，准备 Python 3.10+、`fonttools` 与 `brotli` 后运行：

```sh
python scripts/fonts/build-font-subsets.py
```

字体输出到 `app/assets/fonts/`，覆盖清单写入 `scripts/fonts/glyph-coverage.json`。新增可渲染中文时更新子集和清单，核对生成差异、字宽与 Italic 字形。工程文档不属于生成器的扫描范围，调整本文不触发字体重建。
