using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using DesktopBroker.Models;

namespace DesktopBroker.Win32;

internal static class ForegroundWindowSnapshotCapture
{
    internal static ForegroundWindowCaptureResult Capture()
    {
        var handle = GetForegroundWindow();
        if (handle == nint.Zero)
        {
            return new ForegroundWindowCaptureResult
            {
                Handle = nint.Zero,
                Snapshot = new BrokerForegroundWindowSnapshot()
            };
        }

        _ = GetWindowThreadProcessId(handle, out var processId);
        string? processName = null;
        if (processId != 0)
        {
            try
            {
                processName = Process.GetProcessById((int)processId).ProcessName;
            }
            catch
            {
                processName = null;
            }
        }

        var titleBuilder = new StringBuilder(1024);
        _ = GetWindowText(handle, titleBuilder, titleBuilder.Capacity);

        return new ForegroundWindowCaptureResult
        {
            Handle = handle,
            Snapshot = new BrokerForegroundWindowSnapshot
            {
                Hwnd = handle.ToInt64().ToString(),
                Pid = processId != 0 ? processId.ToString() : null,
                ProcessName = string.IsNullOrWhiteSpace(processName) ? null : processName,
                WindowTitle = string.IsNullOrWhiteSpace(titleBuilder.ToString()) ? null : titleBuilder.ToString(),
            }
        };
    }

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(nint hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);
}

internal sealed class ForegroundWindowCaptureResult
{
    public nint Handle { get; init; }

    public BrokerForegroundWindowSnapshot Snapshot { get; init; } = new();
}
