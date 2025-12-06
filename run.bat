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

echo Building the project...
cargo build

IF %ERRORLEVEL% NEQ 0 (
    echo Build failed.
    pause
    EXIT /B %ERRORLEVEL%
)

echo Running the application...
echo RUST_LOG=info (use dev.bat for debug mode)
cd /d "%~dp0"
set RUST_LOG=info
target\debug\gitpow-rust.exe

IF %ERRORLEVEL% NEQ 0 (
    echo Application exited with an error.
    pause
    EXIT /B %ERRORLEVEL%
)

pause