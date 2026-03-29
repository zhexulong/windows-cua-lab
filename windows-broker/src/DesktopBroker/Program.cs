using DesktopBroker;
using DesktopBroker.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddEnvironmentVariables(prefix: "DESKTOP_BROKER_");
builder.Configuration.AddCommandLine(args);

builder.Services.Configure<BrokerOptions>(options =>
{
    options.Host = builder.Configuration["host"] ?? builder.Configuration["HOST"] ?? "127.0.0.1";
    options.Port = int.TryParse(builder.Configuration["port"] ?? builder.Configuration["PORT"], out var port) ? port : 9477;
    options.ApiKey = builder.Configuration["api-key"] ?? builder.Configuration["API_KEY"];
    options.ArtifactRoot = builder.Configuration["artifact-root"] ?? builder.Configuration["ARTIFACT_ROOT"] ?? "runtime";
    options.ScriptRoot = builder.Configuration["script-root"] ?? builder.Configuration["SCRIPT_ROOT"];
});
builder.Services.AddSingleton<BrokerRequestHandler>();

var app = builder.Build();
var options = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<BrokerOptions>>().Value;

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    host = options.Host,
    port = options.Port,
    windows = OperatingSystem.IsWindows(),
    timestamp = DateTimeOffset.UtcNow.ToString("O")
}));

app.MapPost("/v1/action", async (HttpContext context, BrokerRequestEnvelope request, BrokerRequestHandler handler, CancellationToken cancellationToken) =>
{
    if (!string.IsNullOrWhiteSpace(options.ApiKey))
    {
        var supplied = context.Request.Headers.Authorization.ToString();
        if (!string.Equals(supplied, $"Bearer {options.ApiKey}", StringComparison.Ordinal))
        {
            return Results.Unauthorized();
        }
    }

    var response = await handler.HandleAsync(request, cancellationToken);
    return Results.Json(response);
});

app.Run($"http://{options.Host}:{options.Port}");
