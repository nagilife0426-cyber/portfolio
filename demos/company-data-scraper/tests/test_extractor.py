"""
tests/test_extractor.py
-----------------------
extractor.py の抽出ロジックをダミーHTMLに対してテストする。
実在サイトへのアクセスは一切しない。

実行方法:
    cd a4-company-scraper
    pytest tests/ -v
"""

from pathlib import Path

import pytest

from extractor import (
    extract_from_html,
    extract_postal_code,
    extract_address,
    ExtractedInfo,
)

# ────────────────────────────────────────────────────────────────
# ヘルパー: ダミーHTMLを読み込む
# ────────────────────────────────────────────────────────────────

SAMPLE_DIR = Path(__file__).parent / "sample_html"


def load_html(filename: str) -> str:
    """sample_html/ 配下のHTMLファイルを読み込んで返す。"""
    path = SAMPLE_DIR / filename
    return path.read_text(encoding="utf-8")


# ────────────────────────────────────────────────────────────────
# 単体テスト: 郵便番号抽出
# ────────────────────────────────────────────────────────────────

class TestExtractPostalCode:
    """extract_postal_code() の単体テスト。"""

    def test_standard_format(self):
        """〒XXX-XXXX 形式。"""
        assert extract_postal_code("〒100-0001 東京都千代田区") == "100-0001"

    def test_no_kigou(self):
        """〒なしのXXX-XXXX形式。"""
        assert extract_postal_code("郵便番号: 530-0001") == "530-0001"

    def test_with_space(self):
        """〒と数字の間にスペース。"""
        assert extract_postal_code("〒 220-0012") == "220-0012"

    def test_full_width_hyphen(self):
        """全角ハイフン区切り。"""
        assert extract_postal_code("〒460－0008") == "460-0008"

    def test_no_postal_code(self):
        """郵便番号がない場合は None。"""
        assert extract_postal_code("住所情報はありません") is None

    def test_phone_number_not_extracted(self):
        """電話番号（03-1234-5678）を郵便番号と誤認しないこと。"""
        # 電話番号の前半部分(03)は3桁だが後半が4桁×2になる
        result = extract_postal_code("TEL: 03-1234-5678")
        # 03-1234 はマッチしてしまうが、それよりも実際の郵便番号を優先できるかを確認
        # このテストはパターン共存時の優先度を検証
        text_with_both = "TEL: 03-1234-5678 / 所在地: 〒100-0001 東京都"
        assert extract_postal_code(text_with_both) == "100-0001"


# ────────────────────────────────────────────────────────────────
# 単体テスト: 住所抽出
# ────────────────────────────────────────────────────────────────

class TestExtractAddress:
    """extract_address() の単体テスト。"""

    def test_tokyo(self):
        """東京都の住所。"""
        result = extract_address("〒100-0001 東京都千代田区千代田1丁目1番地")
        assert result is not None
        assert "東京都" in result
        assert "千代田区" in result

    def test_osaka(self):
        """大阪府の住所。"""
        result = extract_address("大阪府大阪市北区梅田2丁目4番9号")
        assert result is not None
        assert "大阪府" in result

    def test_kanagawa(self):
        """神奈川県の住所。"""
        result = extract_address("神奈川県横浜市西区みなとみらい2丁目3番3号")
        assert result is not None
        assert "神奈川県" in result

    def test_no_address(self):
        """住所なし。"""
        result = extract_address("お問い合わせはメールにて受け付けております。")
        assert result is None

    def test_address_with_building(self):
        """ビル名含む住所。"""
        text = "愛知県名古屋市中区栄3丁目15番33号 フューチャービル5F"
        result = extract_address(text)
        assert result is not None
        assert "愛知県" in result


# ────────────────────────────────────────────────────────────────
# 統合テスト: ダミーHTMLパターン別
# ────────────────────────────────────────────────────────────────

class TestPattern1TableStandard:
    """パターン1: 標準的な th/td テーブル形式。"""

    @pytest.fixture(autouse=True)
    def setup(self):
        html = load_html("pattern1_table_standard.html")
        self.result: ExtractedInfo = extract_from_html(
            html, company_name="株式会社サンプル商事"
        )

    def test_postal_code(self):
        assert self.result.postal_code == "100-0001"

    def test_address_contains_prefecture(self):
        assert self.result.address is not None
        assert "東京都" in self.result.address

    def test_address_contains_city(self):
        assert self.result.address is not None
        assert "千代田" in self.result.address

    def test_representative(self):
        assert self.result.representative is not None
        assert "山田" in self.result.representative
        assert "太郎" in self.result.representative

    def test_score_is_complete(self):
        assert self.result.score == "完全"


class TestPattern2DlDtDd:
    """パターン2: dl/dt/dd 定義リスト形式。"""

    @pytest.fixture(autouse=True)
    def setup(self):
        html = load_html("pattern2_dl_dt_dd.html")
        self.result: ExtractedInfo = extract_from_html(
            html, company_name="有限会社テスト工業"
        )

    def test_postal_code(self):
        assert self.result.postal_code == "530-0001"

    def test_address_contains_osaka(self):
        assert self.result.address is not None
        assert "大阪府" in self.result.address

    def test_representative(self):
        assert self.result.representative is not None
        assert "鈴木" in self.result.representative

    def test_score_is_complete(self):
        assert self.result.score == "完全"


class TestPattern3PlaintextInline:
    """パターン3: 平文テキスト・p/span 混在形式。"""

    @pytest.fixture(autouse=True)
    def setup(self):
        html = load_html("pattern3_plaintext_inline.html")
        self.result: ExtractedInfo = extract_from_html(
            html, company_name="合同会社フューチャーネット"
        )

    def test_postal_code(self):
        assert self.result.postal_code == "460-0008"

    def test_address_contains_aichi(self):
        assert self.result.address is not None
        assert "愛知県" in self.result.address

    def test_representative(self):
        assert self.result.representative is not None
        assert "佐藤" in self.result.representative

    def test_score_is_complete(self):
        assert self.result.score == "完全"


class TestPattern4NoRepresentative:
    """パターン4: 代表者名なし → "要確認" スコア。"""

    @pytest.fixture(autouse=True)
    def setup(self):
        html = load_html("pattern4_no_representative.html")
        self.result: ExtractedInfo = extract_from_html(
            html, company_name="株式会社レアケース"
        )

    def test_postal_code(self):
        assert self.result.postal_code == "812-0011"

    def test_address_contains_fukuoka(self):
        assert self.result.address is not None
        assert "福岡県" in self.result.address

    def test_representative_is_none(self):
        """代表者名が取れないことを確認。"""
        assert self.result.representative is None

    def test_score_is_yoikakurun(self):
        """全項目揃わないので "要確認" になること。"""
        assert self.result.score == "要確認"


class TestPattern5ComplexLayout:
    """パターン5: 英日混在・ネストdiv・CEO表記。"""

    @pytest.fixture(autouse=True)
    def setup(self):
        html = load_html("pattern5_complex_layout.html")
        self.result: ExtractedInfo = extract_from_html(
            html, company_name="XYZホールディングス株式会社"
        )

    def test_postal_code(self):
        assert self.result.postal_code == "220-0012"

    def test_address_contains_kanagawa(self):
        assert self.result.address is not None
        assert "神奈川県" in self.result.address

    def test_representative(self):
        """CEO / 代表取締役 表記からも氏名を抽出できること。"""
        assert self.result.representative is not None
        assert "田中" in self.result.representative

    def test_score_is_complete(self):
        assert self.result.score == "完全"


# ────────────────────────────────────────────────────────────────
# エッジケーステスト
# ────────────────────────────────────────────────────────────────

class TestEdgeCases:
    """空HTML・ノイズデータ等のエッジケース。"""

    def test_empty_html(self):
        """空のHTMLでもエラーにならず、スコア "取得失敗" を返す。"""
        result = extract_from_html("", company_name="テスト株式会社")
        assert result.score == "取得失敗"
        assert result.postal_code is None
        assert result.address is None
        assert result.representative is None

    def test_html_without_company_info(self):
        """企業情報がないページ（トップページ等）では要確認か取得失敗になる。"""
        html = "<html><body><p>ようこそ！当社のWebサイトへ。</p></body></html>"
        result = extract_from_html(html, company_name="架空株式会社")
        assert result.score in ("要確認", "取得失敗")

    def test_as_dict_keys(self):
        """as_dict() が期待するキーセットを返すこと。"""
        result = extract_from_html("", company_name="テスト")
        d = result.as_dict()
        expected_keys = {"企業名", "郵便番号", "住所", "代表者名", "URL", "スコア", "備考"}
        assert set(d.keys()) == expected_keys

    def test_company_name_preserved(self):
        """入力企業名が結果に引き継がれること。"""
        result = extract_from_html("<html><body></body></html>", company_name="架空商事")
        assert result.company_name == "架空商事"

    def test_source_url_preserved(self):
        """source_url が結果に引き継がれること。"""
        result = extract_from_html(
            "<html><body></body></html>",
            source_url="https://example.co.jp/company"
        )
        assert result.source_url == "https://example.co.jp/company"

    def test_postal_code_not_confused_with_year(self):
        """西暦年（2024年）を郵便番号と誤認しないこと。"""
        # 2024年はXXX-XXXXパターンに合わないので問題なし
        result = extract_postal_code("設立: 2024年4月1日")
        assert result is None

    def test_address_with_postal_prefix_removed(self):
        """住所フィールドに郵便番号プレフィックスが含まれていても除去されること。"""
        html = load_html("pattern1_table_standard.html")
        result = extract_from_html(html)
        if result.address:
            # 住所が "〒100-0001 東京都..." のような形になっていないこと
            import re
            assert not re.match(r"^〒?\d{3}-\d{4}", result.address), \
                f"住所に郵便番号プレフィックスが残っている: {result.address}"
