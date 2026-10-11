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
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
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

# Every recognised line with the position of each word, in screen pixels.
function Get-OcrLines {
    Initialize-Ocr
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $screen.Bounds.Size)
    } finally {
        $g.Dispose()
    }

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
            [void]$words.Add(@{ t = $w.Text; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height })
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

function Invoke-Request($req) {
    $a = $req.args
    switch ($req.cmd) {
        'ping' { return @{ pong = $true; ps = $PSVersionTable.PSVersion.ToString() } }
        'window' { return Get-WindowInfo }
        'screen' { return Get-ScreenSize }
        'uia' {
            $max = 200
            if ($null -ne $a -and $null -ne $a.maxElements) { $max = [int]$a.maxElements }
            $fg = $false
            if ($null -ne $a -and $null -ne $a.foregroundOnly) { $fg = [bool]$a.foregroundOnly }
            return Get-UiElements $fg $max
        }
        'ocr' { return Get-OcrLines }
        'signature' { return Get-VisualSignature @($a.elements) }
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
