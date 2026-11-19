#!/usr/bin/env python3
"""Moving Man 뷰어용 로컬 정적 서버 (표준 라이브러리만 사용).

기본 http.server 는 HTTP Range 요청을 지원하지 않아서, moov 정보가 파일 끝에 있는
mp4(이 폴더의 영상들이 그렇습니다)는 브라우저에서 탐색(seek)이 안 되거나 처음부터
전부 내려받아야 합니다. 이 서버는 Range(206 Partial Content)를 지원합니다.

사용법:
    python server.py                 # http://127.0.0.1:8000 에서 실행하고 브라우저 열기
    python server.py --port 9000
    python server.py --host 0.0.0.0  # 같은 네트워크의 다른 기기에서도 접속 허용
    python server.py --no-browser
"""

from __future__ import annotations

import argparse
import errno
import http.server
import os
import re
import socket
import sys
import threading
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
CHUNK = 256 * 1024
QUIET_ERRORS = (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)


class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".m4v": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
    }

    _byte_range: tuple[int, int] | None = None

    def end_headers(self) -> None:
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        self._byte_range = None
        range_header = self.headers.get("Range")
        if not range_header:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        match = RANGE_RE.match(range_header.strip())
        if not match or match.group(1) == match.group(2) == "":
            # 여러 구간 요청 등은 전체 응답으로 처리 (RFC 상 허용)
            return super().send_head()

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        try:
            stat = os.fstat(f.fileno())
            size = stat.st_size
            start_s, end_s = match.groups()
            if start_s:
                start = int(start_s)
                end = int(end_s) if end_s else size - 1
            else:  # bytes=-N : 마지막 N바이트
                start = max(0, size - int(end_s))
                end = size - 1
            end = min(end, size - 1)

            if start >= size or start > end:
                f.close()
                self.send_response(416, "Requested Range Not Satisfiable")
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None

            self.send_response(206, "Partial Content")
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
            self.end_headers()
            f.seek(start)
            self._byte_range = (start, end)
            return f
        except Exception:
            f.close()
            raise

    def copyfile(self, source, outputfile) -> None:
        if self._byte_range is None:
            return super().copyfile(source, outputfile)
        remaining = self._byte_range[1] - self._byte_range[0] + 1
        while remaining > 0:
            chunk = source.read(min(CHUNK, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def log_request(self, code="-", size="-") -> None:
        # 영상 스트리밍 중 쏟아지는 206/304 로그는 생략
        if str(code) in ("206", "304"):
            return
        super().log_request(code, size)


class QuietThreadingServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        # 브라우저가 영상 요청을 중간에 끊는 것은 정상 동작이므로 무시
        if isinstance(sys.exc_info()[1], QUIET_ERRORS):
            return
        super().handle_error(request, client_address)


def lan_address() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # 실제로 패킷을 보내지는 않음
            return s.getsockname()[0]
    except OSError:
        return None


def make_server(host: str, port: int, tries: int = 10) -> QuietThreadingServer:
    handler = partial(RangeRequestHandler, directory=str(ROOT))
    last_error: OSError | None = None
    for p in range(port, port + tries):
        try:
            return QuietThreadingServer((host, p), handler)
        except OSError as e:
            if e.errno not in (errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", -1), 10013, 10048):
                raise
            last_error = e
    raise SystemExit(f"포트 {port}~{port + tries - 1} 이 모두 사용 중입니다: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Moving Man 영상 뷰어 로컬 서버")
    parser.add_argument("--host", default="127.0.0.1", help="바인딩할 주소 (기본: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="포트 (기본: 8000, 사용 중이면 다음 번호)")
    parser.add_argument("--no-browser", action="store_true", help="브라우저를 자동으로 열지 않음")
    args = parser.parse_args()

    httpd = make_server(args.host, args.port)
    port = httpd.server_address[1]
    local_url = f"http://127.0.0.1:{port}/"

    print(f"\n  Moving Man 뷰어 실행 중  ->  {local_url}")
    if args.host in ("0.0.0.0", ""):
        ip = lan_address()
        if ip:
            print(f"  같은 네트워크에서 접속     ->  http://{ip}:{port}/")
    print(f"  폴더: {ROOT}")
    print("  종료하려면 Ctrl+C\n")

    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, args=(local_url,)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  서버를 종료합니다.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
