"""CGT Agent benchmark 后端 — Flask + SQLite."""
import argparse
import json
import os
from urllib.parse import unquote
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

from db import IS_POSTGRES, init_db, get_db, row_to_dict
from validators import (
    validate_question_payload,
    validate_review_payload,
    PRESET_REVISION_REASONS,
)
from export_utils import to_xlsx_bytes, to_json_bytes, to_markdown_bytes


STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
STATIC_DIR = os.path.normpath(STATIC_DIR)

app = Flask(__name__, static_folder=None)
CORS(app)
init_db()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def current_role() -> str:
    role = (request.headers.get("X-Role") or "").lower()
    return role if role in ("submitter", "reviewer") else "submitter"


def current_name() -> str:
    raw = (request.headers.get("X-User-Name") or "").strip()
    return unquote(raw)


def api_error(message: str, status: int = 400, errors=None):
    payload = {"error": message}
    if errors is not None:
        payload["errors"] = errors
    return jsonify(payload), status


# ------- 静态前端 -------

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    full = os.path.join(STATIC_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, "index.html")


# ------- 元信息 -------

@app.get("/api/meta")
def meta():
    return jsonify({
        "difficulties": ["L1", "L2", "L3", "L4"],
        "domains": [
            "递送系统 C1",
            "基因治疗 C2",
            "细胞工程 C3",
        ],
        "source_types": ["原创", "文献改编", "教材改编", "数据库条目改编"],
        "revision_reasons": PRESET_REVISION_REASONS,
        "target_count": 1000,
    })


# ------- Stats -------

@app.get("/api/stats")
def stats():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM questions GROUP BY status"
        ).fetchall()
    counts = {"pending": 0, "approved": 0, "needs_revision": 0}
    for r in rows:
        counts[r["status"]] = r["n"]
    total = sum(counts.values())
    return jsonify({
        "total": total,
        "approved": counts["approved"],
        "pending": counts["pending"],
        "needs_revision": counts["needs_revision"],
        "target": 1000,
    })


# ------- 列表 -------

def _build_where(args, role: str, name: str):
    clauses = []
    params = []

    status = args.get("status")
    if status:
        statuses = [s for s in status.split(",") if s]
        if statuses:
            clauses.append(f"status IN ({','.join('?' for _ in statuses)})")
            params.extend(statuses)

    if args.get("difficulty"):
        clauses.append("difficulty = ?")
        params.append(args["difficulty"])

    if args.get("domain"):
        clauses.append("domain = ?")
        params.append(args["domain"])

    author_name = (args.get("author_name") or "").strip()
    if author_name:
        clauses.append("author_name = ?")
        params.append(author_name)

    reviewer = args.get("reviewer_name")
    if reviewer:
        clauses.append("reviewer_name = ?")
        params.append(reviewer)

    q = (args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        clauses.append("(title LIKE ? OR content LIKE ? OR author_name LIKE ?)")
        params.extend([like, like, like])

    if args.get("only_mine") == "1" and name:
        clauses.append("author_name = ?")
        params.append(name)

    # 出题人权限: 未审核题目仅看自己,已审核题目全员可见
    if role != "reviewer" and args.get("scope") == "submitted" and name:
        clauses.append("author_name = ?")
        params.append(name)

    where_sql = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where_sql, params


@app.get("/api/questions")
def list_questions():
    role = current_role()
    name = current_name()
    where_sql, params = _build_where(request.args, role, name)

    sort = request.args.get("sort", "-submitted_at")
    sort_map = {
        "submitted_at": "submitted_at ASC",
        "-submitted_at": "submitted_at DESC",
        "difficulty": "difficulty ASC",
        "-difficulty": "difficulty DESC",
        "reviewed_at": "reviewed_at ASC",
        "-reviewed_at": "reviewed_at DESC",
    }
    order_sql = " ORDER BY " + sort_map.get(sort, "submitted_at DESC")

    limit = min(int(request.args.get("limit", "200")), 1000)

    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM questions{where_sql}{order_sql} LIMIT ?",
            params + [limit],
        ).fetchall()

    items = [row_to_dict(r) for r in rows]
    if role != "reviewer":
        for it in items:
            it.pop("author_email", None)
            it.pop("author_institution", None)
            it.pop("reviewer_institution", None)
            if it.get("author_name") != name:
                it.pop("review_comment", None)
    return jsonify({"items": items, "count": len(items)})


@app.get("/api/questions/<int:qid>")
def get_question(qid):
    role = current_role()
    name = current_name()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
    if not row:
        return api_error("题目不存在", 404)
    item = row_to_dict(row)
    if role != "reviewer" and item["status"] != "approved":
        if item["author_name"] != name:
            return api_error("无权查看此题目", 403)
    if role != "reviewer":
        item.pop("author_email", None)
        item.pop("author_institution", None)
        item.pop("reviewer_institution", None)
    return jsonify(item)


# ------- 提交 -------

@app.post("/api/questions")
def create_question():
    data = request.get_json(force=True, silent=True) or {}
    errors = validate_question_payload(data)
    if errors:
        return api_error("字段校验失败", 400, errors)

    now = now_iso()
    insert_sql = """
        INSERT INTO questions (
            title, difficulty, domain, subdomain, content,
            rubric_json, reference_answer,
            source_type, source_detail,
            author_name, author_institution, author_email,
            status, submitted_at, updated_at
        ) VALUES (?,?,?,?,?, ?,?, ?,?, ?,?,?, 'pending', ?, ?)
    """
    if IS_POSTGRES:
        insert_sql += " RETURNING id"

    with get_db() as conn:
        cursor = conn.execute(
            insert_sql,
            (
                data["title"].strip(),
                data["difficulty"],
                data["domain"],
                (data.get("subdomain") or "").strip() or None,
                data["content"].strip(),
                json.dumps(data["rubric"], ensure_ascii=False),
                (data.get("reference_answer") or "").strip() or None,
                data["source_type"],
                (data.get("source_detail") or "").strip() or None,
                data["author_name"].strip(),
                "",
                "",
                now,
                now,
            ),
        )
        if IS_POSTGRES:
            new_id = cursor.fetchone()["id"]
        else:
            new_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM questions WHERE id = ?", (new_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


# ------- 编辑 -------

@app.put("/api/questions/<int:qid>")
def update_question(qid):
    name = current_name()
    data = request.get_json(force=True, silent=True) or {}

    with get_db() as conn:
        row = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
        if not row:
            return api_error("题目不存在", 404)
        if row["author_name"] != name:
            return api_error("仅出题人可编辑", 403)
        if row["status"] not in ("pending", "needs_revision"):
            return api_error("仅待审核或需修改题目可编辑", 409)

        # 保留作者信息
        data.setdefault("author_name", row["author_name"])

        errors = validate_question_payload(data, is_update=True)
        if errors:
            return api_error("字段校验失败", 400, errors)

        # 需修改后重提 → 重新进入 pending
        new_status = "pending" if row["status"] == "needs_revision" else row["status"]

        conn.execute(
            """
            UPDATE questions SET
                title = ?, difficulty = ?, domain = ?, subdomain = ?, content = ?,
                rubric_json = ?, reference_answer = ?,
                source_type = ?, source_detail = ?,
                status = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                data["title"].strip(),
                data["difficulty"],
                data["domain"],
                (data.get("subdomain") or "").strip() or None,
                data["content"].strip(),
                json.dumps(data["rubric"], ensure_ascii=False),
                (data.get("reference_answer") or "").strip() or None,
                data["source_type"],
                (data.get("source_detail") or "").strip() or None,
                new_status,
                now_iso(),
                qid,
            ),
        )
        updated = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
    return jsonify(row_to_dict(updated))


# ------- 撤回 -------

@app.delete("/api/questions/<int:qid>")
def withdraw_question(qid):
    name = current_name()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
        if not row:
            return api_error("题目不存在", 404)
        if row["author_name"] != name:
            return api_error("仅出题人可撤回", 403)
        if row["status"] != "pending":
            return api_error("仅待审核题目可撤回", 409)
        conn.execute("DELETE FROM questions WHERE id = ?", (qid,))
    return ("", 204)


# ------- 审核 -------

@app.post("/api/questions/<int:qid>/review")
def review_question(qid):
    if current_role() != "reviewer":
        return api_error("仅审核员可审核", 403)
    data = request.get_json(force=True, silent=True) or {}
    errors = validate_review_payload(data)
    if errors:
        return api_error("审核字段校验失败", 400, errors)

    with get_db() as conn:
        row = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
        if not row:
            return api_error("题目不存在", 404)
        conn.execute(
            """
            UPDATE questions SET
                status = ?, reviewed_at = ?, updated_at = ?,
                reviewer_name = ?, reviewer_institution = ?,
                review_comment = ?, revision_reasons_json = ?
            WHERE id = ?
            """,
            (
                data["status"],
                now_iso(),
                now_iso(),
                data["reviewer_name"].strip(),
                "",
                (data.get("review_comment") or "").strip() or None,
                json.dumps(data.get("revision_reasons") or [], ensure_ascii=False),
                qid,
            ),
        )
        updated = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
    return jsonify(row_to_dict(updated))


# ------- 导出 -------

@app.get("/api/questions/export")
def export_questions():
    role = current_role()
    fmt = (request.args.get("format") or "xlsx").lower()
    if fmt not in ("xlsx", "json", "md"):
        return api_error("不支持的格式,仅支持 xlsx/json/md", 400)

    # 导出只给已审核通过的题目
    args = request.args.to_dict()
    args["status"] = "approved"
    name = current_name()
    where_sql, params = _build_where(args, role, name)

    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM questions{where_sql} ORDER BY reviewed_at DESC LIMIT 5000",
            params,
        ).fetchall()

    items = [row_to_dict(r) for r in rows]
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    if fmt == "xlsx":
        data = to_xlsx_bytes(items, role)
        return send_file(
            _bytes_to_io(data),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=f"protein_bench_{ts}.xlsx",
        )
    if fmt == "json":
        data = to_json_bytes(items, role)
        return send_file(
            _bytes_to_io(data),
            mimetype="application/json",
            as_attachment=True,
            download_name=f"protein_bench_{ts}.json",
        )
    data = to_markdown_bytes(items, role)
    return send_file(
        _bytes_to_io(data),
        mimetype="text/markdown",
        as_attachment=True,
        download_name=f"protein_bench_{ts}.md",
    )


def _bytes_to_io(data: bytes):
    import io
    buf = io.BytesIO(data)
    buf.seek(0)
    return buf


# ------- 健康检查 -------

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "time": now_iso()})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
