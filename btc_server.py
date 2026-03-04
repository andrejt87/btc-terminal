#!/usr/bin/env python3
"""BTC Terminal HTTP server with CGI support and no-cache headers."""

import sys
import os
from http.server import HTTPServer, CGIHTTPRequestHandler


class NoCacheCGIHandler(CGIHTTPRequestHandler):
    """CGI handler that adds cache-control headers to prevent stale files."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(("0.0.0.0", port), NoCacheCGIHandler)
    print(f"[BTC Terminal] Serving on http://0.0.0.0:{port}")
    server.serve_forever()
