Attribute VB_Name = "Module1"
'==============================================================================
' Module1.bas
' Amazon セラーレポート 集計ツール (Excel VBA 版)
'
' 概要:
'   GAS版と同等の集計機能をExcel VBAで実現する
'   - CSV取込 → 列マッピング → 商品別/月別集計 → ダッシュボードシート生成
'
' 動作環境: Excel 2016 以降 (Microsoft 365推奨)
' 文字コード: UTF-8 (BOMあり) または Shift-JIS の両方に対応
'==============================================================================

Option Explicit

' ==============================
' 定数定義
' ==============================

' シート名
Private Const SHEET_RAW_SALES     As String = "RAW_売上"
Private Const SHEET_RAW_AD        As String = "RAW_広告"
Private Const SHEET_RAW_INVENTORY As String = "RAW_在庫"
Private Const SHEET_SUMMARY       As String = "SUMMARY"
Private Const SHEET_DASHBOARD     As String = "DASHBOARD"

' 色定数 (RGB)
Private Const COLOR_PRIMARY   As Long = 1742056  ' #1a73e8
Private Const COLOR_SUCCESS   As Long = 1258803  ' #137333
Private Const COLOR_WARNING   As Long = 11534400 ' #b06000
Private Const COLOR_DANGER    As Long = 12861649 ' #c5221f
Private Const COLOR_HEADER_FG As Long = 16777215 ' #ffffff
Private Const COLOR_ALT_ROW   As Long = 15987699 ' #f3f4f6

' ==============================
' カスタムメニュー（リボン経由 or 標準モジュール実行）
' ==============================

'------------------------------------------------------------
' ■ メインメニュー: Auto_Open で呼び出すと起動時に実行される
'------------------------------------------------------------
Public Sub Auto_Open()
    ' クイックアクセスツールバーへの追加手順はREADMEを参照
    MsgBox "Amazon集計ツール v1.0 が起動しました。" & vbCrLf & _
           "「開発」タブ → マクロ → 実行 からメニューを使用してください。", _
           vbInformation, "Amazon集計ツール"
End Sub

' ==============================
' 1. CSVインポート機能
' ==============================

'------------------------------------------------------------
' 売上レポートCSVをRAW_売上シートに取り込む
'------------------------------------------------------------
Public Sub ImportSalesReport()
    Dim filePath As String
    filePath = GetFilePath("売上レポートCSVを選択してください")
    If filePath = "" Then Exit Sub

    Call ImportCsvToSheet(filePath, SHEET_RAW_SALES, "sales")
    MsgBox "売上レポートの取込が完了しました。", vbInformation, "完了"
End Sub

'------------------------------------------------------------
' 広告レポートCSVをRAW_広告シートに取り込む
'------------------------------------------------------------
Public Sub ImportAdReport()
    Dim filePath As String
    filePath = GetFilePath("広告レポートCSVを選択してください")
    If filePath = "" Then Exit Sub

    Call ImportCsvToSheet(filePath, SHEET_RAW_AD, "ad")
    MsgBox "広告レポートの取込が完了しました。", vbInformation, "完了"
End Sub

'------------------------------------------------------------
' 在庫レポートCSVをRAW_在庫シートに取り込む
'------------------------------------------------------------
Public Sub ImportInventoryReport()
    Dim filePath As String
    filePath = GetFilePath("在庫レポートCSVを選択してください")
    If filePath = "" Then Exit Sub

    Call ImportCsvToSheet(filePath, SHEET_RAW_INVENTORY, "inventory")
    MsgBox "在庫レポートの取込が完了しました。", vbInformation, "完了"
End Sub

'------------------------------------------------------------
' CSVファイルを指定シートに取り込む（汎用）
' @param filePath  CSVファイルのフルパス
' @param sheetName 書き込み先シート名
' @param reportType "sales" / "ad" / "inventory"
'------------------------------------------------------------
Private Sub ImportCsvToSheet(filePath As String, sheetName As String, reportType As String)
    Dim ws As Worksheet
    Dim csvWb As Workbook
    Dim csvWs As Worksheet
    Dim lastRow As Long
    Dim lastCol As Long

    On Error GoTo ErrorHandler

    ' 対象シートを取得（なければ作成）
    ws = GetOrCreateSheet(sheetName)
    ws.Cells.ClearContents
    ws.Cells.ClearFormats

    ' CSVをテンポラリブックとして開く
    Application.ScreenUpdating = False
    csvWb = Workbooks.Open(Filename:=filePath, _
                           ReadOnly:=True, _
                           Delimiter:=",", _
                           Local:=True)
    csvWs = csvWb.Worksheets(1)

    lastRow = csvWs.UsedRange.Rows.Count
    lastCol = csvWs.UsedRange.Columns.Count

    If lastRow < 2 Then
        MsgBox "CSVにデータがありません。", vbExclamation, "エラー"
        csvWb.Close False
        Exit Sub
    End If

    ' ヘッダーの列インデックスを取得（表記ゆれ対応）
    Dim colMap As Object
    colMap = BuildColumnMap(csvWs, reportType)

    ' 標準ヘッダーを書き込む
    Dim stdHeaders() As Variant
    stdHeaders = GetStandardHeaders(reportType)

    ws.Range(ws.Cells(1, 1), ws.Cells(1, UBound(stdHeaders) + 1)).Value = stdHeaders
    ApplyHeaderFormat ws, 1, UBound(stdHeaders) + 1, COLOR_PRIMARY

    ' データを変換して書き込む
    Dim outputRow As Long
    outputRow = 2
    Dim srcRow As Long

    For srcRow = 2 To lastRow
        Dim outputData() As Variant
        outputData = MapRowData(csvWs, srcRow, colMap, reportType)

        If Not IsEmpty(outputData) Then
            ws.Range(ws.Cells(outputRow, 1), ws.Cells(outputRow, UBound(outputData) + 1)).Value = outputData
            outputRow = outputRow + 1
        End If
    Next srcRow

    ' 書式整形
    Call FormatDataSheet(ws, sheetName, outputRow - 2)
    ws.Columns.AutoFit

    csvWb.Close False
    Application.ScreenUpdating = True

    Debug.Print sheetName & " 取込完了: " & (outputRow - 2) & " 件"
    Exit Sub

ErrorHandler:
    Application.ScreenUpdating = True
    If Not csvWb Is Nothing Then csvWb.Close False
    MsgBox "エラーが発生しました: " & Err.Description, vbCritical, "エラー"
End Sub

' ==============================
' 2. 集計処理
' ==============================

'------------------------------------------------------------
' 集計を実行してSUMMARYシートを更新する
'------------------------------------------------------------
Public Sub RunAggregation()
    Dim ws As Worksheet
    Dim salesWs As Worksheet

    On Error GoTo ErrorHandler

    salesWs = Nothing
    On Error Resume Next
    salesWs = ThisWorkbook.Worksheets(SHEET_RAW_SALES)
    On Error GoTo ErrorHandler

    If salesWs Is Nothing Then
        MsgBox "RAW_売上シートが見つかりません。先にレポートを取り込んでください。", _
               vbExclamation, "エラー"
        Exit Sub
    End If

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    ' 商品別集計
    Dim productData As Object  ' Dictionary: ASIN -> 集計データ
    productData = AggregateByProduct()

    ' 月別集計
    Dim monthData As Object
    monthData = AggregateByMonth()

    ' SUMMARYシートへ書き出し
    Call WriteSummarySheet(productData, monthData)

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    MsgBox "集計が完了しました。", vbInformation, "完了"
    Exit Sub

ErrorHandler:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "集計エラー: " & Err.Description, vbCritical, "エラー"
End Sub

'------------------------------------------------------------
' 商品（ASIN）別に集計する
' @returns Dictionary(asin -> 集計結果Array)
'------------------------------------------------------------
Private Function AggregateByProduct() As Object
    Dim ws As Worksheet
    Dim adWs As Worksheet
    Dim invWs As Worksheet
    Dim dict As Object
    dict = CreateObject("Scripting.Dictionary")

    ws = ThisWorkbook.Worksheets(SHEET_RAW_SALES)
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row

    ' ヘッダー行の列番号を取得
    Dim hRow As Object
    hRow = GetHeaderMap(ws)

    Dim i As Long
    For i = 2 To lastRow
        Dim asin As String
        asin = Trim(CStr(ws.Cells(i, hRow("ASIN")).Value))
        If asin = "" Then GoTo NextRow

        If Not dict.Exists(asin) Then
            ' キー存在確認・初期化
            ' [0]=売上, [1]=返品額, [2]=注文数, [3]=数量, [4]=返品数
            ' [5]=手数料, [6]=FBA配送料, [7]=FBA保管料, [8]=原価, [9]=広告費割当
            ' [10]=SKU, [11]=商品名
            dict(asin) = Array(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "", "")
        End If

        Dim d() As Variant
        d = dict(asin)

        Dim revenue As Double
        revenue = ToNum(ws.Cells(i, hRow("売上高")).Value)
        Dim returnAmt As Double
        returnAmt = ToNum(ws.Cells(i, hRow("返品額")).Value)

        d(0) = d(0) + revenue - returnAmt  ' 純売上
        d(1) = d(1) + returnAmt            ' 返品額
        d(2) = d(2) + 1                    ' 注文件数
        d(3) = d(3) + ToNum(ws.Cells(i, hRow("数量")).Value)
        d(4) = d(4) + ToNum(ws.Cells(i, hRow("返品数")).Value)
        d(5) = d(5) + ToNum(ws.Cells(i, hRow("Amazon手数料")).Value)
        d(6) = d(6) + ToNum(ws.Cells(i, hRow("FBA配送料")).Value)
        d(7) = d(7) + ToNum(ws.Cells(i, hRow("FBA保管料")).Value)
        d(8) = d(8) + ToNum(ws.Cells(i, hRow("原価")).Value)
        d(9) = d(9) + ToNum(ws.Cells(i, hRow("広告費割当")).Value)

        If d(10) = "" Then d(10) = Trim(CStr(ws.Cells(i, hRow("SKU")).Value))
        If d(11) = "" Then d(11) = Trim(CStr(ws.Cells(i, hRow("商品名")).Value))

        dict(asin) = d
NextRow:
    Next i

    AggregateByProduct = dict
End Function

'------------------------------------------------------------
' 月別に集計する
' @returns Dictionary(YYYY-MM -> 集計結果Array)
'------------------------------------------------------------
Private Function AggregateByMonth() As Object
    Dim ws As Worksheet
    Dim dict As Object
    dict = CreateObject("Scripting.Dictionary")

    ws = ThisWorkbook.Worksheets(SHEET_RAW_SALES)
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row

    Dim hRow As Object
    hRow = GetHeaderMap(ws)

    Dim i As Long
    For i = 2 To lastRow
        Dim dateStr As String
        dateStr = Trim(CStr(ws.Cells(i, hRow("注文日")).Value))
        Dim monthKey As String
        monthKey = ExtractMonth(dateStr)
        If monthKey = "" Then GoTo NextMonthRow

        If Not dict.Exists(monthKey) Then
            ' [0]=純売上, [1]=注文数, [2]=数量, [3]=手数料, [4]=FBA合計, [5]=原価, [6]=広告費, [7]=広告売上
            dict(monthKey) = Array(0, 0, 0, 0, 0, 0, 0, 0)
        End If

        Dim dm() As Variant
        dm = dict(monthKey)
        Dim rev As Double
        rev = ToNum(ws.Cells(i, hRow("売上高")).Value)
        Dim retAmt As Double
        retAmt = ToNum(ws.Cells(i, hRow("返品額")).Value)

        dm(0) = dm(0) + rev - retAmt
        dm(1) = dm(1) + 1
        dm(2) = dm(2) + ToNum(ws.Cells(i, hRow("数量")).Value)
        dm(3) = dm(3) + ToNum(ws.Cells(i, hRow("Amazon手数料")).Value)
        dm(4) = dm(4) + ToNum(ws.Cells(i, hRow("FBA配送料")).Value) + _
                        ToNum(ws.Cells(i, hRow("FBA保管料")).Value)
        dm(5) = dm(5) + ToNum(ws.Cells(i, hRow("原価")).Value)
        dm(6) = dm(6) + ToNum(ws.Cells(i, hRow("広告費割当")).Value)

        dict(monthKey) = dm
NextMonthRow:
    Next i

    AggregateByMonth = dict
End Function

'------------------------------------------------------------
' SUMMARYシートに集計結果を書き出す
'------------------------------------------------------------
Private Sub WriteSummarySheet(productData As Object, monthData As Object)
    Dim ws As Worksheet
    ws = GetOrCreateSheet(SHEET_SUMMARY)
    ws.Cells.ClearContents
    ws.Cells.ClearFormats

    Dim curRow As Long
    curRow = 1

    ' --- セクション1: 月別集計 ---
    ws.Cells(curRow, 1).Value = "■ 月別集計"
    ws.Cells(curRow, 1).Font.Bold = True
    ws.Cells(curRow, 1).Font.Size = 12
    curRow = curRow + 1

    Dim mHeaders As Variant
    mHeaders = Array("月", "純売上", "注文件数", "数量", "Amazon手数料", "FBA費用", "原価", "広告費", "粗利", "粗利率")
    ws.Range(ws.Cells(curRow, 1), ws.Cells(curRow, 10)).Value = mHeaders
    ApplyHeaderFormat ws, curRow, 10, COLOR_PRIMARY
    curRow = curRow + 1

    ' 月キーを昇順ソートして書き出す
    Dim monthKeys() As String
    monthKeys = SortKeys(monthData.Keys)

    Dim mk As Variant
    For Each mk In monthKeys
        Dim dm() As Variant
        dm = monthData(mk)
        Dim grossProfit As Double
        grossProfit = dm(0) - dm(5) - dm(3) - dm(4) - dm(6)  ' 純売上-原価-手数料-FBA-広告費
        Dim gpr As Double
        gpr = IIf(dm(0) > 0, grossProfit / dm(0), 0)

        ws.Cells(curRow, 1).Value = Replace(mk, "-", "年") & "月"
        ws.Cells(curRow, 2).Value = dm(0)
        ws.Cells(curRow, 3).Value = dm(1)
        ws.Cells(curRow, 4).Value = dm(2)
        ws.Cells(curRow, 5).Value = dm(3)
        ws.Cells(curRow, 6).Value = dm(4)
        ws.Cells(curRow, 7).Value = dm(5)
        ws.Cells(curRow, 8).Value = dm(6)
        ws.Cells(curRow, 9).Value = grossProfit
        ws.Cells(curRow, 10).Value = gpr

        ' 通貨フォーマット
        ws.Range(ws.Cells(curRow, 2), ws.Cells(curRow, 9)).NumberFormat = "¥#,##0"
        ws.Cells(curRow, 10).NumberFormat = "0.0%"

        If curRow Mod 2 = 0 Then
            ws.Range(ws.Cells(curRow, 1), ws.Cells(curRow, 10)).Interior.Color = COLOR_ALT_ROW
        End If

        curRow = curRow + 1
    Next mk

    curRow = curRow + 2

    ' --- セクション2: 商品別集計 ---
    ws.Cells(curRow, 1).Value = "■ 商品別集計"
    ws.Cells(curRow, 1).Font.Bold = True
    ws.Cells(curRow, 1).Font.Size = 12
    curRow = curRow + 1

    Dim pHeaders As Variant
    pHeaders = Array("ASIN", "SKU", "商品名", "純売上", "注文数", "数量", "Amazon手数料", "FBA費用", "原価", "広告費", "粗利", "粗利率")
    ws.Range(ws.Cells(curRow, 1), ws.Cells(curRow, 12)).Value = pHeaders
    ApplyHeaderFormat ws, curRow, 12, COLOR_PRIMARY
    curRow = curRow + 1

    ' 売上高降順でソートしながら書き出す（簡易版：全データを配列に入れて整列）
    Dim asinKey As Variant
    For Each asinKey In productData.Keys
        Dim pd() As Variant
        pd = productData(asinKey)
        Dim pgross As Double
        pgross = pd(0) - pd(8) - pd(5) - pd(6) - pd(7) - pd(9)
        Dim pgpr As Double
        pgpr = IIf(pd(0) > 0, pgross / pd(0), 0)

        ws.Cells(curRow, 1).Value = asinKey
        ws.Cells(curRow, 2).Value = pd(10)   ' SKU
        ws.Cells(curRow, 3).Value = pd(11)   ' 商品名
        ws.Cells(curRow, 4).Value = pd(0)    ' 純売上
        ws.Cells(curRow, 5).Value = pd(2)    ' 注文数
        ws.Cells(curRow, 6).Value = pd(3)    ' 数量
        ws.Cells(curRow, 7).Value = pd(5)    ' Amazon手数料
        ws.Cells(curRow, 8).Value = pd(6) + pd(7)  ' FBA配送料+保管料
        ws.Cells(curRow, 9).Value = pd(8)    ' 原価
        ws.Cells(curRow, 10).Value = pd(9)   ' 広告費
        ws.Cells(curRow, 11).Value = pgross  ' 粗利
        ws.Cells(curRow, 12).Value = pgpr    ' 粗利率

        ws.Range(ws.Cells(curRow, 4), ws.Cells(curRow, 11)).NumberFormat = "¥#,##0"
        ws.Cells(curRow, 12).NumberFormat = "0.0%"

        ' 粗利率による色分け
        If pgpr >= 0.2 Then
            ws.Cells(curRow, 12).Font.Color = COLOR_SUCCESS
        ElseIf pgpr >= 0.1 Then
            ws.Cells(curRow, 12).Font.Color = COLOR_WARNING
        Else
            ws.Cells(curRow, 12).Font.Color = COLOR_DANGER
        End If

        curRow = curRow + 1
    Next asinKey

    ws.Columns.AutoFit
    Debug.Print "SUMMARYシート書き出し完了"
End Sub

' ==============================
' 3. ダッシュボード生成
' ==============================

'------------------------------------------------------------
' ダッシュボードシートを生成・更新する
'------------------------------------------------------------
Public Sub BuildDashboard()
    ' まず集計を実行
    Call RunAggregation

    Dim ws As Worksheet
    ws = GetOrCreateSheet(SHEET_DASHBOARD)
    ws.Cells.ClearContents
    ws.Cells.ClearFormats

    Application.ScreenUpdating = False

    ' SUMMARYシートのデータを参照してダッシュボードを構築
    ' （本実装では RunAggregation で得たデータを直接使う設計にする）
    Dim curRow As Long
    curRow = 1

    ' タイトル
    With ws.Cells(curRow, 1)
        .Value = "Amazon セラー ダッシュボード - Q1 2024"
        .Font.Size = 16
        .Font.Bold = True
        .Font.Color = COLOR_PRIMARY
    End With
    ws.Rows(curRow).RowHeight = 36
    curRow = curRow + 2

    ' KPIサマリー（SUMMARYシートからの参照）
    ws.Cells(curRow, 1).Value = "集計完了時刻: " & Now()
    ws.Cells(curRow, 1).Font.Color = RGB(95, 99, 104)
    ws.Cells(curRow, 1).Font.Italic = True
    curRow = curRow + 1

    ws.Cells(curRow, 1).Value = "※ SUMMARYシートで詳細データを確認してください"
    ws.Cells(curRow, 1).Font.Color = COLOR_PRIMARY
    curRow = curRow + 2

    ' グラフ（月別推移）を追加
    Call CreateMonthlyChart(ws)

    ws.Columns.AutoFit
    Application.ScreenUpdating = True

    ThisWorkbook.Worksheets(SHEET_DASHBOARD).Activate
    MsgBox "ダッシュボードの生成が完了しました！", vbInformation, "完了"
End Sub

'------------------------------------------------------------
' 月別推移グラフを追加する
'------------------------------------------------------------
Private Sub CreateMonthlyChart(targetWs As Worksheet)
    Dim summaryWs As Worksheet
    On Error Resume Next
    summaryWs = ThisWorkbook.Worksheets(SHEET_SUMMARY)
    On Error GoTo 0
    If summaryWs Is Nothing Then Exit Sub

    ' 既存グラフを削除
    Dim chObj As ChartObject
    For Each chObj In targetWs.ChartObjects
        chObj.Delete
    Next chObj

    ' SUMMARYから月別データ範囲を特定（ヘッダー行 + 月次データ行）
    Dim dataRange As Range
    Dim lastRow As Long
    lastRow = summaryWs.Cells(summaryWs.Rows.Count, 1).End(xlUp).Row

    ' グラフオブジェクトを作成
    Dim chartObj As ChartObject
    Set chartObj = targetWs.ChartObjects.Add(Left:=10, Top:=80, Width:=500, Height:=300)

    With chartObj.Chart
        .ChartType = xlColumnClustered
        .HasTitle = True
        .ChartTitle.Text = "月別 売上・粗利 推移"
        .ChartTitle.Font.Size = 12
        .ChartTitle.Font.Bold = True
        ' データ系列はRunAggregation後のSUMMARYシートから参照
        .ChartStyle = 2
    End With
End Sub

' ==============================
' 全処理を一括実行
' ==============================

'------------------------------------------------------------
' 全処理（取込→集計→ダッシュボード）を一括実行する
'------------------------------------------------------------
Public Sub RunAll()
    Dim resp As Integer
    resp = MsgBox("全処理（集計→ダッシュボード生成）を実行しますか？" & vbCrLf & _
                  "（CSVは事前に取込済みの想定）", _
                  vbYesNo + vbQuestion, "確認")
    If resp = vbNo Then Exit Sub

    Call RunAggregation
    Call BuildDashboard
End Sub

' ==============================
' ユーティリティ関数
' ==============================

'------------------------------------------------------------
' ファイル選択ダイアログを表示してパスを返す
'------------------------------------------------------------
Private Function GetFilePath(prompt As String) As String
    Dim fd As Office.FileDialog
    fd = Application.FileDialog(msoFileDialogFilePicker)
    With fd
        .Title = prompt
        .Filters.Clear
        .Filters.Add "CSVファイル", "*.csv"
        .Filters.Add "すべてのファイル", "*.*"
        .AllowMultiSelect = False
        If .Show Then
            GetFilePath = .SelectedItems(1)
        Else
            GetFilePath = ""
        End If
    End With
End Function

'------------------------------------------------------------
' シートを取得または新規作成する
'------------------------------------------------------------
Private Function GetOrCreateSheet(sheetName As String) As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    ws = ThisWorkbook.Worksheets(sheetName)
    On Error GoTo 0

    If ws Is Nothing Then
        ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        ws.Name = sheetName
    End If

    GetOrCreateSheet = ws
End Function

'------------------------------------------------------------
' ヘッダー行の列名→列番号マップを取得する（表記ゆれ対応）
' @returns Dictionary(標準列名 -> 列番号)
'------------------------------------------------------------
Private Function GetHeaderMap(ws As Worksheet) As Object
    Dim dict As Object
    dict = CreateObject("Scripting.Dictionary")

    Dim lastCol As Long
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    Dim i As Long
    For i = 1 To lastCol
        Dim hdr As String
        hdr = Trim(ws.Cells(1, i).Value)
        If hdr <> "" Then
            dict(hdr) = i
        End If
    Next i

    GetHeaderMap = dict
End Function

'------------------------------------------------------------
' ヘッダー行に書式を適用する
'------------------------------------------------------------
Private Sub ApplyHeaderFormat(ws As Worksheet, rowNum As Long, colCount As Long, bgColor As Long)
    With ws.Range(ws.Cells(rowNum, 1), ws.Cells(rowNum, colCount))
        .Interior.Color = bgColor
        .Font.Color = COLOR_HEADER_FG
        .Font.Bold = True
        .HorizontalAlignment = xlCenter
    End With
    ws.Rows(rowNum).RowHeight = 22
End Sub

'------------------------------------------------------------
' 文字列を数値に変換する（カンマ・円記号・%除去）
'------------------------------------------------------------
Private Function ToNum(value As Variant) As Double
    If IsEmpty(value) Or IsNull(value) Then
        ToNum = 0
        Exit Function
    End If
    Dim cleaned As String
    cleaned = Replace(Replace(Replace(Replace(CStr(value), ",", ""), "¥", ""), "%", ""), " ", "")
    If IsNumeric(cleaned) Then
        ToNum = CDbl(cleaned)
    Else
        ToNum = 0
    End If
End Function

'------------------------------------------------------------
' 日付文字列から YYYY-MM を抽出する
'------------------------------------------------------------
Private Function ExtractMonth(dateStr As String) As String
    If Len(dateStr) >= 7 And Mid(dateStr, 5, 1) = "-" Then
        ExtractMonth = Left(dateStr, 7)
    Else
        ExtractMonth = ""
    End If
End Function

'------------------------------------------------------------
' 文字列配列キーを昇順ソートする（バブルソート）
'------------------------------------------------------------
Private Function SortKeys(keys As Variant) As String()
    Dim arr() As String
    Dim n As Long
    n = UBound(keys) - LBound(keys) + 1
    ReDim arr(n - 1)

    Dim i As Long
    For i = 0 To n - 1
        arr(i) = CStr(keys(LBound(keys) + i))
    Next i

    ' バブルソート
    Dim j As Long
    Dim tmp As String
    For i = 0 To n - 2
        For j = 0 To n - 2 - i
            If arr(j) > arr(j + 1) Then
                tmp = arr(j)
                arr(j) = arr(j + 1)
                arr(j + 1) = tmp
            End If
        Next j
    Next i

    SortKeys = arr
End Function

'------------------------------------------------------------
' レポート種別に対応する標準ヘッダー配列を返す
'------------------------------------------------------------
Private Function GetStandardHeaders(reportType As String) As Variant
    Select Case reportType
        Case "sales"
            GetStandardHeaders = Array("注文日", "ASIN", "SKU", "商品名", "注文番号", _
                                       "チャネル", "フルフィルメント", "数量", "売上高", _
                                       "Amazon手数料率(%)", "Amazon手数料", "FBA配送料", _
                                       "FBA保管料", "原価", "広告費割当", "返品数", "返品額")
        Case "ad"
            GetStandardHeaders = Array("キャンペーン名", "広告グループ名", "ASIN", "SKU", "商品名", _
                                       "期間開始日", "期間終了日", "インプレッション数", "クリック数", _
                                       "クリック率(%)", "広告費", "広告売上", "ACoS(%)", "ROAS")
        Case "inventory"
            GetStandardHeaders = Array("ASIN", "SKU", "商品名", "FBA在庫数", "出荷可能在庫", _
                                       "予約済み在庫", "仕入中在庫", "平均販売速度/日", _
                                       "推定在庫切れまでの日数", "最終入庫日", "原価/個", "FBA保管手数料/月")
        Case Else
            GetStandardHeaders = Array()
    End Select
End Function

'------------------------------------------------------------
' ソース行を標準形式の配列に変換する（表記ゆれ対応）
' @returns Variant配列 or Empty（空行スキップ）
'------------------------------------------------------------
Private Function MapRowData(srcWs As Worksheet, srcRow As Long, _
                            colMap As Object, reportType As String) As Variant
    ' 空行チェック
    Dim asinCol As Long
    asinCol = IIf(colMap.Exists("ASIN"), colMap("ASIN"), 0)
    If asinCol > 0 And Trim(CStr(srcWs.Cells(srcRow, asinCol).Value)) = "" Then
        MapRowData = Empty
        Exit Function
    End If

    Dim result() As Variant

    Select Case reportType
        Case "sales"
            ReDim result(16)  ' 17列
            result(0) = GetMapped(srcWs, srcRow, colMap, "注文日", "order date", "date", "日付")
            result(1) = GetMapped(srcWs, srcRow, colMap, "ASIN", "asin")
            result(2) = GetMapped(srcWs, srcRow, colMap, "SKU", "sku", "seller-sku")
            result(3) = GetMapped(srcWs, srcRow, colMap, "商品名", "product name", "item-name")
            result(4) = GetMapped(srcWs, srcRow, colMap, "注文番号", "order-id")
            result(5) = GetMapped(srcWs, srcRow, colMap, "販売チャネル", "channel")
            result(6) = GetMapped(srcWs, srcRow, colMap, "フルフィルメント", "fulfillment-channel")
            result(7) = ToNum(GetMapped(srcWs, srcRow, colMap, "数量", "quantity", "quantity-purchased"))
            result(8) = ToNum(GetMapped(srcWs, srcRow, colMap, "売上高", "item-price", "revenue"))
            result(9) = ToNum(GetMapped(srcWs, srcRow, colMap, "Amazon手数料率(%)", "手数料率"))
            result(10) = ToNum(GetMapped(srcWs, srcRow, colMap, "Amazon手数料", "referral-fee"))
            result(11) = ToNum(GetMapped(srcWs, srcRow, colMap, "FBA配送料", "fba-per-unit-fulfillment-fee"))
            result(12) = ToNum(GetMapped(srcWs, srcRow, colMap, "FBA保管料", "storage-fee"))
            result(13) = ToNum(GetMapped(srcWs, srcRow, colMap, "原価", "cost", "unit-cost"))
            result(14) = ToNum(GetMapped(srcWs, srcRow, colMap, "広告費割当", "ad-spend"))
            result(15) = ToNum(GetMapped(srcWs, srcRow, colMap, "返品数", "returns"))
            result(16) = ToNum(GetMapped(srcWs, srcRow, colMap, "返品額", "return-amount"))

        Case Else
            ReDim result(0)
            result(0) = ""
    End Select

    MapRowData = result
End Function

'------------------------------------------------------------
' 複数の列名候補からセル値を取得する（最初にヒットした列を使用）
'------------------------------------------------------------
Private Function GetMapped(ws As Worksheet, rowNum As Long, _
                           colMap As Object, ParamArray colNames() As Variant) As String
    Dim cn As Variant
    For Each cn In colNames
        If colMap.Exists(CStr(cn)) Then
            GetMapped = Trim(CStr(ws.Cells(rowNum, colMap(CStr(cn))).Value))
            Exit Function
        End If
    Next cn
    GetMapped = ""
End Function

'------------------------------------------------------------
' ColumnMapを構築する（ヘッダー行 → 列番号マップ）
' @param ws        対象ワークシート
' @param reportType レポート種別（将来の拡張用）
'------------------------------------------------------------
Private Function BuildColumnMap(ws As Worksheet, reportType As String) As Object
    BuildColumnMap = GetHeaderMap(ws)
End Function

'------------------------------------------------------------
' データシートに書式を適用する
'------------------------------------------------------------
Private Sub FormatDataSheet(ws As Worksheet, sheetName As String, dataRows As Long)
    If dataRows <= 0 Then Exit Sub

    ' 交互行に背景色
    Dim i As Long
    For i = 2 To dataRows + 1 Step 2
        ws.Range(ws.Cells(i, 1), ws.Cells(i, 17)).Interior.Color = COLOR_ALT_ROW
    Next i

    ' 枠線
    With ws.Range(ws.Cells(1, 1), ws.Cells(dataRows + 1, 17)).Borders
        .LineStyle = xlContinuous
        .Color = RGB(218, 220, 224)
        .Weight = xlThin
    End With
End Sub
