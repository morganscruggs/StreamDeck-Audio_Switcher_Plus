<#
.SYNOPSIS
Builds all three plugins - the Node plugin, the Node demo and the exe - packages them into marketplace\, and
installs them into Stream Deck.

.DESCRIPTION
Stream Deck keeps running, and stays usable, while everything builds. It's only closed for the few seconds the
install takes:
  1. Builds the Node plugin and the Node demo (npm run build / npm run build:demo) and the exe plugin (CMake,
     configuring audio-switcher-exe\build the first time) into the repo's own plugin folders - with each build's
     own copy into Stream Deck's Plugins folder turned off (SYNC_TO_STREAMDECK=0), since that fails while Stream
     Deck runs.
  2. Packages all three into marketplace\ (marketplace\package.ps1). Skip with -SkipPackage.
  3. Fully quits Stream Deck - its main process holds files open in its Plugins folder, so they can't be replaced
     while it runs - copies the three built plugins into %APPDATA%\Elgato\StreamDeck\Plugins\, and starts Stream
     Deck again, even if the copy failed.
If a build fails, the script stops before step 3, so Stream Deck is never closed.

Run it from anywhere:
  powershell -ExecutionPolicy Bypass -File build-all.ps1

Needs Node.js (with npm), CMake 3.28+ and Visual Studio 2022 with the "Desktop development with C++"
workload - see each project's README.

.PARAMETER SkipPackage
Build and install only, leaving marketplace\'s .streamDeckPlugin files as they are.
#>
param([switch]$SkipPackage)

$root = $PSScriptRoot
$streamDeckExe = "C:\Program Files\Elgato\StreamDeck\StreamDeck.exe"
$pluginsDir = Join-Path $env:APPDATA "Elgato\StreamDeck\Plugins"
# The built plugin folders at the repo root, each installed under the same name.
$plugins = @(
    "com.morgan-scruggs.audioswitcherplus-node.sdPlugin",
    "com.morgan-scruggs.audioswitcherplus-node-demo.sdPlugin",
    "com.morganscruggs.audioswitcherplus.sdPlugin"
)

function Invoke-Step([string]$Name, [scriptblock]$Command) {
    Write-Host "`n== $Name" -ForegroundColor Cyan
    # Any error in the step (a missing command, say) stops the build, and a stale exit code from an earlier
    # step can't pass for success.
    $ErrorActionPreference = "Stop"
    $global:LASTEXITCODE = 0
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit code $LASTEXITCODE)." }
}

# npm.cmd rather than plain npm: PowerShell would pick Node's npm.ps1 shim, which garbles arguments containing
# spaces. Node.js isn't always on PATH in a new shell after installing it (e.g. with winget).
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { $env:PATH = "C:\Program Files\nodejs;" + $env:PATH }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm not found - install Node.js first." }
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) { $cmake = "C:\Program Files\CMake\bin\cmake.exe" }
if (-not (Test-Path $cmake)) { throw "CMake not found - install it, or add it to PATH." }

# Both builds read this and skip copying themselves into Stream Deck's Plugins folder; step 3 installs instead.
$env:SYNC_TO_STREAMDECK = "0"

Push-Location (Join-Path $root "audio-switcher-node")
try {
    if (-not (Test-Path "node_modules")) { Invoke-Step "Installing Node dependencies" { npm.cmd install } }
    Invoke-Step "Node plugin" { npm.cmd run build }
    Invoke-Step "Node demo" { npm.cmd run build:demo }
}
finally {
    Pop-Location
}

$exeDir = Join-Path $root "audio-switcher-exe"
$buildDir = Join-Path $exeDir "build"
if (-not (Test-Path (Join-Path $buildDir "CMakeCache.txt"))) {
    Invoke-Step "Configuring the exe plugin" { & $cmake -S $exeDir -B $buildDir }
}
Invoke-Step "Exe plugin" { & $cmake --build $buildDir --config RelWithDebInfo --target install --parallel }

if (-not $SkipPackage) {
    Invoke-Step "Packaging into marketplace\" { & (Join-Path $root "marketplace\package.ps1") }
}

if (-not (Test-Path $pluginsDir)) {
    Write-Warning "Stream Deck's Plugins folder isn't at $pluginsDir - built, but not installed."
    return
}

Write-Host "`n== Installing into Stream Deck" -ForegroundColor Cyan
Get-Process StreamDeck, sdaudioswitchplus -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# Wait until it has really exited, since it only lets go of the Plugins folder then.
for ($i = 0; $i -lt 20 -and (Get-Process StreamDeck -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
try {
    foreach ($name in $plugins) {
        $installed = Join-Path $pluginsDir $name
        # A link back to the repo (a development setup) already sees every build.
        if ((Test-Path $installed) -and (Get-Item $installed -Force).LinkType) {
            Write-Host "  $name is a link to the build - nothing to copy"
            continue
        }
        # Files can stay locked for a moment after Stream Deck and its plugins exit, so retry briefly.
        for ($attempt = 1; ; $attempt++) {
            try {
                if (Test-Path $installed) { Remove-Item -LiteralPath $installed -Recurse -Force -ErrorAction Stop }
                Copy-Item -LiteralPath (Join-Path $root $name) -Destination $installed -Recurse -ErrorAction Stop
                # The exe's debug symbols are for debugging locally, not for Stream Deck (the package leaves
                # them out too, via .sdignore).
                Get-ChildItem -LiteralPath $installed -Filter *.pdb -Recurse | Remove-Item -Force
                break
            }
            catch {
                if ($attempt -ge 5) { throw "Couldn't install $name into Stream Deck: $($_.Exception.Message)" }
                Start-Sleep -Seconds 1
            }
        }
        Write-Host "  Installed $name"
    }
    Write-Host "`nAll three plugins built and installed." -ForegroundColor Green
}
finally {
    Write-Host "`n== Starting Stream Deck" -ForegroundColor Cyan
    if (Test-Path $streamDeckExe) { Start-Process $streamDeckExe }
    else { Write-Warning "Stream Deck isn't at $streamDeckExe - start it yourself." }
}
