# Renders gallery.html with headless Edge, once per listing, into that listing's own folder next to this one: the
# full version into ..\full\, and the demo version (gallery.html?demo) into ..\demo\. Each slide id maps to section
# #s<id>: #thumbnail is the listing card, written as thumbnail.png; #1..#6 are the gallery, written as
# gallery-<id>.png (all 1920x960, Elgato Marketplace thumbnail/gallery size); #icon is the 288x288 Marketplace app
# icon, written as icon.png. #3 and #5 are also written as videos, gallery-<id>.mp4, by animate.ps1. Candidates for
# a new listing card, #thumb-<x>, are written as thumbnail-<x>.png while gallery.html has any, to choose between.
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$html = (Resolve-Path "$PSScriptRoot\gallery.html").Path
$uri = ([System.Uri]$html).AbsoluteUri
# A profile of its own, so headless Edge never hands the job off to an Edge window that's already open.
$profileDir = Join-Path $env:TEMP "audio-switcher-gallery-edge"

function Render($url, $size, $out) {
    & $edge --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files `
        --force-device-scale-factor=1 "--window-size=$size" --virtual-time-budget=3000 `
        "--user-data-dir=$profileDir" "--screenshot=$out" $url | Out-Null
    Write-Output "Wrote $out"
}

# The Sound keys (slide 6) show Windows' own Sound icon, as the plugin does. It's Microsoft's artwork, so this reads
# it from Windows, as the plugin does (sound-windows.ts), rather than keeping a copy: into windows-sound.js beside
# gallery.html (git-ignored), with the Sound Settings key's gear. It's read large, to stay sharp on the slide's keys.
if (-not ("AudioSwitcherPlus.Icons" -as [type])) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -Namespace AudioSwitcherPlus -Name Icons -MemberDefinition '
[DllImport("shell32.dll", CharSet = CharSet.Unicode)]
public static extern int SHDefExtractIconW(string iconFile, int index, uint flags, out IntPtr large, IntPtr small, uint size);
[DllImport("user32.dll")]
public static extern bool DestroyIcon(IntPtr icon);'
}
$soundIcon = [IntPtr]::Zero
$cpl = Join-Path ([Environment]::SystemDirectory) "mmsys.cpl"
if ([AudioSwitcherPlus.Icons]::SHDefExtractIconW($cpl, -100, 0, [ref]$soundIcon, [IntPtr]::Zero, 256) -ne 0) {
    throw "Couldn't read the Sound control panel's icon from $cpl."
}
$png = New-Object System.IO.MemoryStream
[System.Drawing.Icon]::FromHandle($soundIcon).ToBitmap().Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
[AudioSwitcherPlus.Icons]::DestroyIcon($soundIcon) | Out-Null
$gear = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "..\..\shared\SettingsIcons\sound-settings-badge.png"))
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot "windows-sound.js"),
    ('window.WINDOWS_SOUND = {{ icon: "{0}", gear: "{1}" }};' -f [Convert]::ToBase64String($png.ToArray()), [Convert]::ToBase64String($gear)))

# The listing card, and any candidates for a new one: thumbnail -> thumbnail.png, thumb-a -> thumbnail-a.png.
$thumbnails = [regex]::Matches((Get-Content $html -Raw), 'id="s(thumbnail|thumb-\w+)"') | ForEach-Object { $_.Groups[1].Value }
if (-not $thumbnails) { throw "gallery.html has no #thumbnail slide." }

foreach ($edition in @("full", "demo")) {
    $dir = Join-Path (Split-Path $PSScriptRoot -Parent) $edition
    New-Item -ItemType Directory -Force $dir | Out-Null
    $query = if ($edition -eq "demo") { "?demo" } else { "" }

    # Clear out the old gallery first, so a slide that's been dropped or renumbered doesn't leave its image behind.
    Remove-Item (Join-Path $dir "gallery-*.png"), (Join-Path $dir "thumbnail*.png") -ErrorAction SilentlyContinue

    foreach ($id in $thumbnails) {
        Render "$uri$query#$id" "1920,960" (Join-Path $dir (($id -replace '^thumb-', 'thumbnail-') + ".png"))
    }
    foreach ($n in @("1", "2", "3", "4", "5", "6")) {
        Render "$uri$query#$n" "1920,960" (Join-Path $dir ("gallery-{0}.png" -f $n))
    }
    Render "$uri$query#icon" "288,288" (Join-Path $dir "icon.png")
}

# Then the animated slides, as videos (needs ffmpeg - see animate.ps1).
& (Join-Path $PSScriptRoot "animate.ps1")
