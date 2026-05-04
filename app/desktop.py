import sys

import webview

from server import start_server


APP_TITLE = "24美术2班常规管理系统"


def main():
    server = None
    try:
        server, url, _thread = start_server(open_browser=False)
        webview.create_window(
            APP_TITLE,
            url,
            width=1360,
            height=860,
            min_size=(1024, 720),
        )
        webview.start()
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    sys.exit(main())
