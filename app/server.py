import json
import mimetypes
import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
import webbrowser


SOURCE_ROOT = Path(__file__).resolve().parent
RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", SOURCE_ROOT)).resolve()
APP_ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else SOURCE_ROOT.parent
CONFIG_PATH = APP_ROOT / ".classroom-manager-config.json"
WEB_ROOT = RESOURCE_ROOT / "web"
INDEX_FILE = WEB_ROOT / "index.html"
DEFAULT_PORT = 8765


def load_config():
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(config):
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def get_backup_path():
    raw_path = load_config().get("backupPath")
    if not raw_path:
        return None
    return Path(raw_path)


def atomic_write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp_path, path)


def choose_backup_file():
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        return None, f"文件选择窗口不可用：{exc}"

    result = {"path": None}

    def open_dialog():
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.asksaveasfilename(
            title="选择或创建班级管理系统备份文件",
            initialdir=str(APP_ROOT),
            initialfile="24美术2班常规管理系统备份.json",
            defaultextension=".json",
            filetypes=[("JSON 备份文件", "*.json"), ("所有文件", "*.*")]
        )
        root.destroy()
        result["path"] = selected

    thread = threading.Thread(target=open_dialog)
    thread.start()
    thread.join()
    if not result["path"]:
        return None, "已取消选择"
    return Path(result["path"]), None


class ClassroomHandler(BaseHTTPRequestHandler):
    server_version = "ClassroomManager/1.0"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self.handle_get_state()
            return
        if parsed.path == "/api/backup/status":
            self.handle_backup_status()
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self.handle_post_state()
            return
        if parsed.path == "/api/backup/select":
            self.handle_select_backup()
            return
        self.send_json({"ok": False, "error": "Unknown API"}, status=404)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        data = self.rfile.read(length).decode("utf-8")
        return json.loads(data or "{}")

    def handle_get_state(self):
        backup_path = get_backup_path()
        if not backup_path:
            self.send_json({
                "ok": False,
                "source": "none",
                "backupPath": None,
                "error": "尚未选择自动保存文件"
            })
            return
        if not backup_path.exists():
            self.send_json({
                "ok": False,
                "source": "missing",
                "backupPath": str(backup_path),
                "error": "自动保存文件不存在"
            })
            return
        try:
            state = json.loads(backup_path.read_text(encoding="utf-8"))
            self.send_json({
                "ok": True,
                "source": "file",
                "backupPath": str(backup_path),
                "state": state
            })
        except Exception as exc:
            self.send_json({
                "ok": False,
                "source": "invalid",
                "backupPath": str(backup_path),
                "error": f"自动保存文件读取失败：{exc}"
            })

    def handle_post_state(self):
        try:
            body = self.read_json_body()
            state = body.get("state", body)
            backup_path = get_backup_path()
            if not backup_path:
                self.send_json({
                    "ok": False,
                    "source": "none",
                    "backupPath": None,
                    "error": "尚未选择自动保存文件"
                }, status=409)
                return
            atomic_write_json(backup_path, state)
            self.send_json({"ok": True, "backupPath": str(backup_path), "savedAt": int(time.time() * 1000)})
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=500)

    def handle_select_backup(self):
        try:
            body = self.read_json_body()
        except Exception:
            body = {}
        selected_path, error = choose_backup_file()
        if not selected_path:
            self.send_json({"ok": False, "cancelled": True, "error": error})
            return

        config = load_config()
        config["backupPath"] = str(selected_path)
        save_config(config)

        state = body.get("state")
        if state is not None and not selected_path.exists():
            atomic_write_json(selected_path, state)

        self.send_json({
            "ok": True,
            "backupPath": str(selected_path),
            "exists": selected_path.exists()
        })

    def handle_backup_status(self):
        backup_path = get_backup_path()
        if not backup_path:
            self.send_json({"ok": True, "connected": True, "backupPath": None, "exists": False})
            return
        self.send_json({
            "ok": True,
            "connected": True,
            "backupPath": str(backup_path),
            "exists": backup_path.exists()
        })

    def serve_static(self, request_path):
        if request_path in ("", "/"):
            target = INDEX_FILE
        else:
            relative = unquote(request_path.lstrip("/")).replace("/", os.sep)
            target = (WEB_ROOT / relative).resolve()

        try:
            target.relative_to(WEB_ROOT)
        except ValueError:
            self.send_error(403)
            return

        if not target.exists() or not target.is_file():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def find_port(start_port):
    for port in range(start_port, start_port + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("没有可用端口")


def create_server(start_port=DEFAULT_PORT):
    os.chdir(WEB_ROOT)
    port = find_port(start_port)
    server = ThreadingHTTPServer(("127.0.0.1", port), ClassroomHandler)
    url = f"http://127.0.0.1:{port}/"
    return server, url


def start_server(open_browser=False, daemon=True, start_port=DEFAULT_PORT):
    server, url = create_server(start_port)
    print(f"24美术2班常规管理系统已启动：{url}")
    if open_browser:
        webbrowser.open(url)
    thread = threading.Thread(target=server.serve_forever, daemon=daemon)
    thread.start()
    return server, url, thread


def main():
    server, url = create_server()
    print(f"24美术2班常规管理系统已启动：{url}")
    print("关闭此窗口即可停止本地服务。")
    if "--no-open" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
