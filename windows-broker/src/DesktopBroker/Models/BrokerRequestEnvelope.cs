namespace DesktopBroker.Models;

public sealed class BrokerRequestEnvelope
{
    public string RequestId { get; set; } = string.Empty;

    public string SessionId { get; set; } = string.Empty;

    public BrokerAction Action { get; set; } = new();

    public BrokerPolicyContext PolicyContext { get; set; } = new();

    public Dictionary<string, object?>? ExpectedState { get; set; }
}

public sealed class BrokerAction
{
    public string Kind { get; set; } = string.Empty;

    public string? Scope { get; set; }

    public string? Target { get; set; }

    public string? Text { get; set; }

    public List<string>? Keys { get; set; }

    public string? Button { get; set; }

    public BrokerPoint? Position { get; set; }

    public BrokerPoint? From { get; set; }

    public BrokerPoint? To { get; set; }
}

public sealed class BrokerPoint
{
    public int X { get; set; }

    public int Y { get; set; }
}

public sealed class BrokerPolicyContext
{
    public List<string> AllowedRoots { get; set; } = [];

    public List<string> BlockedCapabilities { get; set; } = [];

    public string Operator { get; set; } = "unknown";

    public bool RequiresHumanReview { get; set; }
}
