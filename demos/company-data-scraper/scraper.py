"""
scraper.py
----------
企業名から公式HPを推定し、会社概要ページを取得するモジュール。

方針:
- Google検索はAPIなしでは利用規約違反になるため、
  「企業名 + 会社概要」での DuckDuckGo Lite HTML検索で候補URLを取得
- robots.txt を必ず確認し、Disallow されているパスはスキップ
- アクセス間隔: デフォルト 3〜5 秒（礼儀正しいクロール）
- タイムアウト: 10秒
- リトライ: 最大 2 回（指数バックオフ）
"""

import logging
import random
import re
import time
import urllib.parse
import urllib.robotparser
from typing import Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────
# 定数・設定
# ────────────────────────────────────────────────────────────────

USER_AGENT = (
    "Mozilla/5.0 (compatible; CompanyDataCollector/1.0; "
    "+https://github.com/your-repo; polite-bot)"
)
TIMEOUT = 10          # 秒
RETRY_MAX = 2         # リトライ回数
SLEEP_MIN = 3.0       # アクセス間隔 最小（秒）
SLEEP_MAX = 5.0       # アクセス間隔 最大（秒）

# 会社概要ページのURLキーワード（パス判定用）
COMPANY_INFO_PATH_HINTS = [
    "company", "about", "profile", "gaiyou", "info",
    "corporate", "kaisha", "outline", "access", "overview",
    # 日本語パスはURLエンコードされているケースも
    "%e4%bc%9a%e7%a4%be",  # 会社
    "%e6%a6%82%e8%a6%81",  # 概要
    "%e3%83%97%e3%83%ad%e3%83%95%e3%82%a3%e3%83%bc%e3%83%ab",  # プロフィール
]

# 会社概要ページのアンカーテキストキーワード
COMPANY_INFO_LINK_HINTS = [
    "会社概要", "会社情報", "企業情報", "企業概要", "アクセス",
    "会社案内", "組織情報", "about", "company", "profile",
    "コーポレート", "概要",
]


# ────────────────────────────────────────────────────────────────
# robots.txt キャッシュ
# ────────────────────────────────────────────────────────────────

_robots_cache: dict[str, urllib.robotparser.RobotFileParser] = {}


def _get_robots(base_url: str) -> urllib.robotparser.RobotFileParser:
    """
    base_url に対応する robots.txt をキャッシュ付きで取得・パース。
    取得失敗時は全許可扱いの空パーサーを返す。
    """
    if base_url in _robots_cache:
        return _robots_cache[base_url]

    rp = urllib.robotparser.RobotFileParser()
    robots_url = base_url.rstrip("/") + "/robots.txt"
    try:
        rp.set_url(robots_url)
        rp.read()
        logger.debug("robots.txt 取得: %s", robots_url)
    except Exception as e:
        logger.warning("robots.txt 取得失敗（全許可として扱う）: %s / %s", robots_url, e)
    _robots_cache[base_url] = rp
    return rp


def can_fetch(url: str) -> bool:
    """
    robots.txt に基づき、指定 URL へのアクセス可否を返す。
    """
    parsed = urllib.parse.urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    rp = _get_robots(base)
    return rp.can_fetch(USER_AGENT, url)


# ────────────────────────────────────────────────────────────────
# HTTPリクエスト
# ────────────────────────────────────────────────────────────────

def fetch_url(
    url: str,
    session: Optional[requests.Session] = None,
    sleep: bool = True,
) -> Optional[str]:
    """
    URLのHTMLを取得して文字列で返す。
    robots.txt で禁止 / タイムアウト / エラー時は None を返す。

    Parameters
    ----------
    url     : 取得先URL
    session : 再利用する requests.Session（Noneの場合は都度作成）
    sleep   : True のとき SLEEP_MIN〜SLEEP_MAX 秒の待機を入れる
    """
    if not can_fetch(url):
        logger.info("robots.txt により取得スキップ: %s", url)
        return None

    if sleep:
        wait = random.uniform(SLEEP_MIN, SLEEP_MAX)
        logger.debug("アクセス前スリープ %.1f 秒", wait)
        time.sleep(wait)

    headers = {"User-Agent": USER_AGENT}
    req = session or requests

    for attempt in range(RETRY_MAX + 1):
        try:
            resp = req.get(url, headers=headers, timeout=TIMEOUT)
            resp.encoding = resp.apparent_encoding or "utf-8"
            resp.raise_for_status()
            return resp.text
        except requests.exceptions.Timeout:
            logger.warning("タイムアウト(%d回目): %s", attempt + 1, url)
        except requests.exceptions.HTTPError as e:
            logger.warning("HTTPエラー %s: %s", e.response.status_code, url)
            break  # 4xx/5xx はリトライしない
        except requests.exceptions.ConnectionError as e:
            logger.warning("接続エラー(%d回目): %s / %s", attempt + 1, url, e)
        except Exception as e:
            logger.warning("予期しないエラー: %s / %s", url, e)
            break

        if attempt < RETRY_MAX:
            backoff = 2 ** attempt + random.uniform(0, 1)
            logger.debug("リトライ前バックオフ %.1f 秒", backoff)
            time.sleep(backoff)

    return None


# ────────────────────────────────────────────────────────────────
# 公式HP推定
# ────────────────────────────────────────────────────────────────

def find_official_url(company_name: str, session: Optional[requests.Session] = None) -> Optional[str]:
    """
    企業名から公式HP URLを推定して返す。
    DuckDuckGo Lite の HTML検索結果を使用（API不要）。

    ヒューリスティック:
    1. DuckDuckGo で「{企業名} 会社概要」を検索
    2. 結果上位から .co.jp / .com / .jp ドメインの非SNS URL を優先
    3. 候補が取れなければ None
    """
    query = f"{company_name} 会社概要"
    encoded = urllib.parse.quote(query)
    ddg_url = f"https://duckduckgo.com/html/?q={encoded}&kl=jp-jp"

    logger.info("企業URL検索: %s", company_name)
    html = fetch_url(ddg_url, session=session, sleep=True)
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")
    results = soup.select("a.result__url, .result__a, a[href*='uddg=']")

    candidate_urls = []
    for a in results:
        href = a.get("href", "")
        # DuckDuckGoのリダイレクトURLをデコード
        if "uddg=" in href:
            match = re.search(r"uddg=([^&]+)", href)
            if match:
                href = urllib.parse.unquote(match.group(1))

        if not href.startswith("http"):
            continue

        parsed = urllib.parse.urlparse(href)
        domain = parsed.netloc.lower()

        # SNS・検索・地図などのノイズドメインを除外
        noise = ["google", "twitter", "facebook", "instagram", "linkedin",
                 "youtube", "wikipedia", "tabelog", "yelp", "amazon",
                 "rakuten", "duckduckgo", "bing", "yahoo"]
        if any(n in domain for n in noise):
            continue

        # .co.jp / .jp を優先
        priority = 0 if (".co.jp" in domain or domain.endswith(".jp")) else 1
        candidate_urls.append((priority, href))

    if not candidate_urls:
        return None

    candidate_urls.sort(key=lambda x: x[0])
    url = candidate_urls[0][1]
    # パスを除いてトップドメインに正規化
    parsed = urllib.parse.urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}/"


# ────────────────────────────────────────────────────────────────
# 会社概要ページの特定
# ────────────────────────────────────────────────────────────────

def find_company_info_url(
    top_url: str,
    session: Optional[requests.Session] = None,
) -> Optional[str]:
    """
    トップページのHTMLを解析し、会社概要ページへのリンクを返す。
    見つからなければ top_url をそのまま返す。

    優先順位:
    1. アンカーテキストに「会社概要」等を含むリンク
    2. href パスに company / about / profile 等を含むリンク
    """
    html = fetch_url(top_url, session=session, sleep=True)
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")
    parsed_top = urllib.parse.urlparse(top_url)

    best_url = None
    best_score = 0

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        text = a.get_text(strip=True)

        # 絶対URLに変換
        if href.startswith("//"):
            href = parsed_top.scheme + ":" + href
        elif href.startswith("/"):
            href = f"{parsed_top.scheme}://{parsed_top.netloc}{href}"
        elif not href.startswith("http"):
            href = urllib.parse.urljoin(top_url, href)

        # 同一ドメインのみ対象
        if parsed_top.netloc not in href:
            continue

        score = 0
        # テキストマッチ（優先度高）
        for hint in COMPANY_INFO_LINK_HINTS:
            if hint.lower() in text.lower():
                score += 10
                break
        # パスマッチ
        path_lower = urllib.parse.urlparse(href).path.lower()
        for hint in COMPANY_INFO_PATH_HINTS:
            if hint in path_lower:
                score += 5
                break

        if score > best_score:
            best_score = score
            best_url = href

    if best_url and best_score >= 5:
        logger.info("会社概要ページ発見 (score=%d): %s", best_score, best_url)
        return best_url

    # 見つからなければトップページ自体を返す
    logger.info("会社概要ページ未検出 → トップページ使用: %s", top_url)
    return top_url


# ────────────────────────────────────────────────────────────────
# 高レベル API
# ────────────────────────────────────────────────────────────────

def get_company_html(
    company_name: str,
    session: Optional[requests.Session] = None,
) -> tuple[Optional[str], str]:
    """
    企業名を受け取り、会社概要ページのHTML と URL のタプルを返す。
    取得失敗時は (None, "") を返す。

    Returns
    -------
    (html_text, page_url)
    """
    # 1. 公式HP URLを推定
    top_url = find_official_url(company_name, session=session)
    if not top_url:
        logger.warning("公式HP URL 未発見: %s", company_name)
        return None, ""

    # 2. 会社概要ページへのリンクを辿る
    info_url = find_company_info_url(top_url, session=session)
    if not info_url:
        logger.warning("会社概要ページ 未発見: %s", company_name)
        return None, top_url

    # 3. 会社概要ページを取得
    html = fetch_url(info_url, session=session, sleep=True)
    return html, info_url
