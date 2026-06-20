# Сборка ZIP для загрузки в Chrome Web Store
# Запуск: PowerShell -ExecutionPolicy Bypass -File build.ps1

$src = $PSScriptRoot
$version = (Get-Content "$src\manifest.json" | ConvertFrom-Json).version
$out = "$env:USERPROFILE\Desktop\rezka-subtitle-dictionary-v$version.zip"

Write-Host "Сборка версии $version..."

# Временная папка
$tmp = "$env:TEMP\rsd_build_$version"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
New-Item -ItemType Directory "$tmp\icons" | Out-Null

# Копируем только нужные файлы (без dev-скриптов и .git)
$files = @("manifest.json", "content.js", "background.js", "popup.html", "popup.css", "popup.js")
foreach ($f in $files) {
    Copy-Item "$src\$f" "$tmp\$f"
}
Copy-Item "$src\icons\*" "$tmp\icons\"

# Создаём ZIP
if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path "$tmp\*" -DestinationPath $out -CompressionLevel Optimal

# Чистим временное
Remove-Item $tmp -Recurse -Force

Write-Host ""
Write-Host "ZIP готов: $out"
Write-Host ""
Write-Host "Следующие шаги:"
Write-Host "  1. Открой https://chrome.google.com/webstore/devconsole"
Write-Host "  2. Нажми 'Добавить новый объект' (или 'Изменить пакет' для обновления)"
Write-Host "  3. Загрузи ZIP-файл с рабочего стола"
Write-Host "  4. Заполни описание и скриншоты"
Write-Host "  5. Отправь на проверку"
