import { exec } from 'child_process';

/**
 * UI Intelligence Layer - Uses Windows UIAutomation to get semantic layout.
 * Fastest and most reliable method to interact with applications.
 */
export default async function getUIElements(args = {}) {
  console.log(`[Tool: getUIElements] Querying UI Automation Tree...`);
  
  // PowerShell script to access the root UI element and find child elements that are buttons, links, etc.
  const psCommand = `powershell -Command "
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true)
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)

$results = @()
foreach ($el in $elements) {
    if ($el.Current.Name) {
        $results += [PSCustomObject]@{
            Name = $el.Current.Name
            ControlType = $el.Current.ControlType.ProgrammaticName
            BoundingRectangle = $el.Current.BoundingRectangle.ToString()
        }
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
      } catch (e) {
        resolve({ success: false, error: "Failed to parse UI Tree." });
      }
    });
  });
}
