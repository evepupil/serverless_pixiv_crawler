"""素材库:在爬虫 SQLite(pixiv.db)的 material 表上做 CRUD。

material 表存人工审核流程的图:
  status: pending(待审) / approved(已通过) / discarded(已丢弃) / published(已发布)

跟爬虫 pic 表同库,wx 服务器用 sqlite3 直读(审核/发布都是低频操作,跟爬虫 WAL 不冲突)。
"""
from __future__ import annotations

import sqlite3
from datetime import datetime

from .config import get_settings


def _conn():
    return sqlite3.connect(get_settings().crawler_db_path)


def init():
    """建表(幂等)。"""
    c = _conn()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS material (
            pid TEXT NOT NULL,
            account TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            score REAL DEFAULT 0,
            column_name TEXT,
            added_at TEXT NOT NULL,
            reviewed_at TEXT,
            published_at TEXT,
            PRIMARY KEY (pid, account)
        );
        CREATE INDEX IF NOT EXISTS idx_material_acct_status ON material(account, status);
        """
    )
    c.commit()
    c.close()
    print("material init ok")


def add_pending(account: str, items: list[dict]) -> int:
    """审核 skill 推预选:items=[{pid, score, column}]。已存在的不覆盖(去重)。返回新插入数。"""
    if not items:
        return 0
    c = _conn()
    now = datetime.now().isoformat(timespec="seconds")
    n = 0
    for it in items:
        cur = c.execute(
            "INSERT OR IGNORE INTO material(pid, account, status, score, column_name, added_at) "
            "VALUES(?,?,?,?,?,?)",
            (it["pid"], account, "pending", it.get("score", 0), it.get("column", ""), now),
        )
        n += cur.rowcount
    c.commit()
    c.close()
    return n


def list_pending(account: str, limit: int = 20) -> list[dict]:
    """审核 tab:拿一批待审(按加入时间倒序)。"""
    c = _conn()
    rows = c.execute(
        "SELECT pid, score, column_name FROM material WHERE account=? AND status='pending' "
        "ORDER BY added_at DESC LIMIT ?",
        (account, limit),
    ).fetchall()
    c.close()
    return [{"pid": r[0], "score": r[1], "column": r[2]} for r in rows]


def review_submit(account: str, keep_pids: list[str], discard_pids: list[str]) -> dict:
    """审核 tab 提交:keep=通过(approved), discard=丢弃(discarded)。返回各处理数。"""
    c = _conn()
    now = datetime.now().isoformat(timespec="seconds")
    for pid in keep_pids:
        c.execute(
            "UPDATE material SET status='approved', reviewed_at=? WHERE account=? AND pid=? AND status='pending'",
            (now, account, pid),
        )
    for pid in discard_pids:
        c.execute(
            "UPDATE material SET status='discarded', reviewed_at=? WHERE account=? AND pid=? AND status='pending'",
            (now, account, pid),
        )
    c.commit()
    c.close()
    return {"approved": len(keep_pids), "discarded": len(discard_pids)}


def list_material(account: str, status: str) -> list[dict]:
    """素材库 tab:按状态列。"""
    c = _conn()
    rows = c.execute(
        "SELECT pid, status, score, column_name FROM material WHERE account=? AND status=? "
        "ORDER BY COALESCE(reviewed_at, added_at) DESC",
        (account, status),
    ).fetchall()
    c.close()
    return [{"pid": r[0], "status": r[1], "score": r[2], "column": r[3]} for r in rows]


def mark(account: str, action: str, pids: list[str]) -> int:
    """素材库 tab 标记:action=approve/discard/pending(撤销用),只改勾选的,且不改 published(已发的不动)。"""
    status_map = {"approve": "approved", "discard": "discarded", "pending": "pending"}
    new_status = status_map.get(action)
    if not new_status or not pids:
        return 0
    c = _conn()
    now = datetime.now().isoformat(timespec="seconds")
    n = 0
    for pid in pids:
        cur = c.execute(
            "UPDATE material SET status=?, reviewed_at=? WHERE account=? AND pid=? AND status!='published'",
            (new_status, now, account, pid),
        )
        n += cur.rowcount
    c.commit()
    c.close()
    return n


def list_approved(account: str, column: str, limit: int = 8) -> list[str]:
    """发布 skill:拿指定栏目的已通过 pid(按审核时间正序,先审先发)。"""
    c = _conn()
    rows = c.execute(
        "SELECT pid FROM material WHERE account=? AND status='approved' AND column_name=? "
        "ORDER BY reviewed_at ASC LIMIT ?",
        (account, column, limit),
    ).fetchall()
    c.close()
    return [r[0] for r in rows]


def mark_published(account: str, pids: list[str]) -> int:
    """发布 skill 发文后:标记 published。"""
    c = _conn()
    now = datetime.now().isoformat(timespec="seconds")
    n = 0
    for pid in pids:
        cur = c.execute(
            "UPDATE material SET status='published', published_at=? WHERE account=? AND pid=?",
            (now, account, pid),
        )
        n += cur.rowcount
    c.commit()
    c.close()
    return n
