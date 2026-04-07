using System.Runtime.InteropServices;

namespace DesktopBroker.Win32;

internal enum KeyboardInputKind
{
    TypeText,
    Keypress,
}

internal sealed record KeyboardInjectionRequest(
    KeyboardInputKind Kind,
    string? Text,
    IReadOnlyList<string>? Keys,
    string TargetApp);

[StructLayout(LayoutKind.Sequential)]
internal struct INPUT
{
    public uint type;
    public InputUnion U;
}

[StructLayout(LayoutKind.Explicit)]
internal struct InputUnion
{
    [FieldOffset(0)]
    public KEYBDINPUT ki;

    [FieldOffset(0)]
    public MOUSEINPUT mi;

    [FieldOffset(0)]
    public HARDWAREINPUT hi;
}

[StructLayout(LayoutKind.Sequential)]
internal struct KEYBDINPUT
{
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public nint dwExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
internal struct MOUSEINPUT
{
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public nint dwExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
internal struct HARDWAREINPUT
{
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
}

internal static class KeyboardInputConstants
{
    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
}
