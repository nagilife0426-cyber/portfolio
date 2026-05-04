#!/usr/bin/env python3
"""
CrowdWorks 応募状況 監視ダッシュボード
======================================
使い方:
  python3 check_crowdworks.py

実行すると以下が生成されます:
  - cw_status.json   : 最新ステータス（機械読み取り用）
  - cw_dashboard.html: ブラウザで開けるダッシュボード
  - cw_log.txt       : 変化検知ログ

事前準備 (cookies.txt の取得):
  1. Chrome で CrowdWorks にログインする
  2. Chrome拡張「Get cookies.txt LOCALLY」をインストール
     → https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc
  3. crowdworks.jp を開いた状態で拡張アイコンをクリック → "Export" → "cookies.txt" を保存
  4. このスクリプトと同じフォルダ (portfolio/) に置く
"""

import json
import os
import sys
import re
from datetime import datetime
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("❌ 必要なライブラリが不足しています。以下を実行してください:")
    print("   pip3 install requests beautifulsoup4")
    sys.exit(1)

# ===== 設定 =====
BASE_DIR = Path(__file__).parent
COOKIES_FILE = BASE_DIR / "cookies.txt"
STATUS_FILE  = BASE_DIR / "cw_status.json"
LOG_FILE     = BASE_DIR / "cw_log.txt"
DASHBOARD_FILE = BASE_DIR / "cw_dashboard.html"

# ===== 監視対象の応募案件 =====
# 応募後にCrowdWorksのURLから proposal_id を確認して追加する
# URL形式: https://crowdworks.jp/proposals/{proposal_id}
PROPOSALS = [
    {
        "id": "292165175",
        "job_title": "フルーツグミ Instagramバナー",
        "job_id": "13100216",
        "applied_at": "2026-05-04",
        "category": "デザイン",
    },
    {
        "id": "292165194",
        "job_title": "飲料水チラシデザイン",
        "job_id": "13099833",
        "applied_at": "2026-05-04",
        "category": "デザイン",
    },
    # ↓ 新規応募後にIDを追加する
    # {
    #     "id": "PROPOSAL_ID_HERE",
    #     "job_title": "Amazon EC運用自動化",
    #     "job_id": "13100140",
    #     "applied_at": "2026-05-05",
    #     "category": "システム開発",
    # },
    # {
    #     "id": "PROPOSAL_ID_HERE",
    #     "job_title": "Claude Code業務自動化（ハウスドクター）",
    #     "job_id": "13091919",
    #     "applied_at": "2026-05-05",
    #     "category": "システム開発",
    # },
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "ja,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://crowdworks.jp/",
}

# CrowdWorksの応募ステータスキーワード（優先度順）
STATUS_KEYWORDS = [
    "契約中", "交渉中", "辞退済み", "辞退", "却下", "完了", "納品済み",
    "確認中", "修正依頼", "応募中", "スカウト",
]

# ===== クッキー読み込み (Netscape形式) =====
def load_cookies(path: Path) -> dict:
    cookies = {}
    if not path.exists():
        return cookies
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 7:
                domain = parts[0]
                name   = parts[5]
                value  = parts[6]
                if "crowdworks" in domain:
                    cookies[name] = value
    return cookies

# ===== クッキーの有効性チェック =====
def validate_cookies(session: requests.Session) -> bool:
    """ログインが維持されているか確認"""
    try:
        r = session.get("https://crowdworks.jp/dashboard", timeout=10, allow_redirects=False)
        # ログインしていれば 200、していなければ 302 (ログインページへリダイレクト)
        return r.status_code == 200
    except Exception:
        return False

# ===== 提案ページをパース =====
def fetch_proposal_status(proposal_id: str, session: requests.Session) -> dict:
    url = f"https://crowdworks.jp/proposals/{proposal_id}"
    result = {
        "id": proposal_id,
        "url": url,
        "status": "取得失敗",
        "status_raw": "",
        "unread_messages": 0,
        "last_message_at": None,
        "client_name": None,
        "error": None,
    }
    try:
        resp = session.get(url, timeout=15)

        if resp.status_code == 403:
            result["error"] = "ログインセッション切れ (403) — cookies.txt を更新してください"
            return result
        if resp.status_code == 404:
            result["error"] = "提案が見つかりません (404) — proposal_id を確認してください"
            return result
        if resp.status_code != 200:
            result["error"] = f"HTTP {resp.status_code}"
            return result

        soup = BeautifulSoup(resp.text, "html.parser")
        full_text = soup.get_text(separator=" ", strip=True)

        # ── ステータス取得（複数戦略） ──
        status_found = None

        # 戦略1: CSSクラスで直接探す
        for selector in [
            ".proposal-status", ".label-status", "[class*='status']",
            ".state", "[class*='state']", ".label", "[class*='label']",
        ]:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(strip=True)
                if any(kw in text for kw in STATUS_KEYWORDS):
                    status_found = text
                    break

        # 戦略2: ページ全体からキーワードを検索（最初にマッチしたものを採用）
        if not status_found:
            # より精度の高い検索：前後の文脈を考慮
            for kw in STATUS_KEYWORDS:
                # キーワードが単独またはステータス関連の文脈で出現しているか確認
                pattern = rf"(?:ステータス|状態|状況)?[：:\s]*{re.escape(kw)}"
                if re.search(pattern, full_text):
                    status_found = kw
                    break
            # フォールバック: 単純な存在チェック
            if not status_found:
                for kw in STATUS_KEYWORDS:
                    if kw in full_text:
                        status_found = kw
                        break

        if status_found:
            result["status"] = status_found
            result["status_raw"] = status_found
        elif resp.status_code == 200:
            result["status"] = "ページ取得OK（ステータス不明）"

        # ── 未読メッセージ数 ──
        for sel in [".unread-count", "[class*='unread']", ".badge", ".count"]:
            el = soup.select_one(sel)
            if el:
                num_str = re.sub(r'\D', '', el.get_text())
                if num_str:
                    try:
                        result["unread_messages"] = int(num_str)
                        break
                    except ValueError:
                        pass

        # ── 最終メッセージ日時 ──
        time_els = soup.select("time[datetime]")
        if time_els:
            result["last_message_at"] = time_els[-1].get("datetime")

        # ── クライアント名 ──
        for sel in [".client-name", "[class*='client']", ".employer", "[class*='employer']"]:
            el = soup.select_one(sel)
            if el:
                result["client_name"] = el.get_text(strip=True)
                break

    except requests.RequestException as e:
        result["error"] = str(e)

    return result

# ===== ログ書き込み =====
def write_log(message: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {message}"
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)

# ===== 前回との差分チェック =====
def detect_changes(prev: dict, curr: dict) -> list[str]:
    changes = []
    if prev.get("status") != curr.get("status"):
        changes.append(f"ステータス変化: 「{prev.get('status', '不明')}」→「{curr.get('status')}」")
    if prev.get("unread_messages", 0) < curr.get("unread_messages", 0):
        changes.append(f"未読メッセージ増加: {prev.get('unread_messages',0)} → {curr.get('unread_messages',0)}")
    if (prev.get("last_message_at") != curr.get("last_message_at")
            and curr.get("last_message_at")):
        changes.append(f"新しいメッセージ: {curr.get('last_message_at')}")
    return changes

# ===== ステータスに応じた絵文字・色 =====
def status_style(status: str) -> tuple[str, str]:
    """(絵文字, CSSクラス)"""
    mapping = {
        "契約中":   ("🟢", "green"),
        "交渉中":   ("🔵", "blue"),
        "応募中":   ("🟡", "yellow"),
        "確認中":   ("🟡", "yellow"),
        "修正依頼": ("🟠", "orange"),
        "辞退":     ("⚫", "gray"),
        "辞退済み": ("⚫", "gray"),
        "却下":     ("🔴", "red"),
        "完了":     ("✅", "green"),
        "納品済み": ("✅", "green"),
    }
    for k, v in mapping.items():
        if k in status:
            return v
    return ("❓", "gray")

# ===== ダッシュボード HTML 生成 =====
def generate_dashboard(results: list[dict], checked_at: str, cookie_valid: bool):
    rows = ""
    for r in results:
        emoji, color = status_style(r.get("status", ""))
        error_html = f'<div class="error">⚠️ {r["error"]}</div>' if r.get("error") else ""
        days_ago = ""
        if r.get("applied_at"):
            try:
                delta = (datetime.now() - datetime.strptime(r["applied_at"], "%Y-%m-%d")).days
                days_ago = f"({delta}日前に応募)"
            except Exception:
                days_ago = ""
        unread = r.get("unread_messages", 0)
        unread_html = f'<span class="badge-red">{unread}件</span>' if unread > 0 else '<span class="badge-gray">0</span>'
        last_msg = r.get("last_message_at") or "—"

        rows += f"""
        <tr>
          <td>
            <div class="job-title">
              <a href="{r['url']}" target="_blank">{r.get('job_title','—')}</a>
            </div>
            <div class="job-meta">
              <span class="cat">{r.get('category','')}</span>
              {f'<span class="applied-date">応募日: {r["applied_at"]} {days_ago}</span>' if r.get("applied_at") else ""}
            </div>
            {error_html}
          </td>
          <td><span class="status status-{color}">{emoji} {r.get('status','—')}</span></td>
          <td class="center">{unread_html}</td>
          <td class="center mono">{last_msg[:10] if last_msg != '—' else '—'}</td>
          <td class="center">
            <a href="{r['url']}" target="_blank" class="btn-view">確認</a>
          </td>
        </tr>"""

    cookie_status = (
        '<span class="badge-green">✅ セッション有効</span>' if cookie_valid
        else '<span class="badge-red">❌ 要更新（cookies.txt）</span>'
    )
    total = len(results)
    active = sum(1 for r in results if r.get("status") in ["応募中", "交渉中", "確認中", "修正依頼"])
    contracted = sum(1 for r in results if "契約中" in r.get("status", ""))
    errors = sum(1 for r in results if r.get("error"))

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CrowdWorks 応募状況ダッシュボード</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{
      --bg: #0a0e1a; --bg2: #111827; --bg3: #1f2937; --bg4: #374151;
      --border: #374151; --text: #f9fafb; --text2: #9ca3af; --text3: #6b7280;
      --green: #10b981; --yellow: #f59e0b; --red: #ef4444;
      --blue: #3b82f6; --orange: #f97316; --purple: #8b5cf6; --gray: #6b7280;
      --cw: #00b0de;
    }}
    body {{ background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; }}

    header {{ background: var(--bg2); border-bottom: 1px solid var(--border); padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }}
    .logo {{ font-size: 16px; font-weight: 800; color: var(--cw); display: flex; align-items: center; gap: 8px; }}
    .checked-at {{ font-size: 12px; color: var(--text3); }}

    main {{ max-width: 1100px; margin: 0 auto; padding: 28px 24px; }}

    .kpi-row {{ display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 24px; }}
    .kpi {{ background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; }}
    .kpi-label {{ font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 6px; }}
    .kpi-value {{ font-size: 30px; font-weight: 800; }}
    .kpi-value.green {{ color: var(--green); }} .kpi-value.yellow {{ color: var(--yellow); }}
    .kpi-value.red {{ color: var(--red); }} .kpi-value.blue {{ color: var(--blue); }}

    .section-head {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }}
    .section-title {{ font-size: 13px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 1px; }}

    .card {{ background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 20px; }}
    .card-head {{ background: var(--bg3); padding: 12px 18px; border-bottom: 1px solid var(--border); font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }}

    table {{ width: 100%; border-collapse: collapse; }}
    th {{ padding: 10px 14px; text-align: left; font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: .6px; border-bottom: 1px solid var(--border); white-space: nowrap; }}
    td {{ padding: 12px 14px; border-bottom: 1px solid rgba(55,65,81,.5); vertical-align: middle; }}
    tr:last-child td {{ border-bottom: none; }}
    tr:hover td {{ background: rgba(255,255,255,.02); }}
    .center {{ text-align: center; }}
    .mono {{ font-family: monospace; font-size: 12px; color: var(--text2); }}

    .job-title a {{ color: var(--text); text-decoration: none; font-weight: 600; font-size: 13px; }}
    .job-title a:hover {{ color: var(--cw); }}
    .job-meta {{ margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; }}
    .cat {{ font-size: 10px; background: var(--bg3); color: var(--text2); padding: 2px 7px; border-radius: 4px; }}
    .applied-date {{ font-size: 11px; color: var(--text3); }}
    .error {{ margin-top: 5px; font-size: 11px; color: var(--red); background: rgba(239,68,68,.1); padding: 4px 8px; border-radius: 4px; border-left: 2px solid var(--red); }}

    .status {{ display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; white-space: nowrap; }}
    .status-green  {{ background: rgba(16,185,129,.12); color: var(--green); }}
    .status-blue   {{ background: rgba(59,130,246,.12); color: var(--blue); }}
    .status-yellow {{ background: rgba(245,158,11,.12); color: var(--yellow); }}
    .status-orange {{ background: rgba(249,115,22,.12); color: var(--orange); }}
    .status-red    {{ background: rgba(239,68,68,.12); color: var(--red); }}
    .status-gray   {{ background: rgba(107,114,128,.12); color: var(--gray); }}

    .badge-green {{ background: rgba(16,185,129,.15); color: var(--green); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }}
    .badge-red   {{ background: rgba(239,68,68,.15); color: var(--red); font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }}
    .badge-gray  {{ background: var(--bg3); color: var(--text3); font-size: 12px; padding: 2px 8px; border-radius: 20px; }}

    .btn-view {{ display: inline-block; padding: 4px 12px; background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; color: var(--text2); text-decoration: none; font-size: 11px; font-weight: 600; transition: all .15s; }}
    .btn-view:hover {{ color: var(--cw); border-color: var(--cw); }}

    .info-bar {{ background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--text2); }}
    .info-bar strong {{ color: var(--text); }}

    .todo-list {{ background: var(--bg2); border: 1px solid rgba(245,158,11,.3); border-radius: 10px; padding: 18px 22px; margin-bottom: 20px; }}
    .todo-list h3 {{ font-size: 13px; font-weight: 700; color: var(--yellow); margin-bottom: 12px; }}
    .todo-item {{ display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; font-size: 13px; }}
    .todo-num {{ width: 22px; height: 22px; border-radius: 50%; background: rgba(245,158,11,.15); color: var(--yellow); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }}
  </style>
</head>
<body>
<header>
  <div class="logo">📋 CrowdWorks 応募ダッシュボード</div>
  <div style="display:flex;align-items:center;gap:14px;">
    {cookie_status}
    <span class="checked-at">最終確認: {checked_at}</span>
  </div>
</header>
<main>

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">総応募数</div><div class="kpi-value blue">{total}</div></div>
    <div class="kpi"><div class="kpi-label">審査中</div><div class="kpi-value yellow">{active}</div></div>
    <div class="kpi"><div class="kpi-label">契約成立</div><div class="kpi-value green">{contracted}</div></div>
    <div class="kpi"><div class="kpi-label">取得エラー</div><div class="kpi-value {'red' if errors > 0 else 'gray'}">{errors}</div></div>
  </div>

  <!-- 次のアクション -->
  <div class="todo-list">
    <h3>📌 次にやること（Tomoyaが手動で行うこと）</h3>
    <div class="todo-item"><div class="todo-num">1</div><div>Amazon EC自動化（ID:13100140）に応募文を送信する → <a href="https://crowdworks.jp/public/jobs/13100140" target="_blank" style="color:var(--cw)">案件リンク</a></div></div>
    <div class="todo-item"><div class="todo-num">2</div><div>Claude Code業務自動化 ハウスドクター（ID:13091919）に応募文を送信する → <a href="https://crowdworks.jp/public/jobs/13091919" target="_blank" style="color:var(--cw)">案件リンク</a></div></div>
    <div class="todo-item"><div class="todo-num">3</div><div>応募後にCrowdWorksでproposal_idを確認し、このスクリプトのPROPOSALSリストに追加する</div></div>
    <div class="todo-item"><div class="todo-num">4</div><div>cookies.txtを更新する（有効期限が切れている場合）</div></div>
  </div>

  <!-- 情報バー -->
  <div class="info-bar">
    <span>🔐 <strong>cookies.txt の場所:</strong> {COOKIES_FILE}</span>
    <span>|</span>
    <span>📄 <strong>ログファイル:</strong> {LOG_FILE}</span>
    <span>|</span>
    <span>💾 <strong>JSONデータ:</strong> {STATUS_FILE}</span>
  </div>

  <!-- 応募一覧 -->
  <div class="card">
    <div class="card-head">
      <span>📋 応募案件一覧（{total}件）</span>
      <span style="font-size:11px;color:var(--text3)">proposal_id が設定されている案件のみ追跡可能</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>案件名</th>
          <th>ステータス</th>
          <th class="center">未読メッセージ</th>
          <th class="center">最終メッセージ</th>
          <th class="center">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows if rows else '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text3)">監視中の案件がありません</td></tr>'}
      </tbody>
    </table>
  </div>

</main>
</body>
</html>"""
    with open(DASHBOARD_FILE, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"🌐 ダッシュボード生成: {DASHBOARD_FILE}")

# ===== メイン =====
def main():
    print("=" * 60)
    print("CrowdWorks 応募状況チェック")
    print(f"実行時刻: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # クッキー読み込み
    cookies = load_cookies(COOKIES_FILE)
    if not cookies:
        print(f"\n⚠️  cookies.txt が見つかりません: {COOKIES_FILE}")
        print("   → CrowdWorksにログインしてcookies.txtを取得してください。")
        print("   → ステータス確認はできませんが、ダッシュボードは生成します。")

    # セッション作成
    session = requests.Session()
    session.headers.update(HEADERS)
    session.cookies.update(cookies)

    # セッション有効性チェック
    cookie_valid = False
    if cookies:
        print("\n🔐 ログインセッション確認中...")
        cookie_valid = validate_cookies(session)
        if cookie_valid:
            print("✅ ログイン有効")
        else:
            print("❌ セッション切れ — cookies.txt を更新してください")

    # 前回のステータスを読み込み
    prev_data = {}
    if STATUS_FILE.exists():
        try:
            with open(STATUS_FILE, "r", encoding="utf-8") as f:
                old = json.load(f)
            for p in old.get("proposals", []):
                prev_data[p["id"]] = p
        except Exception:
            pass

    # 各提案をチェック
    results = []
    for proposal_meta in PROPOSALS:
        print(f"\n📋 チェック中: {proposal_meta['job_title']} (Proposal ID: {proposal_meta['id']})")

        if not cookie_valid:
            # セッションなしでは取得不可
            merged = {
                **proposal_meta,
                "status": "未取得（要ログイン）",
                "unread_messages": 0,
                "last_message_at": None,
                "error": "cookies.txtのセッションが無効です",
                "url": f"https://crowdworks.jp/proposals/{proposal_meta['id']}",
            }
        else:
            fetched = fetch_proposal_status(proposal_meta["id"], session)
            merged = {**proposal_meta, **fetched}

        results.append(merged)

        # 差分チェック
        prev = prev_data.get(proposal_meta["id"], {})
        changes = detect_changes(prev, merged)
        if changes:
            for ch in changes:
                msg = f"【変化検出】{proposal_meta['job_title']}: {ch}"
                write_log(msg)
                print(f"  🔔 {msg}")
        else:
            status_str = merged.get("status", "不明")
            unread = merged.get("unread_messages", 0)
            emoji, _ = status_style(status_str)
            print(f"  {emoji} ステータス: {status_str} | 未読: {unread}件")

        if merged.get("error") and cookie_valid:
            print(f"  ⚠️  エラー: {merged['error']}")

    # 結果を保存
    checked_at = datetime.now().isoformat()
    output = {
        "last_checked": checked_at,
        "cookie_valid": cookie_valid,
        "proposals": results,
    }
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # ダッシュボード生成
    generate_dashboard(results, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), cookie_valid)

    print(f"\n{'=' * 60}")
    print(f"💾 JSONデータ: {STATUS_FILE}")
    print(f"🌐 ダッシュボード: {DASHBOARD_FILE}")
    print(f"📝 ログ: {LOG_FILE}")
    print(f"\n📌 次のステップ:")
    print("   1. cw_dashboard.html をブラウザで開いて状況を確認")
    print("   2. セッション切れの場合は cookies.txt を更新する")
    print("   3. 新規応募後は PROPOSALS リストに proposal_id を追加する")
    print("=" * 60)

    # ダッシュボードを自動で開く（任意）
    import subprocess, platform
    try:
        if platform.system() == "Darwin":
            subprocess.Popen(["open", str(DASHBOARD_FILE)])
        elif platform.system() == "Windows":
            os.startfile(str(DASHBOARD_FILE))
    except Exception:
        pass


if __name__ == "__main__":
    main()
