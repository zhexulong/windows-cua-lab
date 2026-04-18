using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Text;
using System.Text.Json;
using DesktopBroker.Models;

namespace DesktopBroker.Win32;

public sealed class KeyboardInjectionService
{
    private readonly ILogger<KeyboardInjectionService> _logger;

    public KeyboardInjectionService(ILogger<KeyboardInjectionService> logger)
    {
        _logger = logger;
    }

    internal async Task<string> FocusAsync(string targetApp, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var foregroundBefore = CaptureForegroundWindowSnapshot();
        var activation = ActivateAndValidateTargetApp(targetApp);
        var foregroundAfter = CaptureForegroundWindowSnapshot();
        await Task.Yield();
        return JsonSerializer.Serialize(CreateActivationPayload("focused", "SetForegroundWindow", activation, foregroundBefore, foregroundAfter));
    }

    internal async Task<string> ExecuteAsync(KeyboardInjectionRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var foregroundBefore = CaptureForegroundWindowSnapshot();
        var activation = ActivateAndValidateTargetApp(request.TargetApp);

        switch (request.Kind)
        {
            case KeyboardInputKind.TypeText:
                TypeText(request.Text ?? string.Empty);
                break;
            case KeyboardInputKind.Keypress:
                SendKeys(request.Keys ?? []);
                break;
            default:
                throw new InvalidOperationException($"Unsupported keyboard input kind: {request.Kind}");
        }

        await Task.Yield();

        var foregroundAfter = CaptureForegroundWindowSnapshot();
        var payload = CreateActivationPayload("executed", "SendInput", activation, foregroundBefore, foregroundAfter);

        switch (request.Kind)
        {
            case KeyboardInputKind.TypeText:
                payload["textLength"] = (request.Text ?? string.Empty).Length;
                break;
            case KeyboardInputKind.Keypress:
                payload["keys"] = request.Keys ?? [];
                break;
            default:
                throw new InvalidOperationException("Unsupported keyboard input kind.");
        }

        return JsonSerializer.Serialize(payload);
    }

    private ActivationResult ActivateAndValidateTargetApp(string targetApp)
    {
        var activation = ActivateTargetApp(targetApp);
        if (!string.IsNullOrWhiteSpace(targetApp))
        {
            if (activation.TargetResolved != true)
            {
                throw new InvalidOperationException($"TARGET_APP_NOT_FOUND: requested target app '{targetApp}' was not found.");
            }

            if (activation.TargetActivated != true)
            {
                throw new InvalidOperationException(
                    $"TARGET_APP_NOT_FOREGROUND: requested target app '{targetApp}' was not foregrounded. actual_process={activation.ActualProcessName}; actual_window_title={activation.ActualWindowTitle}");
            }
        }

        return activation;
    }

    private static Dictionary<string, object?> CreateActivationPayload(
        string status,
        string backend,
        ActivationResult activation,
        BrokerForegroundWindowSnapshot foregroundBefore,
        BrokerForegroundWindowSnapshot foregroundAfter)
        => new()
        {
            ["status"] = status,
            ["backend"] = backend,
            ["targetResolved"] = activation.TargetResolved,
            ["targetActivated"] = activation.TargetActivated,
            ["actualProcessName"] = foregroundAfter.ProcessName ?? activation.ActualProcessName,
            ["actualWindowTitle"] = foregroundAfter.WindowTitle ?? activation.ActualWindowTitle,
            ["foregroundBefore"] = ToBrokerForegroundWindowSnapshot(foregroundBefore),
            ["foregroundAfter"] = ToBrokerForegroundWindowSnapshot(foregroundAfter)
        };

    private static BrokerForegroundWindowSnapshot ToBrokerForegroundWindowSnapshot(BrokerForegroundWindowSnapshot snapshot)
        => new()
        {
            Hwnd = snapshot.Hwnd,
            Pid = snapshot.Pid,
            ProcessName = snapshot.ProcessName,
            WindowTitle = snapshot.WindowTitle
        };

    private static BrokerForegroundWindowSnapshot CaptureForegroundWindowSnapshot()
        => ForegroundWindowSnapshotCapture.Capture().Snapshot;

    private ActivationResult ActivateTargetApp(string targetApp)
    {
        var lookupName = GetProcessLookupName(targetApp);
        if (string.IsNullOrWhiteSpace(lookupName))
        {
            return GetForegroundWindowInfo(targetResolved: null, targetActivated: null);
        }

        var process = Process.GetProcessesByName(lookupName)
            .FirstOrDefault(candidate => candidate.MainWindowHandle != nint.Zero);

        if (process is null)
        {
            _logger.LogDebug("No main-window process found for target app {TargetApp}", targetApp);
            return GetForegroundWindowInfo(targetResolved: false, targetActivated: false);
        }

        var windowHandle = process.MainWindowHandle;
        _ = ShowWindow(windowHandle, WindowShowStyle.Restore);
        _ = TryAppActivate(process.Id);
        TryForceForeground(windowHandle, process.Id);

        for (var attempt = 0; attempt < 5; attempt += 1)
        {
            Thread.Sleep(100);
            var foreground = GetForegroundWindowInfo(targetResolved: true, targetActivated: null);
            foreground.TargetActivated =
                foreground.ActualWindowHandle == windowHandle
                || string.Equals(foreground.ActualProcessName, lookupName, StringComparison.OrdinalIgnoreCase);
            if (foreground.TargetActivated == true)
            {
                return foreground;
            }
        }

        var failedForeground = GetForegroundWindowInfo(targetResolved: true, targetActivated: false);
        _logger.LogWarning(
            "Failed to foreground target app {TargetApp}. ActualProcess={ActualProcess}; ActualTitle={ActualTitle}",
            targetApp,
            failedForeground.ActualProcessName,
            failedForeground.ActualWindowTitle);
        return failedForeground;
    }

    private void TryForceForeground(nint windowHandle, int processId)
    {
        var currentThreadId = GetCurrentThreadId();
        var foregroundHandle = GetForegroundWindow();
        var foregroundThreadId = foregroundHandle != nint.Zero ? GetWindowThreadProcessId(foregroundHandle, out _) : 0u;
        var targetThreadId = GetWindowThreadProcessId(windowHandle, out _);
        var attachedForeground = false;
        var attachedTarget = false;

        try
        {
            if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId)
            {
                attachedForeground = AttachThreadInput(currentThreadId, foregroundThreadId, true);
            }

            if (targetThreadId != 0 && targetThreadId != currentThreadId)
            {
                attachedTarget = AttachThreadInput(currentThreadId, targetThreadId, true);
            }

            _ = ShowWindow(windowHandle, WindowShowStyle.Restore);
            _ = SetForegroundWindow(windowHandle);
            _ = SetActiveWindow(windowHandle);
            _ = BringWindowToTop(windowHandle);
            _ = TryAppActivate(processId);
        }
        finally
        {
            if (attachedTarget)
            {
                _ = AttachThreadInput(currentThreadId, targetThreadId, false);
            }

            if (attachedForeground)
            {
                _ = AttachThreadInput(currentThreadId, foregroundThreadId, false);
            }
        }
    }

    private bool TryAppActivate(int processId)
    {
        object? shell = null;
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null)
            {
                return false;
            }

            shell = Activator.CreateInstance(shellType);
            var result = shellType.InvokeMember("AppActivate", BindingFlags.InvokeMethod, null, shell, [processId]);
            return result is bool activated && activated;
        }
        catch (Exception exception)
        {
            _logger.LogDebug(exception, "WScript.Shell AppActivate failed for process {ProcessId}", processId);
            return false;
        }
        finally
        {
            if (shell is not null && Marshal.IsComObject(shell))
            {
                Marshal.ReleaseComObject(shell);
            }
        }
    }

    internal static string GetProcessLookupName(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        return Path.GetFileNameWithoutExtension(value);
    }

    private void TypeText(string text)
    {
        foreach (var character in text)
        {
            SendUnicodeCharacter(character);
        }
    }

    private void SendKeys(IReadOnlyList<string> keys)
    {
        if (keys.Count == 0)
        {
            throw new InvalidOperationException("No keys supplied.");
        }

        var normalizedKeys = keys.Select(key => key.Trim()).Where(key => key.Length > 0).ToArray();
        if (normalizedKeys.Length == 0)
        {
            throw new InvalidOperationException("No keys supplied.");
        }

        var modifiers = normalizedKeys.Where(IsModifierKey).ToArray();
        var mainKeys = normalizedKeys.Where(key => !IsModifierKey(key)).ToArray();
        if (mainKeys.Length == 0)
        {
            throw new InvalidOperationException("At least one non-modifier key is required.");
        }

        foreach (var modifier in modifiers)
        {
            SendVirtualKey(MapVirtualKeyCode(modifier), keyUp: false);
        }

        foreach (var key in mainKeys)
        {
            var vk = MapVirtualKeyCode(key);
            SendVirtualKey(vk, keyUp: false);
            SendVirtualKey(vk, keyUp: true);
        }

        foreach (var modifier in modifiers.Reverse())
        {
            SendVirtualKey(MapVirtualKeyCode(modifier), keyUp: true);
        }
    }

    private static bool IsModifierKey(string key)
        => key.Equals("CTRL", StringComparison.OrdinalIgnoreCase)
            || key.Equals("SHIFT", StringComparison.OrdinalIgnoreCase)
            || key.Equals("ALT", StringComparison.OrdinalIgnoreCase);

    private static ushort MapVirtualKeyCode(string key)
        => key.ToUpperInvariant() switch
        {
            "CTRL" => 0x11,
            "SHIFT" => 0x10,
            "ALT" => 0x12,
            "ENTER" => 0x0D,
            "SPACE" => 0x20,
            "ESC" => 0x1B,
            "TAB" => 0x09,
            "BACKSPACE" => 0x08,
            "DEL" => 0x2E,
            "ADD" => 0x6B,
            "SUBTRACT" => 0x6D,
            _ when key.Length == 1 => MapSingleCharacterVirtualKey(key[0]),
            _ => throw new InvalidOperationException($"Unsupported key: {key}")
        };

    private static ushort MapSingleCharacterVirtualKey(char value)
    {
        var mapped = VkKeyScan(value);
        if (mapped == -1)
        {
            throw new InvalidOperationException($"Unsupported character key: {value}");
        }

        return (ushort)(mapped & 0xFF);
    }

    private void SendVirtualKey(ushort vk, bool keyUp)
    {
        var scanCode = (ushort)MapVirtualKey(vk, 0); // MAPVK_VK_TO_VSC = 0

        var inputs = new INPUT[]
        {
            new()
            {
                type = KeyboardInputConstants.INPUT_KEYBOARD,
                U = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = vk,
                        wScan = scanCode,
                        dwFlags = keyUp ? KeyboardInputConstants.KEYEVENTF_KEYUP : 0,
                        time = 0,
                        dwExtraInfo = nint.Zero,
                    }
                }
            }
        };

        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (sent != inputs.Length)
        {
            var error = Marshal.GetLastWin32Error();
            throw new InvalidOperationException($"SendInput failed for virtual key 0x{vk:X2}. Win32Error={error}.");
        }
    }

    private void SendUnicodeCharacter(char value)
    {
        var inputs = new INPUT[]
        {
            new()
            {
                type = KeyboardInputConstants.INPUT_KEYBOARD,
                U = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = value,
                        dwFlags = KeyboardInputConstants.KEYEVENTF_UNICODE,
                        time = 0,
                        dwExtraInfo = nint.Zero,
                    }
                }
            },
            new()
            {
                type = KeyboardInputConstants.INPUT_KEYBOARD,
                U = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = value,
                        dwFlags = KeyboardInputConstants.KEYEVENTF_UNICODE | KeyboardInputConstants.KEYEVENTF_KEYUP,
                        time = 0,
                        dwExtraInfo = nint.Zero,
                    }
                }
            }
        };

        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (sent != inputs.Length)
        {
            var error = Marshal.GetLastWin32Error();
            throw new InvalidOperationException($"SendInput failed for unicode character {value}. Win32Error={error}.");
        }
    }

    private ActivationResult GetForegroundWindowInfo(bool? targetResolved, bool? targetActivated)
    {
        var capture = ForegroundWindowSnapshotCapture.Capture();
        var snapshot = capture.Snapshot;

        return new ActivationResult
        {
            TargetResolved = targetResolved,
            TargetActivated = targetActivated,
            ActualWindowHandle = capture.Handle,
            ActualProcessName = snapshot.ProcessName ?? string.Empty,
            ActualWindowTitle = snapshot.WindowTitle ?? string.Empty
        };
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern short VkKeyScan(char ch);

    [DllImport("user32.dll", EntryPoint = "MapVirtualKeyW", SetLastError = false)]
    private static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(nint hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint SetActiveWindow(nint hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BringWindowToTop(nint hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(nint hWnd, int nCmdShow);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private sealed class ActivationResult
    {
        public bool? TargetResolved { get; set; }

        public bool? TargetActivated { get; set; }

        public nint ActualWindowHandle { get; set; }

        public string ActualProcessName { get; set; } = string.Empty;

        public string ActualWindowTitle { get; set; } = string.Empty;
    }

    private static class WindowShowStyle
    {
        public const int Restore = 9;
    }
}
