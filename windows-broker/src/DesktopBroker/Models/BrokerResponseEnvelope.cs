namespace DesktopBroker.Models;

public sealed class BrokerResponseEnvelope
{
    public string RequestId { get; set; } = string.Empty;

    public string Status { get; set; } = "failed";

    public string StartedAt { get; set; } = string.Empty;

    public string FinishedAt { get; set; } = string.Empty;

    public List<BrokerArtifact> Artifacts { get; set; } = [];

    public BrokerStateHandle? StateHandle { get; set; }

    public BrokerSafetyEvent SafetyEvent { get; set; } = new();

    public BrokerError? Error { get; set; }
}

public sealed class BrokerArtifact
{
    public string? Kind { get; set; }

    public string? MimeType { get; set; }

    public string? Ref { get; set; }

    public string? ContentBase64 { get; set; }
}

public sealed class BrokerStateHandle
{
    public string? ScreenshotRef { get; set; }

    public string? WindowRef { get; set; }

    public string? StateLabel { get; set; }

    public List<string>? EvidenceRefs { get; set; }
}

public sealed class BrokerSafetyEvent
{
    public string Decision { get; set; } = "review_required";

    public string? Reason { get; set; }

    public List<string>? PolicyRefs { get; set; }
}

public sealed class BrokerError
{
    public string? Code { get; set; }

    public string? Message { get; set; }
}
