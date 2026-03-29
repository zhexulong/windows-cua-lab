namespace DesktopBroker;

public sealed class BrokerOptions
{
    public string Host { get; set; } = "127.0.0.1";

    public int Port { get; set; } = 9477;

    public string? ApiKey { get; set; }

    public string ArtifactRoot { get; set; } = "runtime";

    public string? ScriptRoot { get; set; }
}
