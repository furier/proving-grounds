var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello World!");

app.MapGet("/{files}", (int files) => {
    var stream = new MemoryStream();
    Zip.Write(stream, files);
    stream.Position = 0;
    return Results.Stream(stream, "application/octet-stream", "test.zip");
});

app.Run();
