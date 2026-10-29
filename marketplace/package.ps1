# Packages the built plugins into this folder's listings as .streamDeckPlugin files: the Node plugin (the one on
# the Marketplace) and the exe into full\, and the Node demo into demo\. It only packs what's already built, so
# build first - see AGENTS.md and each project's README. Uses the Stream Deck CLI from audio-switcher-node's dev
# dependencies (npm install there first). build-all.ps1 at the repo root builds all three and then runs this.
$root = Split-Path $PSScriptRoot -Parent
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $env:PATH = "C:\Program Files\nodejs;" + $env:PATH }

$packages = @(
    @{ Folder = "com.morgan-scruggs.audioswitcherplus-node.sdPlugin"; Listing = "full" },
    @{ Folder = "com.morganscruggs.audioswitcherplus.sdPlugin"; Listing = "full" },
    @{ Folder = "com.morgan-scruggs.audioswitcherplus-node-demo.sdPlugin"; Listing = "demo" }
)

Push-Location (Join-Path $root "audio-switcher-node")
try {
    foreach ($package in $packages) {
        $plugin = Join-Path $root $package.Folder
        if (-not (Test-Path $plugin)) { throw "$($package.Folder) isn't built yet - build it first." }

        # `streamdeck pack` rewrites manifest.json in place (dropping its final newline), and the Node one is
        # hand-edited source, so put every manifest back exactly as it was.
        $manifest = Join-Path $plugin "manifest.json"
        $original = [System.IO.File]::ReadAllBytes($manifest)
        try {
            # npx.cmd rather than plain npx: PowerShell would pick Node's npx.ps1 shim, which garbles arguments
            # containing spaces, such as this repo's path.
            $global:LASTEXITCODE = 0
            & npx.cmd streamdeck pack $plugin --output (Join-Path $PSScriptRoot $package.Listing) --force --no-update-check
            if ($LASTEXITCODE -ne 0) { throw "Packing $($package.Folder) failed." }
        }
        finally {
            [System.IO.File]::WriteAllBytes($manifest, $original)
        }
    }
}
finally {
    Pop-Location
}
