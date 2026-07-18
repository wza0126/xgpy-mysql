# XGPY 前后端服务一键管理脚本
# 用法: dev.bat start|stop|restart|status|logs|open [backend|frontend|all]
param(
    [string]$Action = "start",
    [string]$Target = "all"
)

$ErrorActionPreference = "SilentlyContinue"
$Root         = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir   = Join-Path $Root "backend"
$FrontendDir  = Join-Path $Root "frontend"
$BackendPort  = 3101
$FrontendPort = 3266
$BackendLog   = Join-Path $BackendDir "server.log"
$FrontendLog  = Join-Path $FrontendDir "vite.log"

function Test-PortListening([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSec = 30) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

function Start-Backend {
    if (Test-PortListening $BackendPort) {
        Write-Host "[后端] 已在运行  http://127.0.0.1:$BackendPort" -ForegroundColor Yellow
        return
    }
    Write-Host "[后端] 正在启动..."
    Start-Process -FilePath "cmd.exe" -ArgumentList '/c npm run dev > server.log 2>&1' -WorkingDirectory $BackendDir -WindowStyle Hidden
    if (Wait-HttpOk "http://127.0.0.1:$BackendPort/api/health") {
        Write-Host "[后端] 启动成功  http://127.0.0.1:$BackendPort  (日志: backend\server.log)" -ForegroundColor Green
    } else {
        Write-Host "[后端] 启动超时，请查看 backend\server.log" -ForegroundColor Red
    }
}

function Start-Frontend {
    if (Test-PortListening $FrontendPort) {
        Write-Host "[前端] 已在运行  http://127.0.0.1:$FrontendPort" -ForegroundColor Yellow
        return
    }
    Write-Host "[前端] 正在启动..."
    Start-Process -FilePath "cmd.exe" -ArgumentList '/c npm run dev > vite.log 2>&1' -WorkingDirectory $FrontendDir -WindowStyle Hidden
    if (Wait-HttpOk "http://127.0.0.1:$FrontendPort/") {
        Write-Host "[前端] 启动成功  http://127.0.0.1:$FrontendPort  (日志: frontend\vite.log)" -ForegroundColor Green
    } else {
        Write-Host "[前端] 启动超时，请查看 frontend\vite.log" -ForegroundColor Red
    }
}

function Stop-ByPort([int]$Port, [string]$Name) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) {
        Write-Host "[$Name] 未在运行（端口 $Port 空闲）" -ForegroundColor Yellow
        return
    }
    $procId = $conn.OwningProcess
    # 优先杀父进程树（nodemon/npm），防止 nodemon 自动把子进程重新拉起
    $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").ParentProcessId
    if ($parentId -and (Get-Process -Id $parentId -ErrorAction SilentlyContinue)) {
        taskkill /PID $parentId /T /F | Out-Null
    }
    Start-Sleep -Milliseconds 500
    if (Test-PortListening $Port) {
        taskkill /PID $procId /T /F | Out-Null
        Start-Sleep -Milliseconds 500
    }
    if (Test-PortListening $Port) {
        Write-Host "[$Name] 停止失败，端口 $Port 仍被占用 (PID $procId)" -ForegroundColor Red
    } else {
        Write-Host "[$Name] 已停止" -ForegroundColor Green
    }
}

function Show-Status {
    $b = Test-PortListening $BackendPort
    $f = Test-PortListening $FrontendPort
    Write-Host ""
    if ($b) { Write-Host "  后端   运行中   http://127.0.0.1:$BackendPort/api/health" -ForegroundColor Green }
    else    { Write-Host "  后端   未运行" -ForegroundColor Red }
    if ($f) { Write-Host "  前端   运行中   http://127.0.0.1:$FrontendPort" -ForegroundColor Green }
    else    { Write-Host "  前端   未运行" -ForegroundColor Red }
    Write-Host ""
}

function Show-Logs([string]$Which) {
    switch ($Which.ToLower()) {
        "backend"  { Get-Content $BackendLog -Tail 30 -Wait }
        "frontend" { Get-Content $FrontendLog -Tail 30 -Wait }
        default {
            Write-Host "===== backend\server.log (最后 20 行) =====" -ForegroundColor Cyan
            Get-Content $BackendLog -Tail 20
            Write-Host ""
            Write-Host "===== frontend\vite.log (最后 20 行) =====" -ForegroundColor Cyan
            Get-Content $FrontendLog -Tail 20
            Write-Host ""
            Write-Host "实时跟踪: dev.bat logs backend  或  dev.bat logs frontend (Ctrl+C 退出)"
        }
    }
}

function Show-Help {
    Write-Host ""
    Write-Host "XGPY 服务管理脚本用法:"
    Write-Host "  dev.bat start    [backend|frontend]  启动服务（默认全部）"
    Write-Host "  dev.bat stop     [backend|frontend]  停止服务（默认全部）"
    Write-Host "  dev.bat restart  [backend|frontend]  重启服务（默认全部）"
    Write-Host "  dev.bat status                        查看运行状态"
    Write-Host "  dev.bat logs     [backend|frontend]  查看日志（单独查看时实时跟踪）"
    Write-Host "  dev.bat open                          在浏览器打开前端页面"
    Write-Host ""
}

$doBackend  = ($Target -eq "all" -or $Target -eq "backend")
$doFrontend = ($Target -eq "all" -or $Target -eq "frontend")

switch ($Action.ToLower()) {
    "start"   { if ($doBackend)  { Start-Backend }
                if ($doFrontend) { Start-Frontend }
                Show-Status }
    "stop"    { if ($doFrontend) { Stop-ByPort $FrontendPort "前端" }
                if ($doBackend)  { Stop-ByPort $BackendPort "后端" } }
    "restart" { if ($doFrontend) { Stop-ByPort $FrontendPort "前端" }
                if ($doBackend)  { Stop-ByPort $BackendPort "后端" }
                if ($doBackend)  { Start-Backend }
                if ($doFrontend) { Start-Frontend }
                Show-Status }
    "status"  { Show-Status }
    "logs"    { Show-Logs $Target }
    "open"    { Start-Process "http://127.0.0.1:$FrontendPort/" }
    default   { Show-Help }
}
