using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace DesktopBroker.Win32;

public sealed class KeyboardInjectionService
{
    private readonly ILogger<KeyboardInjectionService> _logger;

    public KeyboardInjectionService(ILogger<KeyboardInjectionService> logger)
    {
        _logger = logger;
    }

    internal async Task<string> ExecuteAsync(KeyboardInjectionRequest request, CancellationToken cancellationToken)
    {
        ActivateTargetApp(request.TargetApp);

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

        return request.Kind switch
        {
            KeyboardInputKind.TypeText => $"{{\"status\":\"executed\",\"backend\":\"SendInput\",\"textLength\":{(request.Text ?? string.Empty).Length}}}",
            KeyboardInputKind.Keypress => $"{{\"status\":\"executed\",\"backend\":\"SendInput\",\"keys\":[{string.Join(",", (request.Keys ?? []).Select(key => $"\"{EscapeJson(key)}\""))}]}}",
            _ => throw new InvalidOperationException("Unsupported keyboard input kind.")
        };
    }

    private void ActivateTargetApp(string targetApp)
    {
        var lookupName = GetProcessLookupName(targetApp);
        if (string.IsNullOrWhiteSpace(lookupName))
        {
            return;
        }

        var process = Process.GetProcessesByName(lookupName)
            .FirstOrDefault(candidate => candidate.MainWindowHandle != nint.Zero);

        if (process is null)
        {
            _logger.LogDebug("No main-window process found for target app {TargetApp}", targetApp);
            return;
        }

        SetForegroundWindow(process.MainWindowHandle);
        Thread.Sleep(150);
    }

    private static string GetProcessLookupName(string value)
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

    private static string EscapeJson(string value)
        => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern short VkKeyScan(char ch);

    [DllImport("user32.dll", EntryPoint = "MapVirtualKeyW", SetLastError = false)]
    private static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(nint hWnd);
}
