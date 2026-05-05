import { exec } from 'child_process';

/**
 * UI Intelligence Layer - Uses Windows UIAutomation to get semantic layout.
 * Fastest and most reliable method to interact with applications.
 */
export default async function getUIElements(args = {}) {
  console.log(`[Tool: getUIElements] Querying UI Automation Tree...`);

  const foregroundOnly = Boolean(args.foregroundOnly);
  const maxElements = Number.isFinite(Number(args.maxElements))
    ? Math.max(1, Math.min(500, Number(args.maxElements)))
    : 200;
  const treeScope = foregroundOnly ? 'Descendants' : 'Children';
  
  // PowerShell script to access the root UI element and find child elements that are buttons, links, etc.
  const psCommand = `powershell -NoProfile -NonInteractive -Command "
Add-Type -AssemblyName UIAutomationClient
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

if (${foregroundOnly ? '$true' : '$false'}) {
    $hwnd = [Win32]::GetForegroundWindow()
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }
} else {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
}

$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true)
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::${treeScope}, $condition)

$results = @()
$count = 0
foreach ($el in $elements) {
    if ($count -ge ${maxElements}) { break }
    if ($el.Current.Name -or $el.Current.AutomationId) {
        $results += [PSCustomObject]@{
            Name = $el.Current.Name
            AutomationId = $el.Current.AutomationId
            ClassName = $el.Current.ClassName
            ControlType = $el.Current.ControlType.ProgrammaticName
            BoundingRectangle = $el.Current.BoundingRectangle.ToString()
        }
        $count += 1
    }
}
$results | ConvertTo-Json -Depth 2
"`;

  return new Promise((resolve) => {
    exec(psCommand, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
      if (error) {
        console.error(`[Tool: getUIElements] Error:`, error);
        return resolve({ success: false, error: "Failed to access UI Tree." });
      }

      try {
        const data = JSON.parse(stdout || "[]");
        resolve({ success: true, elements: Array.isArray(data) ? data : [data] });
      } catch {
        resolve({ success: false, error: "Failed to parse UI Tree." });
      }
    });
  });
}
