# 24美术2班常规管理系统

这是一个面向班级日常管理的本地应用，包含座位表、清洁管理、随机抽选、班级配置、数据导入导出和本地自动保存功能。



## 项目结构

```text
.
├── app/
│   ├── desktop.py
│   ├── server.py
│   ├── docs/
│   │   └── 24美术2班教室 6S 管理标准与执行规定.pdf
│   └── web/
│       ├── index.html
│       ├── app.js
│       ├── styles.css
│       └── vendor/
│           └── html2canvas.min.js
├── tools/
│   └── ensure_python.bat
├── build_desktop.bat
├── classroom_desktop.spec
├── requirements-desktop.txt
├── start.bat
└── start_desktop.bat
```

## 启动方式

### 网页版

双击运行：

```bat
start.bat
```

脚本会检查 Python，然后启动本地服务并打开浏览器。

### 桌面版

双击运行：

```bat
start_desktop.bat
```

脚本会检查 Python 和桌面依赖，缺少依赖时会自动执行：

```bat
python -m pip install -r requirements-desktop.txt
```

## 打包桌面程序

双击运行：

```bat
build_desktop.bat
```

成功后程序会输出到：

```text
dist\24美术2班常规管理系统\24美术2班常规管理系统.exe
```

## 数据保存和配置

系统支持选择一个 JSON 文件作为自动保存文件。选择后，本地会生成：

```text
.classroom-manager-config.json
```

这个文件保存的是本机备份路径，例如 `D:\...\备份.json`，不适合提交到 GitHub，已经加入 `.gitignore`。

如需参考格式，可查看：

```text
.classroom-manager-config.example.json
```


