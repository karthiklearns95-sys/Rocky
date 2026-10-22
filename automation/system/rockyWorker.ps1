# Rocky persistent PowerShell worker.
#
# Starting powershell.exe, loading UI Automation and compiling C# helpers costs
# seconds, and Rocky used to pay that on every lookup. This script is started
# ONCE; Rocky then sends one JSON request per line on stdin and reads one reply
# line per request from stdout:
#
#   request : {"id": 7, "cmd": "uia", "args": {...}}
#   reply   : @@ROCKY@@{"id": 7, "ok": true, "result": ...}
#             @@ROCKY@@{"id": 7, "ok": false, "error": "message"}
#
# Requests are data only: nothing from them is ever evaluated as script, so
# text coming from the LLM or the user cannot inject commands.
# The first line the worker writes is @@ROCKY@@{"ready":true,...}.
#
# Written for Windows PowerShell 5.1 (the powershell.exe that ships with Windows).
# Remember: any un-captured expression output becomes part of a function's
# return value, so every call that returns something we do not need is [void]'d.

$ErrorActionPreference = 'Stop'
$PREFIX = '@@ROCKY@@'

# Talk to the raw standard streams. [Console]::InputEncoding/OutputEncoding
# throw when no console is attached, and raw streams avoid code-page surprises.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdin  = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
$stdout.NewLine = "`n"

function Send-Json($obj) {
    $json = ConvertTo-Json -InputObject $obj -Compress -Depth 10
    $stdout.WriteLine($PREFIX + $json)
}

# -- DPI awareness --------------------------------------------------------------
# Without this Windows hands an unaware process SCALED coordinates on a 125-150 % display, so
# UI Automation rectangles, screen capture and OCR disagree with where Rocky actually clicks.
# Per-monitor-v2 makes every one of them speak physical pixels of the virtual desktop.
$script:dpiMode = 'none'
function Initialize-DpiAwareness {
    try {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RockyDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
        $mode = 'none'
        try { if ([RockyDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))) { $mode = 'per-monitor-v2' } } catch { }
        if ($mode -eq 'none') {
            try { if ([RockyDpi]::SetProcessDPIAware()) { $mode = 'system' } } catch { }
        }
        $script:dpiMode = $mode
    } catch { $script:dpiMode = 'none' }
}
Initialize-DpiAwareness

# -- Win32 helpers (compiled once) --------------------------------------------

$script:win32Ready = $false
function Initialize-Win32 {
    if ($script:win32Ready) { return }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RockyWin32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
}
"@
    $script:win32Ready = $true
}

# Foreground window: same shape the old one-shot script produced.
function Get-WindowInfo {
    Initialize-Win32
    $hwnd = [RockyWin32]::GetForegroundWindow()
    $rect = New-Object RockyWin32+RECT
    [void][RockyWin32]::GetWindowRect($hwnd, [ref]$rect)
    $bounds = @{
        x      = $rect.Left
        y      = $rect.Top
        width  = [Math]::Max(0, $rect.Right - $rect.Left)
        height = [Math]::Max(0, $rect.Bottom - $rect.Top)
    }

    $sb = New-Object System.Text.StringBuilder 512
    [void][RockyWin32]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $title = $sb.ToString()

    # Prefer the process that owns this window's main handle (what the old script returned);
    # otherwise fall back to the process that owns the window (e.g. UWP frame hosts).
    $appName = 'unknown'
    $procId = [uint32]0
    [void][RockyWin32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -gt 0) {
        try { $appName = [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName } catch { }
    }
    if ([string]::IsNullOrEmpty($title)) { $title = 'unknown' }

    return @{
        appName     = $appName
        windowTitle = $title
        bounds      = $bounds
        isMinimized = [bool][RockyWin32]::IsIconic($hwnd)
        success     = $true
    }
}

function Get-ScreenSize {
    Add-Type -AssemblyName System.Windows.Forms
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    return @{ width = $b.Width; height = $b.Height }
}

# -- Displays, cursor and screen capture (physical pixels of the virtual desktop) --

function Get-Displays {
    Add-Type -AssemblyName System.Windows.Forms
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
        $b = $s.Bounds
        $w = $s.WorkingArea
        [void]$list.Add(@{
            name = $s.DeviceName; primary = [bool]$s.Primary
            x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height
            workX = $w.X; workY = $w.Y; workWidth = $w.Width; workHeight = $w.Height
        })
    }
    return ,$list.ToArray()
}

# Put the pointer on a point of the virtual desktop, in PHYSICAL pixels (this process is DPI aware,
# Node is not: on a 125 % display nut.js positions came out 1.25x too far). Returns where it ended up.
function Invoke-MovePointer($a) {
    Initialize-Win32
    if ($null -eq $a -or $null -eq $a.x -or $null -eq $a.y) { throw 'move needs x and y' }
    if (-not [RockyWin32]::SetCursorPos([int]$a.x, [int]$a.y)) { throw 'Windows refused to move the pointer' }
    $p = New-Object RockyWin32+POINT
    [void][RockyWin32]::GetCursorPos([ref]$p)
    return @{ x = $p.X; y = $p.Y }
}

function Get-CursorPosition {
    Add-Type -AssemblyName System.Windows.Forms
    $p = [System.Windows.Forms.Cursor]::Position
    return @{ x = $p.X; y = $p.Y }
}

# Copy a rectangle of the virtual desktop into a bitmap. Caller disposes it.
function Copy-ScreenRect($x, $y, $width, $height) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    if ($width -lt 1 -or $height -lt 1) { throw 'capture rectangle is empty' }
    $bmp = New-Object System.Drawing.Bitmap([int]$width, [int]$height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.CopyFromScreen([int]$x, [int]$y, 0, 0, (New-Object System.Drawing.Size([int]$width, [int]$height)))
    } finally {
        $g.Dispose()
    }
    return $bmp
}

# A rectangle from request args, or the primary display when none was given.
function Resolve-CaptureRect($a) {
    if ($null -ne $a -and $null -ne $a.width -and $null -ne $a.height) {
        $x = 0; $y = 0
        if ($null -ne $a.x) { $x = [int]$a.x }
        if ($null -ne $a.y) { $y = [int]$a.y }
        return @{ x = $x; y = $y; width = [int]$a.width; height = [int]$a.height }
    }
    Add-Type -AssemblyName System.Windows.Forms
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    return @{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height }
}

function Get-ScreenPng($a) {
    $r = Resolve-CaptureRect $a
    $bmp = Copy-ScreenRect $r.x $r.y $r.width $r.height
    $ms = New-Object System.IO.MemoryStream
    try {
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        return @{ x = $r.x; y = $r.y; width = $r.width; height = $r.height; png = [Convert]::ToBase64String($ms.ToArray()) }
    } finally {
        $ms.Dispose()
        $bmp.Dispose()
    }
}

# -- UI Automation tree (one batched call using a CacheRequest) ---------------

$script:uiaReady = $false
function Initialize-Uia {
    if ($script:uiaReady) { return }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $script:uiaReady = $true
}

function Format-Rect($r) {
    if ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y) -or [double]::IsInfinity($r.Width) -or [double]::IsInfinity($r.Height)) {
        return '0,0,0,0'
    }
    return ('{0},{1},{2},{3}' -f [int][Math]::Round($r.X), [int][Math]::Round($r.Y), [int][Math]::Round($r.Width), [int][Math]::Round($r.Height))
}

function Get-UiElements($foregroundOnly, $maxElements) {
    Initialize-Uia
    Initialize-Win32
    $AE = [System.Windows.Automation.AutomationElement]
    if ($foregroundOnly) {
        $root = $AE::FromHandle([RockyWin32]::GetForegroundWindow())
        if ($null -eq $root) { $root = $AE::RootElement }
        $scope = [System.Windows.Automation.TreeScope]::Descendants
    } else {
        $root = $AE::RootElement
        $scope = [System.Windows.Automation.TreeScope]::Children
    }

    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::IsEnabledProperty, $true)

    # Fetch every property we need for every element in ONE cross-process round
    # trip, instead of one COM call per property per element.
    $cache = New-Object System.Windows.Automation.CacheRequest
    foreach ($p in @($AE::NameProperty, $AE::AutomationIdProperty, $AE::ClassNameProperty,
                     $AE::ControlTypeProperty, $AE::BoundingRectangleProperty, $AE::IsOffscreenProperty)) {
        $cache.Add($p)
    }
    $cache.TreeScope = [System.Windows.Automation.TreeScope]::Element
    $guard = $cache.Activate()
    try {
        $found = $root.FindAll($scope, $cond)
    } finally {
        $guard.Dispose()
    }

    $list = New-Object System.Collections.Generic.List[object]
    foreach ($el in $found) {
        if ($list.Count -ge $maxElements) { break }
        $c = $el.Cached
        if ([string]::IsNullOrEmpty($c.Name) -and [string]::IsNullOrEmpty($c.AutomationId)) { continue }
        [void]$list.Add(@{
            Name              = $c.Name
            AutomationId      = $c.AutomationId
            ClassName         = $c.ClassName
            ControlType       = $c.ControlType.ProgrammaticName
            BoundingRectangle = (Format-Rect $c.BoundingRectangle)
            IsOffscreen       = [bool]$c.IsOffscreen
        })
    }
    return ,$list.ToArray()
}

# -- Screen capture and OCR (engine created once, no temp files) --------------

$script:ocrReady = $false
$script:asTask = $null
$script:ocrEngine = $null
function Initialize-Ocr {
    if ($script:ocrReady) { return }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]

    # AsTask<T>(IAsyncOperation<T>) is generic, so PowerShell cannot pick it by
    # overload resolution; select it by reflection and close it over the result type.
    $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
    })[0]

    $script:ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $script:ocrEngine) { throw 'No Windows OCR engine available (install an OCR language pack).' }
    $script:ocrReady = $true
}

function Wait-WinRt($winRtTask, $resultType) {
    $netTask = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($winRtTask))
    [void]$netTask.Wait(-1)
    return $netTask.Result
}

# Every recognised line with the position of each word, in screen pixels of the virtual desktop.
# `$a` may carry a rectangle (x, y, width, height); without one the primary display is read.
function Get-OcrLines($a) {
    Initialize-Ocr
    $rect = Resolve-CaptureRect $a
    $bmp = Copy-ScreenRect $rect.x $rect.y $rect.width $rect.height

    $ms = New-Object System.IO.MemoryStream
    try {
        # BMP is uncompressed: much cheaper to write than PNG, and OCR does not care.
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
        [void]$ms.Seek(0, [System.IO.SeekOrigin]::Begin)
        $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
        $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $soft = Wait-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Wait-WinRt ($script:ocrEngine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
    } finally {
        $ms.Dispose()
        $bmp.Dispose()
    }

    $lines = New-Object System.Collections.Generic.List[object]
    foreach ($line in $result.Lines) {
        $words = New-Object System.Collections.Generic.List[object]
        foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            [void]$words.Add(@{ t = $w.Text; x = [int]$r.X + $rect.x; y = [int]$r.Y + $rect.y; w = [int]$r.Width; h = [int]$r.Height })
        }
        [void]$lines.Add(@{ text = $line.Text; words = $words.ToArray() })
    }
    return ,$lines.ToArray()
}

# -- Visual signature: pixel colours at element positions ---------------------

function Get-VisualSignature($elements) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $out = New-Object System.Collections.Generic.List[object]
    try {
        $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
        foreach ($el in $elements) {
            $halfW = [Math]::Max(1, [double]$el.width / 4)
            $halfH = [Math]::Max(1, [double]$el.height / 4)
            $points = @(
                @{ x = [double]$el.x;           y = [double]$el.y },
                @{ x = [double]$el.x - $halfW;  y = [double]$el.y },
                @{ x = [double]$el.x + $halfW;  y = [double]$el.y },
                @{ x = [double]$el.x;           y = [double]$el.y - $halfH },
                @{ x = [double]$el.x;           y = [double]$el.y + $halfH }
            )
            $samples = New-Object System.Collections.Generic.List[object]
            foreach ($pt in $points) {
                $sx = [Math]::Min([Math]::Max([int][Math]::Round($pt.x), $bounds.Left), $bounds.Right - 1)
                $sy = [Math]::Min([Math]::Max([int][Math]::Round($pt.y), $bounds.Top), $bounds.Bottom - 1)
                $color = $bitmap.GetPixel($sx - $bounds.X, $sy - $bounds.Y)
                [void]$samples.Add(@{ r = [int]$color.R; g = [int]$color.G; b = [int]$color.B })
            }
            [void]$out.Add(@{ label = $el.label; samples = $samples.ToArray() })
        }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    return ,$out.ToArray()
}

# -- Request dispatch ---------------------------------------------------------

# -- Installed apps and running windows ---------------------------------------

# Everything in the Start menu: desktop programs and Store apps. AppID can be launched
# with  shell:AppsFolder\<AppID>  whatever kind of app it is.
function Get-InstalledApps {
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($a in (Get-StartApps)) {
        if ($a.Name -and $a.AppID) {
            [void]$out.Add(@{ name = [string]$a.Name; appId = [string]$a.AppID })
        }
    }
    return ,$out.ToArray()
}

# Processes that currently own a titled window (for "is the app up yet?").
function Get-WindowedProcesses {
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {
        try {
            $t = $p.MainWindowTitle
            if ($t) { [void]$out.Add(@{ name = $p.ProcessName; title = $t; id = $p.Id }) }
        } catch { }
    }
    return ,$out.ToArray()
}

# Bring a process's main window to the front (restoring it first if minimised).
# The argument is a numeric process id: nothing user-written is ever put into script text.
function Invoke-FocusWindow($procId) {
    Initialize-Win32
    Add-Type -AssemblyName Microsoft.VisualBasic
    $p = [System.Diagnostics.Process]::GetProcessById([int]$procId)
    $hwnd = $p.MainWindowHandle
    if ($hwnd -eq [IntPtr]::Zero) { throw 'that process has no main window' }
    if ([RockyWin32]::IsIconic($hwnd)) { [void][RockyWin32]::ShowWindow($hwnd, 9) }
    try {
        [Microsoft.VisualBasic.Interaction]::AppActivate([int]$procId)
    } catch {
        [void][RockyWin32]::SetForegroundWindow($hwnd)
    }
    return @{ success = $true; hwnd = [string]$hwnd }
}

function Invoke-Request($req) {
    $a = $req.args
    switch ($req.cmd) {
        'ping' { return @{ pong = $true; ps = $PSVersionTable.PSVersion.ToString(); dpi = $script:dpiMode } }
        'window' { return Get-WindowInfo }
        'screen' { return Get-ScreenSize }
        'uia' {
            $max = 200
            if ($null -ne $a -and $null -ne $a.maxElements) { $max = [int]$a.maxElements }
            $fg = $false
            if ($null -ne $a -and $null -ne $a.foregroundOnly) { $fg = [bool]$a.foregroundOnly }
            return Get-UiElements $fg $max
        }
        'ocr' { return Get-OcrLines $a }
        'displays' { return Get-Displays }
        'cursor' { return Get-CursorPosition }
        'move' { return Invoke-MovePointer $a }
        'capture' { return Get-ScreenPng $a }
        'signature' { return Get-VisualSignature @($a.elements) }
        'apps' { return Get-InstalledApps }
        'processes' { return Get-WindowedProcesses }
        'focus' { return Invoke-FocusWindow $a.id }
        default { throw "unknown command: $($req.cmd)" }
    }
}

Send-Json @{ ready = $true; ps = $PSVersionTable.PSVersion.ToString() }

while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }          # Rocky closed our stdin: exit quietly
    if ($line.Trim().Length -eq 0) { continue }
    $id = $null
    try {
        $req = ConvertFrom-Json -InputObject $line
        $id = $req.id
        $result = Invoke-Request $req
        Send-Json @{ id = $id; ok = $true; result = $result }
    } catch {
        Send-Json @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
}
