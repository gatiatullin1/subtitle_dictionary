@echo off
cd /d "%~dp0"
echo Получаю обновления с GitHub...
git pull
echo.
echo Готово! Теперь нажмите "Перезагрузить расширение" в попапе.
pause
