# 用 Excel COM 生成「排序 / 筛选 / 分类汇总 / 条件格式」的真实 xlsx 样本
# 目的：dump 出这些操作在 OOXML 里到底留下什么结构，据此实现 WPS 评分点检查器。
# 产物：backend/scripts/debug/fixtures/feature/*.xlsx
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File <本文件>
#
# ⚠️ Excel 条件格式常量：xlBetween=1 xlNotBetween=2 xlEqual=3 xlNotEqual=4
#    xlGreater=5 xlLess=6 xlGreaterEqual=7 xlLessEqual=8（不是 3=大于！）
# ⚠️ Sort 常量：xlAscending=1 xlDescending=2
# ⚠️ 不要用自定义函数返回 COM 对象（PowerShell 输出污染会让 $ws 变成数组，报 Int32→String 转换错误）

$ErrorActionPreference = 'Continue'
$outDir = 'D:\wza\xgpy-mysql\backend\scripts\debug\fixtures\feature'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$log = New-Object System.Collections.ArrayList
function L($m) { [void]$log.Add([string]$m) }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
L ("excel version = " + $excel.Version)

$rows = 7
$XL_XLSX = 51
$XL_DESC = 2
$XL_SUM = -4157
$XL_CELLVALUE = 1
$XL_GREATER = 5

function Fill-Sheet($ws) {
  $ws.Cells.Item(1,1).Value2 = '地区'; $ws.Cells.Item(1,2).Value2 = '常住人口'
  $ws.Cells.Item(1,3).Value2 = '土地面积'; $ws.Cells.Item(1,4).Value2 = '人口密度'
  $ws.Cells.Item(2,1).Value2 = '城东区'; $ws.Cells.Item(2,2).Value2 = 120000; $ws.Cells.Item(2,3).Value2 = 30
  $ws.Cells.Item(3,1).Value2 = '城东区'; $ws.Cells.Item(3,2).Value2 = 150000; $ws.Cells.Item(3,3).Value2 = 25
  $ws.Cells.Item(4,1).Value2 = '城西区'; $ws.Cells.Item(4,2).Value2 = 90000;  $ws.Cells.Item(4,3).Value2 = 20
  $ws.Cells.Item(5,1).Value2 = '城西区'; $ws.Cells.Item(5,2).Value2 = 110000; $ws.Cells.Item(5,3).Value2 = 22
  $ws.Cells.Item(6,1).Value2 = '城南区'; $ws.Cells.Item(6,2).Value2 = 80000;  $ws.Cells.Item(6,3).Value2 = 18
  $ws.Cells.Item(7,1).Value2 = '城南区'; $ws.Cells.Item(7,2).Value2 = 70000;  $ws.Cells.Item(7,3).Value2 = 15
  for ($r = 2; $r -le $rows; $r++) { $ws.Cells.Item($r,4).Formula = "=ROUND(B$r*10000/C$r,0)" }
}

function Save-Book($wb, $name) {
  $p = "$outDir\$name"
  if (Test-Path $p) { Remove-Item $p -Force }
  $wb.SaveAs($p, $XL_XLSX)
  $wb.Close($false)
  L ($name + ' saved')
}

# ---------- 1. 排序：按 D 列降序 ----------
try {
  $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  Fill-Sheet $ws
  $ws.Range('A2:D7').Sort($ws.Range('D2'), $XL_DESC)
  Save-Book $wb 'feat_sort.xlsx'
} catch { L ('sort FAIL: ' + $_.Exception.Message) }

# ---------- 2. 自动筛选：D 列 > 45000（会隐藏 3 行）----------
try {
  $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  Fill-Sheet $ws
  $ws.Range('A1:D7').AutoFilter(4, '>45000')
  Save-Book $wb 'feat_filter.xlsx'
} catch { L ('filter FAIL: ' + $_.Exception.Message) }

# ---------- 2b. 自动筛选：按文本值筛选（A 列 = 城东区）----------
try {
  $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  Fill-Sheet $ws
  $ws.Range('A1:D7').AutoFilter(1, '城东区')
  Save-Book $wb 'feat_filter_text.xlsx'
} catch { L ('filter_text FAIL: ' + $_.Exception.Message) }

# ---------- 3. 分类汇总：按 A 列分组，对 B、C 求和 ----------
try {
  $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  Fill-Sheet $ws
  $tl = New-Object 'System.Int32[]' 2
  $tl[0] = 2
  $tl[1] = 3
  $ws.Range('A1:D7').Subtotal(1, $XL_SUM, $tl, $true, $false, $true)
  Save-Book $wb 'feat_subtotal.xlsx'
} catch { L ('subtotal FAIL: ' + $_.Exception.Message) }

# ---------- 4. 条件格式：D 列 > 4000 红底（xlGreater=5）----------
try {
  $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  Fill-Sheet $ws
  $fc = $ws.Range('D2:D7').FormatConditions.Add($XL_CELLVALUE, $XL_GREATER, 4000)
  $fc.Interior.Color = 255
  Save-Book $wb 'feat_condformat.xlsx'
} catch { L ('condformat FAIL: ' + $_.Exception.Message) }

# ---------- 5. 组合：排序 + 条件格式 + 筛选 ----------
try {
  $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  Fill-Sheet $ws
  $ws.Range('A2:D7').Sort($ws.Range('B2'), $XL_DESC)
  $fc = $ws.Range('D2:D7').FormatConditions.Add($XL_CELLVALUE, $XL_GREATER, 45000)
  $fc.Interior.Color = 65535
  $ws.Range('A1:D7').AutoFilter(1, '城东区')
  Save-Book $wb 'feat_combo.xlsx'
} catch { L ('combo FAIL: ' + $_.Exception.Message) }

# ---------- 6. 只加自动筛选标志（不筛选任何值）----------
try {
  $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = 'Sheet1'
  Fill-Sheet $ws
  $ws.Range('A1:D7').AutoFilter()
  Save-Book $wb 'feat_filter_all.xlsx'
} catch { L ('filter_all FAIL: ' + $_.Exception.Message) }

$excel.Quit()
L 'done'
$log | Out-File -FilePath "$outDir\_gen_log.txt" -Encoding utf8
