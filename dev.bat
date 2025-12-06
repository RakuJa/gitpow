@echo off
echo Building wasm package...
(cd graph-wasm && wasm-pack build --target web)

IF %ERRORLEVEL% NEQ 0 (
    echo wasm-pack build failed.
    pause
    EXIT /B %ERRORLEVEL%
)

echo Copying WASM files to static directory...
if not exist "static\graph-wasm\pkg" mkdir "static\graph-wasm\pkg"
xcopy /Y /I "graph-wasm\pkg\*" "static\graph-wasm\pkg\"

echo Running the Tauri application in DEBUG mode with logging...
echo RUST_LOG=debug is set to show all debug messages
echo.
cd /d "%~dp0"
set RUST_LOG=debug
cargo tauri dev

IF %ERRORLEVEL% NEQ 0 (
    echo Application exited with an error.
    pause
    EXIT /B %ERRORLEVEL%
)

pause

