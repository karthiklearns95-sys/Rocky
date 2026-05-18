using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Text.RegularExpressions;
using System.Diagnostics;
using System.Threading;
using System.Text;

namespace UIADaemon {
    class Program {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
        
        [DllImport("user32.dll")]
        public static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);
        
        [DllImport("user32.dll")]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT {
            public int X;
            public int Y;
        }

        public delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint EVENT_SYSTEM_DIALOGSTART = 0x0010;
        private const uint WINEVENT_OUTOFCONTEXT = 0;

        private const uint MOUSEEVENTF_LEFTDOWN = 0x02;
        private const uint MOUSEEVENTF_LEFTUP = 0x04;

        static volatile bool isExecuting = false;
        static StreamWriter activeWriter = null;
        static POINT lastAutomatedPos;
        static WinEventDelegate hookDelegate;

        static void Main(string[] args) {
            // Setup Background Hooks for Focus Stealing and Popups
            hookDelegate = new WinEventDelegate(WinEventProc);
            SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, hookDelegate, 0, 0, WINEVENT_OUTOFCONTEXT);
            SetWinEventHook(EVENT_SYSTEM_DIALOGSTART, EVENT_SYSTEM_DIALOGSTART, IntPtr.Zero, hookDelegate, 0, 0, WINEVENT_OUTOFCONTEXT);

            // Start Mouse Drift Monitor (Physical Interruption)
            Thread mouseMonitor = new Thread(MouseDriftMonitor);
            mouseMonitor.IsBackground = true;
            mouseMonitor.Start();

            // Needs to pump messages for WinEventHook to fire correctly on this thread
            // But since this is a console app, hooks in another thread might be better or we can just rely on the main loop.
            // Wait, WinEventHook requires a message loop if it's WINEVENT_OUTOFCONTEXT, but we'll try without first, 
            // or we can run the pipe in a background thread and keep a message loop here.
            Thread pipeThread = new Thread(PipeServerLoop);
            pipeThread.IsBackground = false;
            pipeThread.Start();
            
            // Standard message loop for WinEventHook to function properly
            System.Windows.Forms.Application.Run();
        }

        static void PipeServerLoop() {
            string pipeName = "UIA_ROCKY_PIPE";
            Console.WriteLine("[Daemon] Starting UIA Named Pipe server on \\\\.\\pipe\\" + pipeName);

            while (true) {
                using (NamedPipeServerStream pipeServer = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1)) {
                    Console.WriteLine("[Daemon] Waiting for IPC connection...");
                    pipeServer.WaitForConnection();
                    Console.WriteLine("[Daemon] IPC Client connected.");
                    
                    try {
                        using (StreamReader reader = new StreamReader(pipeServer))
                        using (StreamWriter writer = new StreamWriter(pipeServer)) {
                            writer.AutoFlush = true;
                            activeWriter = writer;
                            
                            string line;
                            while ((line = reader.ReadLine()) != null) {
                                isExecuting = true;
                                GetCursorPos(out lastAutomatedPos);
                                
                                string response = ProcessCommand(line);
                                
                                GetCursorPos(out lastAutomatedPos);
                                isExecuting = false;

                                lock (activeWriter) {
                                    writer.WriteLine(response);
                                }
                            }
                        }
                    } catch (Exception ex) {
                        Console.WriteLine("[Daemon] Client disconnected or error: " + ex.Message);
                    } finally {
                        activeWriter = null;
                        isExecuting = false;
                    }
                }
            }
        }

        static void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime) {
            if (!isExecuting || activeWriter == null) return;
            // Only care about window-level events
            if (idObject != 0 /* OBJID_WINDOW */) return;

            string eventName = eventType == EVENT_SYSTEM_FOREGROUND ? "focus_lost" : "modal_popup";
            
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(hwnd, sb, sb.Capacity);
            string windowName = sb.ToString().Replace("\"", "'").Replace("\\", "/");
            
            if (string.IsNullOrEmpty(windowName)) windowName = "Unknown";

            string anomaly = "{\"type\": \"anomaly\", \"event\": \"" + eventName + "\", \"newFocus\": \"" + windowName + "\"}";
            try {
                lock (activeWriter) {
                    activeWriter.WriteLine(anomaly);
                }
            } catch { }
        }

        static void MouseDriftMonitor() {
            while (true) {
                Thread.Sleep(50);
                if (isExecuting && activeWriter != null) {
                    POINT currentPos;
                    if (GetCursorPos(out currentPos)) {
                        int dx = currentPos.X - lastAutomatedPos.X;
                        int dy = currentPos.Y - lastAutomatedPos.Y;
                        double dist = Math.Sqrt(dx*dx + dy*dy);
                        if (dist > 50) {
                            try {
                                lock (activeWriter) {
                                    activeWriter.WriteLine("{\"type\": \"anomaly\", \"event\": \"human_intervention\"}");
                                }
                            } catch { }
                            // Reset so we don't spam the pipe
                            lastAutomatedPos = currentPos;
                        }
                    }
                }
            }
        }

        static IntPtr automatedWindow = IntPtr.Zero;

        static string ProcessCommand(string jsonLine) {
            string action = ExtractJsonValue(jsonLine, "action");
            string query = ExtractJsonValue(jsonLine, "targetName");
            string value = ExtractJsonValue(jsonLine, "value");

            if (string.IsNullOrEmpty(action) || string.IsNullOrEmpty(query)) {
                return "{\"status\": \"error\", \"code\": \"InvalidPayload\"}";
            }

            try {
                if (action == "hard_click") {
                    string sx = ExtractJsonValue(jsonLine, "x");
                    string sy = ExtractJsonValue(jsonLine, "y");
                    int x;
                    int y;
                    if (int.TryParse(sx, out x) && int.TryParse(sy, out y)) {
                        SetCursorPos(x, y);
                        Thread.Sleep(10);
                        mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, x, y, 0, 0);
                        return "{\"status\": \"success\", \"elementState\": \"hard_clicked\", \"latency\": \"10ms\"}";
                    }
                    return "{\"status\": \"error\", \"code\": \"InvalidCoordinates\"}";
                }
                
                if (action == "restore_focus") {
                    if (automatedWindow != IntPtr.Zero) {
                        SetForegroundWindow(automatedWindow);
                        return "{\"status\": \"success\", \"elementState\": \"focus_restored\", \"latency\": \"5ms\"}";
                    }
                    return "{\"status\": \"error\", \"code\": \"NoPreviousTarget\"}";
                }

                AutomationElement root = AutomationElement.FromHandle(GetForegroundWindow());
                if (root == null) root = AutomationElement.RootElement;
                
                // Track the window we are interacting with
                automatedWindow = new IntPtr(root.Current.NativeWindowHandle);

                Condition cond = new PropertyCondition(AutomationElement.IsEnabledProperty, true);
                AutomationElementCollection all = root.FindAll(TreeScope.Descendants, cond);

                AutomationElement target = null;
                foreach (AutomationElement el in all) {
                    if ((el.Current.Name != null && Regex.IsMatch(el.Current.Name, query, RegexOptions.IgnoreCase)) ||
                        (el.Current.AutomationId != null && Regex.IsMatch(el.Current.AutomationId, query, RegexOptions.IgnoreCase))) {
                        target = el;
                        break;
                    }
                }

                if (target == null) {
                    return "{\"status\": \"error\", \"code\": \"ElementNotFound\"}";
                }

                Stopwatch sw = Stopwatch.StartNew();
                string stateReport = "unknown";

                if (action == "click" || action == "invoke") {
                    object patternObj;
                    if (target.TryGetCurrentPattern(InvokePattern.Pattern, out patternObj)) {
                        ((InvokePattern)patternObj).Invoke();
                        stateReport = "invoked";
                    } else if (target.TryGetCurrentPattern(TogglePattern.Pattern, out patternObj)) {
                        ((TogglePattern)patternObj).Toggle();
                        stateReport = "toggled";
                    } else {
                        target.SetFocus();
                        stateReport = "focused_simulated_click";
                    }
                } else if (action == "setValue" || action == "type") {
                    object patternObj;
                    if (target.TryGetCurrentPattern(ValuePattern.Pattern, out patternObj)) {
                        ValuePattern vp = (ValuePattern)patternObj;
                        if (!vp.Current.IsReadOnly) {
                            vp.SetValue(value);
                            stateReport = "value_set";
                        } else {
                            return "{\"status\": \"error\", \"code\": \"ElementReadOnly\"}";
                        }
                    } else {
                        target.SetFocus();
                        stateReport = "focused_for_typing";
                    }
                } else if (action == "focus") {
                    target.SetFocus();
                    Thread.Sleep(20); 
                    bool hasFocus = target.Current.HasKeyboardFocus;
                    stateReport = hasFocus ? "focused" : "focus_requested";
                }

                sw.Stop();
                return "{\"status\": \"success\", \"elementState\": \"" + stateReport + "\", \"latency\": \"" + sw.ElapsedMilliseconds + "ms\"}";
            } catch (Exception ex) {
                string msg = ex.Message.Replace("\"", "'").Replace("\\", "/").Replace("\r", "").Replace("\n", " ");
                return "{\"status\": \"error\", \"code\": \"" + msg + "\"}";
            }
        }

        static string ExtractJsonValue(string json, string key) {
            Match m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"(.*?)\"");
            if (m.Success) return m.Groups[1].Value;
            
            m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*(\\d+)");
            if (m.Success) return m.Groups[1].Value;
            
            return "";
        }
    }
}
