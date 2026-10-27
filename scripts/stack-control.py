#!/usr/bin/env python3
"""Lets a Maestro flow stop and start a local stack (tonight-9's "box unreachable", tonight-10's offline log).

Maestro scripts can only make HTTP calls, so scripts/e2e-local.sh runs this on 127.0.0.1:8049 (8049 + 100 x LANE) for the length of a
run: POST /kjbox/stop runs `kj-controller/scripts/local-stack.sh down` in KJBOX_DIR, POST /kjbox/start runs `up`
(which keeps the night and its night_id); POST /decide/stop and /decide/start do the same with decide's
`scripts/local-stack.sh` in DECIDE_DIR (its data lives in gen's Firestore emulator, so a restart keeps it).
Loopback only; nothing else is exposed.

  python3 scripts/stack-control.py --kjbox-dir ../kjbox --decide-dir ../karaoke-decide [--port 8049]
"""

import argparse
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--kjbox-dir", required=True)
    parser.add_argument("--decide-dir")
    parser.add_argument("--port", type=int, default=8049)
    args = parser.parse_args()
    kjbox = Path(args.kjbox_dir).resolve() / "kj-controller" / "scripts" / "local-stack.sh"
    if not kjbox.is_file():
        raise SystemExit(f"no kjbox local-stack script at {kjbox}")
    # path -> (script, argument, extra env)
    commands = {"/kjbox/stop": (kjbox, "down", {}), "/kjbox/start": (kjbox, "up", {})}
    if args.decide_dir:
        decide = Path(args.decide_dir).resolve() / "scripts" / "local-stack.sh"
        if not decide.is_file():
            raise SystemExit(f"no decide local-stack script at {decide}")
        # The lane's gen (scripts/e2e-lane.sh passes it, with the lane's decide and kjbox env, to this process).
        gen = {"GEN_API_URL": os.environ.get("GEN_API_URL", "http://127.0.0.1:8010")}
        commands.update({"/decide/stop": (decide, "down", {}), "/decide/start": (decide, "up", gen)})

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 (http.server API)
            command = commands.get(self.path)
            if command is None:
                self._reply(404, {"error": "not_found"})
                return
            script, arg, extra = command
            run = subprocess.run(
                [str(script), arg],
                cwd=script.parent.parent,
                env={**os.environ, **extra},
                capture_output=True,
                text=True,
                timeout=300,
            )
            ok = run.returncode == 0
            self._reply(200 if ok else 500, {"ok": ok, "output": (run.stdout + run.stderr)[-2000:]})

        def do_GET(self) -> None:  # noqa: N802
            self._reply(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

        def _reply(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt: str, *a: object) -> None:
            print(f"stack-control: {fmt % a}", flush=True)

    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
