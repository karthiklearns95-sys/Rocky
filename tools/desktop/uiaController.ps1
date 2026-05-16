
param($Action, $Query, $RoleHint, $Value)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-ForegroundRoot {
    $code = @'
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    }
'@
    if (-not ("Win32" -as [type])) { Add-Type -TypeDefinition $code }
    $hwnd = [Win32]::GetForegroundWindow()
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $root) { return [System.Windows.Automation.AutomationElement]::RootElement }
    return $root
}

function Find-Element($root, $q, $role) {
    $conds = New-Object System.Collections.ArrayList
    $conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true)))
    
    if ($role) {
        # E.g. "Button", "Edit", "Document"
        # Since ControlType fields are static readonly, we get it via reflection or switch
        # For simplicity, we just fetch all and filter by ProgrammaticName if role is provided
    }

    # Fetch descendants
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $conds[0])
    
    foreach ($el in $all) {
        $name = $el.Current.Name
        $id = $el.Current.AutomationId
        $type = $el.Current.ControlType.ProgrammaticName
        
        if ($role -and ($type -notmatch $role)) { continue }
        
        if (($name -match $q) -or ($id -match $q)) {
            return $el
        }
    }
    return $null
}

try {
    $root = Get-ForegroundRoot
    if ($Action -eq "inspect") {
        $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true)))
        $res = @()
        foreach ($el in $all) {
            if ($el.Current.Name -or $el.Current.AutomationId) {
                $res += @{
                    Name = $el.Current.Name
                    AutomationId = $el.Current.AutomationId
                    ControlType = $el.Current.ControlType.ProgrammaticName
                }
            }
        }
        $res | ConvertTo-Json -Depth 2 -Compress
        exit 0
    }

    $target = Find-Element $root $Query $RoleHint
    if (-not $target) {
        Write-Output '{"error": "Element not found"}'
        exit 1
    }

    if ($Action -eq "invoke") {
        $invokePattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
        if ($invokePattern) {
            $invokePattern.Invoke()
            Write-Output '{"success": true, "method": "invoke"}'
        } else {
            $target.SetFocus()
            # Fallback for buttons without InvokePattern (like SelectionItemPattern)
            Write-Output '{"success": true, "method": "focus"}'
        }
    }
    elseif ($Action -eq "setValue") {
        $valuePattern = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) -as [System.Windows.Automation.ValuePattern]
        if ($valuePattern -and (-not $valuePattern.Current.IsReadOnly)) {
            $valuePattern.SetValue($Value)
            Write-Output '{"success": true, "method": "setValue"}'
        } else {
            $target.SetFocus()
            Write-Output '{"success": true, "method": "focus_for_typing"}'
        }
    }
    elseif ($Action -eq "focus") {
        $target.SetFocus()
        Write-Output '{"success": true, "method": "focus"}'
    }
    else {
        Write-Output '{"error": "Unknown action"}'
    }
} catch {
    Write-Output "{\"error\": \"$($_.Exception.Message.Replace('"', '\"'))\"}"
}
