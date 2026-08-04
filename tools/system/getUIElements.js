import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

/**
 * UI Intelligence Layer — Windows UIAutomation element tree query.
 *
 * Fixed: replaced callback-style bare exec() with execWithTimeout (15s deadline).
 * COM/UIAutomation initialization can stall for seconds on some systems;
 * without a timeout the AgentLoop execution thread blocked indefinitely.
 */
export default async function getUIElements(args = {}) {
  console.log(`[Tool: getUIElements] Querying UI Automation Tree...`);

  const foregroundOnly = Boolean(args.foregroundOnly);
  const maxElements    = Number.isFinite(Number(args.maxElements))
    ? Math.max(1, Math.min(500, Number(args.maxElements)))
    : 200;
  const treeScope = foregroundOnly ? 'Descendants' : 'Children';

  const psCommand =
    `powershell -NoProfile -NonInteractive -Command "` +
    `Add-Type -AssemblyName UIAutomationClient; ` +
    `Add-Type @'` +
    `\nusing System;\nusing System.Runtime.InteropServices;\n` +
    `public class Win32 {\n    [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();\n}\n` +
    `'@\n` +
    `if (${foregroundOnly ? '$true' : '$false'}) {\n` +
    `    $hwnd = [Win32]::GetForegroundWindow(); ` +
    `    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd); ` +
    `    if ($null -eq $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }\n` +
    `} else { $root = [System.Windows.Automation.AutomationElement]::RootElement }\n` +
    `$condition = New-Object System.Windows.Automation.PropertyCondition(` +
    `[System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true); ` +
    `$elements = $root.FindAll([System.Windows.Automation.TreeScope]::${treeScope}, $condition); ` +
    `$results = @(); $count = 0; ` +
    `foreach ($el in $elements) { ` +
    `    if ($count -ge ${maxElements}) { break }; ` +
    `    if ($el.Current.Name -or $el.Current.AutomationId) { ` +
    `        $results += [PSCustomObject]@{ ` +
    `            Name = $el.Current.Name; AutomationId = $el.Current.AutomationId; ` +
    `            ClassName = $el.Current.ClassName; ControlType = $el.Current.ControlType.ProgrammaticName; ` +
    `            BoundingRectangle = $el.Current.BoundingRectangle.ToString() }; $count += 1 } }; ` +
    `$results | ConvertTo-Json -Depth 2"`;

  const { stdout, timedOut, error } = await execWithTimeout(
    psCommand,
    { timeoutMs: 15000, encoding: 'utf8' }
  );

  if (timedOut) {
    console.warn('[Tool: getUIElements] UIAutomation query timed out after 15s.');
    return { success: false, error: 'UI Tree query timed out.' };
  }
  if (error) {
    console.error('[Tool: getUIElements] Error:', error);
    return { success: false, error: 'Failed to access UI Tree.' };
  }

  try {
    const data = JSON.parse(stdout || '[]');
    return { success: true, elements: Array.isArray(data) ? data : [data] };
  } catch {
    return { success: false, error: 'Failed to parse UI Tree.' };
  }
}
