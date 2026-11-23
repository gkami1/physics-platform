"""Full-stack smoke test through Caddy: pages, practice, variants, sign-in, tutor.

    docker compose -p pp-check -f infra/compose.yaml up --build -d   (API_ENV=dev: scripted tutor)
    uv run python infra/smoke.py http://localhost:8080 pp-check

Reads the login code from the API log, so the stack must run without SMTP.
"""

import re
import subprocess
import sys
import time

import httpx

BASE, PROJECT = sys.argv[1], sys.argv[2]
ok = True


def check(name: str, cond: bool, detail: object = "") -> None:
    global ok
    cond = bool(cond)
    ok &= cond
    print(
        f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else "")
    )


# trust_env=False: Windows system proxies would otherwise intercept localhost.
c = httpx.Client(
    base_url=BASE, headers={"Origin": BASE}, timeout=30, follow_redirects=False, trust_env=False
)

# Pages
for p in [
    "/",
    "/ege-physics/practice/",
    "/ege-physics/variants/",
    "/ege-physics/variants/1/",
    "/ege-physics/tasks/kin-0001/",
    "/ege-physics/theory/mech.kinematics.basics/",
    "/login/",
]:
    r = c.get(p)
    check(f"GET {p}", r.status_code == 200, r.status_code)
r = c.get("/ege-physics/tasks/")
check("old /tasks/ redirects to practice", "url=/ege-physics/practice" in r.text, r.status_code)
check("404 page", c.get("/nope/").status_code == 404)
h = c.get("/").headers
check(
    "security headers",
    h.get("x-frame-options") == "DENY" and h.get("x-content-type-options") == "nosniff",
)
html = c.get("/ege-physics/variants/1/").text
check("variant page has no solution text", "## Решение" not in html and "v_0 + at = 2" not in html)
check("health", c.get("/api/health").json().get("status") == "ok")

# Anonymous practice
r = c.post("/api/tasks/kin-0001/attempts", json={"answer": "12,5"})
check(
    "anon attempt correct", r.status_code == 200 and r.json()["outcome"] == "correct", r.text[:120]
)
check("task status solved", c.get("/api/tasks/status").json()["tasks"].get("kin-0001") == "solved")
r = c.post(
    "/api/tasks/kin-0001/attempts", json={"answer": "1"}, headers={"Origin": "https://evil.example"}
)
check("CSRF: foreign Origin rejected", r.status_code == 403, r.status_code)

# Variant
tasks = ["kin-0001", "dyn-0001", "kin-0002", "meas-0001", "dyn-0002"]
r = c.post(
    "/api/variants/runs",
    json={
        "exam_id": "ege-physics",
        "variant": 1,
        "tasks": tasks,
        "answers": {"kin-0001": "12,5", "kin-0002": "31", "dyn-0001": "7"},
        "duration_s": 1234,
    },
)
check("variant submitted", r.status_code == 201, r.text[:200])
run = r.json()
check("variant Part 1 scored", run.get("auto_points") == 3 and run.get("pending") == 1, run)
r = c.put(f"/api/variants/runs/{run['id']}/self-assessment", json={"points": {"dyn-0002": 2}})
check("self-assessment", r.status_code == 200 and r.json()["total_points"] == 5, r.text[:200])
r = c.post("/api/tasks/dyn-0002/reveal")
check("Part 2 solution reveal", r.status_code == 200 and r.json()["solution"], r.status_code)

# Sign up (code from the API log: no SMTP configured)
email = f"smoke{int(time.time())}@example.ru"
password = "smoke test password"  # noqa: S105
form = {"first_name": "Смоук", "last_name": "Тест", "email": email, "password": password}
r = c.post("/api/auth/signup", json=form | {"consent": True})
check("sign-up code requested", r.status_code == 202, r.text[:120])
time.sleep(1)
logs = subprocess.run(  # noqa: S603  (fixed docker command, project name from argv)
    ["docker", "compose", "-p", PROJECT, "logs", "api", "--since", "2m"],  # noqa: S607
    capture_output=True,
    text=True,
    encoding="utf-8",
).stdout
codes = re.findall(r"Код подтверждения: (\d{6})", logs)
check("code found in API log", bool(codes))
r = c.post("/api/auth/verify", json={"email": email, "code": codes[-1] if codes else "000000"})
check("signed up", r.status_code == 200 and r.json()["user"]["email"] == email, r.text[:120])
runs = c.get("/api/variants/runs?exam_id=ege-physics").json()
check("anonymous variant run merged into account", [x["id"] for x in runs] == [run["id"]], runs)
check(
    "anonymous attempts merged",
    c.get("/api/tasks/status").json()["tasks"].get("kin-0001") == "solved",
)
check("progress has mastery", len(c.get("/api/progress").json()["topics"]) > 0)
c.post("/api/auth/logout")
r = c.post("/api/auth/login", json={"email": email, "password": password})
check("password sign-in", r.status_code == 200, r.text[:120])

# Tutor (scripted dev model in this stack)
with c.stream(
    "POST", "/api/tutor/messages", json={"kind": "task", "id": "kin-0001", "text": "С чего начать?"}
) as s:
    body = "".join(s.iter_text())
check(
    "tutor streams SSE",
    s.status_code == 200 and "event: delta" in body and "event: done" in body,
    body[:200],
)
t = c.get("/api/tutor/thread", params={"kind": "task", "id": "kin-0001"}).json()
check("tutor thread saved", len(t["messages"]) == 2, t)

print("\nALL PASS" if ok else "\nSOME CHECKS FAILED")
sys.exit(0 if ok else 1)
