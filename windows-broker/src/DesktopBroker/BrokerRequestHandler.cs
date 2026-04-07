using System.Diagnostics;
using System.Text.Json;
using DesktopBroker.Models;
using DesktopBroker.Win32;
using Microsoft.Extensions.Options;

namespace DesktopBroker;

public sealed class BrokerRequestHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly BrokerOptions _options;
    private readonly ILogger<BrokerRequestHandler> _logger;
    private readonly KeyboardInjectionService _keyboardInjectionService;
    private readonly string _scriptsRoot;

    public BrokerRequestHandler(IOptions<BrokerOptions> options, ILogger<BrokerRequestHandler> logger, KeyboardInjectionService keyboardInjectionService, IWebHostEnvironment environment)
    {
        _options = options.Value;
        _logger = logger;
        _keyboardInjectionService = keyboardInjectionService;
        var stagedScriptsRoot = Path.Combine(environment.ContentRootPath, "scripts");
        var repoScriptsRoot = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..", "..", "scripts"));
        _scriptsRoot = !string.IsNullOrWhiteSpace(_options.ScriptRoot)
            ? _options.ScriptRoot
            : Directory.Exists(stagedScriptsRoot)
                ? stagedScriptsRoot
                : repoScriptsRoot;
    }

    public async Task<BrokerResponseEnvelope> HandleAsync(BrokerRequestEnvelope request, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var safetyEvent = ValidatePolicy(request);
        if (safetyEvent.Decision != "allowed")
        {
            return BuildResponse(request.RequestId, "blocked", startedAt, safetyEvent, [], null, null);
        }

        try
        {
            return request.Action.Kind switch
            {
                "screenshot" => await HandleScreenshotAsync(request, startedAt, safetyEvent, cancellationToken),
                "click" => await HandleClickAsync(request, startedAt, safetyEvent, cancellationToken),
                "double_click" => await HandleDoubleClickAsync(request, startedAt, safetyEvent, cancellationToken),
                "move" => await HandleMoveAsync(request, startedAt, safetyEvent, cancellationToken),
                "scroll" => await HandleScrollAsync(request, startedAt, safetyEvent, cancellationToken),
                "drag" => await HandleDragAsync(request, startedAt, safetyEvent, cancellationToken),
                "type" => await HandleTypeAsync(request, startedAt, safetyEvent, cancellationToken),
                "keypress" => await HandleKeypressAsync(request, startedAt, safetyEvent, cancellationToken),
                "hotkey" => await HandleHotkeyAsync(request, startedAt, safetyEvent, cancellationToken),
                _ => BuildResponse(
                    request.RequestId,
                    "blocked",
                    startedAt,
                    new BrokerSafetyEvent
                    {
                        Decision = "blocked",
                        Reason = $"Action kind '{request.Action.Kind}' is not allowed.",
                        PolicyRefs = ["allowed-action-set"]
                    },
                    [],
                    null,
                    null)
            };
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Broker action failed for {RequestId}", request.RequestId);
            return BuildResponse(
                request.RequestId,
                "failed",
                startedAt,
                new BrokerSafetyEvent
                {
                    Decision = "review_required",
                    Reason = exception.Message,
                    PolicyRefs = ["broker-error"]
                },
                [],
                null,
                new BrokerError
                {
                    Code = "broker_action_failed",
                    Message = exception.Message
                });
        }
    }

    private BrokerSafetyEvent ValidatePolicy(BrokerRequestEnvelope request)
    {
        if (request.PolicyContext.RequiresHumanReview)
        {
            return new BrokerSafetyEvent
            {
                Decision = "review_required",
                Reason = "Action is marked as requiring human review.",
                PolicyRefs = ["human-review"]
            };
        }

        if (request.Action.Kind == "type" && request.Action.Text is { Length: > 200 })
        {
            return new BrokerSafetyEvent
            {
                Decision = "blocked",
                Reason = "Type action exceeds the bounded text length.",
                PolicyRefs = ["bounded-type"]
            };
        }

        return new BrokerSafetyEvent
        {
            Decision = "allowed",
            Reason = "Action passed the bounded broker policy checks.",
            PolicyRefs = ["allowed-action-set", "bounded-broker"]
        };
    }

    private async Task<BrokerResponseEnvelope> HandleScreenshotAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
    {
        var result = await InvokeScriptAsync(
            "capture-screenshot.ps1",
            [
                ("Scope", request.Action.Scope ?? "window"),
                ("Target", request.Action.Target ?? string.Empty)
            ],
            cancellationToken);
        var screenshot = JsonSerializer.Deserialize<ScreenshotScriptResult>(result.StandardOutput, JsonOptions)
            ?? throw new InvalidOperationException("Capture screenshot script returned no payload.");

        var artifacts = new List<BrokerArtifact>
        {
            new()
            {
                Kind = "screenshot",
                MimeType = "image/png",
                Ref = screenshot.Ref,
                ContentBase64 = screenshot.Base64
            }
        };

        return BuildResponse(
            request.RequestId,
            "executed",
            startedAt,
            safetyEvent,
            artifacts,
            new BrokerStateHandle
            {
                ScreenshotRef = screenshot.Ref,
                WindowRef = request.Action.Target,
                StateLabel = "captured",
                EvidenceRefs = [screenshot.Ref ?? "capture"]
            },
            null);
    }

    private Task<BrokerResponseEnvelope> HandleClickAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteSimpleActionAsync(
            request,
            startedAt,
            safetyEvent,
            "invoke-click.ps1",
            [
                ("X", request.Action.Position?.X.ToString() ?? throw new InvalidOperationException("Click action requires position.x.")),
                ("Y", request.Action.Position?.Y.ToString() ?? throw new InvalidOperationException("Click action requires position.y.")),
                ("Button", request.Action.Button ?? "left"),
                ("TargetApp", ExtractExpectedTargetApp(request)),
                ("ClickCount", "1")
            ],
            cancellationToken);

    private Task<BrokerResponseEnvelope> HandleDoubleClickAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteSimpleActionAsync(
            request,
            startedAt,
            safetyEvent,
            "invoke-click.ps1",
            [
                ("X", request.Action.Position?.X.ToString() ?? throw new InvalidOperationException("Click action requires position.x.")),
                ("Y", request.Action.Position?.Y.ToString() ?? throw new InvalidOperationException("Click action requires position.y.")),
                ("Button", request.Action.Button ?? "left"),
                ("TargetApp", ExtractExpectedTargetApp(request)),
                ("ClickCount", "2")
            ],
            cancellationToken);

    private Task<BrokerResponseEnvelope> HandleMoveAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteSimpleActionAsync(
            request,
            startedAt,
            safetyEvent,
            "invoke-move.ps1",
            [
                ("X", request.Action.Position?.X.ToString() ?? throw new InvalidOperationException("Move action requires position.x.")),
                ("Y", request.Action.Position?.Y.ToString() ?? throw new InvalidOperationException("Move action requires position.y.")),
                ("TargetApp", ExtractExpectedTargetApp(request))
            ],
            cancellationToken);

    private Task<BrokerResponseEnvelope> HandleScrollAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteSimpleActionAsync(
            request,
            startedAt,
            safetyEvent,
            "invoke-scroll.ps1",
            [
                ("X", request.Action.Position?.X.ToString() ?? "0"),
                ("Y", request.Action.Position?.Y.ToString() ?? "0"),
                ("DeltaX", request.Action.DeltaX?.ToString() ?? throw new InvalidOperationException("Scroll action requires delta_x.")),
                ("DeltaY", request.Action.DeltaY?.ToString() ?? throw new InvalidOperationException("Scroll action requires delta_y.")),
                ("Keys", string.Join(",", request.Action.Keys ?? [])),
                ("TargetApp", ExtractExpectedTargetApp(request))
            ],
            cancellationToken);

    private Task<BrokerResponseEnvelope> HandleDragAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteSimpleActionAsync(
            request,
            startedAt,
            safetyEvent,
            "invoke-drag.ps1",
            [
                ("FromX", request.Action.From?.X.ToString() ?? throw new InvalidOperationException("Drag action requires from.x.")),
                ("FromY", request.Action.From?.Y.ToString() ?? throw new InvalidOperationException("Drag action requires from.y.")),
                ("ToX", request.Action.To?.X.ToString() ?? throw new InvalidOperationException("Drag action requires to.x.")),
                ("ToY", request.Action.To?.Y.ToString() ?? throw new InvalidOperationException("Drag action requires to.y."))
            ],
            cancellationToken);

    private Task<BrokerResponseEnvelope> HandleTypeAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteKeyboardActionAsync(
            request,
            startedAt,
            safetyEvent,
            new KeyboardInjectionRequest(
                KeyboardInputKind.TypeText,
                request.Action.Text ?? throw new InvalidOperationException("Type action requires text."),
                null,
                ExtractExpectedTargetApp(request)),
            cancellationToken);

    private Task<BrokerResponseEnvelope> HandleHotkeyAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteKeyboardActionAsync(
            request,
            startedAt,
            safetyEvent,
            new KeyboardInjectionRequest(
                KeyboardInputKind.Keypress,
                null,
                request.Action.Keys ?? throw new InvalidOperationException("Hotkey action requires keys."),
                ExtractExpectedTargetApp(request)),
            cancellationToken);

    private Task<BrokerResponseEnvelope> HandleKeypressAsync(BrokerRequestEnvelope request, DateTimeOffset startedAt, BrokerSafetyEvent safetyEvent, CancellationToken cancellationToken)
        => ExecuteKeyboardActionAsync(
            request,
            startedAt,
            safetyEvent,
            new KeyboardInjectionRequest(
                KeyboardInputKind.Keypress,
                null,
                request.Action.Keys ?? throw new InvalidOperationException("Keypress action requires keys."),
                ExtractExpectedTargetApp(request)),
            cancellationToken);

    private async Task<BrokerResponseEnvelope> ExecuteKeyboardActionAsync(
        BrokerRequestEnvelope request,
        DateTimeOffset startedAt,
        BrokerSafetyEvent safetyEvent,
        KeyboardInjectionRequest injectionRequest,
        CancellationToken cancellationToken)
    {
        var output = await _keyboardInjectionService.ExecuteAsync(injectionRequest, cancellationToken);
        var artifacts = string.IsNullOrWhiteSpace(output)
            ? []
            : new List<BrokerArtifact>
            {
                new()
                {
                    Kind = "log",
                    MimeType = "application/json",
                    Ref = "KeyboardInjectionService",
                    ContentBase64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(output))
                }
            };

        return BuildResponse(
            request.RequestId,
            "executed",
            startedAt,
            safetyEvent,
            artifacts,
            new BrokerStateHandle
            {
                WindowRef = request.Action.Target,
                StateLabel = "keyboard-action-complete"
            },
            null);
    }

    private async Task<BrokerResponseEnvelope> ExecuteSimpleActionAsync(
        BrokerRequestEnvelope request,
        DateTimeOffset startedAt,
        BrokerSafetyEvent safetyEvent,
        string scriptName,
        IReadOnlyList<(string Name, string Value)> parameters,
        CancellationToken cancellationToken)
    {
        var result = await InvokeScriptAsync(scriptName, parameters, cancellationToken);
        var artifacts = string.IsNullOrWhiteSpace(result.StandardOutput)
            ? []
            : new List<BrokerArtifact>
            {
                new()
                {
                    Kind = "log",
                    MimeType = "application/json",
                    Ref = scriptName,
                    ContentBase64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(result.StandardOutput))
                }
            };

        return BuildResponse(
            request.RequestId,
            "executed",
            startedAt,
            safetyEvent,
            artifacts,
            new BrokerStateHandle
            {
                WindowRef = request.Action.Target,
                StateLabel = "action-complete"
            },
            null);
    }

    private async Task<ScriptResult> InvokeScriptAsync(string scriptName, IReadOnlyList<(string Name, string Value)> parameters, CancellationToken cancellationToken)
    {
        var scriptPath = Path.Combine(_scriptsRoot, scriptName);
        if (!File.Exists(scriptPath))
        {
            throw new FileNotFoundException($"Missing broker script: {scriptPath}");
        }

        if (!OperatingSystem.IsWindows())
        {
            throw new InvalidOperationException("Desktop broker actuation scripts must run on Windows.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };

        startInfo.ArgumentList.Add("-NoLogo");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);

        foreach (var parameter in parameters)
        {
            startInfo.ArgumentList.Add($"-{parameter.Name}");
            startInfo.ArgumentList.Add(parameter.Value);
        }

        using var process = new Process { StartInfo = startInfo };
        process.Start();

        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);

        var standardOutput = await outputTask;
        var standardError = await errorTask;

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"Script '{scriptName}' failed: {standardError}");
        }

        return new ScriptResult(standardOutput.Trim(), standardError.Trim());
    }

    private static string ExtractExpectedTargetApp(BrokerRequestEnvelope request)
    {
        if (request.ExpectedState is null)
        {
            return string.Empty;
        }

        if (!request.ExpectedState.TryGetValue("targetApp", out var targetAppValue) || targetAppValue is null)
        {
            return string.Empty;
        }

        return targetAppValue switch
        {
            string direct => direct,
            JsonElement { ValueKind: JsonValueKind.String } json => json.GetString() ?? string.Empty,
            _ => targetAppValue.ToString() ?? string.Empty
        };
    }


    private static BrokerResponseEnvelope BuildResponse(
        string requestId,
        string status,
        DateTimeOffset startedAt,
        BrokerSafetyEvent safetyEvent,
        List<BrokerArtifact> artifacts,
        BrokerStateHandle? stateHandle,
        BrokerError? error)
        => new()
        {
            RequestId = requestId,
            Status = status,
            StartedAt = startedAt.ToString("O"),
            FinishedAt = DateTimeOffset.UtcNow.ToString("O"),
            SafetyEvent = safetyEvent,
            Artifacts = artifacts,
            StateHandle = stateHandle,
            Error = error
        };

    private sealed record ScriptResult(string StandardOutput, string StandardError);

    private sealed class ScreenshotScriptResult
    {
        public string? Ref { get; set; }

        public string? Base64 { get; set; }
    }
}
