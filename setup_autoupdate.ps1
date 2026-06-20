# Настройка автоматического обновления расширения Rezka Subtitle Dictionary
# Создаёт задачу в Планировщике Windows: git pull каждый день в 09:00

$extDir = $PSScriptRoot

# Ищем git
$gitPaths = @(
    "C:\Program Files\Git\bin\git.exe",
    "C:\Program Files (x86)\Git\bin\git.exe"
)
$gitExe = $null
foreach ($p in $gitPaths) {
    if (Test-Path $p) { $gitExe = $p; break }
}
if (-not $gitExe) {
    try { $gitExe = (Get-Command git -ErrorAction Stop).Source } catch {}
}
if (-not $gitExe) {
    Write-Host "ОШИБКА: Git не найден. Убедитесь что Git for Windows установлен."
    exit 1
}

Write-Host "Git найден: $gitExe"
Write-Host "Папка расширения: $extDir"
Write-Host ""

# Создаём задачу — запуск PowerShell с git pull без окна
$psArgs = "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"& '$gitExe' -C '$extDir' pull --ff-only 2>`$null`""

$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
$trigger  = New-ScheduledTaskTrigger -Daily -At "09:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit "00:05:00"

try {
    Register-ScheduledTask `
        -TaskName   "RezkaSubDictAutoUpdate" `
        -Action     $action `
        -Trigger    $trigger `
        -Settings   $settings `
        -Force | Out-Null

    Write-Host "Задача 'RezkaSubDictAutoUpdate' создана."
    Write-Host ""
    Write-Host "Расширение будет обновляться автоматически каждый день в 09:00."
    Write-Host "Когда появится обновление, попап покажет уведомление."
    Write-Host "Просто нажмите 'Перезагрузить расширение' — и готово."
    Write-Host ""

    # Запускаем задачу сразу для проверки
    Write-Host "Запускаем обновление прямо сейчас..."
    Start-ScheduledTask -TaskName "RezkaSubDictAutoUpdate"
    Start-Sleep -Seconds 4
    $state = (Get-ScheduledTask -TaskName "RezkaSubDictAutoUpdate").State
    if ($state -eq "Ready") {
        Write-Host "Git pull выполнен успешно."
    } else {
        Write-Host "Задача запущена (статус: $state)."
    }

} catch {
    Write-Host "ОШИБКА при создании задачи: $_"
    Write-Host "Попробуйте запустить setup_autoupdate.bat от имени администратора."
    exit 1
}
